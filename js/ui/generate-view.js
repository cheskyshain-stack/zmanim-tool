import { computeSeasonWeeks, splitChorefAtSpringCutover } from '../sheets/weeks.js';
import { resolveSettings } from '../settings.js';
import { validatePageSizes, defaultPageSizes } from '../pagination.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { excelSerial } from '../zmanim/solar.js';
import { newId } from '../storage.js';

export function renderGenerate(container, state, tables, onGenerate) {
  const todayHebrewYear = hebrewDateExtended(excelSerial(new Date())).year;
  container.innerHTML = `
    <h2>Generate a sheet</h2>
    <form id="gen-form" class="form-grid">
      <fieldset>
        <legend>Which sheet</legend>
        <label><input type="radio" name="season" value="kayitz" checked> שבת קיץ (Pesach → Sukkos)</label>
        <label><input type="radio" name="season" value="choref"> שבת חורף (Sukkos → Pesach)</label>
        <label>Hebrew year<input type="number" name="hebrewYear" value="${todayHebrewYear}"></label>
        <div class="actions"><button type="submit">Compute weeks</button></div>
      </fieldset>
    </form>
    <div id="gen-preview"></div>
  `;

  container.querySelector('#gen-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const season = fd.get('season');
    const hebrewYear = Number(fd.get('hebrewYear'));
    const settings = resolveSettings(state.settings);
    const { weeks } = computeSeasonWeeks(season, hebrewYear, settings, tables);
    renderPreview(container.querySelector('#gen-preview'), season, hebrewYear, weeks, settings, state, onGenerate);
  });
}

function renderPreview(el, season, hebrewYear, weeks, settings, state, onGenerate) {
  if (weeks.length === 0) {
    el.innerHTML = `<p class="hint">No qualifying Shabbosim found for that range — double check the Hebrew year.</p>`;
    return;
  }

  // A שבת חורף season that reaches the spring DST cutover (2nd Sunday of March) needs
  // its tail end as an actual שבת קיץ chart, not just a couple of extra columns — the
  // shul davens on the summer schedule from the clock change through Pesach. That
  // trailing stretch becomes one automatic extra page; the page-count/page-size
  // controls below only cover the "core winter" weeks before it.
  const springSplitIndex = season === 'choref' ? splitChorefAtSpringCutover(weeks, settings) : weeks.length;
  const coreWeeks = weeks.slice(0, springSplitIndex);
  const springWeeks = weeks.slice(springSplitIndex);

  el.innerHTML = `
    <p><strong>${weeks.length} weeks</strong> found (${weeks[0].date.toDateString()} – ${weeks[weeks.length - 1].date.toDateString()}).</p>
    <ol class="week-list">${weeks.map((w, i) => `<li>${i === springSplitIndex ? '<strong>— spring DST cutover: rest becomes a שבת קיץ page —</strong></li><li>' : ''}${w.date.toISOString().slice(0, 10)} — ${esc(w.parsha)}${w.specialParsha ? ' (' + esc(w.specialParsha) + ')' : ''}</li>`).join('')}</ol>
    ${
      springWeeks.length
        ? `<p class="hint"><strong>${springWeeks.length} week${springWeeks.length === 1 ? '' : 's'}</strong> from ${springWeeks[0].date.toDateString()} onward are past the spring DST cutover and will automatically print as one extra page using the שבת קיץ chart layout — they're not part of the "weeks per page" split below, which only covers the ${coreWeeks.length} core-winter weeks.</p>`
        : ''
    }
    <form id="page-form" class="form-grid">
      <fieldset>
        <legend>How many printable pages?${springWeeks.length ? ' (for the core-winter weeks — the שבת קיץ page is automatic and separate)' : ''}</legend>
        <label style="max-width:120px">Number of pages<input type="number" id="num-pages" min="1" max="8" value="3"></label>
      </fieldset>
      <fieldset>
        <legend>Weeks per page (must add up to ${coreWeeks.length})</legend>
        <div id="page-size-inputs"></div>
        <div id="page-error" class="error"></div>
        <div class="actions"><button type="submit">Generate sheet</button></div>
      </fieldset>
    </form>
  `;

  const inputsEl = el.querySelector('#page-size-inputs');
  const numPagesInput = el.querySelector('#num-pages');

  function renderSizeInputs(numPages) {
    const defaults = defaultPageSizes(coreWeeks.length, numPages);
    inputsEl.innerHTML = defaults.map((size, i) => `<label>Page ${i + 1} weeks<input type="number" class="page-size" min="0" value="${size}"></label>`).join('');
  }
  renderSizeInputs(3);

  numPagesInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Number(numPagesInput.value) || 1));
    numPagesInput.value = n;
    renderSizeInputs(n);
  });

  el.querySelector('#page-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const sizes = [...el.querySelectorAll('.page-size')].map((input) => Number(input.value));
    const err = validatePageSizes(coreWeeks.length, sizes);
    const errEl = el.querySelector('#page-error');
    if (err) {
      errEl.textContent = err;
      return;
    }
    errEl.textContent = '';
    const sheet = {
      id: newId('sheet'),
      season,
      hebrewYear,
      createdAt: new Date().toISOString(),
      weeks: weeks.map((w) => ({ serial: w.serial, date: w.date.toISOString(), parsha: w.parsha, specialParsha: w.specialParsha })),
      pageSizes: sizes, // covers weeks[0..springSplitIndex) only; see sheet-view.js
      springSplitIndex, // weeks.length when there's no automatic trailing קיץ page
      overrides: {},
      style: { ...state.settings.sheetStyle }, // remembers whatever style was last used
    };
    onGenerate(sheet);
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
