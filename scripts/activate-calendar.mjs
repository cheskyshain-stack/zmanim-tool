// Run on a computer already signed in to the shul's Cloudflare account.
// Only the new calendar Worker is deployed. No public navigation is enabled.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = path.join(root, 'worker/calendar/wrangler.jsonc');
function wrangler(args, input) {
  const windows = !process.env.CALENDAR_WRANGLER_BIN && process.platform === 'win32';
  const executable = process.env.CALENDAR_WRANGLER_BIN || (windows ? process.execPath : 'npx');
  const command = process.env.CALENDAR_WRANGLER_BIN ? args : windows
    ? [path.join(root, 'worker/calendar/node_modules/wrangler/bin/wrangler.js'), ...args]
    : ['--yes', 'wrangler@4.152.0', ...args];
  const result = spawnSync(executable, command, { cwd: root, input, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['pipe', 'pipe', 'inherit'] });
  if (result.status !== 0) throw new Error('Cloudflare could not complete the calendar setup. Check the authorized account and rerun this command.');
  return result.stdout;
}
wrangler(['whoami']);
const deployment = wrangler(['deploy', '--config', config]);
const endpoint = deployment.match(/https:\/\/zmanim-calendar\.[a-z0-9-]+\.workers\.dev\b/)?.[0];
if (!endpoint) throw new Error('Cloudflare did not return a calendar service URL. The website connection was left unchanged.');
const origin = 'https://' + (await readFile(path.join(root, 'CNAME'), 'utf8')).trim();
let info;
for (let attempt = 0; attempt < 5; attempt++) {
  info = await fetch(endpoint + '/api/info', { headers: { Origin: origin } });
  if (info.ok || ![404, 429, 500, 502, 503, 504].includes(info.status) || attempt === 4) break;
  await info.body?.cancel();
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!info.ok) throw new Error('The calendar service could not be verified. The website connection was left unchanged.');
const state = await info.json();
if (!state.private || !state.accounts || !state.emailImport) throw new Error('The service is not the expected private calendar with LC Text support.');
const denied = await fetch(endpoint + '/api/events?from=2026-11-01&to=2026-11-30', { headers: { Origin: origin } });
if (denied.status !== 401) throw new Error('The calendar must require sign-in before its website connection is enabled.');
const inboxDenied = await fetch(endpoint + '/api/email-import/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heartbeat: true }) });
if (inboxDenied.status !== 401) throw new Error('The email receiver must reject requests without its private connection key.');
let setupFile;
if (!state.ready) {
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  wrangler(['secret', 'put', 'BOOTSTRAP_SHA256', '--config', config], digest + '\n');
  setupFile = path.join(homedir(), 'Lakewood-Commons-calendar-owner-setup-' + Date.now() + '.txt');
  await writeFile(setupFile, 'Private calendar owner setup\n\nOpen this link to create your main calendar admin account:\n' + origin + '/admin/calendar/#setup=' + token + '\n\nKeep this file private. Never commit it or paste the link into deployment logs.\n', { mode: 0o600, flag: 'wx' });
}
await writeFile(path.join(root, 'data/calendar.json'), JSON.stringify({ endpoint }) + '\n');
console.log('Verified private calendar service. Rebuild, test and publish the website connection using the normal deployment process.');
console.log(setupFile ? 'The private owner setup link was saved outside the repository: ' + setupFile : 'The existing main admin account was preserved.');
