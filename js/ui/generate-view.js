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
  // its tail weeks to be an actual שבת קיץ chart, not just plain חורף — the shul really
  // is on the summer schedule from the clock change through Pesach. You choose the page
  // split yourself below (covering all the weeks, as usual); at render time, any page
  // that ends up containing at least one of these weeks prints as a real קיץ chart —
  // the other, earlier weeks on that same page just show blank Plag columns.
  const springSplitIndex = season === 'choref' ? splitChorefAtSpringCutover(weeks, settings) : weeks.length;
  const kayitzWeekCount = weeks.length - springSplitIndex;

  el.innerHTML = `
    <p><strong>${weeks.length} weeks</strong> found (${weeks[0].date.toDateString()} – ${weeks[weeks.length - 1].date.toDateString()}).</p>
    <ol class="week-list">${weeks.map((w, i) => `${i === springSplitIndex ? '<li><strong>— spring DST cutover: any page from here on prints as שבת קיץ —</strong></li>' : ''}<li>${w.date.toISOString().slice(0, 10)} — ${esc(w.parsha)}${w.specialParsha ? ' (' + esc(w.specialParsha) + ')' : ''}</li>`).join('')}</ol>
    ${
      kayitzWeekCount > 0
        ? `<p class="hint"><strong>${kayitzWeekCount} of these ${weeks.length} weeks</strong> (from ${weeks[springSplitIndex].date.toDateString()} onward) are past the spring DST cutover and need the שבת קיץ layout — keep that in mind when you split into pages below: whichever page ends up holding the first of them will print as a full שבת קיץ chart.</p>`
        : ''
    }
    <form id="page-form" class="form-grid">
      <fieldset>
        <legend>How many printable pages?</legend>
        <label style="max-width:120px">Number of pages<input type="number" id="num-pages" min="1" max="8" value="3"></label>
      </fieldset>
      <fieldset>
        <legend>Weeks per page (must add up to ${weeks.length})</legend>
        <div id="page-size-inputs"></div>
        <div id="page-error" class="error"></div>
        <div class="actions"><button type="submit">Generate sheet</button></div>
      </fieldset>
    </form>
  `;

  const inputsEl = el.querySelector('#page-size-inputs');
  const numPagesInput = el.querySelector('#num-pages');

  function renderSizeInputs(numPages) {
    const defaults = defaultPageSizes(weeks.length, numPages);
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
    const err = validatePageSizes(weeks.length, sizes);
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
      pageSizes: sizes,
      overrides: {},
      style: { ...state.settings.sheetStyle }, // remembers whatever style was last used
    };
    onGenerate(sheet);
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
