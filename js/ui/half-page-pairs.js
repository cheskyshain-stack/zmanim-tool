import { escAttr } from '../util.js';

let nextPair = 0;
export function newHalfPagePair(left = '', right = '') {
  const key = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++nextPair}`;
  return { id: `half-${key}`, left, right };
}

export function normalizeHalfPagePairs(value, keys) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(keys), ids = new Set();
  return value.slice(0, 128).filter(row => row && typeof row === 'object').map(row => {
    const pair = newHalfPagePair(allowed.has(row.left) ? row.left : '', allowed.has(row.right) ? row.right : '');
    if (typeof row.id === 'string' && /^[\w-]{1,80}$/.test(row.id) && !ids.has(row.id)) pair.id = row.id;
    ids.add(pair.id);
    return pair;
  });
}

// Reuse empty sheets, then append unplaced schedules. Preserve existing selections
// and any blank half paired with a schedule.
export function addAllHalfPages(pairs, entries) {
  const placed = new Set(pairs.flatMap(pair => [pair.left, pair.right]));
  const remaining = entries.filter(entry => entry.value && !placed.has(entry.key));
  const result = pairs.map(pair => ({ ...pair }));
  let i = 0;
  for (const pair of result) if (!pair.left && !pair.right && i < remaining.length) {
    pair.left = remaining[i++].key;
    pair.right = remaining[i++]?.key || '';
  }
  for (; i < remaining.length; i += 2) result.push(newHalfPagePair(remaining[i].key, remaining[i + 1]?.key || ''));
  return result;
}

export function halfPagePlan(pairs, entries) {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const pages = [], issues = [];
  for (const pair of pairs) {
    const left = byKey.get(pair.left), right = byKey.get(pair.right);
    for (const [side, key, entry] of [['left', pair.left, left], ['right', pair.right, right]]) {
      if (key && !entry?.value) issues.push({ id: pair.id, side, message: `${entry?.label || key} is not available for this year. Choose another schedule or leave this half blank.` });
    }
    if (left?.value || right?.value) pages.push({ id: pair.id, left, right });
  }
  const selected = pages.flatMap(page => [page.left, page.right]).filter(entry => entry?.value);
  const spans = selected.map(entry => entry.value.span).filter(Boolean);
  return { pages, issues, halfCount: selected.length,
    span: spans.length ? { from: Math.min(...spans.map(span => span.from)), to: Math.max(...spans.map(span => span.to)) } : null };
}

export function halfPagePairControls(pairs, entries, plan) {
  const placed = new Set(pairs.flatMap(pair => [pair.left, pair.right]));
  const allPlaced = entries.filter(entry => entry.value).every(entry => placed.has(entry.key));
  const picker = (pair, side) => `<label>${side === 'left' ? 'Left half' : 'Right half'}<select id="half-${escAttr(pair.id)}-${side}" data-half-side="${side}" data-pair-id="${escAttr(pair.id)}">
    <option value="">Blank</option>${entries.map(entry => `<option value="${escAttr(entry.key)}" ${entry.key === pair[side] ? 'selected' : ''} ${!entry.value ? 'disabled' : ''}>${escAttr(entry.label)}${entry.value ? '' : ' (unavailable)'}</option>`).join('')}</select></label>`;
  return `<div class="special-half-pairs"><h3>Pair half pages</h3>
    <p class="hint">Choose the left and right schedule for each sheet. Each half keeps its own design and prints at 5½ × 8½ inches.</p>
    <div class="special-half-actions"><button type="button" id="half-add-all" data-half-action="all" ${allPlaced ? 'disabled' : ''}>Add all half pages</button><button type="button" id="half-add-sheet" data-half-action="add">+ Sheet</button><button type="button" id="half-clear" data-half-action="clear" ${!pairs.length ? 'disabled' : ''}>Clear</button></div>
    ${pairs.map((pair, i) => `<section class="special-half-pair" data-id="${escAttr(pair.id)}" aria-label="Sheet ${i + 1}">
      <div class="special-half-pair-head"><h4>Sheet ${i + 1}</h4><div>
        <button type="button" data-half-action="up" aria-label="Move sheet ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-half-action="down" aria-label="Move sheet ${i + 1} down" ${i === pairs.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-half-action="remove" aria-label="Remove sheet ${i + 1}">Remove</button>
      </div></div><div class="special-half-pickers">${picker(pair, 'left')}${picker(pair, 'right')}</div>
      <button type="button" data-half-action="swap" aria-label="Swap halves on sheet ${i + 1}">Swap halves</button>
      ${plan.issues.filter(issue => issue.id === pair.id).map(issue => `<p class="special-half-error" role="status">${escAttr(issue.message)}</p>`).join('')}
    </section>`).join('')}
    ${!pairs.length ? '<p class="hint">Add a sheet to choose a pair, or add all available half-page schedules.</p>' : ''}
  </div>`;
}
