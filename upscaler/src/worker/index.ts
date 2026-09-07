// Worker entry point. Everything expensive happens here so the interface stays
// responsive: a 300 megapixel export runs for a long time and must never be the reason
// a scroll stutters or a Cancel button stops responding.

import {
  CHANNELS,
  buildTaps,
  resampleImage,
  resampleX,
  resampleYBand,
} from '../lib/lanczos'
import { deblockInPlace, denoiseInPlace, sharpenInPlace } from '../lib/enhance'
import type { SharpenLevel } from '../lib/enhance'
import { PngEncoder } from '../lib/encode/png'
import { TiffEncoder } from '../lib/encode/tiff'
import { JpegEncoder } from '../lib/encode/jpeg'
import { Cancelled, benchmark, currentBackend, initBackend, loadModel, upscaleBuffer } from './engine'
import { rgbaToFloatRgb, runRender } from './pipeline'
import type {
  BenchmarkRequest,
  ExportFormat,
  PreviewRequest,
  RenderRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

const cancelled = new Set<number>()

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelled.add(request.id)
    return
  }

  try {
    await initBackend()
    if (request.type === 'render') await handleRender(request)
    else if (request.type === 'preview') await handlePreview(request)
    else if (request.type === 'benchmark') await handleBenchmark(request)
  } catch (error) {
    const isCancel = error instanceof Cancelled || cancelled.has(request.id)
    post({
      type: 'error',
      id: request.id,
      message: isCancel ? 'Cancelled' : describe(error),
      cancelled: isCancel,
    })
  } finally {
    cancelled.delete(request.id)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // Out of memory surfaces in several unhelpful shapes across browsers. Recognise the
    // common ones and say something the user can act on.
    if (/out of memory|allocation failed|Array buffer allocation/i.test(error.message)) {
      return (
        'The device ran out of memory. Try a lower DPI, a smaller print size, or the ' +
        'Fast model.'
      )
    }
    if (/texture|WebGL|context lost/i.test(error.message)) {
      return (
        'The graphics backend failed part way through, which usually means the job was ' +
        'too large for this device. Try a lower DPI or a smaller tile size in Settings.'
      )
    }
    return error.message
  }
  return String(error)
}

async function handleRender(request: RenderRequest): Promise<void> {
  const started = performance.now()
  let lastSent = 0
  const result = await runRender(request, {
    shouldCancel: () => cancelled.has(request.id),
    onPhase: (phase, progress, detail) => {
      // Throttle: the band loop reports often and flooding the main thread with
      // postMessage is itself a source of jank.
      const now = performance.now()
      if (now - lastSent < 100 && progress < 1) return
      lastSent = now
      post({ type: 'progress', id: request.id, phase, progress, detail })
    },
  })
  post({
    type: 'render-done',
    id: request.id,
    blob: result.blob,
    width: result.width,
    height: result.height,
    backend: currentBackend(),
    elapsedMs: performance.now() - started,
  })
}

async function handlePreview(request: PreviewRequest): Promise<void> {
  let buffer = rgbaToFloatRgb(
    new Uint8ClampedArray(request.pixels),
    request.width,
    request.height,
  )
  let width = request.width
  let height = request.height

  if (request.deblock) deblockInPlace(buffer, width, height)
  if (request.denoise > 0) denoiseInPlace(buffer, width, height, request.denoise)

  const total = request.passes.length || 1
  for (let i = 0; i < request.passes.length; i++) {
    if (cancelled.has(request.id)) throw new Cancelled()
    const pass = request.passes[i]
    post({
      type: 'progress',
      id: request.id,
      phase: 'upscaling',
      progress: i / total,
      detail: `Preview pass ${i + 1} of ${total}`,
    })
    const model = await loadModel(request.baseUrl, pass.family, pass.scale)
    buffer = await upscaleBuffer(model, pass.scale, buffer, width, height, {
      tile: request.tuning.tile,
      pad: request.tuning.pad,
      shouldCancel: () => cancelled.has(request.id),
    })
    width *= pass.scale
    height *= pass.scale
  }

  // Same final resize the real export does, so the preview is not a flattering lie.
  const resized =
    width === request.outWidth && height === request.outHeight
      ? buffer
      : resampleImage(buffer, width, height, request.outWidth, request.outHeight)
  sharpenInPlace(resized, request.outWidth, request.outHeight, request.sharpen)

  const rgba = new Uint8ClampedArray(request.outWidth * request.outHeight * 4)
  for (let i = 0, p = 0, q = 0; i < request.outWidth * request.outHeight; i++, p += 4, q += CHANNELS) {
    rgba[p] = clamp(resized[q])
    rgba[p + 1] = clamp(resized[q + 1])
    rgba[p + 2] = clamp(resized[q + 2])
    rgba[p + 3] = 255
  }
  post(
    {
      type: 'preview-done',
      id: request.id,
      pixels: rgba.buffer,
      width: request.outWidth,
      height: request.outHeight,
    },
    [rgba.buffer],
  )
}

function clamp(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0
}

async function handleBenchmark(request: BenchmarkRequest): Promise<void> {
  // Time the pass that dominates the job: the last one, which produces the most pixels.
  const pass = request.passes[request.passes.length - 1] ?? {
    family: 'esrgan-medium' as const,
    scale: 4 as const,
  }
  const model = await loadModel(request.baseUrl, pass.family, pass.scale)
  const pixelsPerSecond = await benchmark(model, pass.scale)
  post({
    type: 'benchmark-done',
    id: request.id,
    backend: currentBackend(),
    pixelsPerSecond,
    outputPixelsPerSecond: benchmarkOutput(
      request.format,
      request.jpegQuality,
      request.sharpen,
    ),
  })
}

/**
 * Times the tail of the pipeline on a real band: resize, sharpen, encode. Runs the same
 * code the export runs, on the same format and settings, so the number is the device's
 * own rather than a constant that was true on somebody else's laptop.
 */
function benchmarkOutput(
  format: ExportFormat,
  quality: number,
  sharpen: SharpenLevel,
): number {
  const width = 512
  const rows = 256
  // A slightly larger source than output, which is the shape of the real final step.
  const sourceWidth = 584
  const sourceRows = 292
  const slab = new Float32Array(sourceWidth * sourceRows * CHANNELS)
  for (let i = 0; i < slab.length; i++) slab[i] = (i * 13) % 256

  const started = performance.now()
  const xTaps = buildTaps(sourceWidth, width)
  const yTaps = buildTaps(sourceRows, rows)
  const wide = resampleX(slab, sourceWidth, sourceRows, xTaps)
  const band = resampleYBand(wide, width, 0, sourceRows, yTaps, 0, rows)
  sharpenInPlace(band, width, rows, sharpen)

  const bytes = new Uint8Array(width * rows * CHANNELS)
  for (let i = 0; i < bytes.length; i++) {
    const v = band[i]
    bytes[i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0
  }
  const encoder =
    format === 'tiff'
      ? new TiffEncoder(width, rows, { dpi: 300 })
      : format === 'jpeg'
        ? new JpegEncoder(width, rows, { dpi: 300, quality })
        : new PngEncoder(width, rows, { dpi: 300 })
  encoder.writeRows(bytes, rows)
  encoder.finish()

  const elapsed = (performance.now() - started) / 1000
  return (width * rows) / Math.max(elapsed, 1e-6)
}
