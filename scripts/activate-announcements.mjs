import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = path.join(root, 'worker/announcements');
const cli = path.join(service, 'node_modules/wrangler/bin/wrangler.js');
const origin = 'https://baismedrashoflakewoodcommons.org';
if (!fs.existsSync(cli)) throw new Error('First run npm ci --prefix worker/announcements.');
const run = (args, input) => execFileSync(process.execPath, [cli, ...args], { cwd: root, input, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
const config = ['--config', 'worker/announcements/wrangler.jsonc'];
const dryRun = process.argv.includes('--dry-run');
const log = run(['deploy', ...config, ...(dryRun ? ['--dry-run'] : [])]);
process.stdout.write(log);
if (dryRun) { console.log('Packaging check completed.'); process.exit(0); }
const endpoint = log.match(/https:\/\/zmanim-announcements\.[a-z0-9-]+\.workers\.dev\b/)?.[0];
if (!endpoint) throw new Error('The deployment did not return an announcements service URL. The website has not been connected.');
const infoResponse = await fetch(endpoint + '/api/info', { headers: { Origin: origin } });
if (!infoResponse.ok) throw new Error('The service check failed. The website has not been connected.');
const info = await infoResponse.json();
const denied = await fetch(endpoint + '/api/manage/posts', { headers: { Origin: origin } });
if (denied.status !== 401) throw new Error('The service did not protect posting access. The website has not been connected.');
if (!info.ready) {
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  run(['secret', 'put', 'BOOTSTRAP_SHA256', ...config], digest + '\n');
  const destination = path.join(os.homedir(), 'Lakewood-Announcements-Setup-' + Date.now() + '.txt');
  const link = origin + '/announcements/manage/#setup=' + token;
  fs.writeFileSync(destination, 'PRIVATE OWNER SETUP LINK\n\nPublish the prepared website first, then open:\n' + link + '\n\nCreate your owner account with your own name, email and a password of at least 12 characters. The setup link stops working after that. Keep the password in your password manager.\n\nTo try a test editor, open Posting access, press Use a test person, then Create posting link. Open that one-use link in a separate browser and choose the test editor password.\n', { mode: 0o600 });
  console.log('The private owner setup link was saved to: ' + destination);
  console.log('Its token has not been printed or committed. Open that file after the website is published.');
} else console.log('The existing owner account and notification keys have been preserved.');
fs.writeFileSync(path.join(root, 'data/announcements.json'), JSON.stringify({ endpoint }) + '\n');
console.log('Verified server access protection and connected data/announcements.json. Build, test and publish the website, then complete owner setup if needed.');
