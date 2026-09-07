// Drives the harness page in a real Chromium. Boots vite in middleware-free dev mode,
// opens the page, runs each test and prints a pass or fail line with the numbers it
// measured, so a claim in this repo can be checked rather than taken on trust.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { existsSync } from 'node:fs'

const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const only = process.argv.slice(2)
const checks = [
  {
    name: 'referenceOutput',
    describe: (r) =>
      `vs published output on ${r.backend}: 2x ${r.x2Psnr.toFixed(1)} dB ` +
      `(max ${r.x2MaxDiff.toFixed(1)}), 4x ${r.x4Psnr.toFixed(1)} dB ` +
      `(max ${r.x4MaxDiff.toFixed(1)})`,
    // The published samples are 8 bit PNGs of a float result, so an exact match is not
    // possible; anything above 45 dB means we are reproducing them.
    pass: (r) => r.x2Psnr > 45 && r.x4Psnr > 45,
  },
  {
    name: 'superResolution',
    describe: (r) =>
      `edge energy: truth ${r.truthGradient.toFixed(2)}, AI ${r.aiGradient.toFixed(2)}, ` +
      `Lanczos ${r.lanczosGradient.toFixed(2)} ` +
      `(AI recovers ${(((r.aiGradient - r.lanczosGradient) / r.lanczosGradient) * 100).toFixed(0)}% more); ` +
      `PSNR AI ${r.aiPsnr.toFixed(2)} dB vs Lanczos ${r.lanczosPsnr.toFixed(2)} dB on ${r.backend}`,
    pass: (r) =>
      // Clearly more detail than a good resize recovers, without overshooting past the
      // real image, and not just a resize wearing a different name.
      r.aiGradient > r.lanczosGradient * 1.15 &&
      r.aiGradient < r.truthGradient &&
      r.aiPsnr > r.lanczosPsnr - 0.5 &&
      r.identical < 40,
  },
  {
    name: 'tileInvariance',
    describe: (r) => `max channel difference ${r.maxDiff.toFixed(3)} of 255`,
    pass: (r) => r.maxDiff < 1.0,
  },
  {
    name: 'bandInvariance',
    describe: (r) =>
      `${r.size.join('x')}; 8 row bands differ by ${r.maxManyBands}; ` +
      `byte cached intermediate differs by max ${r.maxCached}, ` +
      `mean ${r.meanCached.toFixed(3)}, worst row mean ${r.worstRowMean.toFixed(3)}`,
    pass: (r) =>
      // Band count changes nothing: no seams, at all.
      r.maxManyBands === 0 &&
      // Byte intermediates cost a little precision and nothing else. If the difference
      // were a seam it would pile up on a few rows, so the worst row has to stay close
      // to the average rather than standing out.
      r.maxCached <= 8 &&
      r.meanCached < 0.6 &&
      r.worstRowMean < r.meanCached * 3 + 0.2,
  },
  {
    name: 'borders',
    describe: (r) =>
      `${r.size.join('x')} border ${r.topLeft.join(',')} / ${r.leftEdge.join(',')}, ` +
      `content ${r.firstContent.join(',')}`,
    pass: (r) =>
      r.topLeft.join() === '12,34,56' &&
      r.leftEdge.join() === '12,34,56' &&
      r.bottomRight.join() === '12,34,56' &&
      r.firstContent.join() !== '12,34,56',
  },
  ...['largePng', 'largeTiff', 'largeJpeg'].map((name) => ({
    name,
    describe: (r) =>
      `${r.megapixels.toFixed(1)} MP ${r.type} in ${r.seconds.toFixed(1)}s, ` +
      `${(r.bytes / 1e6).toFixed(1)} MB`,
    pass: (r) => r.bytes > 100_000,
  })),
]

if (!existsSync('tests/tmp/photo.jpg')) {
  console.error('missing tests/tmp/photo.jpg (see tests/README.md)')
  process.exit(1)
}

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  publicDir: 'public',
  // No hot reload and no file watching. Editing a source file while a check is running
  // would otherwise reload the page out from under it, and the failure that produces
  // ("execution context was destroyed") looks nothing like its cause.
  server: { port: 5219, strictPort: true, hmr: false, watch: null },
  logLevel: 'error',
})
await server.listen()

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console]', m.text())
})
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
await page.goto('http://localhost:5219/tests/browser/harness.html')
await page.waitForFunction('window.__ready === true', null, { timeout: 120_000 })

let failures = 0
for (const check of checks) {
  if (only.length && !only.includes(check.name)) continue
  const started = Date.now()
  try {
    const result = await page.evaluate((n) => window.__run(n), check.name)
    const ok = check.pass(result)
    if (!ok) failures++
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${check.name.padEnd(16)} ${check.describe(result)}` +
        `  [${((Date.now() - started) / 1000).toFixed(1)}s]`,
    )
  } catch (error) {
    failures++
    console.log(`FAIL ${check.name.padEnd(16)} threw: ${error.message.split('\n')[0]}`)
  }
}

await browser.close()
await server.close()
console.log(failures === 0 ? '\nall browser checks passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
