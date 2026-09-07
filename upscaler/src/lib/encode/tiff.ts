// Streaming TIFF encoder: RGB, 8 bit, Deflate compressed strips, horizontal
// differencing predictor, DPI in the resolution tags and a real sRGB profile embedded.
//
// TIFF is the format a large format print shop is happiest with, and it streams more
// naturally than PNG: the image is written as independent strips and the directory that
// indexes them goes at the end, once every strip length is known. Rows arrive a band at
// a time and never all exist at once.

import { zlibSync } from 'fflate'
import { srgbProfile } from './icc'

export interface TiffOptions {
  dpi: number
  /** Rows per strip. Bigger strips compress slightly better and cost more memory. */
  rowsPerStrip?: number
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

const SAMPLES = 3

// TIFF field types.
const SHORT = 3
const LONG = 4
const RATIONAL = 5
const ASCII = 2
const UNDEFINED = 7

export class TiffEncoder {
  readonly width: number
  readonly height: number
  private readonly dpi: number
  private readonly rowsPerStrip: number
  private readonly level: number
  private readonly rowBytes: number
  private readonly parts: Uint8Array[] = []
  private readonly header: Uint8Array
  private readonly stripOffsets: number[] = []
  private readonly stripByteCounts: number[] = []
  private pending: Uint8Array
  private pendingRows = 0
  private offset = 8
  private rowsWritten = 0
  private done = false

  constructor(width: number, height: number, options: TiffOptions) {
    this.width = width
    this.height = height
    this.dpi = options.dpi
    this.level = options.level ?? 6
    this.rowBytes = width * SAMPLES
    // Aim for strips of a few MB: small enough to stay cheap, large enough that the
    // directory does not grow to tens of thousands of entries on a tall image.
    this.rowsPerStrip =
      options.rowsPerStrip ??
      Math.max(1, Math.min(height, Math.floor((4 << 20) / Math.max(1, this.rowBytes))))
    this.pending = new Uint8Array(this.rowBytes * this.rowsPerStrip)

    this.header = new Uint8Array(8)
    const v = new DataView(this.header.buffer)
    v.setUint16(0, 0x4949, true) // "II", little endian
    v.setUint16(2, 42, true)
    v.setUint32(4, 0, true) // IFD offset, filled in by finish()
    this.parts.push(this.header)
  }

  writeRows(rgb: Uint8Array, rows: number): void {
    if (this.done) throw new Error('TIFF encoder already finished')
    if (this.rowsWritten + rows > this.height) {
      throw new Error(
        `TIFF encoder given ${this.rowsWritten + rows} rows for a ${this.height} row image`,
      )
    }

    let consumed = 0
    while (consumed < rows) {
      const space = this.rowsPerStrip - this.pendingRows
      const take = Math.min(space, rows - consumed)
      this.pending.set(
        rgb.subarray(consumed * this.rowBytes, (consumed + take) * this.rowBytes),
        this.pendingRows * this.rowBytes,
      )
      this.pendingRows += take
      consumed += take
      if (this.pendingRows === this.rowsPerStrip) this.flushStrip()
    }
    this.rowsWritten += rows
  }

  private flushStrip(): void {
    if (this.pendingRows === 0) return
    const used = this.pending.subarray(0, this.pendingRows * this.rowBytes)
    this.applyPredictor(used, this.pendingRows)
    const packed = zlibSync(used, { level: this.level as 6 })
    this.stripOffsets.push(this.offset)
    this.stripByteCounts.push(packed.length)
    this.parts.push(packed)
    this.offset += packed.length
    this.pendingRows = 0
  }

  /**
   * Predictor 2: replace each sample with its difference from the sample one pixel to
   * the left. Deflate then sees long runs of near zero across smooth areas, which on
   * photographic content is worth a large fraction of the file size.
   */
  private applyPredictor(buf: Uint8Array, rows: number): void {
    for (let y = 0; y < rows; y++) {
      const row = y * this.rowBytes
      for (let i = this.rowBytes - 1; i >= SAMPLES; i--) {
        buf[row + i] = (buf[row + i] - buf[row + i - SAMPLES]) & 0xff
      }
    }
  }

