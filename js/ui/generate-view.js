import { computeSeasonWeeks, computeWeekdayWeeks, splitChorefAtSpringCutover, defaultSeasonAndYear, nextAvailableYearFor } from '../sheets/weeks.js';
import { resolveSettings } from '../settings.js';
import { validatePageSizes, defaultPageSizes } from '../pagination.js';
import { newId } from '../storage.js';

export function renderGenerate(container, state, tables, onGenerate) {
  const settings = resolveSettings(state.settings);
  const { season: defaultSeason, hebrewYear: defaultYear } = defaultSeasonAndYear(settings);
  container.innerHTML = `
    <h2>Generate a sheet</h2>
    <form id="gen-form" class="form-grid">
      <fieldset>
        <legend>Which sheet</legend>
        <label><input type="radio" name="season" value="kayitz" ${defaultSeason === 'kayitz' ? 'checked' : ''}> שבת קיץ (Pesach → Sukkos)</label>
        <label><input type="radio" name="season" value="choref" ${defaultSeason === 'choref' ? 'checked' : ''}> שבת חורף (Sukkos → Pesach)</label>
        <label>Hebrew year${stepper('hebrewYear', defaultYear)}</label>
        <div class="actions"><button type="submit">Compute weeks</button></div>
      </fieldset>
    </form>
    <div id="gen-preview"></div>
  `;
  wireSteppers(container);

  // Switching season re-defaults the year to the soonest occurrence of *that* season
  // that hasn't already fully elapsed — e.g. picking חורף after its date range for the
  // current cycle already passed jumps straight to next year's, never a past one.
  container.querySelectorAll('input[name=season]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const yearInput = container.querySelector('input[name=hebrewYear]');
      yearInput.value = nextAvailableYearFor(radio.value, settings);
    });
  });

  container.querySelector('#gen-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const season = fd.get('season');
    const hebrewYear = Number(fd.get('hebrewYear'));
    const { weeks } = computeSeasonWeeks(season, hebrewYear, settings, tables);
    renderPreview(container.querySelector('#gen-preview'), season, hebrewYear, weeks, settings, state, tables, onGenerate);
  });
}

