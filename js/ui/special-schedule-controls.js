import { escAttr } from '../util.js';
import { switchHtml } from './switch.js';
import { printButtonHtml } from './print-page.js';

const YOM_TOV = new Set(['ראש השנה יום כיפור', 'סוכות', 'פסח', 'שבועות']);

// Keep chronological order within each section, including custom occasions.
export function occasionOptions(groups, selected) {
  const names = groups.map(group => typeof group === 'string' ? group : group.name);
  return [['Yom Tov', true], ['Other schedules', false]].map(([label, yomTov]) => {
    const members = names.filter(name => YOM_TOV.has(name) === yomTov);
    return members.length ? `<optgroup label="${label}">${members.map(name =>
      `<option value="${escAttr(name)}" ${name === selected ? 'selected' : ''}>${escAttr(name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

export function specialScheduleControls(c) {
  const toggle = (id, label, options) => `<div class="poster-bar-switch">${switchHtml(id, label, options)}</div>`;
  const selectedCombined = c.wholeOccasion;
  const schedules = c.items.map(p => `<option value="${escAttr(p.key)}" ${!selectedCombined && p.key === c.one?.key ? 'selected' : ''}>${escAttr(c.asara ? (p.handout ? 'Shacharis only' : p.own ? p.label : 'Full schedule') : p.label)}</option>`);
  if (c.items.length > 1 && !c.handout && !c.asara) schedules.push(`<option value="__combined__" ${selectedCombined ? 'selected' : ''}>Whole occasion combined</option>`);
  const canPad = c.onePage || c.halfLetter || c.one?.own || c.workflow === 'set' && c.setEntries.some(e => e.compact || e.handout || e.poster?.own);
  const canColumns = c.onePage && !c.halfLetter || c.workflow === 'single' && c.one?.own
    || c.workflow === 'set' && c.setEntries.some(e => e.poster?.own);
  const fullFormat = c.one?.key === 'pesach' ? 'Original poster' : 'Full page';
  const compactFormat = c.one?.key === 'pesach' ? 'Condensed poster' : 'Half page';
  return `<div class="special-heading no-print"><div><h2>Special schedules</h2><p class="hint">Choose a schedule to review, or select a set to print.</p></div>
    <button type="button" id="poster-own-new">+ Custom schedule</button></div>
    <div class="special-workflow no-print">${switchHtml('poster-workflow', 'View', [
      { value: 'single', label: 'One schedule', on: c.workflow === 'single' },
      { value: 'set', label: 'Print a set', on: c.workflow === 'set' },
    ])}</div>
    <div class="special-layout"><section class="special-controls no-print" aria-label="Schedule selection"><div class="poster-bar">
      <div class="poster-year"><span class="poster-year-label" id="poster-year-label">Year</span>
        <div class="poster-year-step" role="group" aria-labelledby="poster-year-label">
          <button type="button" id="poster-year-back" aria-label="Previous year" ${c.at === 0 ? 'disabled' : ''}>&minus;</button>
          <span class="poster-year-now" data-year="${c.year}"><select id="poster-year" aria-labelledby="poster-year-label" title="${escAttr(c.yearFullLabel(c.year))}">${c.years.map(y => `<option value="${y}" title="${escAttr(c.yearFullLabel(y))}" ${y === c.year ? 'selected' : ''}>${escAttr(c.yearLabel(y))}</option>`).join('')}</select></span>
          <button type="button" id="poster-year-next" aria-label="Next year" ${c.at === c.years.length - 1 ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-year-today" class="poster-year-reset" ${c.year === c.preferred ? 'disabled' : ''}>Current</button>
        </div></div>
      ${c.workflow === 'set' ? toggle('poster-scope', 'Print', [
        { value: 'one', label: 'This occasion', on: !c.scopeAll }, { value: 'all', label: 'Whole year', on: c.scopeAll },
      ]) : ''}
      ${c.scopeAll ? '' : `<div class="poster-year"><span class="poster-year-label" id="poster-group-label">Occasion</span>
        <div class="poster-year-step" role="group" aria-labelledby="poster-group-label">
          <button type="button" id="poster-group-back" aria-label="Previous occasion" ${c.gAt === 0 ? 'disabled' : ''}>&minus;</button>
          <select id="poster-group" aria-labelledby="poster-group-label">${occasionOptions(c.groups, c.group?.name)}</select>
          <button type="button" id="poster-group-next" aria-label="Next occasion" ${c.gAt === c.groups.length - 1 ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-group-now" class="poster-year-reset" ${!c.current || c.current.name === c.group?.name && (!c.current.key || c.current.key === c.one?.key) ? 'disabled' : ''}>Current</button>
        </div></div>`}
      ${c.workflow === 'single' && c.items.length > 1 ? `<label>${c.handout && !c.asara ? 'Month' : 'Schedule'}<select id="poster-pick">${schedules.join('')}</select></label>` : ''}
      ${c.workflow === 'single' && !c.empty && !c.handout && !c.wholeOccasion && (c.halfFormat || c.one?.key === 'pesach') ? toggle('poster-sheets', 'Format', [
        { value: 'one', label: fullFormat, on: !c.onePage }, { value: 'all', label: compactFormat, on: c.onePage },
      ]) : ''}
      ${c.workflow === 'set' ? toggle('poster-set-layout', 'Layout', [
        { value: 'original', label: 'Original posters', on: !c.onePage }, { value: 'combined', label: 'Combined', on: c.onePage },
      ]) : ''}
      ${!c.empty && c.halfLetter || c.workflow === 'set' && c.setEntries.some(e => e.handout || e.half) ? toggle('poster-copies', 'Copies per page', [
        { value: 'one', label: 'One', on: c.copies === 1 }, { value: 'two', label: 'Two', on: c.copies === 2 },
      ]) : ''}
      ${!c.empty ? `<details class="special-print-settings" ${c.advanced ? 'open' : ''}><summary>Print settings</summary><div>
        ${canPad ? `<div class="poster-year"><span id="poster-margin-label">Margin</span><div class="poster-year-step">
          <button type="button" id="poster-margin-back" aria-label="Narrower margin" ${c.margin <= c.padMin ? 'disabled' : ''}>&minus;</button>
          <select id="poster-margin" aria-labelledby="poster-margin-label">${c.padSteps.map(v => `<option value="${v}" ${Math.abs(v - c.margin) < 1e-9 ? 'selected' : ''}>${c.padLabel(v)}</option>`).join('')}</select>
          <button type="button" id="poster-margin-next" aria-label="Wider margin" ${c.margin >= c.padMax ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-margin-reset" class="poster-year-reset" ${Math.abs(c.margin - c.padOriginal) < 1e-9 ? 'disabled' : ''}>Original</button>
        </div></div>${toggle('poster-ink', 'Ink', [{ value: 'colour', label: 'Colour', on: c.ink === 'colour' }, { value: 'mono', label: 'Black and white', on: c.ink === 'mono' }])}` : ''}
        ${canColumns ? toggle('poster-break', 'Second column', [{ value: 'even', label: 'Split evenly', on: c.brk === 'even' }, { value: 'day', label: 'Start at a day', on: c.brk === 'day' }]) : ''}
        ${c.canTurn ? toggle('poster-orient', 'Paper', [{ value: 'portrait', label: 'Portrait', on: c.orientation === 'portrait' }, { value: 'landscape', label: 'Landscape', on: c.orientation === 'landscape' }]) : ''}
        ${!canPad && !c.canTurn ? '<p class="hint">This poster uses its original Letter layout.</p>' : ''}
      </div></details>` : ''}
      ${c.built ? `<div class="special-print-action">${printButtonHtml()}<span>${c.workflow === 'set' ? `${c.pageCount} ${c.pageCount === 1 ? 'sheet' : 'sheets'} selected` : c.halfLetter ? '5½ × 8½ inches per copy' : '8½ × 11 inches'}</span></div>` : ''}
      ${c.built && c.copyText ? '<button type="button" class="copy-btn" id="poster-copy-btn">Copy text</button>' : ''}
      ${c.workflow === 'set' ? `<div class="special-set-list"><h3>Included schedules</h3>
        <div class="special-set-actions"><button type="button" data-set-select="all">Select all</button><button type="button" data-set-select="none">Clear</button></div>
        ${c.setEntries.map(e => `<div class="special-set-entry"><label><input type="checkbox" data-set-key="${escAttr(e.id)}" ${e.selected ? 'checked' : ''} ${e.missing ? 'disabled' : ''}><span><bdi dir="auto">${escAttr(e.label)}</bdi><small>${escAttr(e.missing || (e.half || e.handout ? 'Half page' : e.compact ? 'Combined Letter poster' : e.paired ? 'Paired alternative' : 'Original Letter poster'))}</small></span></label>${e.missing ? '' : `<button type="button" data-set-review="${escAttr(e.id)}">Review</button>`}</div>`).join('')}
        ${c.scopeAll ? '<p class="hint">Morning handouts are selected separately under One schedule. Vasikin stays a separate poster in combined sets.</p>' : ''}
        ${!c.setEntries.length ? '<p class="hint">No schedules are set up for this occasion yet.</p>' : ''}
      </div>` : ''}
      <div id="poster-own"></div>
    </div></section><section class="special-preview" aria-label="Schedule preview">
      <div class="special-preview-tools no-print"><h3>Preview</h3><button type="button" data-poster-zmanim aria-pressed="false">Check zmanim</button><button type="button" data-poster-explain aria-pressed="false">Explain times</button></div>`;
}
