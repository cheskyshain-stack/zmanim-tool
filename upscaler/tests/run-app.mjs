// End to end run through the built app in a phone sized browser.
//
// This drives the real production build, not the dev server: upload, print size, crop,
// enhance, upscale, download. It also checks for horizontal overflow at 375 px on every
// screen, because a sideways scrollbar on a phone makes the whole thing feel broken.
import { chromium } from 'playwright'
import { preview } from 'vite'
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SHOTS = process.env.SHOT_DIR ?? 'tests/tmp/shots'
const SOURCE = 'tests/tmp/app-source.png'

// 256 x 96 is 8:3, the same shape as a 36" x 96" banner, so the crop screen should say
// it fits perfectly. Small enough that the whole run finishes in seconds even with no
// GPU, and generated here rather than checked in so the test has no fixture to lose.
const SRC_WIDTH = 256
const SRC_HEIGHT = 96

if (!existsSync('dist/index.html')) {
  console.error('run "npm run build" first')
  process.exit(1)
}
mkdirSync(SHOTS, { recursive: true })
writeFileSync(SOURCE, makeSourcePng())

function makeSourcePng() {
  const raw = Buffer.alloc(SRC_HEIGHT * (SRC_WIDTH * 3 + 1))
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < SRC_HEIGHT; y++) {
    const row = y * (SRC_WIDTH * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < SRC_WIDTH; x++) {
      const p = row + 1 + x * 3
      // Ramps, a hard edge and some grain, so there is real detail for the network to
      // work on and the encoders cannot compress it to nothing.
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

const server = await preview({
  configFile: false,
  root: process.cwd(),
  preview: { port: 5233, strictPort: true },
  logLevel: 'error',
})

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({
  viewport: { width: 375, height: 780 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

async function checkOverflow(label) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  if (overflow.scroll > overflow.client + 1) {
    problems.push(
      `${label}: horizontal overflow, ${overflow.scroll}px of content in ${overflow.client}px`,
    )
  }
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: true })
}

const started = Date.now()
await page.goto('http://localhost:5233/', { waitUntil: 'networkidle' })
await checkOverflow('01-upload-empty')

await page.setInputFiles('input[type=file]', SOURCE)
await page.waitForSelector('text=Choose print size', { timeout: 30_000 })
const dimensions = await page.locator('text=/^\\d[\\d,]* x [\\d,]*\\d$/').first().textContent()
await checkOverflow('02-upload-loaded')

await page.click('text=Choose print size')
await page.waitForSelector('text=Preset sizes')
await checkOverflow('03-size-presets')

// A deliberately small print, so the check runs in software rendering in a sane time.
// The pipeline is identical whatever the numbers are, and 8" x 3" keeps the 8:3 shape
// so the run also covers the "fits perfectly, nothing cropped" path.
await page.locator('label:has-text("Width") input').fill('8')
await page.locator('label:has-text("Height") input').fill('3')
await page.locator('button[role=radio]', { hasText: /^150$/ }).click()
await page.waitForTimeout(200)
// 8 x 150 = 1200 and 3 x 150 = 450, which needs 1200 / 256 = 4.69x enlargement, so the
// planner has to choose a real multi pass chain rather than skipping the network.
const needed = await page.locator('text=/^1,200 x 450$/').first().textContent()
await checkOverflow('04-size-custom')

await page.click('text=Check the crop')
await page.waitForSelector('text=Choose quality')
const fits = await page.locator('text=Fits perfectly').count()
await checkOverflow('05-crop')

await page.click('text=Choose quality')
await page.waitForSelector('text=Maximum Print Quality')
await page.click('button:has-text("Natural")')
// The estimate comes from a real benchmark on the device, so wait for it to land.
await page.waitForFunction(
  () => !document.body.textContent.includes('measuring...'),
  null,
  { timeout: 180_000 },
)
const estimate = await page
  .locator('div:has(> div:text-is("Estimated time"))')
  .last()
  .innerText()
const passes = await page
  .locator('div:has(> div:text-is("AI passes"))')
  .last()
  .innerText()
await checkOverflow('06-enhance')

await page.click('button:has-text("Upscale")')
await page.waitForSelector('text=READY FOR LARGE FORMAT PRINTING', { timeout: 300_000 })
await checkOverflow('07-result')

const summary = await page.evaluate(() => {
  const rows = {}
  document.querySelectorAll('dl > div').forEach((row) => {
    const [key, value] = row.querySelectorAll('dt, dd')
    if (key && value) rows[key.textContent.trim()] = value.textContent.trim()
  })
  return rows
})
const download = await page.getAttribute('a[download]', 'download')

// The compare viewer renders its patch through the same pipeline, which on software
// rendering takes a while. Wait for every canvas to actually have pixels rather than
// guessing at a delay: a blank "after" panel is the failure worth catching here.
const canvasPixels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((canvas) => {
      const ctx = canvas.getContext('2d')
      if (!ctx || !canvas.width) return 0
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let painted = 0
      for (let i = 0; i < data.length; i += 4000) if (data[i + 3] > 0) painted++
      return painted
    }),
  )
try {
  await page.waitForFunction(
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
} catch {
  problems.push('compare viewer did not finish painting within 5 minutes')
}
const canvases = await canvasPixels()
await checkOverflow('08-compare')

await browser.close()
await server.close()

console.log(`source dimensions shown: ${dimensions}`)
console.log(`pixels needed shown:     ${needed}`)
console.log(`plan:                    ${passes?.replace(/\s+/g, ' ').trim()}`)
console.log(`estimate:                ${estimate?.replace(/\s+/g, ' ').trim()}`)
console.log(`crop screen says it fits: ${fits > 0}`)
console.log(`download filename:       ${download}`)
console.log('print readiness screen:')
for (const [key, value] of Object.entries(summary)) {
  console.log(`  ${key.padEnd(20)} ${value}`)
}
console.log(`compare canvases painted: ${canvases.join(', ')}`)
console.log(`screenshots in ${SHOTS}`)
console.log(`total ${((Date.now() - started) / 1000).toFixed(1)}s`)

const expected = {
  'Final resolution': '1,200 x 450 px',
  DPI: '150',
  Format: 'PNG',
  Cropping: 'None',
  'Aspect ratio': '8 : 3',
}
for (const [key, value] of Object.entries(expected)) {
  if (summary[key] !== value) problems.push(`summary ${key}: "${summary[key]}" not "${value}"`)
}
if (fits === 0) problems.push('crop screen did not report a perfect fit for an 8:3 source')
if (!/\dx then \dx/.test((passes ?? '').replace(/\s+/g, ' '))) {
  problems.push(`no multi pass AI chain planned: ${passes}`)
}
if (!download?.endsWith('-1200x450-150dpi.png')) {
  problems.push(`download filename wrong: ${download}`)
}
if (canvases.filter((n) => n > 0).length < 3) {
  problems.push(`compare viewer canvases blank: ${canvases.join(', ')}`)
}

if (problems.length) {
  console.log('\nPROBLEMS')
  for (const p of problems) console.log(`  ${p}`)
  process.exit(1)
}
console.log('\napp end to end passed')
