import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedLineCuts, splitLinesInHalf } from '../js/util.js';
import { underlineTime } from '../js/format.js';

test('tags participate in balanced widths without changing time order', () => {
  assert.deepEqual(balancedLineCuts([100, 40, 40, 40, 40, 40], { prefixes: [0, 10, 10, 10, 10, 10] }), [2]);
  assert.deepEqual(balancedLineCuts([30, 40, 40, 110], { prefixes: [0, 10, 10, 10] }), [3]);
});

test('equally good splits prefer wider lines below', () => {
  assert.deepEqual(balancedLineCuts([30, 35, 35, 35, 35, 35, 35],
    { lines: 3, prefixes: [0, 5, 5, 5, 5, 5, 5] }), [2, 4]);
  assert.deepEqual(balancedLineCuts([40, 40, 40, 40, 40, 40]), [3]);
  assert.deepEqual(balancedLineCuts([]), []);
  assert.deepEqual(balancedLineCuts([40]), []);
});

test('even lines take priority over putting the longer line below', () => {
  assert.deepEqual(balancedLineCuts([112, 40, 40, 40, 40, 40],
    { prefixes: [0, 10, 10, 10, 10, 10] }), [2]);
  // 152 / 150 is preferable to 112 / 190, despite the first line being wider.
  assert.deepEqual(balancedLineCuts([30, 31, 30, 31, 30, 31], { lines: 3 }), [2, 4]);
});

test('formatting markers do not change a text list split or lose location marks', () => {
  const times = ['1:00', '1:15', '1:35', '1:50', '4:15'];
  const plain = splitLinesInHalf(times), marked = splitLinesInHalf(times.map(underlineTime));
  assert.deepEqual(plain.split('\n').map(line => line.match(/\d+:\d+/g)),
    marked.split('\n').map(line => line.match(/\d+:\d+/g)));
  assert.equal((marked.match(/\uE000/g) || []).length, times.length);
  assert.deepEqual(marked.match(/\d+:\d+/g), times);
});

test('a leading note remains attached while balancing the list', () => {
  assert.deepEqual(balancedLineCuts([30, 35, 35], { lead: 200, prefixes: [0, 5, 5] }), [1]);
});

test('long custom lists balance without enumerating every possible partition', () => {
  assert.deepEqual(balancedLineCuts(Array(40).fill(40), { lines: 10 }), [4, 8, 12, 16, 20, 24, 28, 32, 36]);
});

test('multi-line lists find the smallest width range among every ordered partition', () => {
  for (const widths of [[30, 75, 28, 50, 33, 60, 45], [100, 40, 40, 40, 40, 40], [30, 31, 30, 31, 30, 31]]) {
    const prefixes = widths.map((_, i) => i ? 5 : 0), lead = 27;
    const spread = cuts => {
      const ends = [0, ...cuts, widths.length];
      const sizes = ends.slice(1).map((end, i) => widths.slice(ends[i], end).reduce((sum, w) => sum + w, 0)
        - prefixes[ends[i]] + (i === 0 ? lead : 0));
      return Math.max(...sizes) - Math.min(...sizes);
    };
    let best = Infinity;
    for (let a = 1; a < widths.length - 1; a++) {
      for (let b = a + 1; b < widths.length; b++) best = Math.min(best, spread([a, b]));
    }
    assert.equal(spread(balancedLineCuts(widths, { lines: 3, prefixes, lead })), best);
  }
});
