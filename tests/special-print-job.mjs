import test from 'node:test';
import assert from 'node:assert/strict';
import { newPrintPage, normalizePrintPages, specialPrintPlan } from '../js/ui/special-print-job.js';

test('paired schedules stay selected across designs with different physical sizes', () => {
  const pages = [newPrintPage('chanukah', 'asarabteves'), newPrintPage('bhb')];
  const before = JSON.stringify(pages);
  const value = { span: { from: 1, to: 3 } };
  const half = specialPrintPlan(pages, key => ({ key, half: true, value }));
  assert.equal(half.frames.length, 2);
  assert.equal(half.landscape, true);
  const full = specialPrintPlan(pages, key => ({ key, half: key === 'bhb', value }));
  assert.equal(full.frames.length, 3);
  assert.equal(full.landscape, false);
  assert.deepEqual(full.frames.flatMap(frame => [frame.left, frame.right]).filter(Boolean).map(entry => entry.key), ['chanukah', 'asarabteves', 'bhb']);
  assert.equal(JSON.stringify(pages), before);
});

test('an unavailable selection is reported without creating an empty printed sheet', () => {
  const pages = [newPrintPage('available', 'missing'), newPrintPage('missing')];
  const result = specialPrintPlan(pages, key => ({ key, half: true, label: key, value: key === 'available' ? { span: { from: 3, to: 5 } } : null }));
  assert.equal(result.frames.length, 1);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.span, { from: 3, to: 5 });
});

test('normalization preserves page identity, half placement and valid saved choices', () => {
  const pages = [newPrintPage('', 'asara-locations'), newPrintPage('chanukah', 'unknown')];
  const normalized = normalizePrintPages(pages, ['asara-locations', 'chanukah']);
  assert.deepEqual(normalized, [pages[0], { ...pages[1], right: '' }]);
  assert.equal(normalizePrintPages(null, []), null);
  assert.deepEqual(normalizePrintPages([{ left: 'unknown' }], []), []);
});
