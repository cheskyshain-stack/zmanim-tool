import { escAttr } from '../util.js';
import { switchHtml } from './switch.js';
import { printButtonHtml } from './print-page.js';

const YOM_TOV = new Set(['ראש השנה יום כיפור', 'סוכות', 'פסח', 'שבועות']);
const NORAIM_OCCASIONS = new Set(['slichos', 'roshhashana', 'tzomgedalia', 'shuva', 'yomkippur', 'afteryk']);
export const SPECIAL_COLLECTIONS = [
  { kind: 'yomtov', value: 'all:yomtov', name: 'All Yom Tov', category: 'Yom Tov' },
  { kind: 'roshchodesh', value: 'all:roshchodesh', name: 'All Rosh Chodesh', category: 'Rosh Chodesh' },
];

export function specialCollectionEntries(catalog, kind) {
  return catalog.filter(entry => {
    if (!entry.value || entry.whole || entry.locations || entry.poster?.combined || entry.poster?.extra) return false;
    if (kind === 'roshchodesh') return entry.group === 'ראש חודש' && entry.poster?.dated;
    if (kind !== 'yomtov' || !YOM_TOV.has(entry.group)) return false;
    return entry.group !== 'ראש השנה יום כיפור' || ['roshhashana', 'yomkippur'].includes(entry.key);
  }).sort((a, b) => (a.value.span?.from ?? Infinity) - (b.value.span?.from ?? Infinity));
}

// Keep the underlying poster groups and saved keys while exposing direct occasions.
export function specialOccasionChoices(groups, catalog, { selectedKey = null, availableOnly = false } = {}) {
  const choices = [];
  const posterChoice = (entry, category) => ({ value: `poster:${entry.key}`, key: entry.key,
    name: entry.whole ? `${entry.group} · ${entry.label}` : entry.label, group: entry.group,
    category, from: entry.value?.span?.from ?? Infinity, disabled: !entry.value });
  for (const group of groups) {
    const entries = catalog.filter(entry => entry.group === group.name);
    if (group.name === 'ראש השנה יום כיפור') {
      for (const entry of entries) {
        if (!NORAIM_OCCASIONS.has(entry.key) && entry.key !== selectedKey) continue;
        if (availableOnly && !entry.value) continue;
        choices.push(posterChoice(entry, ['roshhashana', 'yomkippur', 'pair', 'vasikinboth'].includes(entry.key) || entry.whole
          ? 'Yom Tov' : 'Other schedules'));
      }
    } else {
      if (availableOnly && !entries.some(entry => entry.value)) continue;
      choices.push({ value: group.name, name: group.name, group: group.name,
        category: group.name === 'ראש חודש' ? 'Rosh Chodesh' : YOM_TOV.has(group.name) ? 'Yom Tov' : 'Other schedules', from: group.firstStart ?? Infinity });
    }
  }
  return choices.sort((a, b) => a.from - b.from);
}

