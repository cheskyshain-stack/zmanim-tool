// Builds this app for CJ Portal and copies the result into a checkout of that site.
//
// The upscaler is the one tool on that site with a build step, so the source lives here
// and only the built output is committed there. This script is the whole bridge between
// the two, so there is one command rather than a sequence to remember and get wrong.
//
//   node scripts/publish-to-portal.mjs [path-to-my-tools-checkout]
//
// It writes nothing to git. Review the diff in the portal repo and commit it there.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portal = resolve(process.argv[2] ?? process.env.PORTAL_DIR ?? '/home/user/my-tools')
const target = join(portal, 'upscaler')

if (!existsSync(join(portal, 'CNAME'))) {
  console.error(
    `\n${portal} does not look like the CJ Portal checkout (no CNAME).\n` +
      'Pass the path: node scripts/publish-to-portal.mjs /path/to/my-tools\n',
  )
  process.exit(1)
}

console.log('building for /upscaler/ ...')
execFileSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    BASE_PATH: '/upscaler/',
    // Turns on the way home and the portal page conventions. See cjPortal() in
    // vite.config.ts.
    VITE_PORTAL_HOME: '/',
  },
})

// Replace rather than merge: a stale hashed chunk left behind would be dead weight in
// the portal repo for ever, and the service worker precache would still list it.
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(join(root, 'dist'), target, { recursive: true })

async function measure(dir) {
  let bytes = 0
  let files = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await measure(full)
      bytes += inner.bytes
      files += inner.files
    } else {
      bytes += (await stat(full)).size
      files += 1
    }
  }
  return { bytes, files }
}

const { bytes, files } = await measure(target)
console.log(
  `\nwrote ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB to ${target}\n` +
    'Now review and commit in the portal repo.',
)
