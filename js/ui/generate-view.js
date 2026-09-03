import { computeSeasonWeeks, computeWeekdayWeeks, splitChorefAtSpringCutover, defaultSeasonAndYear, nextAvailableYearFor } from '../sheets/weeks.js';
import { resolveSettings } from '../settings.js';
import { validatePageSizes, defaultPageSizes, alignPageSizesTo } from '../pagination.js';
import { newId } from '../storage.js';
import { escText } from '../util.js';

export function renderGenerate(container, state, tables, onGenerate, onOpenTab) {
  const settings = resolveSettings(state.settings);
  const { season: defaultSeason, hebrewYear: defaultYear } = defaultSeasonAndYear(settings);
  // Generate is where the app opens, so it's where someone who has never seen it lands.
  // The pointer shows only until there's a saved sheet - by then they've done it once.
  const firstRun = !state.sheets.length;
  // Held to a column rather than the full width of a desktop screen: this is a short
  // form of small controls, and stretched across a wide monitor it read as a mostly
  // empty page with a stray year field marooned on the right.
  container.innerHTML = `
    <div class="gen-column">
    <h2>Generate a sheet</h2>
    <p class="hint">Pick the season and year, then choose how the weeks split across printable pages.</p>
    ${firstRun ? '<p class="guide-nudge">First time here? <button type="button" id="open-guide" class="linkish">Read the guide</button>. What this site does, and how to print a board.</p>' : ''}
    ${stepsBar(1)}
    <div id="step-one"></div>
    <form id="gen-form" class="form-grid">
      <fieldset>
        <legend>Season</legend>
        <div class="season-picker">
          <input type="radio" id="season-kayitz" class="season-radio" name="season" value="kayitz" ${defaultSeason === 'kayitz' ? 'checked' : ''}>
          <label class="season-option" for="season-kayitz">
            ${SEASON_ICON.kayitz}
            <span class="season-text">
              <span class="season-name">שבת קיץ</span>
              <span class="season-range">Pesach → Sukkos</span>
            </span>
          </label>
          <input type="radio" id="season-choref" class="season-radio" name="season" value="choref" ${defaultSeason === 'choref' ? 'checked' : ''}>
          <label class="season-option" for="season-choref">
            ${SEASON_ICON.choref}
            <span class="season-text">
              <span class="season-name">שבת חורף</span>
              <span class="season-range">Sukkos → Pesach</span>
            </span>
          </label>
        </div>
        <label class="year-row" for="step-hebrewYear"><span class="year-label">Hebrew Year</span>${stepper('hebrewYear', defaultYear)}<span></span></label>
        <div class="actions"><button type="submit" class="btn-primary">Continue <span aria-hidden="true">→</span></button></div>
      </fieldset>
    </form>
    <div id="gen-preview"></div>
    </div>
  `;
  wireSteppers(container);
  container.querySelector('#open-guide')?.addEventListener('click', () => onOpenTab('guide'));

  // Which season card reads as selected. The CSS also has a :checked + label rule, but
  // it was observed not re-evaluating when the checked state changed - leaving the
  // highlight on the previously chosen card - so the class is set explicitly here and
  // is what the styling actually keys off.
  const syncSeasonCards = () => {
    container.querySelectorAll('.season-radio').forEach((radio) => {
      container.querySelector(`label[for="${radio.id}"]`).classList.toggle('is-selected', radio.checked);
    });
  };
  syncSeasonCards();

  // Switching season re-defaults the year to the soonest occurrence of *that* season
  // that hasn't already fully elapsed - e.g. picking חורף after its date range for the
  // current cycle already passed jumps straight to next year's, never a past one.
  //
  // Only while the year is still the app's own default, though. Setting a year and then
  // picking a season is a perfectly normal order to work in, and it used to throw the
  // year away: an answer you gave being overwritten by one you didn't.
  const yearInput = container.querySelector('input[name=hebrewYear]');
  let yearChosenByUser = false;
  yearInput.addEventListener('change', () => (yearChosenByUser = true));
  yearInput.addEventListener('input', () => (yearChosenByUser = true));
  container.querySelectorAll('input[name=season]').forEach((radio) => {
    radio.addEventListener('change', () => {
      syncSeasonCards();
      if (!radio.checked || yearChosenByUser) return;
      yearInput.value = nextAvailableYearFor(radio.value, settings);
    });
  });

  container.querySelector('#gen-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const season = fd.get('season');
    const hebrewYear = Number(fd.get('hebrewYear'));
    const { weeks } = computeSeasonWeeks(season, hebrewYear, settings, tables);

    // Step one folds into a one-line summary once it's answered, so step two isn't
    // competing with a form you've already finished - the page used to just keep
    // growing downward with everything still on screen at once.
    container.querySelector('#gen-form').hidden = true;
    container.querySelector('#step-one').innerHTML = `
      <div class="step-summary">
        <span dir="ltr"><bdi><strong>${seasonLabel(season)}</strong></bdi> · ${hebrewYear} · ${weeks.length} weeks</span>
        <button type="button" id="change-sheet">Change</button>
      </div>`;
    container.querySelector('#gen-steps').outerHTML = stepsBar(2);
    container.querySelector('#change-sheet').addEventListener('click', () => renderGenerate(container, state, tables, onGenerate));

    // No scrolling into view: collapsing step one keeps step two roughly where step one
    // was, and scrolling to it pushed the step indicator off the top of the screen.
    renderPreview(container.querySelector('#gen-preview'), season, hebrewYear, weeks, settings, state, tables, onGenerate);
  });
}

