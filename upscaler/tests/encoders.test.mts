// Round trip check for the three streaming encoders. Encodes a synthetic image in
// awkward band sizes, then the companion Python script decodes the files with Pillow
// and compares pixels and metadata.
import { writeFileSync, mkdirSync } from 'node:fs'
import { PngEncoder } from '../src/lib/encode/png'
import { TiffEncoder } from '../src/lib/encode/tiff'
import { JpegEncoder } from '../src/lib/encode/jpeg'

const WIDTH = 517
const HEIGHT = 233
const DPI = 300
const OUT = process.argv[2] ?? '.'

function makeImage(): Uint8Array {
  const buf = new Uint8Array(WIDTH * HEIGHT * 3)
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const p = (y * WIDTH + x) * 3
      // Smooth ramps plus a hard edge plus a little noise: exercises the filters, the
      // predictor and the DCT rather than compressing to nothing.
      buf[p] = Math.round((x / WIDTH) * 255)
      buf[p + 1] = Math.round((y / HEIGHT) * 255)
      buf[p + 2] = x > WIDTH / 2 ? 230 : 25
      if ((x + y) % 17 === 0) {
        buf[p] = Math.round(rand() * 255)
        buf[p + 2] = Math.round(rand() * 255)
      }
    }
  }
  return buf
}

async function save(name: string, blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  writeFileSync(`${OUT}/${name}`, bytes)
  console.log(`${name}: ${bytes.length} bytes`)
}

const image = makeImage()
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/source.raw`, image)

// Feed rows in uneven bands so the encoders' internal buffering is actually exercised.
const BANDS = [7, 1, 64, 100, 33]
function* bands() {
  let y = 0
  let i = 0
  while (y < HEIGHT) {
    const rows = Math.min(BANDS[i++ % BANDS.length], HEIGHT - y)
    yield { y, rows }
    y += rows
  }
}

const png = new PngEncoder(WIDTH, HEIGHT, { dpi: DPI })
for (const { y, rows } of bands()) {
  png.writeRows(image.subarray(y * WIDTH * 3, (y + rows) * WIDTH * 3), rows)
}
await save('out.png', png.finish())

const tiff = new TiffEncoder(WIDTH, HEIGHT, { dpi: DPI, rowsPerStrip: 40 })
for (const { y, rows } of bands()) {
  tiff.writeRows(image.subarray(y * WIDTH * 3, (y + rows) * WIDTH * 3), rows)
}
await save('out.tiff', tiff.finish())

const jpeg = new JpegEncoder(WIDTH, HEIGHT, { dpi: DPI, quality: 95 })
for (const { y, rows } of bands()) {
  jpeg.writeRows(image.subarray(y * WIDTH * 3, (y + rows) * WIDTH * 3), rows)
}
await save('out.jpg', jpeg.finish())

// A single strip TIFF takes the inline offset branch, which is a different code path.
const tiff1 = new TiffEncoder(WIDTH, HEIGHT, { dpi: DPI, rowsPerStrip: HEIGHT })
tiff1.writeRows(image, HEIGHT)
await save('out-onestrip.tiff', tiff1.finish())
