// Copies the ESRGAN weights out of node_modules and into public/models, which is where
// the app loads them from at runtime.
//
// The weights are shipped inside the @upscalerjs/* npm packages rather than downloaded
// from a model host at runtime. That is deliberate: the app then has no third party
// dependency at run time, works offline once installed as a PWA, costs nothing to run,
// and cannot break because somebody else's CDN moved a file.
//
// public/models is generated, not checked in. Run "npm run models" (build and dev both
// run it for you) after a fresh npm install.
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const out = join(root, 'public', 'models')

// Which scales we ship per family. x8 exists in both packages but upstream marks it
// node only, and two chained x4 passes beat one x8 pass on this architecture anyway,
// so it is left out rather than shipped as a trap.
const FAMILIES = [
  { id: 'esrgan-slim', pkg: '@upscalerjs/esrgan-slim', scales: [2, 3, 4] },
  { id: 'esrgan-medium', pkg: '@upscalerjs/esrgan-medium', scales: [2, 3, 4] },
]

async function dirSize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size
  }
  return total
}

async function main() {
  // Stage into a temporary directory and swap it in at the end, rather than emptying
  // public/models first. A dev server or a test run reading those files while this
  // script is halfway through would otherwise get a 404 for a model that exists.
  const staging = `${out}.staging`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  for (const family of FAMILIES) {
    const src = join(root, 'node_modules', family.pkg, 'models')
    if (!existsSync(src)) {
      console.error(
        `\nMissing ${family.pkg}. Run "npm install" first.\n`,
      )
      process.exit(1)
    }
    for (const scale of family.scales) {
      const from = join(src, `x${scale}`)
      const to = join(staging, family.id, `x${scale}`)
      if (!existsSync(join(from, 'model.json'))) {
        console.error(`\nMissing ${from}/model.json\n`)
        process.exit(1)
      }
      await mkdir(to, { recursive: true })
      await cp(from, to, { recursive: true })
    }
  }

  const mb = (await dirSize(staging)) / 1024 / 1024
  await rm(out, { recursive: true, force: true })
  await rename(staging, out)
  console.log(`models: wrote public/models (${mb.toFixed(1)} MB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
