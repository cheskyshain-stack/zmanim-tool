import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateRoomDesignChoice, seatsCreateChartDisplayChoice } from '../js/seats/room-design-choice.js';

const legacyKey = 'lakewood-commons-seats-room-design';
test('open-seat display choices are independent from other charts and Room design', () => {
  const values = new Map(), store = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const create = () => seatsCreateChartDisplayChoice({storageKey:'open-seats',getStorage:()=>store});
  const open = create(), design = seatsCreateRoomDesignChoice({getStorage:()=>store});
  assert.equal(open.get('a'),false);open.set('a',true);
  assert.equal(open.get('b'),false);assert.equal(design.get('a'),false);assert.equal(create().get('a'),true);
  open.set('b',true);open.set('a',false);assert.equal(open.get('b'),true);
});
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('each chart retains an independent choice across new controller instances', () => {
  const store = storage(), create = () => seatsCreateRoomDesignChoice({ getStorage: () => store });
  const first = create();
  first.set('chart-a', true);
  assert.equal(first.get('chart-b'), false);
  first.set('chart-b', true);first.set('chart-a', false);
  const reopened = create();
  assert.equal(reopened.get('chart-a'), false);
  assert.equal(reopened.get('chart-b'), true);
  assert.equal(reopened.get('new-chart'), false);
});

test('the legacy device choice migrates only to the previously active chart', () => {
  const store = storage({ [legacyKey]: '1' }), create = id => seatsCreateRoomDesignChoice({ legacyChartId: id, getStorage: () => store });
  const first = create('chart-a');
  assert.equal(first.get('chart-a'), true);
  assert.equal(first.get('chart-b'), false);
  const later = create('chart-b');
  assert.equal(later.get('chart-a'), true);
  assert.equal(later.get('chart-b'), false);
  later.set('chart-a', false);
  store.setItem(legacyKey, '1');
  assert.equal(create('chart-a').get('chart-a'), false, 'An older open page must not reapply the device-wide flag');
});

test('an unknown old chart cannot enable room design for a new chart', () => {
  const store = storage({ [legacyKey]: '1' });
  const first = seatsCreateRoomDesignChoice({ getStorage: () => store });
  assert.equal(first.get('new-chart'), false);
  assert.equal(seatsCreateRoomDesignChoice({ legacyChartId: 'new-chart', getStorage: () => store }).get('new-chart'), false);
});

test('writes from separate tabs do not replace other charts choices', () => {
  const store = storage(), create = () => seatsCreateRoomDesignChoice({ getStorage: () => store });
  const left = create(), right = create();
  left.set('chart-a', true);right.set('chart-b', true);right.set('chart-b', false);
  assert.equal(left.get('chart-a'), true);
  assert.equal(left.get('chart-b'), false);
  assert.equal(create().get('chart-a'), true);
});

test('unavailable storage keeps independent choices for the current visit', () => {
  const preferences = seatsCreateRoomDesignChoice({ getStorage() { throw new Error('blocked'); } });
  preferences.set('chart-a', true);
  assert.equal(preferences.get('chart-a'), true);
  assert.equal(preferences.get('chart-b'), false);
  preferences.set('chart-b', true);preferences.set('chart-a', false);
  assert.equal(preferences.get('chart-a'), false);
  assert.equal(preferences.get('chart-b'), true);
});
