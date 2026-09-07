// Streaming baseline JPEG encoder, 4:4:4, with JFIF density set from the print DPI.
//
// Why not canvas.toBlob('image/jpeg')? Because a canvas has a hard pixel ceiling
// (2^28 on desktop Chrome, far lower on phones) and the flagship job here is 311
// megapixels. Going through a canvas would fail on exactly the export the app exists
// for. This encoder takes rows a band at a time and never holds the image.
//
// 4:4:4 means chroma is kept at full resolution. Standard photo JPEG throws away three
// quarters of the colour detail (4:2:0); on a print somebody walks up to, that shows on
// saturated edges, and the file size saving is not worth it here.

const NATURAL_TO_ZIGZAG = new Int32Array([
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41,
  43, 9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38,
  46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63,
])

// Annex K quantisation tables, in natural (raster) order.
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40,
  57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35,
  55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112,
  100, 103, 99,
]
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99,
  99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99,
]

// Annex K Huffman specifications: counts of codes of each length 1..16, then the values.
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_LUMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_CHROMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_LUMA_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51,
  0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
  0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18,
  0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
  0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
  0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2,
  0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const AC_CHROMA_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07,
  0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09,
  0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25,
  0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
  0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74,
  0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
  0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
  0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2,
  0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]

// Scale factors that fold the AAN fast DCT's output scaling into the quant table.
const AAN = [
  1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379,
]

type Code = { code: number; length: number }

function buildHuffman(bits: number[], values: number[]): Code[] {
  const table: Code[] = []
  let code = 0
  let k = 0
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) {
      table[values[k++]] = { code, length }
      code++
    }
    code <<= 1
  }
  return table
}

function scaleFactor(quality: number): number {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  return q < 50 ? Math.floor(5000 / q) : 200 - q * 2
}

export interface JpegOptions {
  /** 1 to 100. 92 and up is the sensible range for print. */
  quality: number
  dpi: number
}

export class JpegEncoder {
  readonly width: number
  readonly height: number
  private readonly parts: Uint8Array[] = []
  private buffer = new Uint8Array(1 << 20)
  private used = 0
  private bitBuffer = 0
  private bitCount = 0

  private readonly lumaQuant = new Int32Array(64)
  private readonly chromaQuant = new Int32Array(64)
  private readonly lumaScale = new Float32Array(64)
  private readonly chromaScale = new Float32Array(64)
  private readonly dcLuma = buildHuffman(DC_LUMA_BITS, DC_LUMA_VALUES)
  private readonly acLuma = buildHuffman(AC_LUMA_BITS, AC_LUMA_VALUES)
  private readonly dcChroma = buildHuffman(DC_CHROMA_BITS, DC_CHROMA_VALUES)
  private readonly acChroma = buildHuffman(AC_CHROMA_BITS, AC_CHROMA_VALUES)

  private readonly block = new Float32Array(64)
  private readonly quantised = new Int32Array(64)
  private readonly zigzag = new Int32Array(64)
  private readonly strip: Uint8Array
  private stripRows = 0
  private rowsWritten = 0
  private dcY = 0
  private dcCb = 0
  private dcCr = 0
  private done = false

  constructor(width: number, height: number, options: JpegOptions) {
    this.width = width
    this.height = height
    this.strip = new Uint8Array(width * 3 * 8)

    const sf = scaleFactor(options.quality)
    for (let i = 0; i < 64; i++) {
      this.lumaQuant[NATURAL_TO_ZIGZAG[i]] = clampQuant((LUMA_QUANT[i] * sf + 50) / 100)
      this.chromaQuant[NATURAL_TO_ZIGZAG[i]] = clampQuant(
        (CHROMA_QUANT[i] * sf + 50) / 100,
      )
    }
    for (let row = 0, i = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++, i++) {
        const divisor = AAN[row] * AAN[col] * 8
        this.lumaScale[i] = 1 / (this.lumaQuant[NATURAL_TO_ZIGZAG[i]] * divisor)
        this.chromaScale[i] = 1 / (this.chromaQuant[NATURAL_TO_ZIGZAG[i]] * divisor)
      }
    }

