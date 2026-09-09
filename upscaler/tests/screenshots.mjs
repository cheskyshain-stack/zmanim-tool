// Captures the whole flow through the built app, in a phone and a desktop viewport and
// in both themes. Not a test: it asserts nothing and exists so the interface can be
// looked at without a device to hand.
//
//   npm run build && node tests/screenshots.mjs
import { chromium } from 'playwright'
import { preview } from 'vite'
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const OUT = process.env.SHOT_DIR ?? 'tests/tmp/shots'
const SOURCE = 'tests/tmp/app-source.png'
const SRC_WIDTH = 256
const SRC_HEIGHT = 96

if (!existsSync('dist/index.html')) {
  console.error('run "npm run build" first')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
writeFileSync(SOURCE, makeSourcePng())

const VIEWS = [
  { name: 'phone-light', width: 390, height: 844, theme: 'light', mobile: true },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark', mobile: true },
  { name: 'desktop-dark', width: 1200, height: 900, theme: 'dark', mobile: false },
]

const server = await preview({
  configFile: false,
  root: process.cwd(),
  preview: { port: 5241, strictPort: true },
  logLevel: 'error',
})
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 2,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  })
  const page = await context.newPage()
  // The app reads its theme out of its own settings key, so set it before first paint
  // rather than clicking through Settings on every run.
  await page.addInitScript((theme) => {
    localStorage.setItem(
      'print-upscaler-settings-v1',
      JSON.stringify({ theme, presetId: '36x96' }),
    )
  }, view.theme)

  const shot = (step) =>
    page.screenshot({ path: `${OUT}/${view.name}-${step}.png`, fullPage: true })

  await page.goto('http://localhost:5241/', { waitUntil: 'networkidle' })
  await shot('1-upload')

  await page.setInputFiles('input[type=file]', SOURCE)
  await page.waitForSelector('text=Choose print size', { timeout: 30_000 })
  await shot('2-loaded')

  await page.click('text=Choose print size')
  await page.waitForSelector('text=Preset sizes')
  await shot('3-size')

  await page.locator('label:has-text("Width") input').fill('8')
  await page.locator('label:has-text("Height") input').fill('3')
  await page.locator('button[role=radio]', { hasText: /^150$/ }).click()
  await page.waitForTimeout(200)

  await page.click('text=Check the crop')
  await page.waitForSelector('text=Choose quality')
  await shot('4-crop')

  await page.click('text=Choose quality')
  await page.waitForSelector('text=Maximum Print Quality')
  await page.waitForFunction(() => !document.body.textContent.includes('measuring...'), null, {
    timeout: 180_000,
  })
  await shot('5-enhance')

  await page.click('button:has-text("Upscale")')
  // Catch the progress screen part way through rather than after it has gone.
  await page.waitForSelector('text=Upscaling', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await shot('6-progress')

  await page.waitForSelector('text=READY FOR LARGE FORMAT PRINTING', { timeout: 300_000 })
  await shot('7-ready')

  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('canvas')].length >= 3 &&
        [...document.querySelectorAll('canvas')].every((canvas) => {
          const ctx = canvas.getContext('2d')
          if (!ctx || !canvas.width) return false
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          for (let i = 3; i < data.length; i += 4000) if (data[i] > 0) return true
          return false
        }),
      null,
      { timeout: 300_000 },
    )
    .catch(() => {})
  await shot('8-compare')

  await page.click('text=Settings')
  await page.waitForSelector('text=Appearance')
  await shot('9-settings')

  console.log(`${view.name}: done`)
  await context.close()
}

await browser.close()
await server.close()
console.log(`screenshots in ${OUT}`)

function makeSourcePng() {
  const raw = Buffer.alloc(SRC_HEIGHT * (SRC_WIDTH * 3 + 1))
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < SRC_HEIGHT; y++) {
    const row = y * (SRC_WIDTH * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < SRC_WIDTH; x++) {
      const p = row + 1 + x * 3
      raw[p] = (Math.sin(x / 9) * 90 + 140 + rand() * 12) & 255
      raw[p + 1] = (Math.cos(y / 7) * 70 + 130 + rand() * 12) & 255
      raw[p + 2] = x % 32 < 16 ? 60 : 200
    }
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'ascii')
    body.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SRC_WIDTH, 0)
  ihdr.writeUInt32BE(SRC_HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}
