import { ZMANIM_REFERENCE_GROUPS, zmanimReferences, referenceClock } from '../zmanim/references.js';
import { dateFromSerial, shulNow } from '../zmanim/solar.js';
import { jewishDateString, excelWeekday } from '../hebrew-calendar.js';
import { DAY_NAMES, escAttr, useStraightHebrewQuotes } from '../util.js';

// Shared renderers register dates only when the admin installs this controller.
let zmanimReferenceInstalled = false;
let zmanimReferenceNext = 0;
const zmanimReferenceContexts = new Map();
const zmanimReferencePreference = 'zmanim-admin-show-zmanim';
const referenceDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

function registerZmanimReference(context) {
  if (!zmanimReferenceInstalled || !context.days?.length) return null;
  const id = String(++zmanimReferenceNext);
  zmanimReferenceContexts.set(id, { ...context, days: [...new Set(context.days)].sort((a, b) => a - b), registeredAt: Date.now() });
  return id;
}

export function zmanimReferenceAttrs(context) {
  const id = registerZmanimReference(context);
  return id ? ` data-zmanim-reference="${id}"` : '';
}

export function attachZmanimReference(element, context) {
  if (!element) return;
  const id = registerZmanimReference(context);
  if (id) element.dataset.zmanimReference = id; else element.removeAttribute('data-zmanim-reference');
}

const referenceDateLabel = serial => `${DAY_NAMES[excelWeekday(serial) - 1]}, ${referenceDateFormat.format(dateFromSerial(serial))}`;
const referenceSignature = context => context.title + ':' + context.days.join(',');

