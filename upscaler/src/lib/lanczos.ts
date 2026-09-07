// Separable Lanczos resampling in float, used for the exact final resize after the AI
// passes and for every preview that has to be honest about detail.
//
// It is written as "build the tap table once, then apply it" rather than as a single
// resize() call, because the export pipeline resizes one horizontal band at a time and
// needs to ask the table which source rows a band depends on before it has those rows.

export const CHANNELS = 3

export interface TapTable {
  srcLength: number
  dstLength: number
  /** First source index each output index reads from. */
  starts: Int32Array
  /** How many source samples each output index reads. */
  counts: Int32Array
  /** Flattened weights, `stride` per output index, already normalised to sum to 1. */
  weights: Float32Array
  stride: number
}

function lanczos(x: number, a: number): number {
  if (x === 0) return 1
  const ax = Math.abs(x)
  if (ax >= a) return 0
  const px = Math.PI * x
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px)
}

/**
 * Builds the tap table for one axis.
 *
 * `a` is the Lanczos lobe count: 3 is the usual print quality choice. When shrinking,
 * the kernel has to be widened by the shrink factor or the result aliases, which is
 * exactly the case that matters here (the last step of a big job is a slight downscale
 * from the AI output to the exact print size).
 */
export function buildTaps(srcLength: number, dstLength: number, a = 3): TapTable {
  const scale = dstLength / srcLength
  const support = scale < 1 ? a / scale : a
  const stride = Math.min(srcLength, Math.ceil(support * 2) + 2)

  const starts = new Int32Array(dstLength)
  const counts = new Int32Array(dstLength)
  const weights = new Float32Array(dstLength * stride)

  for (let i = 0; i < dstLength; i++) {
    // Centre of output sample i expressed in source coordinates, half pixel aligned so
    // the image does not drift by half a pixel at high scale factors.
    const centre = (i + 0.5) / scale - 0.5
    let first = Math.ceil(centre - support)
    let last = Math.floor(centre + support)
    if (last < first) last = first

    // Clamp to the image and keep the window no wider than the table allows.
    if (first < 0) first = 0
    if (last > srcLength - 1) last = srcLength - 1
    if (last - first + 1 > stride) last = first + stride - 1

    const count = last - first + 1
    starts[i] = first
    counts[i] = count

    let sum = 0
    const base = i * stride
    for (let j = 0; j < count; j++) {
      const t = scale < 1 ? (first + j - centre) * scale : first + j - centre
      const w = lanczos(t, a)
      weights[base + j] = w
      sum += w
    }
    // Normalising is what stops edge pixels from darkening: near the border part of the
    // kernel hangs off the image and the remaining taps have to carry full weight.
    if (sum !== 0) {
      for (let j = 0; j < count; j++) weights[base + j] /= sum
    } else {
      weights[base] = 1
      counts[i] = 1
    }
  }

  return { srcLength, dstLength, starts, counts, weights, stride }
}

/** The half open source range that output rows [dstFrom, dstTo) read from. */
export function sourceSpan(taps: TapTable, dstFrom: number, dstTo: number) {
  let from = taps.srcLength
  let to = 0
  for (let i = dstFrom; i < dstTo; i++) {
    const start = taps.starts[i]
    const end = start + taps.counts[i]
    if (start < from) from = start
    if (end > to) to = end
  }
  if (from > to) return { from: 0, to: 0 }
  return { from, to }
}

/**
 * Resamples along x. `src` is planar-free interleaved RGB float, `rows` tall.
 * Returns a fresh buffer `taps.dstLength` wide.
 */
export function resampleX(
  src: Float32Array,
  srcWidth: number,
  rows: number,
  taps: TapTable,
): Float32Array {
  const dstWidth = taps.dstLength
  const out = new Float32Array(dstWidth * rows * CHANNELS)
  const { starts, counts, weights, stride } = taps

  for (let y = 0; y < rows; y++) {
    const srcRow = y * srcWidth * CHANNELS
    const dstRow = y * dstWidth * CHANNELS
    for (let x = 0; x < dstWidth; x++) {
      const start = starts[x]
      const count = counts[x]
      const wBase = x * stride
      let r = 0
      let g = 0
      let b = 0
      let p = srcRow + start * CHANNELS
      for (let j = 0; j < count; j++) {
        const w = weights[wBase + j]
        r += src[p] * w
        g += src[p + 1] * w
        b += src[p + 2] * w
        p += CHANNELS
      }
      const q = dstRow + x * CHANNELS
      out[q] = r
      out[q + 1] = g
      out[q + 2] = b
    }
  }
  return out
}

/**
 * Resamples along y for output rows [dstFrom, dstTo).
 *
 * `src` holds source rows [srcFrom, srcFrom + srcRows) only, which is what makes the
 * streaming export possible: the caller never has to materialise the full intermediate
 * image, just the slab the current band reads from.
 */
export function resampleYBand(
  src: Float32Array,
  width: number,
  srcFrom: number,
  srcRows: number,
  taps: TapTable,
  dstFrom: number,
  dstTo: number,
): Float32Array {
  const outRows = dstTo - dstFrom
  const out = new Float32Array(width * outRows * CHANNELS)
  const { starts, counts, weights, stride } = taps
  const rowStride = width * CHANNELS

  for (let y = dstFrom; y < dstTo; y++) {
    const start = starts[y]
    const count = counts[y]
    const wBase = y * stride
    const dstRow = (y - dstFrom) * rowStride

    for (let j = 0; j < count; j++) {
      const w = weights[wBase + j]
      if (w === 0) continue
      // Clamp into the slab. sourceSpan() guarantees the rows are present; the clamp is
      // belt and braces so a rounding slip degrades a pixel instead of reading garbage.
      let row = start + j - srcFrom
      if (row < 0) row = 0
      else if (row >= srcRows) row = srcRows - 1
      const srcRow = row * rowStride
      for (let i = 0; i < rowStride; i++) {
        out[dstRow + i] += src[srcRow + i] * w
      }
    }
  }
  return out
}

/** Whole image convenience path, for previews and any image small enough to hold. */
export function resampleImage(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  a = 3,
): Float32Array {
  const xTaps = buildTaps(srcWidth, dstWidth, a)
  const yTaps = buildTaps(srcHeight, dstHeight, a)
  const wide = resampleX(src, srcWidth, srcHeight, xTaps)
  return resampleYBand(wide, dstWidth, 0, srcHeight, yTaps, 0, dstHeight)
}
