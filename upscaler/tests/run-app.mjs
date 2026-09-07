// End to end run through the built app in a phone sized browser.
//
// This drives the real production build, not the dev server: upload, print size, crop,
// enhance, upscale, download. It also checks for horizontal overflow at 375 px on every
// screen, because a sideways scrollbar on a phone makes the whole thing feel broken.
import { chromium } from 'playwright'
import { preview } from 'vite'
import { existsSync, mkdirSync } from 'node:fs'

const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SHOTS = process.env.SHOT_DIR ?? 'tests/tmp/shots'
const PHOTO = 'tests/tmp/photo.jpg'

if (!existsSync('dist/index.html')) {
  console.error('run "npm run build" first')
  process.exit(1)
}
if (!existsSync(PHOTO)) {
  console.error(`missing ${PHOTO} (see tests/README.md)`)
  process.exit(1)
}
mkdirSync(SHOTS, { recursive: true })

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

await page.setInputFiles('input[type=file]', PHOTO)
await page.waitForSelector('text=Choose print size', { timeout: 30_000 })
const dimensions = await page.textContent('text=/^\\d[\\d,]* x [\\d,]*\\d$/')
await checkOverflow('02-upload-loaded')

await page.click('text=Choose print size')
await page.waitForSelector('text=Preset sizes')
await checkOverflow('03-size-presets')

// A deliberately small print, so the check runs in software rendering in a sane time.
// The pipeline is identical whatever the numbers are.
const widthBox = page.locator('label:has-text("Width") input')
await widthBox.fill('6')
const heightBox = page.locator('label:has-text("Height") input')
await heightBox.fill('4')
await page.click('button[role=radio]:has-text("100")')
await page.waitForTimeout(200)
const needed = await page.textContent('text=/^600 x 400$/')
await checkOverflow('04-size-custom')

await page.click('text=Check the crop')
await page.waitForSelector('text=Choose quality')
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
const estimate = await page.textContent('text=/Estimated time/ >> xpath=..')
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

// The compare viewer renders its patch through the same pipeline; give it a moment and
// confirm both canvases actually got pixels rather than staying blank.
await page.waitForTimeout(4000)
const canvases = await page.evaluate(() => {
  const found = [...document.querySelectorAll('canvas')]
  return found.map((canvas) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let nonBlank = 0
    for (let i = 0; i < data.length; i += 4000) if (data[i + 3] > 0) nonBlank++
    return nonBlank
  })
})
await checkOverflow('08-compare')

await browser.close()
await server.close()

console.log(`source dimensions shown: ${dimensions}`)
console.log(`pixels needed shown:     ${needed}`)
console.log(`estimate:                ${estimate?.replace(/\s+/g, ' ').trim()}`)
console.log(`download filename:       ${download}`)
console.log('print readiness screen:')
for (const [key, value] of Object.entries(summary)) {
  console.log(`  ${key.padEnd(20)} ${value}`)
}
console.log(`compare canvases painted: ${canvases.join(', ')}`)
console.log(`screenshots in ${SHOTS}`)
console.log(`total ${((Date.now() - started) / 1000).toFixed(1)}s`)

const expected = {
  'Final resolution': '600 x 400 px',
  DPI: '100',
  Format: 'PNG',
}
for (const [key, value] of Object.entries(expected)) {
  if (summary[key] !== value) problems.push(`summary ${key}: "${summary[key]}" not "${value}"`)
}
if (!download?.endsWith('-600x400-100dpi.png')) {
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
