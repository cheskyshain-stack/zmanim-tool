// The AI super resolution engine: backend selection, model loading and tiled inference.
//
// Everything here runs inside a Web Worker. TensorFlow.js picks WebGPU when the browser
// has it, WebGL otherwise, and plain CPU as a last resort so the app still works rather
// than showing an error on a device with no usable GPU path.

import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import '@tensorflow/tfjs-backend-cpu'
import { loadLayersModel, type LayersModel } from '@tensorflow/tfjs-layers'
import { CHANNELS } from '../lib/lanczos'
import type { FamilyId, ModelScale } from '../lib/models'
import { modelUrl } from '../lib/models'

export type BackendName = 'webgpu' | 'webgl' | 'cpu'

let backendPromise: Promise<BackendName> | null = null

export function currentBackend(): BackendName {
  return (tf.getBackend() as BackendName) ?? 'cpu'
}

async function tryBackend(name: string): Promise<boolean> {
  try {
    const ok = await tf.setBackend(name)
    if (!ok) return false
    await tf.ready()
    // Registering a backend is not the same as it working. Run something tiny and read
    // the answer back, because a WebGL context that fails on first use is common on
    // older phones and we would rather fall through than fail mid job.
    const probe = tf.tidy(() => tf.add(tf.tensor1d([1, 2]), tf.tensor1d([3, 4])))
    const values = await probe.data()
    probe.dispose()
    return values[0] === 4 && values[1] === 6
  } catch {
    return false
  }
}

export async function initBackend(): Promise<BackendName> {
  if (backendPromise) return backendPromise
  backendPromise = (async () => {
    if ('gpu' in navigator) {
      try {
        await import('@tensorflow/tfjs-backend-webgpu')
        if (await tryBackend('webgpu')) return 'webgpu'
      } catch {
        // No WebGPU here. Nothing to report; WebGL is the normal path today.
      }
    }
    // Textures rather than a flat buffer: the models are convolutional and the WebGL
    // backend is much faster with packed textures.
    tf.env().set('WEBGL_PACK', true)
    if (await tryBackend('webgl')) return 'webgl'
    await tryBackend('cpu')
    return 'cpu'
  })()
  return backendPromise
}

const cache = new Map<string, Promise<LayersModel>>()

export function loadModel(
  base: string,
  family: FamilyId,
  scale: ModelScale,
): Promise<LayersModel> {
  const url = modelUrl(base, family, scale)
  let existing = cache.get(url)
  if (!existing) {
    existing = loadLayersModel(url)
    cache.set(url, existing)
  }
  return existing
}

export function disposeModels(): void {
  for (const entry of cache.values()) {
    entry.then((model) => model.dispose()).catch(() => {})
  }
  cache.clear()
}

export interface TileOptions {
  /** Tile edge in source pixels. Smaller uses less GPU memory and runs slower. */
  tile: number
  /**
   * Context in source pixels kept around every tile and thrown away afterwards. The
   * networks have a receptive field of roughly 25 source pixels, so without this each
   * tile's border would be computed from nothing and the seams would show.
   */
  pad: number
  onProgress?: (completed: number, total: number) => void
  shouldCancel?: () => boolean
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'Cancelled'
  }
}

/** Interleaved RGB in 0-255, held either as floats or as bytes. */
export type PixelBuffer = Float32Array | Uint8Array

/**
 * Runs one model over a whole buffer, tile by tile, writing into `out`.
 *
 * `src` is interleaved RGB in 0-255, which is the range these models were trained in.
 * `out` must be `scale` times larger on each axis. It may be a Uint8Array, and for any
 * intermediate large enough to be worth keeping it should be: floats cost four times
 * the memory to hold a value the next pass reads back as 0-255 anyway. The final pass
 * writes floats, because everything after it (resize, sharpen) wants the precision.
 */
