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
  return `<div class="special-heading no-print"><div><h2>Special schedules</h2><p class="hint">Choose a page, then add any other pages you want to print with it.</p></div></div>
    <div class="special-layout"><section class="special-controls no-print" aria-label="Schedule selection"><div class="poster-bar">
      <div class="poster-year"><span class="poster-year-label" id="poster-year-label">Year</span>
        <div class="poster-year-step" role="group" aria-labelledby="poster-year-label">
          <button type="button" id="poster-year-back" aria-label="Previous year" ${c.at === 0 ? 'disabled' : ''}>&minus;</button>
          <span class="poster-year-now" data-year="${c.year}"><select id="poster-year" aria-labelledby="poster-year-label">${c.years.map(y => `<option value="${y}" ${y === c.year ? 'selected' : ''}>${escAttr(c.yearLabel(y))}</option>`).join('')}</select></span>
          <button type="button" id="poster-year-next" aria-label="Next year" ${c.at === c.years.length - 1 ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-year-today" class="poster-year-reset" ${c.year === c.preferred ? 'disabled' : ''}>Current</button>
        </div></div>
      <div class="poster-year"><span class="poster-year-label" id="poster-group-label">Occasion</span>
        <div class="poster-year-step" role="group" aria-labelledby="poster-group-label">
          <button type="button" id="poster-group-back" aria-label="Previous occasion" ${c.gAt === 0 ? 'disabled' : ''}>&minus;</button>
          <select id="poster-group" aria-labelledby="poster-group-label">${occasionOptions(c.groups, c.group?.name)}</select>
          <button type="button" id="poster-group-next" aria-label="Next occasion" ${c.gAt === c.groups.length - 1 ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-group-now" class="poster-year-reset" ${!c.current || c.current.name === c.group?.name && c.current.key === c.selected ? 'disabled' : ''}>Current</button>
        </div></div>
      ${toggle('poster-design', 'Design', [{ value: 'new', label: 'New design', on: c.design === 'new' }, { value: 'old', label: 'Old design', on: c.design === 'old' }])}
      ${c.asara ? `<div class="special-asara-options">${switchHtml('poster-asara-option', 'Asara B’Teves schedule', [
        { value: 'full', label: 'Regular schedule', on: c.selected === 'asarabteves' },
        { value: 'shacharis', label: 'Shacharis only', on: c.selected === 'asarashacharis' },
        { value: 'locations', label: 'Shacharis locations + Mincha/Maariv', on: c.selected === 'asaralocations' },
      ])}</div>` : c.choices.length > 1 ? `<label>${c.group?.name === 'ראש חודש' ? 'Month' : 'Page'}<select id="poster-pick">${c.choices.map(entry => `<option value="${escAttr(entry.key)}" ${entry.key === c.selected ? 'selected' : ''} ${entry.value ? '' : 'disabled'}>${escAttr(entry.label)}</option>`).join('')}</select></label>` : ''}
      ${c.conflict ? `<label>Chart to use<select id="poster-conflict">${c.conflict.map((chart, index) => `<option value="${index}" ${index === c.conflictPick ? 'selected' : ''}>${escAttr(c.chartLabel(chart.sheet))}</option>`).join('')}</select></label>` : ''}
      ${c.canPad || c.canTurn ? `<details class="special-print-settings" ${c.advanced ? 'open' : ''}><summary>Print settings</summary><div>
        ${c.canPad ? `<div class="poster-year"><span id="poster-margin-label">Margin</span><div class="poster-year-step">
          <button type="button" id="poster-margin-back" aria-label="Narrower margin" ${c.margin <= c.padMin ? 'disabled' : ''}>&minus;</button>
          <select id="poster-margin" aria-labelledby="poster-margin-label">${c.padSteps.map(v => `<option value="${v}" ${Math.abs(v - c.margin) < 1e-9 ? 'selected' : ''}>${c.padLabel(v)}</option>`).join('')}</select>
          <button type="button" id="poster-margin-next" aria-label="Wider margin" ${c.margin >= c.padMax ? 'disabled' : ''}>+</button>
          <button type="button" id="poster-margin-reset" class="poster-year-reset" ${Math.abs(c.margin - c.padOriginal) < 1e-9 ? 'disabled' : ''}>Original</button>
        </div></div>
        ${toggle('poster-ink', 'Ink', [{ value: 'colour', label: 'Colour', on: c.ink === 'colour' }, { value: 'mono', label: 'Black and white', on: c.ink === 'mono' }])}` : ''}
        ${c.canColumns ? toggle('poster-break', 'Second column', [{ value: 'even', label: 'Split evenly', on: c.brk === 'even' }, { value: 'day', label: 'Start at a day', on: c.brk === 'day' }]) : ''}
        ${c.canTurn ? toggle('poster-orient', 'Paper', [{ value: 'portrait', label: 'Portrait', on: c.orientation === 'portrait' }, { value: 'landscape', label: 'Landscape', on: c.orientation === 'landscape' }]) : ''}
      </div></details>` : ''}
      ${c.printable ? `<div class="special-print-action">${printButtonHtml()}<span>${c.count} ${c.count === 1 ? 'sheet' : 'sheets'} · Letter · ${c.landscape ? 'Landscape' : 'Portrait'}</span></div>` : ''}
      ${c.copyText ? '<button type="button" class="copy-btn" id="poster-copy-btn">Copy text</button>' : ''}
      <div id="poster-own"></div>
    </div></section><section class="special-preview" aria-label="Schedule preview">
      <div class="special-preview-tools no-print"><h3>Preview</h3><button type="button" data-poster-zmanim aria-pressed="false">Check zmanim</button><button type="button" data-poster-explain aria-pressed="false">Explain times</button></div>`;
}
