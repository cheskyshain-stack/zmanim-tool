import assert from 'node:assert/strict';
import { generalAllocations } from './maaser-worker.js';

const state = {
  sources: [{ id: 'salary' }, { id: 'other' }],
  income: [
    { source_id: 'salary', entry_date: '2026-01-01', maaser_cents: 6000 },
    { source_id: 'other', entry_date: '2026-01-01', maaser_cents: 4000 },
    { source_id: 'salary', entry_date: '2026-02-01', maaser_cents: 3000 },
  ],
  opening: [], giving: [], allocations: [],
};
assert.deepEqual(generalAllocations(state, '2026-01-15', 5000), [
  { sourceId: 'salary', cents: 3000 }, { sourceId: 'other', cents: 2000 },
]);
assert.deepEqual(generalAllocations(state, '2026-01-15', 15000), [
  { sourceId: 'salary', cents: 6000 }, { sourceId: 'other', cents: 4000 },
]);
state.giving.push({ id: 'previous', entry_date: '2026-01-10' });
state.allocations.push({ giving_id: 'previous', source_id: 'salary', amount_cents: 6000 });
assert.deepEqual(generalAllocations(state, '2026-01-15', 1500), [
  { sourceId: 'other', cents: 1500 },
]);
assert.deepEqual(generalAllocations({ ...state, income: [] }, '2026-01-15', 1500), []);
console.log('Maaser general allocation tests passed.');