function renderPreview(el, season, hebrewYear, weeks, settings, state, tables, onGenerate) {
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

  // The Weekday chart's own week list can include weeks the Shabbos list skips (a Yom
  // Tov Shabbos whose week still has a regular weekday), so it's computed and paginated
  // completely separately — see the "Also generate a Weekday chart" section below.
  const weekdayWeeks = computeWeekdayWeeks(season, hebrewYear, settings, tables).weeks;

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
        <label style="max-width:160px">Number of pages${stepper('numPages', 3, { min: 1, max: 8 })}</label>
      </fieldset>
      <fieldset>
        <legend>Weeks per page (must add up to ${weeks.length})</legend>
        <div id="page-size-inputs"></div>
        <div id="page-error" class="error"></div>
      </fieldset>
      <fieldset>
        <legend>Weekday chart</legend>
        <label><input type="checkbox" id="include-weekday"> Also generate a Weekday chart (separate file) for these weeks</label>
        <p class="hint">Covers ${weekdayWeeks.length} weeks — a little more than the ${weeks.length} above when a Yom Tov Shabbos week still has a regular weekday in it.</p>
        <div id="weekday-page-section" hidden>
          <label style="max-width:160px">Number of pages${stepper('wdNumPages', 3, { min: 1, max: 8 })}</label>
          <div id="weekday-page-size-inputs"></div>
          <div id="weekday-page-error" class="error"></div>
        </div>
      </fieldset>
      <div class="actions"><button type="submit">Generate sheet</button></div>
    </form>
  `;

  const inputsEl = el.querySelector('#page-size-inputs');
  const numPagesInput = el.querySelector('input[name=numPages]');
  function renderSizeInputs(numPages) {
    const defaults = defaultPageSizes(weeks.length, numPages);
    inputsEl.innerHTML = defaults.map((size, i) => `<label>Page ${i + 1} weeks${stepper(`pageSize${i}`, size, { min: 0, className: 'page-size' })}</label>`).join('');
    wireSteppers(inputsEl);
  }
  renderSizeInputs(3);
  numPagesInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Number(numPagesInput.value) || 1));
    numPagesInput.value = n;
    renderSizeInputs(n);
  });

  const weekdaySection = el.querySelector('#weekday-page-section');
  const wdInputsEl = el.querySelector('#weekday-page-size-inputs');
  const wdNumPagesInput = el.querySelector('input[name=wdNumPages]');
  function renderWeekdaySizeInputs(numPages) {
    const defaults = defaultPageSizes(weekdayWeeks.length, numPages);
    wdInputsEl.innerHTML = defaults.map((size, i) => `<label>Page ${i + 1} weeks${stepper(`wdPageSize${i}`, size, { min: 0, className: 'wd-page-size' })}</label>`).join('');
    wireSteppers(wdInputsEl);
  }
  renderWeekdaySizeInputs(3);
  wdNumPagesInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Number(wdNumPagesInput.value) || 1));
    wdNumPagesInput.value = n;
    renderWeekdaySizeInputs(n);
  });
  el.querySelector('#include-weekday').addEventListener('change', (e) => {
    weekdaySection.hidden = !e.target.checked;
  });

  wireSteppers(el);

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

    const includeWeekday = el.querySelector('#include-weekday').checked;
    let weekdaySizes = null;
    if (includeWeekday) {
      weekdaySizes = [...el.querySelectorAll('.wd-page-size')].map((input) => Number(input.value));
      const wdErr = validatePageSizes(weekdayWeeks.length, weekdaySizes);
      const wdErrEl = el.querySelector('#weekday-page-error');
      if (wdErr) {
        wdErrEl.textContent = wdErr;
        return;
      }
      wdErrEl.textContent = '';
    }

    if (includeWeekday) {
      onGenerate({
        id: newId('sheet'),
        season: 'weekday',
        hebrewYear,
        linkedSeason: season, // which Shabbos season this was generated alongside, for context only
        createdAt: new Date().toISOString(),
        weeks: weekdayWeeks.map((w) => ({ serial: w.serial, date: w.date.toISOString(), parsha: w.parsha, specialParsha: w.specialParsha })),
        pageSizes: weekdaySizes,
        overrides: {},
        style: { ...state.settings.sheetStyle },
      });
    }
    onGenerate({
      id: newId('sheet'),
      season,
      hebrewYear,
      createdAt: new Date().toISOString(),
      weeks: weeks.map((w) => ({ serial: w.serial, date: w.date.toISOString(), parsha: w.parsha, specialParsha: w.specialParsha })),
      pageSizes: sizes,
      overrides: {},
      style: { ...state.settings.sheetStyle }, // remembers whatever style was last used
    });
  });
}

/** A number input paired with clear − / + buttons instead of relying on the browser's
 *  tiny native spinner (or worse, the scroll wheel). `opts.className` lets callers
 *  (e.g. the per-page week-count fields) still find the underlying input the same way
 *  a plain <input class="page-size"> would have been found before. */
function stepper(name, value, opts = {}) {
  const { min, max, className = '' } = opts;
  return `
    <span class="stepper">
      <button type="button" class="step-btn step-down" aria-label="Decrease" tabindex="-1">−</button>
      <input type="number" name="${name}" class="step-input ${className}" value="${value}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}>
      <button type="button" class="step-btn step-up" aria-label="Increase" tabindex="-1">+</button>
    </span>`;
}

/** Wires every .stepper's −/+ buttons found within `root` to nudge their input by 1
 *  (clamped to its own min/max, if set) and fire a real 'change' event, so any existing
 *  listener on the input (e.g. the "Number of pages" handler above) reacts exactly as
 *  if the number had been typed in directly. */
function wireSteppers(root) {
  root.querySelectorAll('.stepper').forEach((wrap) => {
    const input = wrap.querySelector('.step-input');
    const min = input.min !== '' ? Number(input.min) : -Infinity;
    const max = input.max !== '' ? Number(input.max) : Infinity;
    const nudge = (delta) => {
      input.value = Math.min(max, Math.max(min, (Number(input.value) || 0) + delta));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    wrap.querySelector('.step-down').addEventListener('click', () => nudge(-1));
    wrap.querySelector('.step-up').addEventListener('click', () => nudge(1));
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
