import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatsWorkspace } from '../worker/seats/worker.js';
import { seatsCreateState, seatsWriteName } from '../js/seats/model.js';
import { seatsSharedPlan } from '../js/seats/shared-model.js';
import { seatsCreateLocalTrash, seatsTrashAvailable, seatsTrashExpiry, SEATS_TRASH_MS, SEATS_TRASH_KEY } from '../js/seats/trash.js';

const chartId = 'synthetic-trash-chart', nameId = 'synthetic-trash-names', now = Date.parse('2026-11-01T12:00:00Z');
function setup() {
  const plan = seatsCreateState().plans[0]; plan.id = chartId; plan.name = 'Recovery chart'; seatsWriteName(plan, 'B7', 0, 'Recovery Test Person');
  const chart = { plan: seatsSharedPlan(plan), revision: 4, createdAt: '2026-10-25T10:00:00.000Z', createdBy: 'Original Organizer', updatedAt: '2026-10-26T12:00:00.000Z', updatedBy: 'Previous Organizer', operations: [] };
  const names = { id: nameId, name: 'Recovery names', names: ['Name One', 'Name Two'], createdAt: chart.createdAt, createdBy: chart.createdBy };
  const data = new Map([['plan:' + chartId, structuredClone(chart)], ['names:' + nameId, structuredClone(names)]]), alarms = [], broadcasts = [];
  const storage = {
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => { for (const [k,v] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) data.set(k, structuredClone(v)); },
    list: async ({ prefix = '', limit = Infinity, reverse = false, end } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix) && (!end || k < end)).sort(([a],[b]) => a.localeCompare(b)).slice().sort((a,b) => reverse ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])).slice(0, limit)),
    delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); }, setAlarm: async at => alarms.push(at),
  };
  const worker = new SeatsWorkspace({ storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [] }, {});
  worker.session = async token => token === 'synthetic-session' ? { name: 'Restoring Organizer' } : null; worker.broadcast = message => broadcasts.push(message);
  const call = (path, method = 'GET', body, auth = true) => worker.fetch(new Request('https://example.test/api/' + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-session' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { data, chart, names, worker, alarms, broadcasts, call };
}

test('website Trash restores complete chart/name files, dates and author history, with safe retries', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { call, chart, names, data, broadcasts } = setup();
  assert.equal((await call('trash', 'GET', null, false)).status, 401);
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt: new Date(now).toISOString() }, false)).status, 401);
  assert.equal((await (await call('info')).json()).trash60Days, true);
  for (const route of ['plans/' + chartId, 'name-lists/' + nameId]) assert.equal((await call(route, 'DELETE')).status, 200);
  const files = (await (await call('trash')).json()).files; assert.equal(files.length, 2);
  assert.ok(files.every(file => file.expiresAt === new Date(now + SEATS_TRASH_MS).toISOString() && file.deletedBy === 'Restoring Organizer'));
  assert.equal((await (await call('plans')).json()).plans.length, 0); assert.equal((await (await call('name-lists')).json()).files.length, 0);
  t.mock.timers.tick(1000);
  for (const [path, id] of [['plans', chartId], ['name-lists', nameId]]) {
    const body = { deletedAt: files.find(file => file.id === id).deletedAt }, response = await call(path + '/' + id + '/restore', 'POST', body);
    assert.equal(response.status, 200); const restored = await response.json();
    assert.equal(restored.createdAt, chart.createdAt); assert.equal(restored.createdBy, chart.createdBy); assert.equal(restored.updatedBy, 'Restoring Organizer'); assert.equal(restored.deletedAt, undefined);
    if (path === 'plans') { assert.deepEqual(restored.plan, chart.plan); assert.equal(restored.revision, 6); }
    else { assert.deepEqual(restored.names, names.names); assert.equal(restored.id, nameId); assert.equal(restored.revision, 2); }
    assert.deepEqual(await (await call(path + '/' + id + '/restore', 'POST', body)).json(), restored, 'A lost response can be retried without another restore or history event');
  }
  assert.equal((await (await call('trash')).json()).files.length, 0);
  const history = (await (await call('plans/' + chartId + '/history')).json()).entries;
  assert.equal(history[0].details[0], 'Restored chart from Trash'); assert.equal(history[0].by, 'Restoring Organizer'); assert.equal(history.length, 3);
  assert.ok(broadcasts.some(message => message.type === 'plans-changed')); assert.ok(broadcasts.some(message => message.type === 'name-lists-changed'));
  assert.deepEqual(data.get('names:' + nameId).names, names.names);
});

