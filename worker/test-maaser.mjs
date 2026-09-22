// Integration test against a locally running `wrangler dev --local` maaser worker.
// Not part of the deploy loop; run by hand while iterating: node worker/test-maaser.mjs
const BASE = 'http://127.0.0.1:8787';
let failures = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('ok  -', name); }
  else { console.log('FAIL-', name, extra !== undefined ? JSON.stringify(extra) : ''); failures++; }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  // 1. Create a tracker
  const created = await api('/api/trackers', { method: 'POST' });
  ok('create tracker returns 201', created.status === 201, created);
  const { token, recoveryCode } = created.body;
  ok('token looks like a real secret', typeof token === 'string' && token.replace(/-/g, '').length >= 40, token);
  ok('recoveryCode is distinct from token', recoveryCode !== token);

  const auth = { authorization: `Bearer ${token}` };

  // 2. Fresh tracker starts with one seeded source, no entries
  let state = await api('/api/state', { headers: auth });
  ok('state ok', state.status === 200, state);
  ok('starts with exactly one source', state.body.sources.length === 1, state.body.sources);
  ok('starts with no income', state.body.income.length === 0);
  const salaryId = state.body.sources[0].id;

  // 3. A second, unrelated tracker cannot see or touch the first one's data
  const created2 = await api('/api/trackers', { method: 'POST' });
  const auth2 = { authorization: `Bearer ${created2.body.token}` };
  const state2 = await api('/api/state', { headers: auth2 });
  ok('separate tracker has its own source, not tracker 1\'s', state2.body.sources[0].id !== salaryId);
  const crossWrite = await api('/api/income', {
    method: 'POST', headers: auth2,
    body: JSON.stringify({ sourceId: salaryId, amount: 100, date: '2026-01-01', percent: 10 }),
  });
  ok('tracker 2 cannot post income against tracker 1\'s source', crossWrite.status === 404, crossWrite);

  // 4. Invalid / garbage tokens are rejected
  const badAuth = await api('/api/state', { headers: { authorization: 'Bearer not-a-real-token-at-all-00000000' } });
  ok('bogus token rejected', badAuth.status === 401, badAuth);
  const noAuth = await api('/api/state');
  ok('missing token rejected', noAuth.status === 401, noAuth);

  // 5. Worked example from the spec:
  //    $1000 income @10% -> $100 goal. Give $80 -> $20 remaining. Give $30 more -> $10 ahead.
  //    Add $200 income @10% -> $10 remaining.
  const inc1 = await api('/api/income', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ sourceId: salaryId, amount: 1000, date: '2026-01-01', percent: 10 }),
  });
  ok('income 1 created', inc1.status === 201 && inc1.body.maaserCents === 10000, inc1);

  const give1 = await api('/api/giving', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ sourceId: salaryId, amount: 80, date: '2026-01-02' }),
  });
  ok('giving 1 created', give1.status === 201, give1);

  const give2 = await api('/api/giving', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ sourceId: salaryId, amount: 30, date: '2026-01-03' }),
  });
  ok('giving 2 created', give2.status === 201, give2);

  const inc2 = await api('/api/income', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ sourceId: salaryId, amount: 200, date: '2026-01-04', percent: 10 }),
  });
  ok('income 2 created', inc2.status === 201, inc2);

  state = await api('/api/state', { headers: auth });
  const goalCents = state.body.income.reduce((s, e) => s + e.maaser_cents, 0);
  const givenCents = state.body.allocations.reduce((s, a) => s + a.amount_cents, 0);
  const netCents = goalCents - givenCents; // positive = remaining, negative = ahead
  ok('goal is $120.00 all time', goalCents === 12000, goalCents);
  ok('given is $110.00 all time', givenCents === 11000, givenCents);
  ok('net remaining is $10.00 (matches the spec example)', netCents === 1000, netCents);

  // 6. Split donation: allocate one donation across two sources, must sum exactly and count once.
  const business = await api('/api/sources', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Business', defaultPercent: 10 }) });
  const businessId = business.body.id;
  const split = await api('/api/giving', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      amount: 50, date: '2026-01-05',
      allocations: [{ sourceId: salaryId, amount: 20 }, { sourceId: businessId, amount: 30 }],
    }),
  });
  ok('split donation accepted when allocations sum to total', split.status === 201, split);
  const splitBad = await api('/api/giving', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      amount: 50, date: '2026-01-05',
      allocations: [{ sourceId: salaryId, amount: 20 }, { sourceId: businessId, amount: 20 }],
    }),
  });
  ok('split donation rejected when allocations do not sum to total', splitBad.status === 400, splitBad);

  state = await api('/api/state', { headers: auth });
  const givingCount = state.body.giving.length;
  const splitGivingRow = state.body.giving.find((g) => g.amount_cents === 5000);
  const splitAllocRows = state.body.allocations.filter((a) => a.giving_id === splitGivingRow.id);
  ok('a split donation is one giving row', !!splitGivingRow);
  ok('a split donation has exactly its two allocations', splitAllocRows.length === 2, splitAllocRows);
  ok('split donation counted once in overall totals (2 giving rows before it + 1, not 2)', givingCount === 3, givingCount);

  // 7. Editing percent on an existing entry recalculates just that entry
  const firstIncome = state.body.income.find((e) => e.amount_cents === 100000);
  const editIncome = await api(`/api/income/${firstIncome.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ percent: 20 }),
  });
  ok('editing percent recalculates maaser', editIncome.status === 200 && editIncome.body.maaserCents === 20000, editIncome);
  // changing the source's default percent afterward must not touch already-saved entries
  await api(`/api/sources/${salaryId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ defaultPercent: 15 }) });
  const stateAfter = await api('/api/state', { headers: auth });
  const untouched = stateAfter.body.income.find((e) => e.id === firstIncome.id);
  ok('changing source default percent leaves existing entries alone', untouched.percent === 20, untouched);

  // 8. Delete recalculates totals (just check the row is gone)
  const del = await api(`/api/giving/${splitGivingRow.id}`, { method: 'DELETE', headers: auth });
  ok('delete giving ok', del.status === 200);
  const afterDel = await api('/api/state', { headers: auth });
  ok('deleted giving entry is gone', !afterDel.body.giving.find((g) => g.id === splitGivingRow.id));
  ok('its allocations are gone too', !afterDel.body.allocations.find((a) => a.giving_id === splitGivingRow.id));

  // 9. Opening balance
  const opening = await api('/api/opening', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ sourceId: businessId, type: 'remaining', amount: 40, date: '2025-01-01', note: 'Before tracking' }),
  });
  ok('opening balance created', opening.status === 201, opening);

  // 10. PIN protection
  const setPin = await api('/api/settings/pin', { method: 'POST', headers: auth, body: JSON.stringify({ pin: '1234' }) });
  ok('pin set', setPin.status === 200 && setPin.body.pinEnabled === true, setPin);
  const withoutPin = await api('/api/state', { headers: auth });
  ok('state now requires pin', withoutPin.status === 401 && withoutPin.body.error === 'pin_required', withoutPin);
  const wrongPin = await api('/api/state', { headers: { ...auth, 'x-tracker-pin': '9999' } });
  ok('wrong pin rejected', wrongPin.status === 401 && wrongPin.body.error === 'wrong_pin', wrongPin);
  const rightPin = await api('/api/state', { headers: { ...auth, 'x-tracker-pin': '1234' } });
  ok('right pin accepted', rightPin.status === 200, rightPin);

  // 11. Rotating the link invalidates the old one
  const rotated = await api('/api/settings/rotate-link', { method: 'POST', headers: { ...auth, 'x-tracker-pin': '1234' } });
  ok('rotate-link returns a new token', rotated.status === 200 && rotated.body.token && rotated.body.token !== token, rotated);
  const oldStillWorks = await api('/api/state', { headers: { ...auth, 'x-tracker-pin': '1234' } });
  ok('old link rejected after rotation', oldStillWorks.status === 401, oldStillWorks);
  const newAuth = { authorization: `Bearer ${rotated.body.token}`, 'x-tracker-pin': '1234' };
  const newWorks = await api('/api/state', { headers: newAuth });
  ok('new link works after rotation', newWorks.status === 200, newWorks);

  // 12. Recovery: old recovery code -> new token, invalidates rotated token and resets pin
  const recovered = await api('/api/recovery', { method: 'POST', body: JSON.stringify({ recoveryCode, resetPin: true }) });
  ok('recovery accepted with original recovery code', recovered.status === 200 && recovered.body.token, recovered);
  const rotatedTokenNowDead = await api('/api/state', { headers: newAuth });
  ok('token from before recovery is dead after recovery', rotatedTokenNowDead.status === 401, rotatedTokenNowDead);
  const recoveredAuth = { authorization: `Bearer ${recovered.body.token}` };
  const afterRecovery = await api('/api/state', { headers: recoveredAuth });
  ok('recovered link works with no pin needed (pin was reset)', afterRecovery.status === 200, afterRecovery);
  const oldRecoveryCodeReused = await api('/api/recovery', { method: 'POST', body: JSON.stringify({ recoveryCode }) });
  ok('recovery code cannot be reused after rotation', oldRecoveryCodeReused.status === 401, oldRecoveryCodeReused);

  // 13. Create-tracker idempotency: same Idempotency-Key returns the same token, not a new tracker.
  const idemKey = 'test-idem-key-' + Math.random();
  const c1 = await api('/api/trackers', { method: 'POST', headers: { 'idempotency-key': idemKey } });
  const c2 = await api('/api/trackers', { method: 'POST', headers: { 'idempotency-key': idemKey } });
  ok('repeated create with same idempotency key returns the same token', c1.body.token === c2.body.token, [c1.body, c2.body]);

  // 14. Idempotent income creation: a retried POST with the same key does not double-count.
  const beforeIdemState = await api('/api/state', { headers: recoveredAuth });
  const beforeCount = beforeIdemState.body.income.length;
  const idemWriteKey = 'income-idem-' + Math.random();
  const w1 = await api('/api/income', {
    method: 'POST', headers: { ...recoveredAuth, 'idempotency-key': idemWriteKey },
    body: JSON.stringify({ sourceId: beforeIdemState.body.sources[0].id, amount: 500, date: '2026-02-01', percent: 10 }),
  });
  const w2 = await api('/api/income', {
    method: 'POST', headers: { ...recoveredAuth, 'idempotency-key': idemWriteKey },
    body: JSON.stringify({ sourceId: beforeIdemState.body.sources[0].id, amount: 500, date: '2026-02-01', percent: 10 }),
  });
  ok('retried income create returns the same id', w1.body.id === w2.body.id, [w1.body, w2.body]);
  const afterIdemState = await api('/api/state', { headers: recoveredAuth });
  ok('retried income create only inserted one row', afterIdemState.body.income.length === beforeCount + 1, afterIdemState.body.income.length);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
