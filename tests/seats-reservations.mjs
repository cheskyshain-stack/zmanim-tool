import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatsWorkspace } from '../worker/seats/worker.js';
import { seatsCreateState, seatsWriteName } from '../js/seats/model.js';
import { seatsSharedPlan, seatsSharedDiff } from '../js/seats/shared-model.js';
import { SEATS_RESERVATION_MS } from '../js/seats/reservation.js';

const now = Date.parse('2026-11-08T12:00:00Z'), chartId = 'synthetic-reservation-chart';
function setup() {
  const plan = seatsCreateState().plans[0]; plan.id = chartId;
  seatsWriteName(plan, 'C4', 0, 'Saved Original Person');
  const record = { plan: seatsSharedPlan(plan), revision: 1, operations: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), updatedBy: 'Original Organizer' };
  const data = new Map([['plan:' + chartId, structuredClone(record)]]), sockets = [];
  const worker = new SeatsWorkspace({
    storage: { get: async key => structuredClone(data.get(key)), put: async values => { for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value)); } },
    blockConcurrencyWhile: fn => fn(), getWebSockets: () => sockets,
  }, {});
  function connect(name) {
    const socket = { readyState: WebSocket.OPEN, attachment: { authenticated: true, name, clientId: 'synthetic-client-' + name, expires: now + 86400000, planId: null, seat: null }, messages: [],
      deserializeAttachment() { return structuredClone(this.attachment); }, serializeAttachment(meta) { this.attachment = structuredClone(meta); }, send(raw) { this.messages.push(JSON.parse(raw)); } };
    sockets.push(socket); return socket;
  }
  const send = (socket, message) => worker.webSocketMessage(socket, JSON.stringify(message));
  const reserve = (socket, seat = 'C4:0') => send(socket, { type: 'presence', planId: seat ? chartId : null, seat });
  const patch = (socket, name, id) => {
    const before = data.get('plan:' + chartId).plan, after = structuredClone(before);
    seatsWriteName(after, 'C4', 0, name);
    return send(socket, { type: 'patch', planId: chartId, operationId: 'synthetic-operation-' + id, changes: seatsSharedDiff(before, after) });
  };
  return { worker, data, record, connect, reserve, send, patch };
}

test('a reservation expires at 30 minutes despite heartbeats and repeated claims, keeping chart data untouched', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { worker, data, record, connect, reserve, send } = setup(), first = connect('One'), second = connect('Two');
  await reserve(first);
  const deadline = first.attachment.seatExpiresAt;
  assert.equal(deadline, now + 30 * 60 * 1000); assert.equal(SEATS_RESERVATION_MS, 30 * 60 * 1000);
  t.mock.timers.tick(SEATS_RESERVATION_MS - 1);
  await send(first, { type: 'ping' }); await reserve(first);
  assert.equal(first.attachment.seatExpiresAt, deadline, 'A repeated reservation cannot renew its deadline');
  await reserve(second); assert.equal(second.attachment.seat, null); assert.ok(second.messages.some(message => message.type === 'busy'));
  t.mock.timers.tick(1);
  assert.equal(worker.peers().find(peer => peer.socket === first).seat, null, 'The exact deadline applies even before any cleanup message');
  await send(first, { type: 'ping' });
  assert.ok(first.messages.some(message => message.type === 'reservation-expired' && message.seat === 'C4:0'));
  assert.equal(second.messages.at(-1).type, 'presence'); assert.equal(second.messages.at(-1).peers.find(peer => peer.clientId === first.attachment.clientId).seat, null);
  const received = second.messages.length;
  for (let i = 0; i < 3; i++) await reserve(first);
  assert.equal(worker.peers().find(peer => peer.socket === first).seat, null);
  assert.equal(second.messages.length, received, 'An old client retry cannot trigger a presence retry loop');
  assert.deepEqual(data.get('plan:' + chartId), record, 'Releasing a selection never modifies a name, assignment or saved date');
  await reserve(second); assert.equal(second.attachment.seat, 'C4:0');
  await reserve(second, null); await reserve(first, null); await reserve(first);
  assert.equal(first.attachment.seatExpiresAt, deadline + SEATS_RESERVATION_MS, 'An explicit new selection receives its own deadline');
});

test('the service releases a suspended or legacy client independently and still rejects conflicting saves', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { worker, data, connect, reserve, patch } = setup(), first = connect('One'), second = connect('Two');
  await reserve(first);
  await patch(second, 'Blocked Replacement', 'blocked');
  assert.equal(second.messages.at(-1).type, 'conflict'); assert.equal(data.get('plan:' + chartId).revision, 1);
  t.mock.timers.tick(SEATS_RESERVATION_MS);
  await reserve(second); assert.equal(second.attachment.seat, 'C4:0', 'Another client can claim the seat even if its former owner never wakes up');
  await patch(first, 'Stale Replacement', 'stale'); assert.equal(first.messages.at(-1).type, 'conflict');
  await patch(second, 'New Saved Person', 'accepted'); assert.equal(data.get('plan:' + chartId).revision, 2);
  assert.ok(data.get('plan:' + chartId).plan.people.some(person => person.name === 'New Saved Person'));
  await reserve(second, null);
  first.attachment = { ...first.attachment, seat: 'A1:0', planId: chartId }; delete first.attachment.seatExpiresAt; delete first.attachment.seatExpired;
  worker.expireReservations();
  assert.equal(worker.peers().find(peer => peer.socket === first).seat, null, 'Reservations from before the update cannot block seats indefinitely');
  await reserve(first, 'A1:0'); assert.equal(worker.peers().find(peer => peer.socket === first).seat, null);
  await reserve(second, 'A1:0'); assert.equal(second.attachment.seat, 'A1:0');
});

test('changing seats starts a fresh deadline and late release of another seat has no chart side effects', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { worker, data, record, connect, reserve } = setup(), first = connect('One'), second = connect('Two');
  await reserve(first); t.mock.timers.tick(15 * 60 * 1000); await reserve(first, 'A1:0');
  assert.equal(first.attachment.seatExpiresAt, Date.now() + SEATS_RESERVATION_MS);
  await reserve(second); assert.equal(second.attachment.seat, 'C4:0');
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(worker.peers().filter(peer => peer.seat).length, 2);
  await reserve(first, null); assert.equal(worker.peers().filter(peer => peer.seat).length, 1);
  assert.deepEqual(data.get('plan:' + chartId), record);
});