const seasonLabel = (season) => (season === 'kayitz' ? 'שבת קיץ' : 'שבת חורף');

// Sun and snowflake, so the two cards are told apart at a glance rather than by reading.
// Inline SVG in currentColor's place with their own colours, for the same reason the nav
// icons are inline: the offline copy stays one self-contained folder.
const SEASON_ICON = {
  kayitz: `<svg class="season-icon is-summer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>`,
  // One arm (the spine plus a V at each end) drawn three times, rotated 60 degrees apart,
  // which is what makes it come out as an even six-pointed flake. Built by hand the first
  // time and it showed: the barbs were at different angles on every arm.
  choref: `<svg class="season-icon is-winter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g><path d="M12 2.8v18.4M9.7 5.3 12 3l2.3 2.3M9.7 18.7 12 21l2.3-2.3"/></g>
    <g transform="rotate(60 12 12)"><path d="M12 2.8v18.4M9.7 5.3 12 3l2.3 2.3M9.7 18.7 12 21l2.3-2.3"/></g>
    <g transform="rotate(120 12 12)"><path d="M12 2.8v18.4M9.7 5.3 12 3l2.3 2.3M9.7 18.7 12 21l2.3-2.3"/></g></svg>`,
};

/** Two-step progress header, so it's clear up front that this is a short sequence and
 *  which part you're on - previously the second half simply appeared below the first
 *  with nothing marking it as a separate step. */
function stepsBar(current) {
  const step = (n, label) => {
    const state = n === current ? 'is-current' : n < current ? 'is-done' : '';
    return `<li class="${state}"><span class="step-num">${n < current ? '✓' : n}</span>${label}</li>`;
  };
  return `<ol class="steps" id="gen-steps">${step(1, 'Sheet setup')}${step(2, 'Pages')}</ol>`;
}

