const http = require('node:http'), net = require('node:net'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'seats-room-sharing-'));
let backend = '', worker, logs = '';
const server = http.createServer((request, response) => {
  if (request.url.split('?')[0] === '/data/seats-sync.json') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ endpoint: backend })); }
  let file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { response.statusCode = 403; return response.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.statusCode = 404; return response.end(); }
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); backend = 'http://127.0.0.1:' + port;
  const binary = process.env.SEATS_WRANGLER_BIN; if (!binary) throw new Error('Set SEATS_WRANGLER_BIN to the Wrangler executable.');
  worker = spawn(binary, ['dev', '--config', 'worker/seats/wrangler.jsonc', '--local', '--port', String(port), '--inspector-port', '0', '--persist-to', path.join(output, 'worker-data'), '--var', 'ALLOWED_ORIGIN:' + origin], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { logs += chunk; }); worker.stderr.on('data', chunk => { logs += chunk; });
  const api = (route, options = {}) => fetch(backend + route, { ...options, headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers } });
  let booted = false; for (let attempt = 0; attempt < 100; attempt++) { try { if ((await api('/api/plans')).status === 401) { booted = true; break; } } catch {} await pause(200); }
  assert.ok(booted, 'Shared service did not start: ' + logs.slice(-2500));
  const loginResponse = await api('/api/session', { method: 'POST', body: JSON.stringify({ pin: '4444', name: 'Legacy Fixture Owner' }) }); assert.equal(loginResponse.status, 200);
  const session = await loginResponse.json(), authenticated = { Authorization: 'Bearer ' + session.token };
  const { seatsCreateState, seatsSetCount, seatsWriteName, seatsAssigned, seatsItems } = await import('../js/seats/model.js');
  const legacy = seatsCreateState().plans[0]; legacy.name = 'Synthetic legacy room';
  legacy.objects = legacy.objects.filter(object => object.id !== 'rear-case-a7' && !object.id.startsWith('seat-pillar-'));
  Object.assign(legacy.objects.find(object => object.id === 'main-amud'), { x: 568, y: 164, width: 64, height: 48 });
  const table = id => legacy.tables.find(entry => entry.id === id);
  for (const [id, count] of Object.entries({ C1: 5, A8: 3, B2: 4, C2: 4, B5: 4, C5: 4, D7: 3, D8: 3 })) seatsSetCount(table(id), count);
  Object.assign(table('C1'), { x: 695, y: 78, width: 240 }); Object.assign(table('D1'), { x: 935, y: 78, width: 240 });
  legacy.objects.find(object => object.type === 'bimah').y = 452;
  for (const id of ['rear-case-side-left', 'rear-case-side-right']) Object.assign(legacy.objects.find(object => object.id === id), { y: 728, height: 208 });
  const displaced = seatsWriteName(legacy, 'C1', 4, 'Synthetic Fifth Seat Person').id;
  const retained = seatsWriteName(legacy, 'D7', 1, 'Synthetic Rear Seat Person').id;
  const remoteId = crypto.randomUUID(), created = await api('/api/plans', { method: 'POST', headers: authenticated, body: JSON.stringify({ id: remoteId, plan: legacy }) });
  assert.equal(created.status, 201); const original = await created.json();
  assert.equal(original.revision, 1); assert.equal(original.plan.layoutVersion, 12); assert.equal(original.plan.tables.find(entry => entry.id === 'C1').count, 5);
  assert.equal(original.plan.objects.find(object => object.type === 'bimah').y, 452, 'The service stores the legacy layout without upgrading it');
  const readRecord = async () => { const response = await api('/api/plans/' + remoteId, { headers: authenticated }); assert.equal(response.status, 200); return response.json(); };
  function assertUpdated(record) {
    const plan = record.plan, get = id => plan.tables.find(entry => entry.id === id);
    assert.equal(plan.layoutVersion, 12, 'The migrated chart retains the deployed wire format');
    for (const [id, count] of Object.entries({ C1: 4, A8: 4, B2: 5, C2: 5, B5: 5, C5: 5, D7: 5, D8: 5 })) assert.equal(get(id).count, count, id);
    assert.equal(seatsItems(plan).reduce((sum, entry) => sum + (entry.count || 0), 0), 165);
    assert.ok(Math.abs(get('D1').x - get('C1').x - get('C1').width - 8) < .001, 'C1 and D1 have the requested gap');
    assert.ok(Math.abs(get('D1').x + get('D1').width - 1159) < .001, 'C1 and D1 leave extra clearance for the front-right opening');
    for (const id of ['D7','D8']) assert.ok(Math.abs(get(id).x + get(id).width - 1175) < .001, id + ' sits near the right wall');
    const small = plan.objects.find(object => object.id === 'rear-case-a7');
    assert.deepEqual([small.x,small.y,small.width,small.height],[17,648,24,40]);
    assert.equal(plan.objects.find(object => object.type === 'bimah').y, 488);
    const amud = plan.objects.find(object => object.id === 'main-amud'); assert.deepEqual([amud.x,amud.y,amud.width,amud.height],[581,169,38,38]);
    for(const [id,seat] of [['B7',2],['C7',4]]){
      const table=get(id),pillar=plan.objects.find(object=>object.id==='seat-pillar-'+id+'-'+seat);
      assert.deepEqual([pillar.width,pillar.height],[20,20]);assert.ok(Math.abs(pillar.x+10-table.x-table.width*(seat-.5)/table.count)<.001);
      assert.equal(pillar.y,table.y+table.height+1);
    }
    for (const id of ['rear-case-side-left', 'rear-case-side-right']) { const cabinet = plan.objects.find(object => object.id === id); assert.equal(cabinet.y, 798); assert.equal(cabinet.height, 138); }
    assert.ok(plan.people.some(person => person.id === displaced), 'The removed fifth seat does not remove its name');
    assert.equal(seatsAssigned(plan).has(displaced), false, 'The removed fifth-seat person returns to the waiting list');
    assert.equal(get('D7').seats[1], retained, 'Growing the rear table retains its existing assignment');
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const errors = [], patches = [], contexts = [];
    const observe = page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framesent', event => { try { const message = JSON.parse(event.payload); if (message.type === 'patch') patches.push(message); } catch {} }));
    };
    const openLink = async (page, name) => {
      await page.goto(origin + '/seats/?page=' + remoteId); await page.locator('#seats-name').fill(name); await page.locator('#seats-pin').fill('4444'); await page.getByRole('button', { name: 'Open Seats', exact: true }).click();
      await page.locator('#chart-name').waitFor(); await page.waitForFunction(() => document.querySelector('.saved-label')?.textContent === 'Saved to website');
    };
    const first = await browser.newContext({ viewport: { width: 1440, height: 1050 } }); contexts.push(first); const page = await first.newPage(); observe(page); await openLink(page, 'Migration Organizer One');
    let migrated;
    for (let attempt = 0; attempt < 100; attempt++) { migrated = await readRecord(); if (migrated.revision > original.revision) break; await pause(100); }
    assertUpdated(migrated); assert.equal(migrated.revision, 2, 'The frontend sends one accepted migration update');
    assert.equal(patches.length, 1); assert.ok(patches[0].changes.some(change => change.group === 'tables' && change.id === 'C1' && change.key === 'count' && change.before === 5 && change.after === 4), 'A real outgoing patch changes the server count');
    assert.ok(patches[0].changes.some(change => change.group === 'tables' && change.id === 'D7' && change.key === 'count' && change.before === 3 && change.after === 5));
    assert.equal(patches[0].changes.some(change => change.group === 'plan' && change.key === 'layoutVersion'), false);
    const local = await page.evaluate(() => { const state = JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')); return state.plans.find(plan => plan.id === state.activeId); }); assertUpdated({ plan: local });
    await page.screenshot({ path: path.join(output, 'migrated-shared-room.png'), fullPage: true });
    await page.reload(); await page.getByRole('button', { name: 'Saved charts', exact: true }).click();
    await page.locator('.sharing-site-plan .saved-page-card[data-id="' + remoteId + '"]').click(); await page.waitForFunction(() => document.querySelector('.saved-label')?.textContent === 'Saved to website');
    const second = await browser.newContext({ viewport: { width: 375, height: 900 } }); contexts.push(second); const peer = await second.newPage(); observe(peer); await openLink(peer, 'Migration Organizer Two');
    const peerLocal = await peer.evaluate(() => { const state = JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')); return state.plans.find(plan => plan.id === state.activeId); }); assertUpdated({ plan: peerLocal });
    const afterReload = await readRecord(); assertUpdated(afterReload); assert.equal(afterReload.revision, migrated.revision, 'Reload and a second organizer do not repeat migration');
    assert.equal(patches.length, 1, 'Subsequent readers send no extra migration patches');
    const historyResponse = await api('/api/plans/' + remoteId + '/history', { headers: authenticated }); assert.equal(historyResponse.status, 200); const history = await historyResponse.json();
    assert.equal(history.entries.length, 2); assert.equal(history.entries[0].by, 'Migration Organizer One'); assert.equal(history.entries[0].revision, 2);
    assert.deepEqual(errors, []); for (const context of contexts) await context.close();
    console.log('PASS: legacy shared v12 room migration sends one real server patch, preserves assigned and displaced names, stores all requested counts and geometry, and remains unchanged after reload and a second organizer.');
    console.log('Artifacts: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); console.error(logs.slice(-2500)); process.exitCode = 1; }).finally(() => { worker?.kill('SIGTERM'); server.close(); });