test('60-day boundary is exact and cleanup retains tombstones against old offline uploads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { call, worker, chart, names, data } = setup();
  await call('plans/' + chartId, 'DELETE'); await call('name-lists/' + nameId, 'DELETE');
  const deletedAt = new Date(now).toISOString();
  t.mock.timers.tick(SEATS_TRASH_MS - 1); assert.equal((await (await call('trash')).json()).files.length, 2);
  t.mock.timers.tick(1); assert.equal((await (await call('trash')).json()).files.length, 0);
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt })).status, 410);
  assert.equal((await call('name-lists/' + nameId + '/restore', 'POST', { deletedAt })).status, 410);
  await worker.alarm();
  assert.equal(data.get('plan:' + chartId).plan, undefined); assert.equal(data.get('names:' + nameId).names, undefined);
  assert.ok(data.get('plan:' + chartId).purgedAt); assert.equal([...data.keys()].some(key => key.startsWith('history:' + chartId + ':')), false);
  assert.equal((await call('plans', 'POST', { id: chartId, plan: chart.plan })).status, 410);
  assert.equal((await call('name-lists', 'POST', names)).status, 410);
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt })).status, 410);
  assert.equal((await call('plans/' + chartId)).status, 410);
});

test('legacy deletions remain recoverable; repeated deletion, stale restores and full folders are safe', async t => {
  t.mock.timers.enable({ apis: ['Date'], now }); const { call, data, chart } = setup();
  const deletedAt = new Date(now - 1000).toISOString(); data.set('plan:' + chartId, { ...chart, deletedAt, deletedBy: 'Earlier Organizer' });
  assert.equal((await (await call('trash')).json()).files[0].deletedAt, deletedAt);
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', {})).status, 400);
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt })).status, 200);
  await call('plans/' + chartId, 'DELETE'); t.mock.timers.tick(1000); await call('plans/' + chartId, 'DELETE');
  assert.equal(data.get('plan:' + chartId).deletedAt, new Date(now).toISOString(), 'Repeated deletion must not extend retention');
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt })).status, 409, 'A delayed retry cannot undo a later deletion');
  for (let i=0;i<30;i++) data.set('plan:synthetic-active-' + i, { ...chart, plan: { ...chart.plan, id: 'synthetic-active-' + i } });
  assert.equal((await call('plans/' + chartId + '/restore', 'POST', { deletedAt: new Date(now).toISOString() })).status, 409);
  assert.ok(data.get('plan:' + chartId).deletedAt);
});

test('local recovery keeps the complete chart and metadata across reload and refuses unsafe storage writes', t => {
  t.mock.timers.enable({ apis: ['Date'], now }); const { chart } = setup(), data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const first = seatsCreateLocalTrash(storage), archived = first.add(chart.plan, { createdAt: chart.createdAt, history: [{ details: ['Original history'] }] }, 'Deleting Organizer');
  chart.plan.name = 'Later mutation'; const reloaded = seatsCreateLocalTrash(storage), found = reloaded.list()[0];
  assert.equal(found.plan.name, 'Recovery chart'); assert.equal(found.metadata.createdAt, chart.createdAt); assert.equal(found.deletedBy, 'Deleting Organizer');
  assert.ok(seatsTrashAvailable(found)); assert.equal(seatsTrashExpiry(found), new Date(now + SEATS_TRASH_MS).toISOString());
  const blocked = seatsCreateLocalTrash({ ...storage, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => blocked.add(chart.plan, {}, 'Organizer'), /Nothing was deleted/); assert.equal(reloaded.list().length, 1);
  reloaded.remove(archived.id); assert.equal(first.list().length, 0);
  first.add(chart.plan, {}, 'Organizer'); t.mock.timers.tick(SEATS_TRASH_MS); assert.equal(reloaded.list().length, 0);
  data.set(SEATS_TRASH_KEY, '{broken'); assert.throws(() => reloaded.add(chart.plan, {}, 'Organizer'), /Nothing was deleted/);
});

test('unavailable browser storage does not prevent opening Seats and refuses deletion safely', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
    const trash = seatsCreateLocalTrash();
    assert.throws(() => trash.list(), /Trash could not be opened/);
    assert.throws(() => trash.add({ id: 'synthetic-chart' }, {}, 'Organizer'), /Nothing was deleted/);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});