function renderPreview(el, season, hebrewYear, weeks, settings, state, tables, onGenerate) {
  if (weeks.length === 0) {
    el.innerHTML = `<p class="hint">No qualifying Shabbosim found for that range. Double check the Hebrew year.</p>`;
    return;
  }

  // A שבת חורף season that reaches the spring DST cutover (2nd Sunday of March) needs
  // its tail weeks to be an actual שבת קיץ chart, not just plain חורף - the shul really
  // is on the summer schedule from the clock change through Pesach. You choose the page
  // split yourself below (covering all the weeks, as usual); at render time, any page
  // that ends up containing at least one of these weeks prints as a real קיץ chart -
  // the other, earlier weeks on that same page just show blank Plag columns.
  const springSplitIndex = season === 'choref' ? splitChorefAtSpringCutover(weeks, settings) : weeks.length;
  const kayitzWeekCount = weeks.length - springSplitIndex;

  // The Weekday chart's own week list can include weeks the Shabbos list skips (a Yom
  // Tov Shabbos whose week still has a regular weekday), so it's computed and paginated
  // completely separately - see the "Also generate a Weekday chart" section below.
  const weekdayWeeks = computeWeekdayWeeks(season, hebrewYear, settings, tables).weeks;

  el.innerHTML = `
    <details class="panel">
      <summary>Show all ${weeks.length} weeks (${fmtDate(weeks[0].date)} – ${fmtDate(weeks[weeks.length - 1].date)})</summary>
      <ol class="week-list">${weeks.map((w, i) => `${i === springSplitIndex ? '<li class="week-marker"><strong>Spring DST cutover: any page from here on prints as שבת קיץ</strong></li>' : ''}<li>${w.date.toISOString().slice(0, 10)}: ${escText(w.parsha)}${w.specialParsha ? ' (' + escText(w.specialParsha) + ')' : ''}</li>`).join('')}</ol>
    </details>
    ${
      kayitzWeekCount > 0
        ? `<p class="hint"><strong>${kayitzWeekCount} of these ${weeks.length} weeks</strong> (from ${fmtDate(weeks[springSplitIndex].date)} onward) are past the spring DST cutover and need the שבת קיץ layout. Keep that in mind when you split into pages below: whichever page ends up holding the first of them will print as a full שבת קיץ chart.</p>`
        : ''
    }
    <form id="page-form" class="form-grid">
      <fieldset>
        <legend>How many printable pages?</legend>
        <label for="step-numPages" style="max-width:160px">Number of pages${stepper('numPages', 3, { min: 1, max: 8 })}</label>
      </fieldset>
      <fieldset>
        <legend>Weeks per page (must add up to ${weeks.length})</legend>
        <div id="page-size-inputs"></div>
        <div class="alloc" id="alloc">
          <div class="alloc-bar" id="alloc-bar"></div>
          <p class="alloc-msg" id="alloc-msg"></p>
        </div>
        <div id="page-error" class="error"></div>
      </fieldset>
      <fieldset>
        <legend>Weekday chart</legend>
        <label><input type="checkbox" id="include-weekday" checked> Also generate a Weekday chart (separate file) for these weeks</label>
        <p class="hint">Covers ${weekdayWeeks.length} weeks, a little more than the ${weeks.length} above when a Yom Tov Shabbos week still has a regular weekday in it. It uses the same weeks and the same page breaks as the sheet above, so page 1 of each covers the same stretch of the year.</p>
        <details class="panel">
          <summary>Show the ${weekdayWeeks.length} weekday weeks</summary>
          <ol class="week-list">${weekdayWeeks.map((w) => `<li>${w.date.toISOString().slice(0, 10)}: ${escText(w.parsha)}</li>`).join('')}</ol>
        </details>
      </fieldset>
      <div class="actions"><button type="submit" class="btn-primary">Generate sheet</button></div>
    </form>
  `;

  const inputsEl = el.querySelector('#page-size-inputs');
  const numPagesInput = el.querySelector('input[name=numPages]');
  function renderSizeInputs(numPages) {
    const defaults = defaultPageSizes(weeks.length, numPages);
    inputsEl.innerHTML = defaults.map((size, i) => `<label for="step-pageSize${i}">Page ${i + 1} weeks${stepper(`pageSize${i}`, size, { min: 0, className: 'page-size' })}</label>`).join('');
    wireSteppers(inputsEl);
  }
  // Live picture of the split: one block per page, sized to its share, plus what's left
  // over or overflowing. The numbers alone made you add them up in your head to find out
  // whether you were three weeks short.
  const barEl = el.querySelector('#alloc-bar');
  const msgEl = el.querySelector('#alloc-msg');
  function renderAlloc() {
    const sizes = [...el.querySelectorAll('.page-size')].map((i) => Number(i.value) || 0);
    const placed = sizes.reduce((a, b) => a + b, 0);
    const total = weeks.length;
    const short = Math.max(0, total - placed);
    const over = Math.max(0, placed - total);
    // Widths are shares of the wider of the two, so going over pushes the pages along
    // instead of the overflow appearing out of nowhere.
    const scale = Math.max(total, placed) || 1;
    const pct = (n) => (n / scale) * 100;
    barEl.innerHTML = [
      ...sizes.map((n, i) => `<span class="alloc-seg" style="width:${pct(n)}%" title="Page ${i + 1}: ${n} week${n === 1 ? '' : 's'}">${n || ''}</span>`),
      short ? `<span class="alloc-seg is-short" style="width:${pct(short)}%" title="${short} not on any page yet">${short}</span>` : '',
      over ? `<span class="alloc-seg is-over" style="width:${pct(over)}%" title="${over} more than there are weeks">+${over}</span>` : '',
    ].join('');
    msgEl.classList.toggle('is-bad', placed !== total);
    msgEl.textContent = short
      ? `${placed} of ${total} weeks placed, ${short} still to go.`
      : over
        ? `${placed} placed, ${over} more than the ${total} weeks there are.`
        : `All ${total} weeks placed.`;
  }

  renderSizeInputs(3);
  renderAlloc();
  numPagesInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Number(numPagesInput.value) || 1));
    numPagesInput.value = n;
    renderSizeInputs(n);
    renderAlloc();
  });
  // 'change' covers the stepper buttons (they dispatch it) and 'input' catches typing as
  // it happens, so the bar never lags behind the numbers.
  inputsEl.addEventListener('change', renderAlloc);
  inputsEl.addEventListener('input', renderAlloc);

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
    const shabbosSheetId = newId('sheet');

    if (includeWeekday) {
      onGenerate({
        id: newId('sheet'),
        season: 'weekday',
        hebrewYear,
        linkedSeason: season, // which Shabbos season this was generated alongside
        linkedSheetId: shabbosSheetId, // the exact sheet below, for the "View שבת sheet" link
        createdAt: new Date().toISOString(),
        weeks: weekdayWeeks.map((w) => ({ serial: w.serial, date: w.date.toISOString(), parsha: w.parsha, specialParsha: w.specialParsha })),
        // Page breaks fall on the same dates as the Shabbos sheet's, rather than being
        // chosen separately - see alignPageSizesTo().
        pageSizes: alignPageSizesTo(weeks, sizes, weekdayWeeks),
        overrides: {},
        style: { ...state.settings.sheetStyle },
      });
    }
    onGenerate({
      id: shabbosSheetId,
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
  // The input carries an id and every wrapping <label> points at it with for= - without
  // that, a label associates with its *first* form control, which here is the − button,
  // and Chrome then mirrors the label's hover/pressed state onto it: pressing + lit −
  // up as well, and clicking the label's text acted like pressing −.
  return `
    <span class="stepper">
      <button type="button" class="step-btn step-down" aria-label="Decrease" tabindex="-1">−</button>
      <input type="number" id="step-${name}" name="${name}" class="step-input ${className}" value="${value}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}>
      <button type="button" class="step-btn step-up" aria-label="Increase" tabindex="-1">+</button>
    </span>`;
}

/** Wires every .stepper's −/+ buttons found within `root` to nudge their input by 1
 *  (clamped to its own min/max, if set) and fire a real 'change' event, so any existing
 *  listener on the input (e.g. the "Number of pages" handler above) reacts exactly as
 *  if the number had been typed in directly. */
function wireSteppers(root) {
  root.querySelectorAll('.stepper').forEach((wrap) => {
    // Guard against double-wiring: the page-size steppers sit inside the preview, so
    // they were reached both by their own renderSizeInputs() call and by the later
    // wireSteppers(el) over the whole preview - two listeners, and every click moved
    // the number by 2.
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
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

// dateFromSerial (zmanim/solar.js) returns a UTC-midnight Date; formatting it with
// .toDateString() would run it through the *local* timezone instead, which for any
// timezone behind UTC (e.g. US Eastern) rolls the displayed calendar day back by one.
// This keeps the "weeks found" summary matching the actual dates in the list below.
function fmtDate(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

