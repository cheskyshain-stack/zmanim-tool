// Sharpening, noise reduction and artifact reduction.
//
// Two of the three run at source resolution, before the AI passes, and that is on
// purpose. JPEG block edges and sensor noise live in the source pixels; an upscaler
// treats both as detail and enlarges them into something much harder to remove. Cleaning
// first is cheaper (the source is small) and works far better than cleaning after.
//
// Sharpening is the opposite: it runs last, at the final print resolution, because the
// right radius depends on the pixels that actually go to the printer.

import { CHANNELS } from './lanczos'

export type SharpenLevel = 'none' | 'light' | 'medium' | 'strong'

export const SHARPEN_LABEL: Record<SharpenLevel, string> = {
  none: 'None',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
}

export interface SharpenSpec {
  amount: number
  radius: number
  /** Differences below this (in 0-255) are left alone, so flat areas stay flat. */
  threshold: number
  /** How far past the local min and max a sharpened pixel may go, as a fraction. */
  overshoot: number
}

export const SHARPEN_SPECS: Record<SharpenLevel, SharpenSpec> = {
  none: { amount: 0, radius: 0, threshold: 0, overshoot: 0 },
  light: { amount: 0.35, radius: 1.0, threshold: 3, overshoot: 0.06 },
  medium: { amount: 0.7, radius: 1.2, threshold: 3, overshoot: 0.1 },
  strong: { amount: 1.15, radius: 1.5, threshold: 2, overshoot: 0.16 },
}

/** Rows of context a sharpen pass needs above and below a band to be seamless. */
export function sharpenMargin(level: SharpenLevel): number {
  if (level === 'none') return 0
  return Math.max(2, Math.ceil(SHARPEN_SPECS[level].radius * 3) + 1)
}

function gaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(0.4, radius)
  const half = Math.max(1, Math.ceil(sigma * 2.5))
  const k = new Float32Array(half * 2 + 1)
  let sum = 0
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + half] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

function blurSeparable(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const k = gaussianKernel(radius)
  const half = (k.length - 1) / 2
  const rowStride = width * CHANNELS
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)

  for (let y = 0; y < height; y++) {
    const row = y * rowStride
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let j = -half; j <= half; j++) {
        let sx = x + j
        if (sx < 0) sx = 0
        else if (sx >= width) sx = width - 1
        const w = k[j + half]
        const p = row + sx * CHANNELS
        r += src[p] * w
        g += src[p + 1] * w
        b += src[p + 2] * w
      }
      const q = row + x * CHANNELS
      tmp[q] = r
      tmp[q + 1] = g
      tmp[q + 2] = b
    }
  }

  for (let y = 0; y < height; y++) {
    const dstRow = y * rowStride
    for (let j = -half; j <= half; j++) {
      let sy = y + j
      if (sy < 0) sy = 0
      else if (sy >= height) sy = height - 1
      const w = k[j + half]
      const srcRow = sy * rowStride
      for (let i = 0; i < rowStride; i++) out[dstRow + i] += tmp[srcRow + i] * w
    }
  }
  return out
}

/**
 * Unsharp mask with the two guards that keep it off the "oversharpened" look: a
 * threshold so noise in flat areas is not lifted, and a clamp that stops any pixel
 * running more than `overshoot` past the brightest and darkest of its neighbours. The
 * clamp is what removes halos: a halo is exactly an overshoot beyond the local range.
 *
 * Operates in place on `buf`, which is interleaved RGB float in 0-255.
 */