// Keep chronological order within each section, including custom occasions.
export function occasionOptions(groups, selected, collections = []) {
  const choices = groups.map(group => typeof group === 'string' ? { name: group } : group);
  return ['Yom Tov', 'Rosh Chodesh', 'Other schedules'].map(label => {
    const members = [...collections.filter(choice => choice.category === label), ...choices.filter(choice => (choice.category || (choice.name === 'ראש חודש' ? 'Rosh Chodesh'
      : YOM_TOV.has(choice.name) ? 'Yom Tov' : 'Other schedules')) === label)];
    return members.length ? `<optgroup label="${label}">${members.map(choice =>
      `<option value="${escAttr(choice.value ?? choice.name)}" ${(choice.value ?? choice.name) === selected ? 'selected' : ''} ${choice.disabled ? 'disabled' : ''}>${escAttr(choice.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

export function specialScheduleControls(c) {
  const toggle = (id, label, options) => `<div class="poster-bar-switch">${switchHtml(id, label, options)}</div>`;
  return `<div class="special-heading no-print"><div><h2>Special schedules</h2><p class="hint">Choose a page, then add any other pages you want to print with it.</p></div></div>
    <div class="special-layout"><section class="special-controls no-print" aria-label="Schedule selection"><div class="poster-bar">
      <div class="poster-year" role="group" aria-labelledby="poster-year-label"><div class="special-field-heading"><span class="poster-year-label" id="poster-year-label">Year</span>
        <button type="button" id="poster-year-today" class="special-field-reset" aria-label="Current year" ${c.year === c.preferred ? 'disabled' : ''}>Current</button></div>
        <div class="poster-year-step">
          <span class="poster-year-now" data-year="${c.year}"><select id="poster-year" aria-labelledby="poster-year-label">${c.years.map(y => `<option value="${y}" ${y === c.year ? 'selected' : ''}>${escAttr(c.yearLabel(y))}</option>`).join('')}</select></span>
          <button type="button" id="poster-year-back" aria-label="Previous year" ${c.at === 0 ? 'disabled' : ''}>&minus;</button>
          <button type="button" id="poster-year-next" aria-label="Next year" ${c.at === c.years.length - 1 ? 'disabled' : ''}>+</button>
        </div></div>
      <div class="poster-year" role="group" aria-labelledby="poster-group-label"><div class="special-field-heading"><span class="poster-year-label" id="poster-group-label">Occasion</span>
        <button type="button" id="poster-group-now" class="special-field-reset" aria-label="Current occasion" ${!c.current || !c.collection && c.current.name === c.group?.name && c.current.key === c.selected ? 'disabled' : ''}>Current</button></div>
        <div class="poster-year-step">
          <select id="poster-group" aria-labelledby="poster-group-label">${occasionOptions(c.groups, c.occasionValue, c.collections)}</select>
          <button type="button" id="poster-group-back" aria-label="Previous occasion" ${c.gAt === 0 ? 'disabled' : ''}>&minus;</button>
          <button type="button" id="poster-group-next" aria-label="Next occasion" ${c.gAt === c.groups.length - 1 ? 'disabled' : ''}>+</button>
        </div></div>
      ${toggle('poster-design', 'Design', [{ value: 'new', label: 'New design', on: c.design === 'new' }, { value: 'old', label: 'Old design', on: c.design === 'old' }])}
      ${c.asara ? `<div class="special-asara-options">${switchHtml('poster-asara-option', 'Asara B’Teves schedule', [
        { value: 'full', label: 'Regular schedule', on: c.selected === 'asarabteves' },
        { value: 'shacharis', label: 'Shacharis only', on: c.selected === 'asarashacharis' },
        { value: 'locations', label: 'Shacharis locations + Mincha/Maariv', on: c.selected === 'asaralocations' },
      ])}</div>` : c.choices.length > 1 || c.group?.name === 'ראש חודש' ? `<div class="poster-year" role="group" aria-labelledby="poster-page-label"><div class="special-field-heading"><span class="poster-year-label" id="poster-page-label">${c.group?.name === 'ראש חודש' ? 'Month' : 'Page'}</span>
        <button type="button" id="poster-page-now" class="special-field-reset" aria-label="Current ${c.group?.name === 'ראש חודש' ? 'month' : 'page'}" ${!c.pageCurrent || !c.allMonths && c.pageCurrent === c.selected ? 'disabled' : ''}>Current</button></div>
        <div class="poster-year-step">
          <select id="poster-pick" aria-labelledby="poster-page-label">${c.group?.name === 'ראש חודש' ? `<option value="all:roshchodesh" ${c.allMonths ? 'selected' : ''} ${c.choices.some(entry => entry.value && entry.poster?.dated) ? '' : 'disabled'}>All Rosh Chodesh</option>` : ''}${c.choices.map(entry => `<option value="${escAttr(entry.key)}" ${!c.allMonths && entry.key === c.selected ? 'selected' : ''} ${entry.value ? '' : 'disabled'}>${escAttr(entry.label)}</option>`).join('')}</select>
          <button type="button" id="poster-page-back" aria-label="Previous page" ${c.pAt <= 0 ? 'disabled' : ''}>&minus;</button>
          <button type="button" id="poster-page-next" aria-label="Next page" ${c.pAt >= c.pCount - 1 ? 'disabled' : ''}>+</button>
        </div></div>` : ''}
      ${c.unavailable?.length ? `<p class="hint">No schedule is available yet for ${c.unavailable.map(name => `<bdi dir="auto">${escAttr(name)}</bdi>`).join(', ')}.</p>` : ''}
      ${c.conflict ? `<label>Chart to use<select id="poster-conflict">${c.conflict.map((chart, index) => `<option value="${index}" ${index === c.conflictPick ? 'selected' : ''}>${escAttr(c.chartLabel(chart.sheet))}</option>`).join('')}</select></label>` : ''}
      ${c.canPad || c.canTurn ? `<details class="special-print-settings" ${c.advanced ? 'open' : ''}><summary>Print settings</summary><div>
        ${c.canPad ? `<div class="poster-year" role="group" aria-labelledby="poster-margin-label"><div class="special-field-heading"><span id="poster-margin-label">Margin</span>
          <button type="button" id="poster-margin-reset" class="special-field-reset" aria-label="Original margin" ${Math.abs(c.margin - c.padOriginal) < 1e-9 ? 'disabled' : ''}>Original</button></div><div class="poster-year-step">
          <select id="poster-margin" aria-labelledby="poster-margin-label">${c.padSteps.map(v => `<option value="${v}" ${Math.abs(v - c.margin) < 1e-9 ? 'selected' : ''}>${c.padLabel(v)}</option>`).join('')}</select>
          <button type="button" id="poster-margin-back" aria-label="Narrower margin" ${c.margin <= c.padMin ? 'disabled' : ''}>&minus;</button>
          <button type="button" id="poster-margin-next" aria-label="Wider margin" ${c.margin >= c.padMax ? 'disabled' : ''}>+</button>
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
