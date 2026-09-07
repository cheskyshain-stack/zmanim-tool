// Streaming PNG encoder.
//
// The point of this file is that it never holds the image. Rows go in a band at a time,
// get filtered, get handed to a streaming deflate, and the compressed output goes into
// an array of chunks that becomes a Blob at the end (browsers spill large Blobs to disk,
// so a 300 megapixel PNG does not have to fit in RAM). Peak memory is one band plus one
// scanline, whatever the final size is.
//
// canvas.toBlob() cannot do this job: Chrome caps a canvas at 2^28 pixels and phones cap
// it far lower, and 28,800 x 10,800 is 311 megapixels.

import { Zlib } from 'fflate'
import { crc32, crc32Final } from './crc'

export interface PngOptions {
  /** Dots per inch written into pHYs. */
  dpi: number
  /** fflate deflate level, 0 to 9. 6 is the usual default; 4 is noticeably faster. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Per row filter choice. 'adaptive' tries four filters per row and keeps the smallest,
   * which is what makes PNGs of photographic content compress well. 'up' skips that
   * search; on a very large export it saves real time for a few percent of size.
   */
  filter?: 'adaptive' | 'up'
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const BYTES_PER_PIXEL = 3

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let c = crc32(out.subarray(4, 8 + data.length))
  view.setUint32(8 + data.length, crc32Final(c))
  return out
}

export class PngEncoder {
  readonly width: number
  readonly height: number
  private readonly rowBytes: number
  private readonly parts: Uint8Array[] = []
  private readonly zlib: Zlib
  private readonly filterMode: 'adaptive' | 'up'
  private prev: Uint8Array
  private line: Uint8Array
  private candidate: Uint8Array
  private rowsWritten = 0
  private done = false

  constructor(width: number, height: number, options: PngOptions) {
    this.width = width
    this.height = height
    this.rowBytes = width * BYTES_PER_PIXEL
    this.filterMode = options.filter ?? 'adaptive'
    this.prev = new Uint8Array(this.rowBytes)
    this.line = new Uint8Array(this.rowBytes + 1)
    this.candidate = new Uint8Array(this.rowBytes + 1)

    this.parts.push(SIGNATURE)
    this.parts.push(chunk('IHDR', this.ihdr()))
    // Rendering intent 0 is perceptual, which is what a print shop wants by default.
    this.parts.push(chunk('sRGB', new Uint8Array([0])))
    this.parts.push(chunk('gAMA', u32(45455)))
    this.parts.push(chunk('cHRM', this.chrm()))
    this.parts.push(chunk('pHYs', this.phys(options.dpi)))

    this.zlib = new Zlib({ level: options.level ?? 6 }, (data, final) => {
      if (data.length) this.parts.push(chunk('IDAT', data))
      if (final) this.parts.push(chunk('IEND', new Uint8Array(0)))
    })
  }

  private ihdr(): Uint8Array {
    const d = new Uint8Array(13)
    const v = new DataView(d.buffer)
    v.setUint32(0, this.width)
    v.setUint32(4, this.height)
    d[8] = 8 // bit depth
    d[9] = 2 // colour type 2: truecolour RGB
    d[10] = 0 // deflate
    d[11] = 0 // adaptive filtering
    d[12] = 0 // no interlace
    return d
  }

  private chrm(): Uint8Array {
    // sRGB primaries and D65 white, in the 100000ths PNG uses.
    const values = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000]
    const d = new Uint8Array(32)
    const v = new DataView(d.buffer)
    values.forEach((n, i) => v.setUint32(i * 4, n))
    return d
  }

  private phys(dpi: number): Uint8Array {
    // PNG stores pixels per metre. One inch is exactly 0.0254 m.
    const ppm = Math.round(dpi / 0.0254)
    const d = new Uint8Array(9)
    const v = new DataView(d.buffer)
    v.setUint32(0, ppm)
    v.setUint32(4, ppm)
    d[8] = 1 // unit is the metre, which is what makes the numbers mean DPI
    return d
  }

  /**
   * Appends `rows` scanlines. `rgb` is interleaved 8 bit RGB, tightly packed, and must
   * hold exactly `rows * width * 3` bytes.
   */
  writeRows(rgb: Uint8Array, rows: number): void {
    if (this.done) throw new Error('PNG encoder already finished')
    if (this.rowsWritten + rows > this.height) {
      throw new Error(
        `PNG encoder given ${this.rowsWritten + rows} rows for a ${this.height} row image`,
      )
    }
    if (rgb.length < rows * this.rowBytes) {
      throw new Error('PNG encoder given a short row buffer')
    }

    // Filter the whole band into one buffer and hand deflate a single push. Pushing a
    // row at a time works but allocates once per row, and a 10,800 row export makes
    // that measurable.
    const stride = this.rowBytes + 1
    const band = new Uint8Array(stride * rows)
    for (let r = 0; r < rows; r++) {
      const row = rgb.subarray(r * this.rowBytes, (r + 1) * this.rowBytes)
      band.set(this.filterRow(row), r * stride)
      this.prev.set(row)
    }
    this.zlib.push(band, false)
    this.rowsWritten += rows
  }

  private filterRow(row: Uint8Array): Uint8Array {
    if (this.filterMode === 'up') {
      const out = this.line
      out[0] = 2
      for (let i = 0; i < this.rowBytes; i++) out[i + 1] = (row[i] - this.prev[i]) & 0xff
      return out
    }

    let best = this.line
    let bestScore = Infinity
    let target = this.candidate

    for (const type of [0, 1, 2, 4] as const) {
      target[0] = type
      let score = 0
      for (let i = 0; i < this.rowBytes; i++) {
        const raw = row[i]
        const left = i >= BYTES_PER_PIXEL ? row[i - BYTES_PER_PIXEL] : 0
        const up = this.prev[i]
        const upLeft = i >= BYTES_PER_PIXEL ? this.prev[i - BYTES_PER_PIXEL] : 0

        let value: number
        switch (type) {
          case 0:
            value = raw
            break
          case 1:
            value = raw - left
            break
          case 2:
            value = raw - up
            break
          default:
            value = raw - paeth(left, up, upLeft)
        }
        value &= 0xff
        target[i + 1] = value
        // The standard heuristic: sum the filtered bytes read as signed, and take the
        // row that stays closest to zero, since that is what deflate compresses best.
        score += value < 128 ? value : 256 - value
      }
      if (score < bestScore) {
        bestScore = score
        const swap = best
        best = target
        target = swap
      }
    }

    this.line = best
    this.candidate = target
    return best
  }

  /** Flushes deflate, writes IEND and returns the file. */
  finish(): Blob {
    if (this.done) throw new Error('PNG encoder already finished')
    if (this.rowsWritten !== this.height) {
      throw new Error(
        `PNG encoder finished with ${this.rowsWritten} of ${this.height} rows`,
      )
    }
    this.done = true
    this.zlib.push(new Uint8Array(0), true)
    return new Blob(this.parts as BlobPart[], { type: 'image/png' })
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function u32(n: number): Uint8Array {
  const d = new Uint8Array(4)
  new DataView(d.buffer).setUint32(0, n)
  return d
}