  finish(): Blob {
    if (this.done) throw new Error('TIFF encoder already finished')
    if (this.rowsWritten !== this.height) {
      throw new Error(
        `TIFF encoder finished with ${this.rowsWritten} of ${this.height} rows`,
      )
    }
    this.done = true
    this.flushStrip()

    const icc = srgbProfile()
    const software = new TextEncoder().encode('Print Upscaler\0')
    const stripCount = this.stripOffsets.length

    // Values too big for the 4 byte inline slot live in a blob before the directory.
    const bitsPerSample = bytes(6, (v) => {
      v.setUint16(0, 8, true)
      v.setUint16(2, 8, true)
      v.setUint16(4, 8, true)
    })
    const xRes = rational(this.dpi)
    const yRes = rational(this.dpi)
    const offsetsBlock = bytes(stripCount * 4, (v) => {
      this.stripOffsets.forEach((n, i) => v.setUint32(i * 4, n, true))
    })
    const countsBlock = bytes(stripCount * 4, (v) => {
      this.stripByteCounts.forEach((n, i) => v.setUint32(i * 4, n, true))
    })

    const extras: Uint8Array[] = []
    let cursor = this.offset
    const place = (data: Uint8Array): number => {
      // Every value block starts on an even offset, which the TIFF spec asks for.
      if (cursor % 2 === 1) {
        extras.push(new Uint8Array(1))
        cursor += 1
      }
      const at = cursor
      extras.push(data)
      cursor += data.length
      return at
    }

    const bitsAt = place(bitsPerSample)
    const xAt = place(xRes)
    const yAt = place(yRes)
    const softwareAt = place(software)
    const iccAt = place(icc)
    const offsetsAt = stripCount === 1 ? this.stripOffsets[0] : place(offsetsBlock)
    const countsAt = stripCount === 1 ? this.stripByteCounts[0] : place(countsBlock)

    if (cursor > 0xffffffff) {
      throw new Error(
        'This image is over the 4 GB limit of the TIFF format. Export as PNG instead.',
      )
    }

    // Tags must appear in ascending tag order.
    const entries: Array<[number, number, number, number]> = [
      [256, LONG, 1, this.width],
      [257, LONG, 1, this.height],
      [258, SHORT, 3, bitsAt],
      [259, SHORT, 1, 8], // Adobe Deflate
      [262, SHORT, 1, 2], // RGB
      [273, LONG, stripCount, offsetsAt],
      [277, SHORT, 1, SAMPLES],
      [278, LONG, 1, this.rowsPerStrip],
      [279, LONG, stripCount, countsAt],
      [282, RATIONAL, 1, xAt],
      [283, RATIONAL, 1, yAt],
      [284, SHORT, 1, 1], // chunky, RGBRGB rather than planes
      [296, SHORT, 1, 2], // resolution unit: inch, so 282/283 read as DPI
      [305, ASCII, software.length, softwareAt],
      [317, SHORT, 1, 2], // horizontal differencing predictor
      [34675, UNDEFINED, icc.length, iccAt],
    ]

    const ifdAt = cursor % 2 === 1 ? cursor + 1 : cursor
    if (ifdAt !== cursor) extras.push(new Uint8Array(1))

    const ifd = new Uint8Array(2 + entries.length * 12 + 4)
    const v = new DataView(ifd.buffer)
    v.setUint16(0, entries.length, true)
    entries.forEach(([tag, type, count, value], i) => {
      const at = 2 + i * 12
      v.setUint16(at, tag, true)
      v.setUint16(at + 2, type, true)
      v.setUint32(at + 4, count, true)
      // A value that fits in four bytes is stored inline; anything larger, and any array,
      // stores an offset here instead. SHORT is two bytes and sits in the low half.
      if (type === SHORT && count === 1) v.setUint16(at + 8, value, true)
      else v.setUint32(at + 8, value, true)
    })
    v.setUint32(ifd.length - 4, 0, true) // no second directory

    new DataView(this.header.buffer).setUint32(4, ifdAt, true)

    return new Blob([...this.parts, ...extras, ifd] as BlobPart[], {
      type: 'image/tiff',
    })
  }
}

function bytes(size: number, fill: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(size)
  fill(new DataView(out.buffer))
  return out
}

function rational(value: number): Uint8Array {
  // Keep two decimals of DPI without floating point, so 150.5 stays exact.
  return bytes(8, (v) => {
    v.setUint32(0, Math.round(value * 100), true)
    v.setUint32(4, 100, true)
  })
}
