// Bundles and runs tests/encoders.test.mts, which writes the sample files that
// tests/verify-encoders.py then checks with Pillow.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

const out = 'tests/tmp/encoders'
mkdirSync(out, { recursive: true })
await build({
  entryPoints: ['tests/encoders.test.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'tests/tmp/encoders.mjs',
  logLevel: 'warning',
})
const { pathToFileURL } = await import('node:url')
process.argv[2] = out
await import(pathToFileURL(`${process.cwd()}/tests/tmp/encoders.mjs`).href)