    this.writeHeaders(options.dpi)
  }

  // ---- byte and bit output -------------------------------------------------

  private byte(value: number): void {
    if (this.used === this.buffer.length) {
      this.parts.push(this.buffer)
      this.buffer = new Uint8Array(1 << 20)
      this.used = 0
    }
    this.buffer[this.used++] = value
  }

  private word(value: number): void {
    this.byte((value >> 8) & 0xff)
    this.byte(value & 0xff)
  }

  private bits(code: number, length: number): void {
    this.bitBuffer = (this.bitBuffer << length) | code
    this.bitCount += length
    while (this.bitCount >= 8) {
      this.bitCount -= 8
      const out = (this.bitBuffer >> this.bitCount) & 0xff
      this.byte(out)
      // 0xFF inside entropy coded data has to be stuffed, or a decoder reads it as a
      // marker and the rest of the file is garbage.
      if (out === 0xff) this.byte(0)
    }
    this.bitBuffer &= (1 << this.bitCount) - 1
  }

  private flushBits(): void {
    if (this.bitCount > 0) this.bits((1 << (8 - this.bitCount)) - 1, 8 - this.bitCount)
    this.bitBuffer = 0
    this.bitCount = 0
  }

  // ---- headers -------------------------------------------------------------

  private writeHeaders(dpi: number): void {
    this.word(0xffd8) // SOI

    // APP0 / JFIF, carrying the print density. Units 1 means dots per inch, which is
    // what makes a layout program open the file at the right physical size.
    this.word(0xffe0)
    this.word(16)
    for (const c of 'JFIF') this.byte(c.charCodeAt(0))
    this.byte(0)
    this.word(0x0102) // version 1.2
    this.byte(1) // density units: dots per inch
    this.word(Math.round(dpi))
    this.word(Math.round(dpi))
    this.byte(0)
    this.byte(0)

    this.word(0xffdb) // DQT, both tables
    this.word(132)
    this.byte(0)
    for (let i = 0; i < 64; i++) this.byte(this.lumaQuant[i])
    this.byte(1)
    for (let i = 0; i < 64; i++) this.byte(this.chromaQuant[i])

    this.word(0xffc0) // SOF0, baseline
    this.word(17)
    this.byte(8)
    this.word(this.height)
    this.word(this.width)
    this.byte(3)
    // All three components at 1x1 sampling: 4:4:4, full resolution chroma.
    this.byte(1)
    this.byte(0x11)
    this.byte(0)
    this.byte(2)
    this.byte(0x11)
    this.byte(1)
    this.byte(3)
    this.byte(0x11)
    this.byte(1)

    this.writeHuffmanTable(0x00, DC_LUMA_BITS, DC_LUMA_VALUES)
    this.writeHuffmanTable(0x10, AC_LUMA_BITS, AC_LUMA_VALUES)
    this.writeHuffmanTable(0x01, DC_CHROMA_BITS, DC_CHROMA_VALUES)
    this.writeHuffmanTable(0x11, AC_CHROMA_BITS, AC_CHROMA_VALUES)

    this.word(0xffda) // SOS
    this.word(12)
    this.byte(3)
    this.byte(1)
    this.byte(0x00)
    this.byte(2)
    this.byte(0x11)
    this.byte(3)
    this.byte(0x11)
    this.byte(0)
    this.byte(63)
    this.byte(0)
  }

  private writeHuffmanTable(id: number, bits: number[], values: number[]): void {
    this.word(0xffc4)
    this.word(2 + 1 + 16 + values.length)
    this.byte(id)
    for (const n of bits) this.byte(n)
    for (const v of values) this.byte(v)
  }

  // ---- pixels --------------------------------------------------------------

  /** Appends `rows` scanlines of interleaved 8 bit RGB. */
  writeRows(rgb: Uint8Array, rows: number): void {
    if (this.done) throw new Error('JPEG encoder already finished')
    if (this.rowsWritten + rows > this.height) {
      throw new Error(
        `JPEG encoder given ${this.rowsWritten + rows} rows for a ${this.height} row image`,
      )
    }
    const rowBytes = this.width * 3
    let consumed = 0
    while (consumed < rows) {
      const take = Math.min(8 - this.stripRows, rows - consumed)
      this.strip.set(
        rgb.subarray(consumed * rowBytes, (consumed + take) * rowBytes),
        this.stripRows * rowBytes,
      )
      this.stripRows += take
      consumed += take
      if (this.stripRows === 8) this.encodeStrip(8)
    }
    this.rowsWritten += rows
  }

  private encodeStrip(validRows: number): void {
    const rowBytes = this.width * 3
    // The last strip of a height that is not a multiple of 8 gets its missing rows
    // filled by repeating the last real row, so the padding cannot pull a dark or
    // bright edge into the bottom block row.
    for (let r = validRows; r < 8; r++) {
      this.strip.copyWithin(r * rowBytes, (validRows - 1) * rowBytes, validRows * rowBytes)
    }

    const mcusAcross = Math.ceil(this.width / 8)
    const y = new Float32Array(64)
    const cb = new Float32Array(64)
    const cr = new Float32Array(64)

    for (let mx = 0; mx < mcusAcross; mx++) {
      for (let row = 0; row < 8; row++) {
        const rowStart = row * rowBytes
        for (let col = 0; col < 8; col++) {
          // Same idea horizontally: clamp to the last real column.
          const sx = Math.min(mx * 8 + col, this.width - 1)
          const p = rowStart + sx * 3
          const r = this.strip[p]
          const g = this.strip[p + 1]
          const b = this.strip[p + 2]
          const i = row * 8 + col
          y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128
          cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b
          cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b
        }
      }
      this.dcY = this.encodeBlock(y, this.lumaScale, this.dcLuma, this.acLuma, this.dcY)
      this.dcCb = this.encodeBlock(
        cb,
        this.chromaScale,
        this.dcChroma,
        this.acChroma,
        this.dcCb,
      )
      this.dcCr = this.encodeBlock(
        cr,
        this.chromaScale,
        this.dcChroma,
        this.acChroma,
        this.dcCr,
      )
    }
    this.stripRows = 0
  }

  private encodeBlock(
    input: Float32Array,
    scale: Float32Array,
    dcTable: Code[],
    acTable: Code[],
    previousDc: number,
  ): number {
    const data = this.block
    data.set(input)
    forwardDct(data)

    const q = this.quantised
    for (let i = 0; i < 64; i++) {
      const v = data[i] * scale[i]
      q[i] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0
    }
    const z = this.zigzag
    for (let i = 0; i < 64; i++) z[NATURAL_TO_ZIGZAG[i]] = q[i]

    const dc = z[0]
    const diff = dc - previousDc
    if (diff === 0) {
      this.emit(dcTable[0])
    } else {
      const size = magnitude(diff)
      this.emit(dcTable[size])
      this.bits(diff > 0 ? diff : diff + (1 << size) - 1, size)
    }

    // Trailing zeros are replaced by a single end of block code, so find the last one.
    let end = 63
    while (end > 0 && z[end] === 0) end--

    for (let k = 1; k <= end; k++) {
      let run = 0
      while (k <= end && z[k] === 0) {
        run++
        k++
      }
      // A run longer than 15 needs ZRL (sixteen zeros) codes first.
      while (run >= 16) {
        this.emit(acTable[0xf0])
        run -= 16
      }
      const value = z[k]
      const size = magnitude(value)
      this.emit(acTable[(run << 4) | size])
      this.bits(value > 0 ? value : value + (1 << size) - 1, size)
    }
    if (end < 63) this.emit(acTable[0x00])

    return dc
  }

  private emit(code: Code): void {
    this.bits(code.code, code.length)
  }

  finish(): Blob {
    if (this.done) throw new Error('JPEG encoder already finished')
    if (this.rowsWritten !== this.height) {
      throw new Error(
        `JPEG encoder finished with ${this.rowsWritten} of ${this.height} rows`,
      )
    }
    this.done = true
    if (this.stripRows > 0) this.encodeStrip(this.stripRows)
    this.flushBits()
    this.word(0xffd9) // EOI
    this.parts.push(this.buffer.subarray(0, this.used))
    return new Blob(this.parts as BlobPart[], { type: 'image/jpeg' })
  }
}

