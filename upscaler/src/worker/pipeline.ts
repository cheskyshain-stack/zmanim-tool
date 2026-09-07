// The render pipeline. This is the part that lets a phone produce a 28,800 x 10,800
// file without running out of memory.
//
// The trick is to invert the obvious loop. Rather than upscale the whole image and then
// resize it (which would need the whole 402 megapixel intermediate in memory at once),
// the pipeline walks the OUTPUT in horizontal bands. For each band it works out which
// intermediate rows that band reads from, which source rows those in turn came from,
// runs only those through the network, resizes them, sharpens them and hands them
// straight to a streaming encoder. Peak memory is one band, whatever the final size is.
//
// Early passes are an exception: while an intermediate is still small enough to hold, it
// is held. Recomputing the first pass once per band would cost far more than the memory
// it saves, because each band would drag its tile padding along with it.

import { CHANNELS, buildTaps, resampleX, resampleYBand, sourceSpan } from '../lib/lanczos'
import {
  deblockInPlace,
  denoiseInPlace,
  sharpenInPlace,
  sharpenMargin,
} from '../lib/enhance'
import { PngEncoder } from '../lib/encode/png'
import { TiffEncoder } from '../lib/encode/tiff'
import { JpegEncoder } from '../lib/encode/jpeg'
import { Cancelled, loadModel, upscaleBuffer, upscaleInto } from './engine'
import type { Phase, RenderRequest } from './protocol'

export interface Sink {
  writeRows(rgb: Uint8Array, rows: number): void
  finish(): Blob
}

function makeEncoder(request: RenderRequest): Sink {
  const { targetWidth: w, targetHeight: h, dpi, format, tuning } = request
  if (format === 'tiff') {
    return new TiffEncoder(w, h, { dpi, level: tuning.deflateLevel })
  }
  if (format === 'jpeg') {
    return new JpegEncoder(w, h, { dpi, quality: request.jpegQuality })
  }
  return new PngEncoder(w, h, {
    dpi,
    level: tuning.deflateLevel,
    filter: tuning.pngFilter,
  })
}

/** RGBA bytes to interleaved RGB float in 0-255, which is the models' input range. */
export function rgbaToFloatRgb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height * CHANNELS)
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 4, q += CHANNELS) {
    out[q] = rgba[p]
    out[q + 1] = rgba[p + 1]
    out[q + 2] = rgba[p + 2]
  }
  return out
}

export interface RunHooks {
  onPhase(phase: Phase, progress: number, detail: string): void
  shouldCancel(): boolean
}

export interface RenderResult {
  blob: Blob
  width: number
  height: number
}

