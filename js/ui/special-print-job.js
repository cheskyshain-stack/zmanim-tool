import { newHalfPagePair } from './half-page-pairs.js';

export const newPrintPage = (left = '', right = '') => newHalfPagePair(left, right);

export function normalizePrintPages(value, keys) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(keys), used = new Set();
  return value.slice(0, 128).filter(row => row && typeof row === 'object').map(row => {
    const page = newPrintPage(allowed.has(row.left) ? row.left : '', allowed.has(row.right) ? row.right : '');
    if (typeof row.id === 'string' && /^[\w-]{1,80}$/.test(row.id) && !used.has(row.id)) page.id = row.id;
    used.add(page.id);
    return page;
  }).filter(page => page.left || page.right);
}

// A pair stays selected when a design needs more room. It then uses two physical
// sheets and returns to one when both selections are half-page designs again.
export function specialPrintPlan(pages, resolve) {
  const frames = [], issues = [];
  for (const page of pages) {
    const left = page.left ? resolve(page.left) : null, right = page.right ? resolve(page.right) : null;
    for (const [key, entry] of [[page.left, left], [page.right, right]]) {
      if (key && !entry?.value) issues.push({ id: page.id, key, label: entry?.label || key });
    }
    const entries = [left, right].filter(entry => entry?.value);
    if (!entries.length) continue;
    if (entries.every(entry => entry.half)) frames.push({ id: page.id, page, left, right, half: true });
    else for (const [side, entry] of [['left', left], ['right', right]]) {
      if (entry?.value) frames.push({ id: `${page.id}-${side}`, page, [side]: entry, half: entry.half });
    }
  }
  const entries = frames.flatMap(frame => [frame.left, frame.right]).filter(entry => entry?.value);
  const spans = entries.map(entry => entry.value.span).filter(Boolean);
  return { frames, issues, landscape: frames.length > 0 && frames.every(frame => frame.half),
    span: spans.length ? { from: Math.min(...spans.map(span => span.from)), to: Math.max(...spans.map(span => span.to)) } : null };
}