function clampQuant(value: number): number {
  const v = Math.floor(value)
  return v < 1 ? 1 : v > 255 ? 255 : v
}

/** Number of bits needed to carry `value`, which is its JPEG size category. */
function magnitude(value: number): number {
  let v = value < 0 ? -value : value
  let n = 0
  while (v) {
    v >>= 1
    n++
  }
  return n
}

/**
 * AAN fast forward DCT, in place, on a 64 entry block in natural order. The output is
 * scaled; the scale is folded into the quantisation table by the constructor.
 */
function forwardDct(data: Float32Array): void {
  for (let offset = 0; offset < 64; offset += 8) {
    const d0 = data[offset]
    const d1 = data[offset + 1]
    const d2 = data[offset + 2]
    const d3 = data[offset + 3]
    const d4 = data[offset + 4]
    const d5 = data[offset + 5]
    const d6 = data[offset + 6]
    const d7 = data[offset + 7]

    const t0 = d0 + d7
    const t7 = d0 - d7
    const t1 = d1 + d6
    const t6 = d1 - d6
    const t2 = d2 + d5
    const t5 = d2 - d5
    const t3 = d3 + d4
    const t4 = d3 - d4

    let t10 = t0 + t3
    const t13 = t0 - t3
    let t11 = t1 + t2
    const t12 = t1 - t2

    data[offset] = t10 + t11
    data[offset + 4] = t10 - t11

    const z1 = (t12 + t13) * 0.707106781
    data[offset + 2] = t13 + z1
    data[offset + 6] = t13 - z1

    t10 = t4 + t5
    t11 = t5 + t6
    const t12b = t6 + t7

    const z5 = (t10 - t12b) * 0.382683433
    const z2 = 0.5411961 * t10 + z5
    const z4 = 1.306562965 * t12b + z5
    const z3 = t11 * 0.707106781

    const z11 = t7 + z3
    const z13 = t7 - z3

    data[offset + 5] = z13 + z2
    data[offset + 3] = z13 - z2
    data[offset + 1] = z11 + z4
    data[offset + 7] = z11 - z4
  }

  for (let offset = 0; offset < 8; offset++) {
    const d0 = data[offset]
    const d1 = data[offset + 8]
    const d2 = data[offset + 16]
    const d3 = data[offset + 24]
    const d4 = data[offset + 32]
    const d5 = data[offset + 40]
    const d6 = data[offset + 48]
    const d7 = data[offset + 56]

    const t0 = d0 + d7
    const t7 = d0 - d7
    const t1 = d1 + d6
    const t6 = d1 - d6
    const t2 = d2 + d5
    const t5 = d2 - d5
    const t3 = d3 + d4
    const t4 = d3 - d4

    let t10 = t0 + t3
    const t13 = t0 - t3
    let t11 = t1 + t2
    const t12 = t1 - t2

    data[offset] = t10 + t11
    data[offset + 32] = t10 - t11

    const z1 = (t12 + t13) * 0.707106781
    data[offset + 16] = t13 + z1
    data[offset + 48] = t13 - z1

    t10 = t4 + t5
    t11 = t5 + t6
    const t12b = t6 + t7

    const z5 = (t10 - t12b) * 0.382683433
    const z2 = 0.5411961 * t10 + z5
    const z4 = 1.306562965 * t12b + z5
    const z3 = t11 * 0.707106781

    const z11 = t7 + z3
    const z13 = t7 - z3

    data[offset + 40] = z13 + z2
    data[offset + 24] = z13 - z2
    data[offset + 8] = z11 + z4
    data[offset + 56] = z11 - z4
  }
}
