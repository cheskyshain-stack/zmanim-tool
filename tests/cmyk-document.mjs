import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cmykPixels } from '../js/ui/cmyk-document.js';

test('neutral colours use only black ink and transparency is flattened on white', () => {
  for (let gray = 0; gray < 256; gray++) {
    assert.deepEqual([...cmykPixels([gray, gray, gray, 255])], [0, 0, 0, 255 - gray]);
  }
  assert.deepEqual([...cmykPixels([0, 0, 0, 0])], [0, 0, 0, 0]);
  assert.deepEqual([...cmykPixels([0, 0, 0, 128])], [0, 0, 0, 128]);
});

test('primary colours and coloured shadows produce real CMYK separations', () => {
  assert.deepEqual([...cmykPixels([255, 0, 0, 255])], [0, 255, 255, 0]);
  assert.deepEqual([...cmykPixels([0, 255, 0, 255])], [255, 0, 255, 0]);
  assert.deepEqual([...cmykPixels([0, 0, 255, 255])], [255, 255, 0, 0]);
  assert.deepEqual([...cmykPixels([255, 255, 0, 255])], [0, 0, 255, 0]);
  assert.deepEqual([...cmykPixels([128, 0, 0, 255])], [0, 255, 255, 127]);
});