export function installZmanimReferences(main, host) {
  zmanimReferenceInstalled = true;
  let enabled = false, selectedContext = '', selectedDay = null, selectedGroup = 'shacharis', moreOpen = false, queued = false;
  try { enabled = localStorage.getItem(zmanimReferencePreference) === '1'; } catch { /* The view still works without storage. */ }
  const bar = document.createElement('div');
  bar.className = 'time-explain-bar zmanim-reference-bar no-print';
  bar.innerHTML = '<button type="button" id="show-zmanim-toggle" aria-pressed="false">Show zmanim</button><span>Compare schedule times with the day’s zmanim.</span>';
  host.appendChild(bar);
  const toggle = bar.querySelector('button');
  const panel = document.createElement('section');
  panel.className = 'zmanim-reference-panel no-print';
  panel.id = 'zmanim-reference-panel';
  panel.setAttribute('aria-label', 'Zmanim for schedule comparison');
  toggle.setAttribute('aria-controls', panel.id);

  const contexts = () => [...main.querySelectorAll('[data-zmanim-reference]')].map(element => ({
    element, context: zmanimReferenceContexts.get(element.dataset.zmanimReference),
  })).filter(item => item.context);

  const setEnabled = value => {
    enabled = value;
    try { localStorage.setItem(zmanimReferencePreference, enabled ? '1' : '0'); } catch { /* Optional preference. */ }
    refresh();
  };
  const refresh = () => {
    const available = contexts();
    toggle.disabled = !available.length;
    toggle.setAttribute('aria-pressed', String(enabled));
    panel.hidden = !enabled || !available.length;
    if (!enabled || !available.length) return;
    const source = available[0].element;
    const anchor = source.closest('.pages-fit') || source.closest('#poster-sheet,#pages,.week-cards') || source;
    if (panel.nextElementSibling !== anchor) anchor.before(panel);
    const active = available.find(item => referenceSignature(item.context) === selectedContext) || available[0];
    const context = active.context;
    selectedContext = referenceSignature(context);
    if (!context.days.includes(selectedDay)) {
      const today = shulNow(new Date(), context.settings).serial;
      selectedDay = context.days.reduce((best, day) => Math.abs(day - today) < Math.abs(best - today) ? day : best);
    }
    const groups = context.groups || Object.keys(ZMANIM_REFERENCE_GROUPS);
    if (!groups.includes(selectedGroup)) selectedGroup = groups[0];
    const at = context.days.indexOf(selectedDay);
    const refs = zmanimReferences(selectedDay, context.settings, selectedGroup, context);
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const focusSelector = focused?.id ? `#${focused.id}` : focused?.dataset.referenceGroup
      ? `[data-reference-group="${focused.dataset.referenceGroup}"]` : null;
    const valuesHtml = values => `<dl class="zmanim-reference-values">${values.map(ref => `<div data-reference-key="${ref.key}"><dt lang="he" dir="rtl">${escAttr(ref.label)}</dt>
      <dd><bdi dir="ltr">${referenceClock(ref.value)}</bdi></dd>${ref.note ? `<small>${escAttr(ref.note)}</small>` : ''}</div>`).join('')}</dl>`;
    panel.innerHTML = `<div class="zmanim-reference-heading"><h3>Compare zmanim</h3><button type="button" class="zmanim-reference-hide">Hide</button></div>
      ${available.length > 1 ? `<label class="zmanim-reference-context">Schedule<select id="zmanim-reference-context">${available.map((item, i) =>
        `<option value="${i}" ${item === active ? 'selected' : ''}>${escAttr(item.context.title)}</option>`).join('')}</select></label>` :
        `<div class="zmanim-reference-schedule">${escAttr(context.title)}</div>`}
      <div class="zmanim-reference-date-control"><button type="button" id="zmanim-reference-prev" aria-label="Previous date" ${at === 0 ? 'disabled' : ''}>←</button>
        <label>Date<select id="zmanim-reference-date">${context.days.map(day => `<option value="${day}" ${day === selectedDay ? 'selected' : ''}>${escAttr(referenceDateLabel(day))}</option>`).join('')}</select></label>
        <button type="button" id="zmanim-reference-next" aria-label="Next date" ${at === context.days.length - 1 ? 'disabled' : ''}>→</button></div>
      <div class="zmanim-reference-hebrew" dir="rtl" lang="he">${escAttr(jewishDateString(selectedDay, false, context.settings.useGregorianBefore1582))}</div>
      <div class="zmanim-reference-groups" aria-label="Choose zmanim to compare">${groups.map(group => `<button type="button" data-reference-group="${group}" aria-pressed="${group === selectedGroup}">${ZMANIM_REFERENCE_GROUPS[group]}</button>`).join('')}</div>
      ${valuesHtml(refs.filter(ref => !ref.secondary))}
      ${refs.some(ref => ref.secondary) ? `<details class="zmanim-reference-more" ${moreOpen ? 'open' : ''}><summary>More ${ZMANIM_REFERENCE_GROUPS[selectedGroup]} zmanim</summary>${valuesHtml(refs.filter(ref => ref.secondary))}</details>` : ''}
      <p class="zmanim-reference-note">Exact zmanim before minute rounding, using this schedule’s location and calculation settings. ${context.weeklyLimit && selectedGroup === 'mincha' ? 'The weekly limit keeps the chart’s own rounding.' : ''}</p>`;
    useStraightHebrewQuotes(panel);
    panel.querySelector('.zmanim-reference-hide').onclick = () => setEnabled(false);
    panel.querySelector('#zmanim-reference-context')?.addEventListener('change', event => {
      selectedContext = referenceSignature(available[Number(event.target.value)].context); refresh();
    });
    panel.querySelector('#zmanim-reference-date').onchange = event => { selectedDay = Number(event.target.value); refresh(); };
    panel.querySelector('#zmanim-reference-prev').onclick = () => { selectedDay = context.days[at - 1]; refresh(); };
    panel.querySelector('#zmanim-reference-next').onclick = () => { selectedDay = context.days[at + 1]; refresh(); };
    panel.querySelectorAll('[data-reference-group]').forEach(button => {
      button.onclick = () => { selectedGroup = button.dataset.referenceGroup; moreOpen = false; refresh(); };
    });
    const more = panel.querySelector('.zmanim-reference-more');
    if (more) more.ontoggle = () => { if (main.contains(more)) moreOpen = more.open; };
    if (focusSelector) {
      const control = panel.querySelector(focusSelector);
      (control?.disabled ? panel.querySelector('#zmanim-reference-date') : control)?.focus({ preventScroll: true });
    }
    if (zmanimReferenceContexts.size > 500) {
      const live = new Set(available.map(item => item.element.dataset.zmanimReference));
      for (const [id, entry] of zmanimReferenceContexts) if (!live.has(id) && Date.now() - entry.registeredAt > 60000) zmanimReferenceContexts.delete(id);
    }
  };
  toggle.onclick = () => setEnabled(!enabled);
  new MutationObserver(records => {
    if (queued || records.every(record => panel.contains(record.target))) return;
    queued = true;
    queueMicrotask(() => { queued = false; refresh(); });
  }).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-zmanim-reference'] });

  // Clicking a seasonal cell picks its own date and tefillah without changing its
  // value. Explain times retains its existing capture-phase click behavior.
  main.addEventListener('click', event => {
    if (!enabled) return;
    const cell = event.target.closest('.cell[data-serial][data-season]');
    const source = cell?.closest('[data-zmanim-reference]');
    const context = source && zmanimReferenceContexts.get(source.dataset.zmanimReference);
    if (!context) return;
    const season = cell.dataset.season, key = cell.dataset.col;
    const fridayKeys = season === 'kayitz' ? ['F', 'G', 'H', 'I', 'J', 'K', 'L'] : ['F', 'G', 'H', 'I'];
    selectedContext = referenceSignature(context);
    if (season !== 'weekday') selectedDay = Number(cell.dataset.serial) - (fridayKeys.includes(key) ? 1 : 0);
    else {
      const anchor = Number(cell.dataset.serial), sunday = anchor - (excelWeekday(anchor) - 1);
      const days = context.days.filter(day => day >= sunday && day < sunday + 6);
      if (!days.includes(selectedDay) && days.length) {
        const today = shulNow(new Date(), context.settings).serial;
        selectedDay = days.reduce((best, day) => Math.abs(day - today) < Math.abs(best - today) ? day : best);
      }
    }
    selectedGroup = ['D', 'E'].includes(key) ? 'shacharis' : ['B', 'F'].includes(key) ? 'maariv' : key === 'H' ? 'other' : 'mincha';
    moreOpen = selectedGroup === 'mincha' && (season === 'kayitz' ? ['I', 'J', 'K'].includes(key) : season === 'choref' && key === 'G');
    refresh();
  });
  refresh();
}
