import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsSessionValid } from '../js/seats/session.js';
import { SeatsWorkspace } from '../worker/seats/worker.js';

test('the browser honors the stored deadline regardless of activity', () => {
  const now = Date.parse('2026-10-26T15:00:00Z'), endpoint = 'https://example.invalid';
  const session = { version: 1, name: 'Synthetic Organizer', endpoint, token: 'a'.repeat(64), expires: Date.parse('2026-11-03T08:00:00Z') };
  assert.equal(seatsSessionValid(session, endpoint, session.expires - 1), true);
  assert.equal(seatsSessionValid(session, endpoint, session.expires), false);
  assert.equal(seatsSessionValid({ ...session, lastActive: now }, endpoint, session.expires - 1), true);
  for (const patch of [{ name: '' }, { expires: NaN }, { expires: now }, { token: '' }, { version: 0 }]) assert.equal(seatsSessionValid({ ...session, ...patch }, endpoint, now), false);
  assert.equal(seatsSessionValid(session, 'https://another.invalid', now), false);
  assert.equal(seatsSessionValid({ ...session, endpoint: '', token: undefined }, '', now), true);
});

test('the Seats service issues and enforces the first New York 3 a.m. after a full week', async t => {
  const now = Date.parse('2026-10-25T06:30:00Z'), expires = Date.parse('2026-11-01T08:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const records = new Map();
  let cleanupAt;
  const storage = {
    get: key => records.get(key), put: (key, value) => records.set(key, value), delete: key => records.delete(key),
    setAlarm: at => { cleanupAt = at; },
  };
  const workspace = new SeatsWorkspace({ storage, blockConcurrencyWhile: operation => operation() }, {});
  const login = await workspace.fetch(new Request('https://example.invalid/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic Organizer', pin: '4444' }),
  }));
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.expires, expires);
  assert.equal(cleanupAt, now + 24 * 60 * 60 * 1000, 'The cleanup cadence stays daily');
  const info = () => workspace.fetch(new Request('https://example.invalid/api/info', { headers: { Authorization: 'Bearer ' + session.token } }));
  t.mock.timers.setTime(expires - 1);
  assert.equal((await info()).status, 200);
  t.mock.timers.setTime(expires);
  assert.equal((await info()).status, 401);
});
