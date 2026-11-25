import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { activateGoogleCalendar } from '../scripts/activate-google-calendar.mjs';

const callback = 'https://zmanim-calendar.cheskyshain.workers.dev/api/google-calendar/callback';
const download = path.join(tmpdir(), 'synthetic-google-web-client.json');
const client = { web: { client_id: 'synthetic.apps.googleusercontent.com', client_secret: 'synthetic-secret-never-print', redirect_uris: [callback] } };
const config = { name: 'zmanim-calendar', account_id: '04b085d9f19ac1ba6d333e0006fc94c1', vars: { GOOGLE_CALENDAR_REDIRECT_URI: callback } };
function fixture({ names = [], configured = false, credentials = client, settings = config, backupError = false, writeError = false } = {}) {
  const commands = [], requests = [], backups = [];
  let active = configured;
  return {
    commands, requests, backups,
    dependencies: {
      async read(file) { return file.endsWith('wrangler.jsonc') ? JSON.stringify(settings) : typeof credentials === 'string' ? credentials : JSON.stringify(credentials); },
      async wrangler(args, input) {
        commands.push({ args, input });
        if (args[1] === 'list') return JSON.stringify(names.map(name => ({ name, type: 'secret_text' })));
        assert.deepEqual(args, ['secret', 'bulk']);
        assert.equal(backups.length, names.includes('GOOGLE_CALENDAR_TOKEN_KEY') ? 0 : 1, 'Back up a new key before uploading it');
        if (writeError) throw Error('Synthetic Cloudflare failure');
        active = true;
        return '';
      },
      async send(url, options) {
        requests.push({ url, options });
        assert.equal(options.method, undefined, 'Only GET readiness requests are allowed');
        const route = new URL(url).pathname;
        if (route === '/api/info') return Response.json({ ready: true, private: true, googleCalendar: true });
        if (route === '/api/google-calendar') return Response.json({ error: 'Sign in' }, { status: 401 });
        assert.equal(new URL(url).searchParams.get('state'), 'setup-check');
        return Response.json({ error: active ? 'The Google connection expired.' : 'Google Calendar setup is incomplete.' }, { status: active ? 400 : 503 });
      },
      makeKey: () => 'ab'.repeat(32),
      async saveKey(key) { if (backupError) throw Error('Synthetic backup failure'); backups.push(key); },
      pause: async () => {},
    },
  };
}

test('first activation sends only new Google secrets over stdin and backs up the encryption key first', async () => {
  const f = fixture({ names: ['CALENDAR_REMINDER_VAPID', 'BOOTSTRAP_SHA256'] });
  const result = await activateGoogleCalendar(download, f.dependencies);
  assert.equal(result.alreadyConfigured, false);
  assert.equal(result.url, 'https://baismedrashoflakewoodcommons.org/calendar/');
  assert.deepEqual(f.backups, ['ab'.repeat(32)]);
  assert.equal(f.commands.length, 2);
  assert.deepEqual(JSON.parse(f.commands[1].input), {
    GOOGLE_CALENDAR_CLIENT_ID: client.web.client_id,
    GOOGLE_CALENDAR_CLIENT_SECRET: client.web.client_secret,
    GOOGLE_CALENDAR_TOKEN_KEY: 'ab'.repeat(32),
  });
  assert.ok(f.commands.every(call => !JSON.stringify(call.args).includes(client.web.client_secret)));
  assert.ok(!JSON.stringify(result).includes(client.web.client_secret));
  assert.ok(f.requests.every(request => !request.url.includes('secret')));
});

test('existing token encryption key is preserved without replacement or backup', async () => {
  const f = fixture({ names: ['GOOGLE_CALENDAR_TOKEN_KEY', 'CALENDAR_REMINDER_VAPID'] });
  await activateGoogleCalendar(download, f.dependencies);
  const updates = JSON.parse(f.commands[1].input);
  assert.equal(Object.hasOwn(updates, 'GOOGLE_CALENDAR_TOKEN_KEY'), false);
  assert.equal(Object.hasOwn(updates, 'CALENDAR_REMINDER_VAPID'), false);
  assert.deepEqual(f.backups, []);
});

test('an active setup is a read-only no-op even without another credentials download', async () => {
  const f = fixture({ configured: true });
  f.dependencies.makeKey = () => { throw Error('Must not rotate key'); };
  const result = await activateGoogleCalendar(undefined, f.dependencies);
  assert.equal(result.alreadyConfigured, true);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.backups, []);
});

test('incomplete existing OAuth settings never overwrite a client or silently generate a replacement key', async () => {
  for (const names of [['GOOGLE_CALENDAR_CLIENT_ID'], ['GOOGLE_CALENDAR_CLIENT_SECRET'], ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET'], ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_TOKEN_KEY']]) {
    const f = fixture({ names });
    await assert.rejects(activateGoogleCalendar(download, f.dependencies), /will not overwrite/);
    assert.equal(f.commands.length, 1);
    assert.deepEqual(f.backups, []);
  }
});

test('invalid downloads, redirect changes and repository-local credentials fail before any secret write', async () => {
  for (const credentials of [{ installed: client.web }, { web: { ...client.web, redirect_uris: ['https://unrelated.example/callback'] } }, '{"client_secret":"synthetic-secret-never-print",broken']) {
    const f = fixture({ credentials });
    await assert.rejects(activateGoogleCalendar(download, f.dependencies), error => {
      assert.ok(!error.message.includes(client.web.client_secret));
      return true;
    });
    assert.deepEqual(f.commands, []);
  }
  const f = fixture();
  await assert.rejects(activateGoogleCalendar(new URL('../private-google.json', import.meta.url).pathname, f.dependencies), /outside the repository/);
  assert.deepEqual(f.commands, []);
});

test('wrong Worker configuration and failed key backup cannot mutate Cloudflare', async () => {
  const wrong = fixture({ settings: { ...config, name: 'other-worker' } });
  await assert.rejects(activateGoogleCalendar(download, wrong.dependencies), /does not match/);
  assert.deepEqual(wrong.requests, []);
  assert.deepEqual(wrong.commands, []);
  const failed = fixture({ backupError: true });
  await assert.rejects(activateGoogleCalendar(download, failed.dependencies), /backup failure/);
  assert.equal(failed.commands.length, 1, 'Only secret metadata was read');
});

test('a failed secret upload never reports configuration success and retains the recovery backup', async () => {
  const f = fixture({ writeError: true });
  await assert.rejects(activateGoogleCalendar(download, f.dependencies), /Cloudflare failure/);
  assert.equal(f.backups.length, 1);
  assert.equal(f.requests.filter(request => new URL(request.url).pathname === '/api/google-calendar').length, 0);
});