export function sharpenInPlace(
  buf: Float32Array,
  width: number,
  height: number,
  level: SharpenLevel,
): void {
  if (level === 'none' || width < 3 || height < 3) return
  const { amount, radius, threshold, overshoot } = SHARPEN_SPECS[level]
  const blur = blurSeparable(buf, width, height, radius)
  const rowStride = width * CHANNELS
  const slack = overshoot * 255

  for (let y = 0; y < height; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < height - 1 ? y + 1 : height - 1
    for (let x = 0; x < width; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < width - 1 ? x + 1 : width - 1
      const p = y * rowStride + x * CHANNELS

      for (let c = 0; c < CHANNELS; c++) {
        const value = buf[p + c]
        const diff = value - blur[p + c]
        if (Math.abs(diff) < threshold) continue

        // Local range over the 3x3 neighbourhood, which is the halo budget.
        let lo = Infinity
        let hi = -Infinity
        for (let yy = y0; yy <= y1; yy++) {
          const base = yy * rowStride + c
          for (let xx = x0; xx <= x1; xx++) {
            const v = buf[base + xx * CHANNELS]
            if (v < lo) lo = v
            if (v > hi) hi = v
          }
        }

        let next = value + amount * diff
        const min = lo - slack
        const max = hi + slack
        if (next < min) next = min
        else if (next > max) next = max
        buf[p + c] = next < 0 ? 0 : next > 255 ? 255 : next
      }
    }
  }
}

/**
 * Mild edge preserving denoise: a 3x3 bilateral filter. Weights fall off with colour
 * distance as well as spatial distance, so flat areas are smoothed and edges are not.
 * Deliberately small; the goal is to stop the upscaler amplifying grain, not to scrub
 * the image.
 */
export function denoiseInPlace(
  buf: Float32Array,
  width: number,
  height: number,
  strength = 1,
): void {
  if (strength <= 0 || width < 3 || height < 3) return
  const rangeSigma = 12 * strength
  const inv = 1 / (2 * rangeSigma * rangeSigma)
  const spatial = [0.6, 0.85, 0.6, 0.85, 1, 0.85, 0.6, 0.85, 0.6]
  const rowStride = width * CHANNELS
  const src = buf.slice()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * rowStride + x * CHANNELS
      let wr = 0
      let wg = 0
      let wb = 0
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        let yy = y + dy
        if (yy < 0) yy = 0
        else if (yy >= height) yy = height - 1
        for (let dx = -1; dx <= 1; dx++, n++) {
          let xx = x + dx
          if (xx < 0) xx = 0
          else if (xx >= width) xx = width - 1
          const q = yy * rowStride + xx * CHANNELS
          const s = spatial[n]
          const dr = src[q] - src[p]
          const dg = src[q + 1] - src[p + 1]
          const db = src[q + 2] - src[p + 2]
          const kr = s * Math.exp(-dr * dr * inv)
          const kg = s * Math.exp(-dg * dg * inv)
          const kb = s * Math.exp(-db * db * inv)
          sr += src[q] * kr
          wr += kr
          sg += src[q + 1] * kg
          wg += kg
          sb += src[q + 2] * kb
          wb += kb
        }
      }
      buf[p] = sr / wr
      buf[p + 1] = sg / wg
      buf[p + 2] = sb / wb
    }
  }
}

/**
 * JPEG artifact reduction. JPEG quantises in 8x8 blocks, so its worst artifact is a
 * visible step exactly on every eighth row and column. This softens those steps and
 * only those steps, and only when the step is small enough to be an artifact rather
 * than real image content sitting on a block edge by coincidence.
 */
export function deblockInPlace(
  buf: Float32Array,
  width: number,
  height: number,
  threshold = 14,
): void {
  const rowStride = width * CHANNELS

  for (let x = 8; x < width; x += 8) {
    for (let y = 0; y < height; y++) {
      const row = y * rowStride
      const a = row + (x - 1) * CHANNELS
      const b = row + x * CHANNELS
      for (let c = 0; c < CHANNELS; c++) {
        const step = buf[b + c] - buf[a + c]
        if (Math.abs(step) >= threshold) continue
        const fix = step * 0.25
        buf[a + c] += fix
        buf[b + c] -= fix
      }
    }
  }

  for (let y = 8; y < height; y += 8) {
    const above = (y - 1) * rowStride
    const below = y * rowStride
    for (let i = 0; i < rowStride; i++) {
      const step = buf[below + i] - buf[above + i]
      if (Math.abs(step) >= threshold) continue
      const fix = step * 0.25
      buf[above + i] += fix
      buf[below + i] -= fix
    }
  }
}
