// Run on the shul's authorized computer with a Google Web OAuth client download.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = path.join(root, 'worker/calendar/wrangler.jsonc');
const callback = 'https://zmanim-calendar.cheskyshain.workers.dev/api/google-calendar/callback';
const origin = 'https://baismedrashoflakewoodcommons.org';
const endpoint = 'https://zmanim-calendar.cheskyshain.workers.dev';
const clientId = 'GOOGLE_CALENDAR_CLIENT_ID';
const clientSecret = 'GOOGLE_CALENDAR_CLIENT_SECRET';
const tokenKey = 'GOOGLE_CALENDAR_TOKEN_KEY';

function runWrangler(args, input) {
  const result = spawnSync(process.execPath, [path.join(root, 'worker/calendar/node_modules/wrangler/bin/wrangler.js'), ...args, '--config', config], {
    cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
  });
  if (result.status !== 0) throw Error('Cloudflare could not complete this step. Install the calendar dependencies and sign in with Wrangler on the authorized computer, then retry. No command output was printed because it may contain credentials.');
  return result.stdout;
}

function parseJson(value, message) {
  try { return JSON.parse(value); } catch { throw Error(message); }
}

async function backupTokenKey(key) {
  const destination = path.join(homedir(), 'Lakewood-Commons-Google-token-key-' + randomBytes(8).toString('hex') + '.txt');
  const relative = path.relative(root, destination);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Error('A private backup location outside the repository is required. Nothing was changed.');
  try { await writeFile(destination, key + '\n', { mode: 0o600, flag: 'wx' }); }
  catch { throw Error('The new encryption key could not be backed up privately. Nothing was changed.'); }
  console.log('Private encryption-key backup saved outside the repository: ' + destination);
}

export async function activateGoogleCalendar(credentialsPath, {
  wrangler = runWrangler, send = fetch, read = readFile,
  makeKey = () => randomBytes(32).toString('hex'),
  saveKey = backupTokenKey,
  pause = () => new Promise(resolve => setTimeout(resolve, 2000)),
} = {}) {
  const settings = parseJson(await read(config, 'utf8'), 'The existing calendar Worker configuration could not be read.');
  if (settings.name !== 'zmanim-calendar' || settings.account_id !== '04b085d9f19ac1ba6d333e0006fc94c1' || settings.vars?.GOOGLE_CALENDAR_REDIRECT_URI !== callback) {
    throw Error('The calendar configuration does not match the existing shul service. Nothing was changed.');
  }
  const request = async route => {
    try { return await send(endpoint + route, { headers: { Origin: origin }, cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw Error('The existing calendar service could not be reached. Retry when it is available.'); }
  };
  const infoResponse = await request('/api/info');
  const info = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || !info.ready || !info.private || !info.googleCalendar) throw Error('The existing private calendar service is not ready. Do not create or reset an owner account.');
  const ready = async () => {
    // An invalid, nonrandom state can never match or consume a member authorization.
    const response = await request('/api/google-calendar/callback?state=setup-check');
    const data = await response.json().catch(() => ({}));
    if (response.status === 400 && data.error === 'The Google connection expired.') return true;
    if (response.status === 503 && data.error === 'Google Calendar setup is incomplete.') return false;
    throw Error('Google setup readiness could not be verified. No authorization was started.');
  };
  if (await ready()) return { alreadyConfigured: true, url: origin + '/calendar/' };
  if (!credentialsPath) throw Error('Download the shul Google Web OAuth client JSON outside this repository, then pass its path as the only argument.');
  const resolvedPath = path.resolve(credentialsPath);
  const relativePath = path.relative(root, resolvedPath);
  if (!relativePath || !relativePath.startsWith('..' + path.sep) && relativePath !== '..' && !path.isAbsolute(relativePath)) throw Error('Keep the OAuth client download outside the repository, such as in Downloads.');
  let raw;
  try { raw = await read(resolvedPath, 'utf8'); }
  catch { throw Error('The OAuth client download could not be read. Check its path.'); }
  const client = parseJson(raw, 'The OAuth client download must be valid JSON. Its contents were not printed.').web;
  if (!client || typeof client.client_id !== 'string' || !client.client_id.endsWith('.apps.googleusercontent.com') || typeof client.client_secret !== 'string' || !client.client_secret.trim()) throw Error('Download credentials for a Google OAuth Web application, not a service account or Desktop client.');
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(callback)) throw Error('Add the exact calendar callback URL to the Google Web client, then download its JSON again.');
  const listed = parseJson(await wrangler(['secret', 'list', '--format', 'json']), 'Cloudflare secret names could not be read. Nothing was changed.');
  if (!Array.isArray(listed) || listed.some(entry => typeof entry?.name !== 'string')) throw Error('Cloudflare returned unexpected secret metadata. Nothing was changed.');
  const names = new Set(listed.map(entry => entry.name));
  if (names.has(clientId) || names.has(clientSecret)) throw Error('Existing Google OAuth settings are incomplete or invalid. Preserve them and restore the original missing configuration or encryption key from its secure backup. This helper will not overwrite an existing OAuth client or rotate a key.');
  const updates = { [clientId]: client.client_id, [clientSecret]: client.client_secret };
  if (!names.has(tokenKey)) {
    const key = makeKey();
    if (!/^[a-f0-9]{64}$/i.test(key)) throw Error('The new encryption key was not valid. Nothing was changed.');
    await saveKey(key);
    updates[tokenKey] = key;
  }
  // Credentials travel over stdin. Only the new encryption key gets a private backup.
  await wrangler(['secret', 'bulk'], JSON.stringify(updates) + '\n');
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await ready()) {
      const denied = await request('/api/google-calendar');
      await denied.body?.cancel();
      if (denied.status !== 401) throw Error('Google settings were saved, but calendar sign-in restrictions need review.');
      return { alreadyConfigured: false, url: origin + '/calendar/' };
    }
    if (attempt < 5) await pause();
  }
  throw Error('Settings were saved, but the live service has not confirmed readiness. Preserve all secrets and check the existing Worker before retrying.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw Error('Pass only the path to the downloaded Google Web OAuth client JSON.');
    const result = await activateGoogleCalendar(process.argv[2]);
    console.log(result.alreadyConfigured ? 'Google authorization settings are already active. No secrets were changed.' : 'Google authorization settings are active. Existing calendar data and unrelated secrets were preserved.');
    console.log('To finish your connection, sign in at ' + result.url + ' and open Calendar options > Google Calendar > Connect Google Calendar. Approve access in Google.');
    console.log('This readiness check does not prove member consent or a completed event sync. Keep a secure backup of the Worker encryption secret; never rotate it while connections exist.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
