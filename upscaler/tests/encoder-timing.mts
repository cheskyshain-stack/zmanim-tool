// Times the three encoders on this machine's CPU. Not a test, so it asserts nothing:
// it is where the encoder numbers in the README come from, so they can be rechecked.
//
//   npx tsx tests/encoder-timing.mts
import { PngEncoder } from '../src/lib/encode/png'
import { TiffEncoder } from '../src/lib/encode/tiff'
import { JpegEncoder } from '../src/lib/encode/jpeg'

const WIDTH = 4000
const HEIGHT = 2000
const BAND = 100
const MEGAPIXELS = (WIDTH * HEIGHT) / 1e6

// Ramps plus structure, so deflate has something to work with but not a trivial run.
const band = new Uint8Array(WIDTH * 3 * BAND)
for (let i = 0; i < band.length; i++) {
  band[i] = (i * 7 + Math.sin(i / 500) * 60) & 255
}

const cases = [
  ['PNG adaptive, deflate 6', () => new PngEncoder(WIDTH, HEIGHT, { dpi: 300 })],
  [
    'PNG up filter, deflate 4',
    () => new PngEncoder(WIDTH, HEIGHT, { dpi: 300, level: 4, filter: 'up' }),
  ],
  ['TIFF deflate 6, predictor', () => new TiffEncoder(WIDTH, HEIGHT, { dpi: 300 })],
  ['JPEG quality 95, 4:4:4', () => new JpegEncoder(WIDTH, HEIGHT, { dpi: 300, quality: 95 })],
] as const

console.log(`${MEGAPIXELS} MP, fed ${BAND} rows at a time\n`)
for (const [label, make] of cases) {
  const started = performance.now()
  const encoder = make()
  for (let y = 0; y < HEIGHT; y += BAND) {
    encoder.writeRows(band, Math.min(BAND, HEIGHT - y))
  }
  const blob = encoder.finish()
  const seconds = (performance.now() - started) / 1000
  console.log(
    `${label.padEnd(26)} ${seconds.toFixed(2)}s  ` +
      `${(MEGAPIXELS / seconds).toFixed(1)} MP/s  ` +
      `${(blob.size / 1e6).toFixed(1)} MB`,
  )
}
