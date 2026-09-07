// Decoding, orientation and getting pixels back out of a bitmap.
//
// EXIF orientation is read and applied by hand rather than relying on
// createImageBitmap's imageOrientation option. That option is not available everywhere,
// and when it is missing it fails silently: the image simply comes out sideways, which
// on a 3 ft banner is not a subtle mistake.

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

export interface DecodedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** EXIF value 1 to 8. 1 means the file needed no rotation. */
  orientation: number
  type: string
  bytes: number
  name: string
}

/**
 * Reads the EXIF Orientation tag out of a JPEG. Returns 1 (no rotation) for anything
 * else, including a JPEG with no EXIF block, which is the common case.
 */
export async function readExifOrientation(file: Blob): Promise<number> {
  // The tag lives in the first APP1 segment, which is at the front of the file.
  const head = new DataView(await file.slice(0, 128 * 1024).arrayBuffer())
  if (head.byteLength < 4 || head.getUint16(0) !== 0xffd8) return 1

  let offset = 2
  while (offset + 4 <= head.byteLength) {
    const marker = head.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) return 1
    const size = head.getUint16(offset + 2)
    if (marker === 0xffe1) {
      const start = offset + 4
      if (head.getUint32(start) !== 0x45786966) return 1 // not "Exif"
      const tiff = start + 6
      const little = head.getUint16(tiff) === 0x4949
      if (head.getUint16(tiff + 2, little) !== 0x002a) return 1
      const ifd = tiff + head.getUint32(tiff + 4, little)
      const count = head.getUint16(ifd, little)
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > head.byteLength) break
        if (head.getUint16(entry, little) === 0x0112) {
          const value = head.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    if (marker === 0xffda) return 1 // start of scan: no EXIF before the image data
    offset += 2 + size
  }
  return 1
}

function swapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8
}

/** Canvas transform that undoes an EXIF orientation, for an image `w` x `h`. */
function orientationTransform(
  orientation: number,
  w: number,
  h: number,
): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, w, 0]
    case 3:
      return [-1, 0, 0, -1, w, h]
    case 4:
      return [1, 0, 0, -1, 0, h]
    case 5:
      return [0, 1, 1, 0, 0, 0]
    case 6:
      return [0, 1, -1, 0, h, 0]
    case 7:
      return [0, -1, -1, 0, h, w]
    case 8:
      return [0, -1, 1, 0, 0, w]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export async function decodeImage(file: File): Promise<DecodedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(
      `${file.type || 'That file'} is not supported. Use a JPG, PNG or WEBP.`,
    )
  }
  let raw: ImageBitmap
  try {
    raw = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be decoded. It may be damaged.')
  }

  const orientation = file.type === 'image/jpeg' ? await readExifOrientation(file) : 1
  if (orientation === 1) {
    return {
      bitmap: raw,
      width: raw.width,
      height: raw.height,
      orientation,
      type: file.type,
      bytes: file.size,
      name: file.name,
    }
  }

  const width = swapsAxes(orientation) ? raw.height : raw.width
  const height = swapsAxes(orientation) ? raw.width : raw.height
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser would not give the app a 2D canvas.')
  ctx.setTransform(...orientationTransform(orientation, raw.width, raw.height))
  ctx.drawImage(raw, 0, 0)
  raw.close()

  const bitmap = await createImageBitmap(canvas)
  return {
    bitmap,
    width,
    height,
    orientation,
    type: file.type,
    bytes: file.size,
    name: file.name,
  }
}

/**
 * Pulls a rectangle of source pixels out at its native resolution. This is what gets
 * handed to the worker; everything downstream works from these pixels alone.
 */
export function extractRegion(
  bitmap: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageData {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser would not give the app a 2D canvas.')
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/** A downscaled copy for on screen use, so a 50 megapixel source does not stall a phone. */
export function makeThumbnail(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = makeCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  )
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  return canvas
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Megapixels, with enough decimals that a small image does not read as "0.0 MP". */
export function formatMegapixels(pixels: number): string {
  const mp = pixels / 1e6
  if (mp >= 10) return `${mp.toFixed(0)} MP`
  if (mp >= 1) return `${mp.toFixed(1)} MP`
  return `${mp.toFixed(2)} MP`
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return 'unknown'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} sec`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}
