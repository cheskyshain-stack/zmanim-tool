import { cellDetailHtml } from './calc-cell.js';
import { fixedTime } from '../zmanim/trace.js';
import { announcedWeekCell } from '../announced.js';

// Renderers attach their own calculation, never a lookup by clock time across the page.
// Only the admin installs this registry. Shared congregation renderers emit nothing extra.
let timeExplainInstalled = false;
let timeExplainNext = 0;
const timeExplainDetails = new Map();
const timeExplainPattern = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\b/gi;

export function timeExplanationAttrs(detail) {
  if (!timeExplainInstalled) return '';
  const id = String(++timeExplainNext);
  timeExplainDetails.set(id, { ...detail, registeredAt: Date.now() });
  return ` data-time-explain="${id}"`;
}

export function chartExplanationAttrs(row, key, header, chartName, { value = row[key], fixed = false, announcedWeek = null } = {}) {
  const times = (row.traces?.[key] || []).map(trace => {
    if (!announcedWeek) return trace;
    const displayed = announcedWeekCell(trace.plain(), key, announcedWeek.anchor, announcedWeek.settings);
    return displayed === trace.plain() ? trace : fixedTime(displayed, { label: 'The time temporarily announced by the shul for this week' });
  });
  return timeExplanationAttrs({ header, chartName, printed: value,
    times, note: row.traceNotes?.[key] || row.notes?.[key], fixed });
}

export function posterTimeExplanationHtml(body, time) {
  if (!timeExplainInstalled) return body;
  return `<span${timeExplanationAttrs({ printed: time.text, times: time.traces || (time.trace ? [time.trace] : []),
    header: '', note: time.explanation, single: true })}>${body}</span>`;
}

function timeExplainTokens(root) {
  const tokens = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const match of node.textContent.matchAll(timeExplainPattern)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      tokens.push({ text: match[0], range });
    }
  }
  return tokens;
}

function timeExplainContext(root, detail) {
  const row = root.closest('.onepage-row,.week-line,.poster-row,.poster-set,.sukkos-row,.rh-row,.chanukah-line');
  const label = row?.querySelector('.onepage-label,.week-label,.poster-row-label,.poster-set-head,.poster-label,.sukkos-label,.rh-label,.chanukah-label');
  const title = root.closest('.poster,.week-card,.page')?.querySelector('.poster-title,.week-card-title,.page-title');
  return { ...detail, header: detail.header || label?.textContent.trim() || 'Time calculation',
    chartName: detail.chartName || title?.textContent.trim() || 'Schedule' };
}

export function installTimeExplanations(main, host) {
  timeExplainInstalled = true;
  let enabled = false;
  const originalAttrs = new WeakMap();
  const bar = document.createElement('div');
  bar.className = 'time-explain-bar no-print';
  bar.innerHTML = '<button type="button" id="explain-times-toggle" aria-pressed="false">Explain times</button><span id="explain-times-hint" role="status">Turn on, then click any schedule time.</span>';
  host.appendChild(bar);
  const toggle = bar.querySelector('button');
  const hint = bar.querySelector('[role="status"]');
  const dialog = document.createElement('dialog');
  dialog.className = 'calc-open time-explain-dialog no-print';
  dialog.setAttribute('aria-label', 'Time calculation');
  document.body.appendChild(dialog);

  const refresh = () => {
    const live = new Set();
    for (const el of main.querySelectorAll('[data-time-explain]')) {
      live.add(el.dataset.timeExplain);
      if (enabled && timeExplainTokens(el).length) {
        if (!originalAttrs.has(el)) {
          originalAttrs.set(el, ['tabindex', 'role', 'aria-label', 'contenteditable'].map(a => el.getAttribute(a)));
        }
        el.classList.add('time-explain-target');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Explain this time');
        if (el.hasAttribute('contenteditable')) el.setAttribute('contenteditable', 'false');
      } else if (originalAttrs.has(el)) {
        el.classList.remove('time-explain-target');
        ['tabindex', 'role', 'aria-label', 'contenteditable'].forEach((a, i) => {
          const value = originalAttrs.get(el)[i];
          if (value === null) el.removeAttribute(a); else el.setAttribute(a, value);
        });
        originalAttrs.delete(el);
      }
    }
    // Keep detached markup briefly: the weekly print run restores its original HTML.
    if (timeExplainDetails.size > 2000) for (const [id, detail] of timeExplainDetails) {
      if (!live.has(id) && Date.now() - detail.registeredAt > 60000) timeExplainDetails.delete(id);
    }
  };
  new MutationObserver(refresh).observe(main, { childList: true, subtree: true });
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    toggle.setAttribute('aria-pressed', String(enabled));
    hint.textContent = enabled ? 'Click a time to see its rule. Turn off to edit times.' : 'Turn on, then click any schedule time.';
    refresh();
  });

  const open = (root, index) => {
    const detail = timeExplainDetails.get(root.dataset.timeExplain);
    if (!detail) return;
    const tokens = timeExplainTokens(root);
    const pool = [...(detail.times || [])];
    const selected = tokens.map(token => {
      const at = detail.single && tokens.length === 1 && pool.length === 1 ? 0 : pool.findIndex(t => t.plain() === token.text);
      let trace = at < 0 ? (detail.fixed ? fixedTime(token.text, { label: 'The standing schedule set by the shul' }) : null) : pool.splice(at, 1)[0];
      if (trace && /^\d{1,2}:\d{2}:\d{2}$/.test(token.text) && trace.steps.length === 1) {
        trace = { ...trace, plain: () => token.text, steps: [{ ...trace.steps[0], at: token.text }] };
      }
      return { token, trace };
    });
    const choices = index == null ? selected : selected.slice(index, index + 1);
    if (!choices.length) return;
    const times = choices.map(c => c.trace).filter(Boolean);
    const missing = choices.some(c => !c.trace);
    const context = timeExplainContext(root, detail);
    const note = [context.note, missing ? 'This displayed time has no recorded calculation. Check the source schedule before treating it as a fixed time.' : ''].filter(Boolean).join(' ');
    const fixed = times.length && times.every(t => t.steps.every(s => ['fixed', 'condition', 'underline', 'mark'].includes(s.kind)));
    dialog.innerHTML = cellDetailHtml({ ...context, note, printed: choices.map(c => c.token.text).join(' / '), times });
    const badge = document.createElement('p');
    badge.className = 'time-explain-kind';
    badge.textContent = missing ? 'Calculation not recorded' : fixed ? 'Fixed time' : 'Calculated time';
    dialog.querySelector('.calc-open-printed').after(badge);
    root.focus({ preventScroll: true });
    dialog.showModal();
    dialog.querySelector('.calc-close').onclick = () => dialog.close();
  };
  main.addEventListener('click', event => {
    if (!enabled) return;
    const root = event.target.closest('[data-time-explain]');
    if (!root) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const tokens = timeExplainTokens(root);
    const index = tokens.findIndex(t => [...t.range.getClientRects()].some(r =>
      event.clientX >= r.left - 3 && event.clientX <= r.right + 3 && event.clientY >= r.top - 3 && event.clientY <= r.bottom + 3));
    open(root, index < 0 ? null : index);
  }, true);
  main.addEventListener('keydown', event => {
    if (!enabled || !['Enter', ' '].includes(event.key)) return;
    const root = event.target.closest('[data-time-explain]');
    if (!root) return;
    event.preventDefault(); event.stopImmediatePropagation(); open(root, null);
  }, true);
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  } });
  window.addEventListener('beforeprint', () => { if (dialog.open) dialog.close(); });
}
