import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateSeatActivity, seatsLastSeatAssignment } from '../js/seats/seat-activity.js';

const assignment = (revision, by = 'Seat organizer') => ({ revision, by, at: '2026-11-02T12:00:00.000Z', details: ['A1, seat 1: Empty → Synthetic Person'] });
const edit = revision => ({ revision, by: 'Layout organizer', at: '2026-11-02T13:00:00.000Z', details: ['Changed room layout'] });

test('only assigning an occupied seat changes the displayed organizer', () => {
  const seat = assignment(2);
  const ignored = ['Changed A1', 'Added 50 names', 'Saved chart to the site', 'Restored chart from Trash', 'Renamed chart from “Before” to “After”', 'Changed name from “Before” to “After”', 'A1, seat 1: Synthetic Person → Empty'];
  assert.deepEqual(seatsLastSeatAssignment([...ignored.map(detail => ({ ...edit(3), details: [detail] })), seat]), { by: seat.by, at: seat.at });
  assert.equal(seatsLastSeatAssignment(ignored.map(detail => ({ ...edit(3), details: [detail] }))), null);
  assert.deepEqual(seatsLastSeatAssignment([{ ...seat, details: ['Rav, seat 1: Synthetic Person → Other Person'] }]), { by: seat.by, at: seat.at });
  assert.equal(seatsLastSeatAssignment([{ ...seat, at: 'invalid' }]), null);
});

test('existing shared charts find the last assignment beyond the first history page and cache each revision', async () => {
  const calls = [], notifications = [], seat = assignment(9);
  const activity = seatsCreateSeatActivity({ request: async path => {
    calls.push(path);
    return path.includes('?before=') ? { entries: [edit(10), seat], nextBefore: null } : { entries: Array.from({ length: 50 }, (_, index) => edit(60 - index)), nextBefore: 11 };
  }, onChange: id => notifications.push(id) });
  const first = activity.load('synthetic-chart', 60), second = activity.load('synthetic-chart', 60);
  assert.equal(first, second); await first;
  assert.deepEqual(activity.read('synthetic-chart').assignment, { by: seat.by, at: seat.at });
  assert.deepEqual(calls, ['/api/plans/synthetic-chart/history', '/api/plans/synthetic-chart/history?before=11']);
  await activity.load('synthetic-chart', 59); assert.equal(calls.length, 2);
  await activity.load('synthetic-chart', 61); assert.equal(calls.length, 3, 'Later layout changes reuse the known earlier assignment');
  assert.deepEqual(notifications, ['synthetic-chart', 'synthetic-chart']);
});

test('a newer result wins when history requests finish out of order', async () => {
  const resolve = [], notifications = [];
  const activity = seatsCreateSeatActivity({ request: () => new Promise(done => resolve.push(done)), onChange: id => notifications.push(id) });
  const old = activity.load('synthetic-chart', 2), recent = activity.load('synthetic-chart', 3);
  resolve[1]({ entries: [assignment(3, 'New seat organizer')], nextBefore: null }); await recent;
  resolve[0]({ entries: [assignment(2, 'Earlier seat organizer')], nextBefore: null }); await old;
  assert.equal(activity.read('synthetic-chart').assignment.by, 'New seat organizer');
  assert.deepEqual(notifications, ['synthetic-chart']);
});

test('missing assignments and failed requests never fall back to an unrelated editor', async () => {
  let fail = true;
  const activity = seatsCreateSeatActivity({ request: async () => { if (fail) throw new Error('Offline'); return { entries: [edit(4)], nextBefore: null }; }, onChange: () => {} });
  await activity.load('synthetic-chart', 4); assert.equal(activity.read('synthetic-chart').status, 'error'); assert.equal(activity.read('synthetic-chart').assignment, null);
  fail = false; await activity.load('synthetic-chart', 4); assert.equal(activity.read('synthetic-chart').status, 'ready'); assert.equal(activity.read('synthetic-chart').assignment, null);
  activity.clear(); assert.equal(activity.read('synthetic-chart'), undefined);
});