export async function runRender(
  request: RenderRequest,
  hooks: RunHooks,
): Promise<RenderResult> {
  const { tuning } = request
  const check = () => {
    if (hooks.shouldCancel()) throw new Cancelled()
  }

  hooks.onPhase('preparing', 0, 'Reading image')
  const expected = request.cropWidth * request.cropHeight * 4
  if (request.pixels.byteLength !== expected) {
    throw new Error(
      `Pixel buffer is ${request.pixels.byteLength} bytes for a ` +
        `${request.cropWidth} x ${request.cropHeight} crop, which needs ${expected}.`,
    )
  }
  let current = rgbaToFloatRgb(
    new Uint8ClampedArray(request.pixels),
    request.cropWidth,
    request.cropHeight,
  )
  let width = request.cropWidth
  let height = request.cropHeight

  // Clean the source before anything enlarges its faults.
  if (request.deblock) {
    hooks.onPhase('preparing', 0.02, 'Reducing JPEG artifacts')
    deblockInPlace(current, width, height)
  }
  if (request.denoise > 0) {
    hooks.onPhase('preparing', 0.04, 'Reducing noise')
    denoiseInPlace(current, width, height, request.denoise)
  }
  check()

  // Total AI work, used to weight the progress bar honestly across passes of very
  // different cost. The last pass is usually most of the job.
  const passPixels: number[] = []
  {
    let w = width
    let h = height
    for (const pass of request.passes) {
      w *= pass.scale
      h *= pass.scale
      passPixels.push(w * h)
    }
  }
  const totalWork = passPixels.reduce((a, b) => a + b, 0) || 1
  let workDone = 0

  // --- passes whose result still fits in memory run whole ------------------
  //
  // Each of these writes its result straight out as bytes and becomes the input to the
  // next one. Holding a 25 megapixel intermediate costs 75 MB as bytes and 300 MB as
  // floats, and the next pass reads it back as 0-255 either way, so bytes it is. From
  // the streamed passes onward everything stays in float, because the resize and the
  // sharpen both want the precision and by then only one band exists at a time.
  let base: Float32Array | Uint8Array = current
  let splitIndex = 0
  for (; splitIndex < request.passes.length; splitIndex++) {
    const pass = request.passes[splitIndex]
    const nextPixels = width * pass.scale * height * pass.scale
    if (nextPixels > tuning.cacheBudget) break

    hooks.onPhase('loading-model', workDone / totalWork, `Loading ${pass.scale}x model`)
    const model = await loadModel(request.baseUrl, pass.family, pass.scale)
    check()

    const before = workDone
    const share = passPixels[splitIndex]
    const nextWidth = width * pass.scale
    const nextHeight = height * pass.scale
    base = await upscaleInto(
      model,
      pass.scale,
      base,
      width,
      height,
      new Uint8Array(nextWidth * nextHeight * CHANNELS),
      {
        tile: tuning.tile,
        pad: tuning.pad,
        shouldCancel: hooks.shouldCancel,
        onProgress: (done, total) => {
          hooks.onPhase(
            'upscaling',
            (before + (share * done) / total) / totalWork,
            `Pass ${splitIndex + 1} of ${request.passes.length}, ${pass.scale}x`,
          )
        },
      },
    )
    width = nextWidth
    height = nextHeight
    workDone += share
  }
  current = new Float32Array(0)

  const streamed = request.passes.slice(splitIndex)
  const streamFactor = streamed.reduce((n, p) => n * p.scale, 1)
  const intermediateWidth = width * streamFactor
  const intermediateHeight = height * streamFactor

  // --- the streaming band loop ---------------------------------------------
  const content = request.content
  const contentWidth = Math.round(content.width)
  const contentHeight = Math.round(content.height)
  const contentX = Math.round(content.x)
  const contentY = Math.round(content.y)

  hooks.onPhase('resizing', workDone / totalWork, 'Planning the final resize')
  const xTaps = buildTaps(intermediateWidth, contentWidth)
  const yTaps = buildTaps(intermediateHeight, contentHeight)
  const margin = sharpenMargin(request.sharpen)

  // Size the band so the two big buffers it needs stay inside the budget.
  const rowRatio = intermediateHeight / contentHeight
  const bytesPerOutputRow =
    (intermediateWidth + contentWidth) * CHANNELS * 4 * Math.max(1, rowRatio)
  const bandRows = Math.max(
    8,
    Math.min(contentHeight, Math.floor(tuning.bandBudget / bytesPerOutputRow)),
  )

  const models = await Promise.all(
    streamed.map(async (pass, i) => {
      hooks.onPhase(
        'loading-model',
        workDone / totalWork,
        `Loading ${pass.scale}x model (${i + 1} of ${streamed.length})`,
      )
      return loadModel(request.baseUrl, pass.family, pass.scale)
    }),
  )
  check()

  const encoder = makeEncoder(request)
  const [borderR, borderG, borderB] = request.borderColor
  const targetRowBytes = request.targetWidth * CHANNELS
  const borderRow = new Uint8Array(targetRowBytes)
  for (let x = 0; x < request.targetWidth; x++) {
    borderRow[x * CHANNELS] = borderR
    borderRow[x * CHANNELS + 1] = borderG
    borderRow[x * CHANNELS + 2] = borderB
  }

  // Chunked, not allocated whole. "Fit whole image" on a tall print can put thousands
  // of border rows above the image, and 28,800 pixels wide by 5,000 rows is 432 MB in
  // one go, which would defeat the entire point of streaming the rest.
  const BORDER_CHUNK = 256
  const writeBorderRows = (count: number) => {
    if (count <= 0) return
    const rows = Math.min(count, BORDER_CHUNK)
    const block = new Uint8Array(targetRowBytes * rows)
    for (let i = 0; i < rows; i++) block.set(borderRow, i * targetRowBytes)
    let remaining = count
    while (remaining > 0) {
      const take = Math.min(rows, remaining)
      encoder.writeRows(block, take)
      remaining -= take
    }
  }

  writeBorderRows(contentY)

  const streamWork = streamed.reduce((sum, _, i) => sum + passPixels[splitIndex + i], 0)
  const streamBase = workDone

  for (let oy = 0; oy < contentHeight; oy += bandRows) {
    check()
    const bandEnd = Math.min(oy + bandRows, contentHeight)
    // Sharpening reads past the edges of its band, so compute a wider slice and throw
    // the extra rows away. Without this every band boundary would show as a faint line.
    const from = Math.max(0, oy - margin)
    const to = Math.min(contentHeight, bandEnd + margin)

    const span = sourceSpan(yTaps, from, to)
    const bandProgress = (streamBase + (streamWork * oy) / contentHeight) / totalWork

    // Walk back through the streamed passes to find which base rows this band needs,
    // widening by the tile padding at every level so no pass ever sees a fabricated edge.
    const wants: Array<{ from: number; to: number }> = new Array(streamed.length)
    let need = { from: span.from, to: span.to }
    for (let k = streamed.length - 1; k >= 0; k--) {
      wants[k] = need
      const scale = streamed[k].scale
      const levelHeight = height * streamed.slice(0, k).reduce((n, p) => n * p.scale, 1)
      need = {
        from: Math.max(0, Math.floor(need.from / scale) - tuning.pad),
        to: Math.min(levelHeight, Math.ceil(need.to / scale) + tuning.pad),
      }
    }

    let slabRows = need.to - need.from
    let slabFrom = need.from
    let slabWidth = width
    // Annotated because a later assignment is a subarray view, not a fresh buffer.
    let slab: Float32Array = new Float32Array(slabWidth * slabRows * CHANNELS)
    slab.set(
      base.subarray(need.from * slabWidth * CHANNELS, need.to * slabWidth * CHANNELS),
    )

    for (let k = 0; k < streamed.length; k++) {
      const pass = streamed[k]
      hooks.onPhase('upscaling', bandProgress, `Upscaling ${pass.scale}x`)
      const produced = await upscaleBuffer(
        models[k],
        pass.scale,
        slab,
        slabWidth,
        slabRows,
        {
          tile: tuning.tile,
          pad: tuning.pad,
          shouldCancel: hooks.shouldCancel,
        },
      )
      const producedFrom = slabFrom * pass.scale
      const producedWidth = slabWidth * pass.scale
      const want = wants[k]
      const keepRows = want.to - want.from
      const offset = (want.from - producedFrom) * producedWidth * CHANNELS
      slab = produced.subarray(offset, offset + keepRows * producedWidth * CHANNELS)
      slabFrom = want.from
      slabRows = keepRows
      slabWidth = producedWidth
    }

    hooks.onPhase('resizing', bandProgress, 'Resizing to exact print size')
    const wide = resampleX(slab, intermediateWidth, slabRows, xTaps)
    const band = resampleYBand(
      wide,
      contentWidth,
      span.from,
      slabRows,
      yTaps,
      from,
      to,
    )

    if (request.sharpen !== 'none') {
      hooks.onPhase('enhancing', bandProgress, 'Sharpening')
      sharpenInPlace(band, contentWidth, to - from, request.sharpen)
    }

    hooks.onPhase('exporting', bandProgress, 'Writing rows')
    const rows = bandEnd - oy
    const skip = oy - from
    const out = new Uint8Array(targetRowBytes * rows)
    for (let r = 0; r < rows; r++) {
      const dst = r * targetRowBytes
      out.set(borderRow, dst)
      const srcRow = (skip + r) * contentWidth * CHANNELS
      const target = dst + contentX * CHANNELS
      for (let i = 0; i < contentWidth * CHANNELS; i++) {
        const v = band[srcRow + i]
        out[target + i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0
      }
    }
    encoder.writeRows(out, rows)
  }

  writeBorderRows(request.targetHeight - contentY - contentHeight)

  hooks.onPhase('exporting', 0.99, 'Finishing the file')
  const blob = encoder.finish()
  hooks.onPhase('done', 1, 'Done')
  return { blob, width: request.targetWidth, height: request.targetHeight }
}