export async function upscaleInto<T extends PixelBuffer>(
  model: LayersModel,
  scale: number,
  src: PixelBuffer,
  width: number,
  height: number,
  out: T,
  options: TileOptions,
): Promise<T> {
  const outWidth = width * scale
  const bytes = out instanceof Uint8Array

  const { tile, pad } = options
  const cols = Math.ceil(width / tile)
  const rows = Math.ceil(height / tile)
  const total = cols * rows
  let completed = 0

  for (let ty = 0; ty < height; ty += tile) {
    for (let tx = 0; tx < width; tx += tile) {
      if (options.shouldCancel?.()) throw new Cancelled()

      const tileWidth = Math.min(tile, width - tx)
      const tileHeight = Math.min(tile, height - ty)

      // Padded read window, clamped to the image.
      const x0 = Math.max(0, tx - pad)
      const y0 = Math.max(0, ty - pad)
      const x1 = Math.min(width, tx + tileWidth + pad)
      const y1 = Math.min(height, ty + tileHeight + pad)
      const readWidth = x1 - x0
      const readHeight = y1 - y0

      const input = new Float32Array(readWidth * readHeight * CHANNELS)
      for (let y = 0; y < readHeight; y++) {
        const from = ((y0 + y) * width + x0) * CHANNELS
        // Widening a Uint8Array into a Float32Array is what set() does anyway, so this
        // one line covers both buffer kinds with no branch and no extra copy.
        input.set(src.subarray(from, from + readWidth * CHANNELS), y * readWidth * CHANNELS)
      }

      const result = await runTile(model, input, readWidth, readHeight)

      // Copy back only the part of the tile that had full context on every side.
      const offsetX = (tx - x0) * scale
      const offsetY = (ty - y0) * scale
      const copyWidth = tileWidth * scale
      const resultStride = readWidth * scale * CHANNELS
      for (let y = 0; y < tileHeight * scale; y++) {
        const from = (offsetY + y) * resultStride + offsetX * CHANNELS
        const to = ((ty * scale + y) * outWidth + tx * scale) * CHANNELS
        if (bytes) {
          for (let i = 0; i < copyWidth * CHANNELS; i++) {
            const v = result[from + i]
            out[to + i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0
          }
        } else {
          out.set(result.subarray(from, from + copyWidth * CHANNELS), to)
        }
      }

      completed++
      options.onProgress?.(completed, total)
      // Give the worker's event loop a turn so a cancel message can land, and so the
      // WebGL command queue is not one unbroken block of work.
      await Promise.resolve()
    }
  }
  return out
}

/** Convenience wrapper that allocates a float result. Used for small buffers. */
export function upscaleBuffer(
  model: LayersModel,
  scale: number,
  src: PixelBuffer,
  width: number,
  height: number,
  options: TileOptions,
): Promise<Float32Array> {
  return upscaleInto(
    model,
    scale,
    src,
    width,
    height,
    new Float32Array(width * scale * height * scale * CHANNELS),
    options,
  )
}

async function runTile(
  model: LayersModel,
  input: Float32Array,
  width: number,
  height: number,
): Promise<Float32Array> {
  const tensor = tf.tensor4d(input, [1, height, width, CHANNELS])
  let output: tf.Tensor | null = null
  try {
    output = model.predict(tensor) as tf.Tensor
    const data = (await output.data()) as Float32Array
    return data
  } finally {
    tensor.dispose()
    output?.dispose()
  }
}

/**
 * Times one representative tile so the app can quote a real number for how long a job
 * will take on this device rather than a guess. Returns source pixels per second.
 */
export async function benchmark(
  model: LayersModel,
  scale: number,
  tile = 96,
): Promise<number> {
  const pixels = tile * tile
  const probe = new Float32Array(pixels * CHANNELS)
  for (let i = 0; i < probe.length; i++) probe[i] = (i * 37) % 256

  // First run includes shader compilation and texture upload, which is a one time cost
  // and would make the estimate far too pessimistic. Throw it away.
  await runTile(model, probe, tile, tile)

  const started = performance.now()
  const runs = 3
  for (let i = 0; i < runs; i++) await runTile(model, probe, tile, tile)
  const elapsed = (performance.now() - started) / runs / 1000
  // Report in output pixels per second, which is what the plan's aiPixels counts.
  return (pixels * scale * scale) / Math.max(elapsed, 1e-6)
}
