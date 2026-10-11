import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedLineCuts, splitLinesInHalf } from '../js/util.js';
import { underlineTime } from '../js/format.js';

test('a wide leading tag gets fewer times on top, with the longer line below', () => {
  assert.deepEqual(balancedLineCuts([100, 40, 40, 40, 40, 40], { prefixes: [0, 10, 10, 10, 10, 10] }), [2]);
  assert.deepEqual(balancedLineCuts([30, 40, 40, 110], { prefixes: [0, 10, 10, 10] }), [2]);
});

test('three lines build from shorter to longer while keeping every time in order', () => {
  assert.deepEqual(balancedLineCuts([30, 35, 35, 35, 35, 35, 35],
    { lines: 3, prefixes: [0, 5, 5, 5, 5, 5, 5] }), [2, 4]);
  assert.deepEqual(balancedLineCuts([40, 40, 40, 40, 40, 40]), [3]);
  assert.deepEqual(balancedLineCuts([]), []);
  assert.deepEqual(balancedLineCuts([40]), []);
});

test('formatting markers do not change a text list split or lose location marks', () => {
  const times = ['1:00', '1:15', '1:35', '1:50', '4:15'];
  const plain = splitLinesInHalf(times), marked = splitLinesInHalf(times.map(underlineTime));
  assert.deepEqual(plain.split('\n').map(line => line.match(/\d+:\d+/g)),
    marked.split('\n').map(line => line.match(/\d+:\d+/g)));
  assert.equal((marked.match(/\uE000/g) || []).length, times.length);
  assert.deepEqual(marked.match(/\d+:\d+/g), times);
});

test('a note remains attached when no increasing-width split can fit its position', () => {
  assert.deepEqual(balancedLineCuts([30, 35, 35], { lead: 200, prefixes: [0, 5, 5] }), [1]);
});

test('long custom lists balance without enumerating every possible partition', () => {
  assert.deepEqual(balancedLineCuts(Array(40).fill(40), { lines: 10 }), [4, 8, 12, 16, 20, 24, 28, 32, 36]);
});
