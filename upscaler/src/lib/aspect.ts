// Aspect ratio and cropping. The rule the whole app is built around: the source is
// never stretched. If the source ratio and the print ratio disagree, either pixels are
// dropped (crop) or bars are added (fit), and the user is told which, in advance.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type FitMode = 'cover' | 'contain' | 'custom'

export const FIT_LABEL: Record<FitMode, string> = {
  cover: 'Crop to fill',
  contain: 'Fit whole image',
  custom: 'Custom crop',
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/**
 * A printable ratio. 2048 x 768 gives "8 : 3". When the reduced pair is unwieldy (a
 * photo at 4032 x 3024 reduces cleanly, a cropped one may not) it falls back to a
 * decimal, because "1349 : 500" tells nobody anything.
 */
export function ratioLabel(width: number, height: number): string {
  if (!width || !height) return '-'
  const d = gcd(Math.round(width), Math.round(height))
  const w = Math.round(width) / d
  const h = Math.round(height) / d
  if (w <= 64 && h <= 64) return `${w} : ${h}`
  return `${(width / height).toFixed(3)} : 1`
}

/** How far apart two ratios are, as a fraction. 0 is an exact match. */
export function ratioMismatch(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): number {
  const a = srcWidth / srcHeight
  const b = dstWidth / dstHeight
  return Math.abs(a - b) / Math.max(a, b)
}

/**
 * Treats ratios within a quarter of a percent as identical. Pixel dimensions are
 * integers, so a genuine 8:3 source and an 8:3 print can still differ in the twelfth
 * decimal place, and calling that "cropping needed" would be a lie about a zero pixel
 * crop.
 */
export const RATIO_EPSILON = 0.0025

export function ratiosMatch(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): boolean {
  return ratioMismatch(srcWidth, srcHeight, dstWidth, dstHeight) < RATIO_EPSILON
}

/**
 * The largest rect of the target ratio that fits inside the source, centred. This is
 * the crop that "Crop to fill" starts from, and what the crop preview shades out.
 */
export function coverCrop(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Rect {
  const targetRatio = dstWidth / dstHeight
  const srcRatio = srcWidth / srcHeight
  if (srcRatio > targetRatio) {
    // Source is wider than the print: keep full height, trim the sides.
    const width = srcHeight * targetRatio
    return { x: (srcWidth - width) / 2, y: 0, width, height: srcHeight }
  }
  // Source is taller than the print: keep full width, trim top and bottom.
  const height = srcWidth / targetRatio
  return { x: 0, y: (srcHeight - height) / 2, width: srcWidth, height }
}

/**
 * Where the whole source lands inside the print when nothing is cropped. The remaining
 * area is the border. Returned in target pixel space.
 */
export function containBox(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Rect {
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return {
    x: (dstWidth - width) / 2,
    y: (dstHeight - height) / 2,
    width,
    height,
  }
}

/** Fraction of the source image thrown away by a crop, 0 to 1. */
export function croppedFraction(crop: Rect, srcWidth: number, srcHeight: number): number {
  const kept = (crop.width * crop.height) / (srcWidth * srcHeight)
  return Math.max(0, 1 - kept)
}

/** Fraction of the print taken up by blank border under "Fit whole image". */
export function borderFraction(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): number {
  const box = containBox(srcWidth, srcHeight, dstWidth, dstHeight)
  return Math.max(0, 1 - (box.width * box.height) / (dstWidth * dstHeight))
}

/**
 * Snaps a user-dragged crop to the target ratio and keeps it inside the image. The crop
 * step lets you move and resize a box; this is what stops it ever producing a rect that
 * would need stretching or that runs off the edge.
 */
export function constrainCrop(
  desired: Rect,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Rect {
  const targetRatio = dstWidth / dstHeight
  const max = coverCrop(srcWidth, srcHeight, dstWidth, dstHeight)

  let width = Math.min(Math.max(desired.width, 16), max.width)
  let height = width / targetRatio
  if (height > srcHeight) {
    height = srcHeight
    width = height * targetRatio
  }

  const x = Math.min(Math.max(desired.x, 0), srcWidth - width)
  const y = Math.min(Math.max(desired.y, 0), srcHeight - height)
  return { x, y, width, height }
}

/** Rounds a crop to whole pixels without letting it grow past the image edge. */
export function snapRect(rect: Rect, srcWidth: number, srcHeight: number): Rect {
  const x = Math.max(0, Math.round(rect.x))
  const y = Math.max(0, Math.round(rect.y))
  const width = Math.max(1, Math.min(Math.round(rect.width), srcWidth - x))
  const height = Math.max(1, Math.min(Math.round(rect.height), srcHeight - y))
  return { x, y, width, height }
}
