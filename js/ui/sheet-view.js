import { safeHeaderImage } from '../security.js';
import {
  resolveSettings, specialShacharisHeading, DEFAULT_ACCENT_COLOR,
  WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL, WEEKDAY_FOOTER_NOTE,
} from '../settings.js';
import { hebrewDateExtended, weekOfLabel, specialShacharisKinds, hasRoshChodesh, shabbosMevarchimMonth, moladFor, moladLabel, excelWeekday } from '../hebrew-calendar.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { buildWeekdayRow, WEEKDAY_COLUMNS, chanukahDaysInWeek, chanukahDaysThroughFriday } from '../sheets/weekday.js';
import { chanukahShabbosLabel, chanukahPanelBlocks } from '../posters/chanukah.js';
import { inSpringDstWindow } from '../sheets/common.js';
import { hebrewLang, escText, escAttr } from '../util.js';
import { splitWeeksIntoPages } from '../pagination.js';
import { applyRules } from '../rules.js';
import { mergeRow, setOverride, clearOverride, getOverride } from '../overrides.js';
import { announcedWeekCell } from '../announced.js';
import { shacharisGridHtml } from './shacharis-grid.js';
import {
  UL_START, UL_END, NEW_TAG_START, NEW_TAG_MID, NEW_TAG_END,
  CHANUKAH_TAG_START, CHANUKAH_TAG_MID, CHANUKAH_TAG_END,
  normalizeRichText, markHeaderRoom,
} from '../format.js';
import { applyTimeShorthand } from './rich-text.js';
import { setPrintPage } from './print-page.js';
import { switchHtml, wireSwitch } from './switch.js';

const chartInk = state => state.settings.chartInk ?? state.settings.sheetStyle?.ink ?? 'colour';
const CHART_PAD_MIN = 0.15, CHART_PAD_MAX = 0.75;
const chartPad = (value, fallback) => Number.isFinite(Number(value)) && value != null
  ? Math.max(CHART_PAD_MIN, Math.min(CHART_PAD_MAX, Number(value))) : fallback;
function chartMarginControl(key, label, value, original) {
  const steps = Array.from({ length: 13 }, (_, i) => (15 + i * 5) / 100);
  return `<div class="poster-year"><span class="poster-year-label" id="${key}-label">${label}</span>
    <div class="poster-year-step">
      <button type="button" id="${key}-less" aria-label="Decrease ${label}" ${value <= CHART_PAD_MIN ? 'disabled' : ''}>&minus;</button>
      <select id="${key}" aria-labelledby="${key}-label">${steps.map(v => `<option value="${v}" ${Math.abs(v-value)<0.001?'selected':''}>${v.toFixed(2)}in</option>`).join('')}</select>
      <button type="button" id="${key}-more" aria-label="Increase ${label}" ${value >= CHART_PAD_MAX ? 'disabled' : ''}>+</button>
      <button type="button" id="${key}-original" class="poster-year-reset" ${Math.abs(value-original)<0.001?'disabled':''}>Original</button>
    </div></div>`;
}

/** A fixed, made-up molad - Tuesday afternoon, 23 minutes and 7 chalakim after 4 - shown
 *  beside the Molad format switch so the two sentences can be compared without opening a
 *  מברכים week to see one. Not read from any real month (the spec that asked for this is
 *  explicit: a formatting example, not an actual value), chosen because it exercises both
 *  a nonzero minutes part and a nonzero חלקים part at once, which is the only shape that
 *  shows every moving piece of either sentence in one line. The serial is searched for
 *  rather than hand-picked, so this stays a Tuesday if excelWeekday's own epoch ever moves. */
function moladFormatExample(format) {
  let serial = 2;
  while (excelWeekday(serial) !== 3) serial++;
  return moladLabel({ serial, hours: 16, minutes: 23, chalakim: 7 }, { moladFormat: format, english: false });
}

/** You choose the page split for a שבת חורף sheet yourself (as usual, covering every
 *  week). Whichever page ends up containing at least one week past the spring DST
 *  cutover (2nd Sunday of March - not the fall one near Sukkos) prints as a real שבת
 *  קיץ chart for its *entire* page - same columns, same formulas, same rule-matching
 *  as an actual קיץ sheet - even for any earlier weeks sharing that page, which just
 *  come out with blank Plag columns (same as קיץ's own weeks outside its Plag window).
 *  A Weekday chart has no such split - it's always 'weekday'. */
function pageEffectiveSeason(sheet, pageWeeks, settings) {
  if (sheet.season !== 'choref') return sheet.season;
  return pageWeeks.some((w) => inSpringDstWindow(w.date, settings)) ? 'kayitz' : 'choref';
}
function columnsAndBuilderFor(effectiveSeason) {
  if (effectiveSeason === 'weekday') return { columns: WEEKDAY_COLUMNS, buildRow: buildWeekdayRow };
  return effectiveSeason === 'kayitz' ? { columns: KAYITZ_COLUMNS, buildRow: buildKayitzRow } : { columns: CHOREF_COLUMNS, buildRow: buildChorefRow };
}


/** Which shipped webfont stands in for each choice when the real one isn't installed.
 *
 *  A phone has none of these fonts, so without a stand-in every Hebrew column falls back
 *  to the system sans - and with a single stand-in for all of them, picking Times New
 *  Roman still got you David's Hebrew, which looks nothing like it. Times New Roman and
 *  Frank Ruehl are both traditional high-contrast Hebrew serifs, so one covers the other
 *  closely; David is a lighter semi-serif and only matches itself.
 *
 *  Arial and Segoe UI are deliberately absent: they fall back to the device's own Hebrew
 *  sans (Noto on Android, Segoe on Windows), which is already the right shape - no point
 *  downloading a font to say the same thing. */
const HEBREW_STAND_IN = {
  'Times New Roman': 'Frank Ruhl Libre',
  'Frank Ruehl': 'Frank Ruhl Libre',
  'Guttman Yad': 'Frank Ruhl Libre',
  David: 'David Libre',
  'David Libre': 'David Libre',
};

/** The full CSS stack for a chosen font: the real font first (installed on the machines
 *  these sheets are printed from), then the shipped stand-in, then a generic. */
export function fontStackFor(fontFamily) {
  const standIn = HEBREW_STAND_IN[fontFamily];
  const generic = fontFamily === 'Arial' || fontFamily === 'Segoe UI' ? 'sans-serif' : 'serif';
  return `"${fontFamily}"${standIn ? `, "${standIn}"` : ''}, ${generic}`;
}

// Undo/redo history per sheet, kept in memory only (module-level, keyed by sheet id) -
// intentionally not persisted to localStorage; it lives for as long as the app tab is
// open, same as undo history in most editors.
const histories = new Map();
function getHistory(sheetId) {
  if (!histories.has(sheetId)) histories.set(sheetId, { undo: [], redo: [] });
  return histories.get(sheetId);
}
function applyOverrideValue(sheet, serial, col, value) {
  if (value === undefined) clearOverride(sheet, serial, col);
  else setOverride(sheet, serial, col, value);
}

/** The printed pages of one sheet, built and styled but not yet in the document.
 *
 *  Exported because the congregation's page shows the same chart, and a second renderer
 *  for it would be a second thing to keep in step with the formulas. Pass readOnly for
 *  that use: it is the same markup with the cell editing taken off, rather than a
 *  different rendering path that could quietly diverge.
 *
 *  Row heights still need syncPageHeights() once the pages are in the document, since
 *  nothing can be measured before then. */
export function buildSheetPages(sheet, state, onChange = () => {}, { readOnly = false, showMolad = false } = {}) {
  if (!sheet) return [];
  const settings = resolveSettings(state.settings);
  if (!sheet.style) sheet.style = { ...state.settings.sheetStyle };
  if (!sheet.columnWidths) sheet.columnWidths = {};
  const wks = sheet.weeks.map((w) => ({ ...w, date: new Date(w.date) }));
  const split = splitWeeksIntoPages(wks, sheet.pageSizes).map((pw) => ({ weeks: pw, effectiveSeason: pageEffectiveSeason(sheet, pw, settings) }));
  return split.map(({ weeks: pw, effectiveSeason }, i) => {
    const { columns, buildRow } = columnsAndBuilderFor(effectiveSeason);
    /* A read-only chart is the reading copy, so it quotes what the shul has announced: see
       js/announced.js. The editable one never does. That is the whole reason the flag is
       carried this far rather than the swap being done for everybody: a cell in the admin is
       a box somebody types into, and a swapped time sitting in it would be saved over the
       board's own the moment that week was edited for any other reason.
       showMolad is carried the same explicit way, defaulting closed, for a stricter reason
       than that one: the congregation's own /chart/ page (chart-view.js) calls this with
       readOnly alone and nothing in this parameter's own name to fall back on, and must
       never show it regardless of what state.settings itself holds - settings.showMolad is
       carried whole into data/published.json (buildPublishedPayload, publish.js) for the
       admin's own next session to read back, and that published copy is read by nobody but
       luach.js, not by this file at all, so there is no path by which this chart's own
       congregation reader could pick the setting up even by mistake. Only renderSheet's own
       admin call passes it, read fresh off state.settings.showMolad there. */
    const el = renderPage(pw, i, split.length, columns, buildRow, settings, sheet, state, onChange, effectiveSeason, { announced: readOnly, showMolad });
    el.dataset.sheetLabel = sheetLabel(sheet);
    el.dataset.pageIndex = i;
    applyStyle(el, sheet.style, chartInk(state)); // variables only - row heights need the page in the document
    if (readOnly) el.querySelectorAll('[contenteditable]').forEach((cell) => cell.removeAttribute('contenteditable'));
    return el;
  });
}

/** Makes every row on every page the same height. Must run with the pages in the
 *  document: heights read 0 on a detached element. */
export function syncPageHeights(pagesEl) {
  syncHeaderRowHeight(pagesEl);
}

export function renderSheet(container, state, sheet, onChange) {
  if (!sheet.style) sheet.style = { ...state.settings.sheetStyle };
  if (!sheet.style.accentColor) sheet.style.accentColor = state.settings.sheetStyle.accentColor || DEFAULT_ACCENT_COLOR; // sheets saved before this control existed
  if (!sheet.columnWidths) sheet.columnWidths = {};
  const settings = resolveSettings(state.settings);
  const weeks = sheet.weeks.map((w) => ({ ...w, date: new Date(w.date) }));
  const pages = splitWeeksIntoPages(weeks, sheet.pageSizes).map((pageWeeks) => ({ weeks: pageWeeks, effectiveSeason: pageEffectiveSeason(sheet, pageWeeks, settings) }));
  const anyKayitzPage = pages.some((p) => p.effectiveSeason === 'kayitz');
  const isEnglish = state.settings.language === 'en';

  // The Weekday chart generated alongside this one (or, from the Weekday chart itself,
  // the Shabbos sheet it was generated alongside) - generating both saves both, but only
  // one can be open at a time, so this link is how you actually get to see the other one
  // right after generating instead of having to dig it up from Saved Sheets.
  // linkedSheetId is the exact pairing recorded at generation time; the season+year
  // match after it is the fallback for pairs generated before that was stored.
  const companion =
    sheet.season === 'weekday'
      ? state.sheets.find((s) => s.id === sheet.linkedSheetId) ||
        state.sheets.filter((s) => s.season === sheet.linkedSeason && s.hebrewYear === sheet.hebrewYear).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) ||
        state.sheets
          .filter((s) => s.season === 'weekday' && s.linkedSeason === sheet.season && s.hebrewYear === sheet.hebrewYear)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  // A board is 11in across. See setPrintPage for why the document's one page size is set
  // from the view rather than from a named page in the stylesheet.
  setPrintPage('letter landscape');
  container.innerHTML = `
    <div class="sheet-toolbar no-print">
      <button id="back-btn">&larr; Back</button>
      <button id="print-btn" class="btn-primary" title="Opens the print dialog, where the destination can be a printer or Save as PDF">Print / Save as PDF</button>
    </div>
    <div id="chart-layout-panel" class="panel no-print">
      <div class="panel-body">
        <div class="poster-bar">
          ${chartMarginControl('chart-pad-y', 'Top and bottom padding', chartPad(sheet.style.paddingY, 0.35), 0.35)}
          ${chartMarginControl('chart-pad-x', 'Left and right padding', chartPad(sheet.style.paddingX, 0.5), 0.5)}
          <div class="poster-bar-switch">${switchHtml('chart-ink', 'Ink', [
            { value: 'colour', label: 'Colour', on: chartInk(state) !== 'mono' },
            { value: 'mono', label: 'Black and white', on: chartInk(state) === 'mono' },
          ])}</div>
          <div class="poster-bar-switch">${switchHtml('chart-molad', 'Molad', [
            { value: 'off', label: 'Off', on: !state.settings.showMolad },
            { value: 'on', label: 'On', on: Boolean(state.settings.showMolad) },
          ])}</div>
          <div class="poster-bar-switch">${switchHtml('chart-molad-format', 'Molad format', [
            { value: 'compact', label: 'Compact Hebrew', on: state.settings.moladFormat !== 'yiddish' },
            { value: 'yiddish', label: 'Yiddish', on: state.settings.moladFormat === 'yiddish' },
          ])}</div>
          <p class="hint">Padding applies to this chart. Ink, Molad and Molad format apply to every Shabbos chart page in any view here - Molad prints the molad under the parsha name on a שבת that is שבת מברכים. None of the three ever reaches the congregation's own copy of the chart, printed or online, whatever this is set to.</p>
          <p class="hint" id="molad-format-example">${moladFormatExample(state.settings.moladFormat === 'yiddish' ? 'yiddish' : 'compact')} (a formatting example, not an actual month's molad)</p>
        </div>
      </div>
    </div>
    <div id="page-overflow-warning" class="error no-print" hidden></div>
    <div id="sheet-stack">
      <div id="pages" class="pages"></div>
    </div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => onChange({ back: true }));
  container.querySelector('#print-btn').addEventListener('click', () => window.print());


  // Both charts go into one container, interleaved: שבת page 1, its Weekday page 1,
  // שבת page 2, Weekday page 2… The two are already page-aligned (see alignPageSizesTo),
  // so each pair covers the same weeks - which is the order you want to print in, and
  // also what makes the side-by-side view line up pair-per-row.
  //
  // Style variables are set per *page* rather than per container, because the two sheets
  // carry their own font/size/colour and they now share a parent.
  const pagesEl = container.querySelector('#pages');
  const buildPagesFor = (sh) => buildSheetPages(sh, state, onChange, { showMolad: Boolean(state.settings.showMolad) });
  const shabbosFirst = sheet.season === 'weekday' && companion;
  const primaryPages = buildPagesFor(shabbosFirst ? companion : sheet);
  const companionPages = buildPagesFor(shabbosFirst ? sheet : companion);
  for (let i = 0; i < Math.max(primaryPages.length, companionPages.length); i++) {
    if (primaryPages[i]) pagesEl.appendChild(primaryPages[i]);
    if (companionPages[i]) pagesEl.appendChild(companionPages[i]);
  }

  // Row heights need the pages in the document to be measured.
  syncHeaderRowHeight(pagesEl);
  autoFit(container);

  // A page is supposed to be exactly 817px (11in x 8.5in at 100%, see the layout
  // invariant) - syncHeaderRowHeight shares that out evenly, but it is a CSS minimum, not
  // a cap, and a page whose own content genuinely needs more (most often the Weekday
  // chart's שחרית panel, which has to print every schedule in play - the everyday one,
  // ר"ח/בה"ב/תענית, and חנוכה's own two more on a week that is all three at once - stacked
  // in one card, regardless of how many weeks share the page) renders taller anyway. Paper
  // does not: a page over 11in x 8.5in is not one sheet any more, and the print engine
  // splits it across two, repeating the header and leaving the שחרית panel's own position
  // (calculated for the one tall page, not for wherever the split landed) sitting in the
  // wrong place on whichever physical sheet it ends up on - measured directly, from a real
  // print preview, as the confusing, overlapping-looking extra page this warns about here.
  // Checked after the real pages are built and measured, not predicted, since what a page
  // needs depends on which special weeks land on it together - the one thing nothing short
  // of building it can know in advance. The threshold is 40px over 817px, well past the
  // handful of px the molad note's own documented edge case can add (see its own comment
  // in this file), so that known, accepted case never trips this warning, while a page
  // that needs a second physical sheet always does.
  const overflowWarningEl = container.querySelector('#page-overflow-warning');
  const overflowPages = [...pagesEl.querySelectorAll('.page')]
    .map((el) => ({ el, height: el.getBoundingClientRect().height }))
    .filter(({ height }) => height > 857);
  if (overflowPages.length) {
    const items = overflowPages.map(({ el, height }) =>
      `${el.dataset.sheetLabel}, page ${Number(el.dataset.pageIndex) + 1} (${Math.round(height)}px, ${Math.round(height - 817)}px over one sheet)`);
    overflowWarningEl.textContent = `This chart has more on a page than one sheet of paper holds, which prints as a confusing extra page rather than cleanly: ${items.join('; ')}. Go back to Print Layout and move some weeks to another page.`;
    overflowWarningEl.hidden = false;
  } else {
    overflowWarningEl.textContent = '';
    overflowWarningEl.hidden = true;
  }

  const restyleOwnPages = () => {
    pagesEl.querySelectorAll(`.page[data-sheet-label="${sheetLabel(sheet)}"]`).forEach((el) => applyStyle(el, sheet.style, chartInk(state)));
    syncHeaderRowHeight(pagesEl);
  };

  // Persists sheet.style as the app's "last used" style too, so the next *newly
  // generated* sheet starts from it (see generate-view.js / settings.js sheetStyle).
  const commit = () => {
    state.settings.sheetStyle = { ...sheet.style };
    onChange({ save: true });
  };
  for (const [key, field, original] of [['chart-pad-y', 'paddingY', 0.35], ['chart-pad-x', 'paddingX', 0.5]]) {
    const select = container.querySelector('#' + key);
    const change = value => {
      sheet.style[field] = Math.round(chartPad(value, original) * 100) / 100;
      restyleOwnPages();
      commit();
    };
    select.addEventListener('change', () => change(select.value));
    container.querySelector('#' + key + '-less').addEventListener('click', () => change(Number(select.value) - 0.05));
    container.querySelector('#' + key + '-more').addEventListener('click', () => change(Number(select.value) + 0.05));
    container.querySelector('#' + key + '-original').addEventListener('click', () => change(original));
  }
  wireSwitch(container, 'chart-ink', value => {
    state.settings.chartInk = value === 'mono' ? 'mono' : 'colour';
    restyleOwnPages();
    commit();
  });
  // No restyleOwnPages here: unlike Ink, this changes which lines a row has, not just
  // their colour, so the existing DOM cannot simply be restyled - commit()'s own
  // onChange({save:true}) re-renders the whole view, which rebuilds the rows themselves
  // with the new setting read fresh.
  wireSwitch(container, 'chart-molad', value => {
    state.settings.showMolad = value === 'on';
    commit();
  });
  wireSwitch(container, 'chart-molad-format', value => {
    state.settings.moladFormat = value === 'yiddish' ? 'yiddish' : 'compact';
    commit();
  });

}

const sheetLabel = (sh) => (sh.season === 'kayitz' ? 'שבת קיץ' : sh.season === 'choref' ? 'שבת חורף' : 'Weekday');


// --- Fit to screen -----------------------------------------------------------------
// Module-level, not per-render: the sheet view re-renders on every saved cell edit, and
// the view shouldn't snap back to full size underneath you each time.
let fitOn = false;
let fitChosenByUser = false;
let fitResizeHandler = null;

/** Scales #pages down until its widest row fits across the screen. Uses `zoom` rather
 *  than `transform: scale`, which only paints smaller and leaves the original footprint
 *  behind - the same reason side-by-side uses it. */
function applyFit(container, on) {
  const pagesEl = container.querySelector('#pages');
  if (!pagesEl) return;
  pagesEl.style.zoom = ''; // always measure unscaled
  if (!on) return;
  const avail = pagesEl.clientWidth;
  const content = pagesEl.scrollWidth;
  if (!avail || content <= avail) return;
  pagesEl.style.zoom = Math.max(0.15, avail / content);
}

function setFit(container, on) {
  fitOn = on;
  fitChosenByUser = true;
  const btn = container.querySelector('#fit-btn');
  btn?.classList.toggle('is-active', on);
  applyFit(container, on);
}

/** Turns fitting on by itself the first time a sheet is opened on a screen too narrow to
 *  show a page - otherwise a phone opens onto a wall of one column. Never overrides a
 *  choice already made with the button. */
function autoFit(container) {
  const pagesEl = container.querySelector('#pages');
  const decide = () => {
    if (!fitChosenByUser) {
      pagesEl.style.zoom = ''; // measure unscaled before asking whether it fits
      fitOn = pagesEl.scrollWidth > pagesEl.clientWidth;
      container.querySelector('#fit-btn')?.classList.toggle('is-active', fitOn);
    }
    applyFit(container, fitOn);
  };
  decide();

  // Rotating a phone changes what fits. One listener, replaced each render so it always
  // points at the container currently on screen.
  if (fitResizeHandler) window.removeEventListener('resize', fitResizeHandler);
  fitResizeHandler = () => {
    if (document.body.contains(pagesEl)) decide();
  };
  window.addEventListener('resize', fitResizeHandler);
}

/** Black or white, whichever the header row can actually be read in against the page
 *  colour. White on the dark grey the chart shipped with, black once the colour is light:
 *  without this, picking a light Page color left the header white on near-white and the
 *  column names simply vanished. Rec. 601 luma, which is the usual rule of thumb for
 *  this, with the threshold at the middle of the range. */
function headerInkFor(color) {
  const hex = String(color || '').replace('#', '');
  if (hex.length !== 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#1a1a1a' : '#fff';
}

function applyStyle(target, style, ink = style.ink) {
  target.style.padding = chartPad(style.paddingY, 0.35) + 'in ' + chartPad(style.paddingX, 0.5) + 'in';
  // Filter the chart sections separately so the building picture keeps its colour.
  target.style.filter = '';
  target.querySelectorAll('table, .header-center, .header-rabbi, .page-footer').forEach(el => {
    el.style.filter = ink === 'mono' ? 'grayscale(1)' : '';
  });
  target.style.setProperty('--sheet-font-family', fontStackFor(style.fontFamily));
  target.style.setProperty('--sheet-font-size', style.fontSizePt + 'pt');
  target.style.setProperty('--sheet-header-scale', style.headerScale);
  target.style.setProperty('--sheet-accent', style.accentColor);
  target.style.setProperty('--sheet-head-ink', headerInkFor(style.accentColor));
}

/** Makes every row in a table - header included - exactly the same height.
 *
 *  Left alone, the header always comes out shorter: the table stretches to fill the page
 *  (`.page` is a flex column, `table { flex: 1 }`), and the browser hands out that extra
 *  height in proportion to each row's *natural* content height, which for the header is
 *  a single short line. Simply pinning the header to a measured data-row height doesn't
 *  settle it either - the total is fixed, so growing the header shrinks the data rows it
 *  was just matched against.
 *
 *  So instead of measuring one against the other, this splits the table's total height
 *  evenly across all its rows, which is stable in one pass. The floor guards the case
 *  where there are enough rows that an even share would be tighter than the content
 *  actually needs - better to overflow the even split than to clip real text. Re-run on
 *  every applyStyle(), since the font/size controls invalidate the measurements. */
function syncHeaderRowHeight(pagesEl) {
  pagesEl.querySelectorAll('table').forEach((table) => {
    if (!table.getBoundingClientRect().height) return;
    const headRow = table.querySelector('thead tr');
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    if (!headRow || !bodyRows.length) return;
    const allRows = [headRow, ...bodyRows];
    allRows.forEach((r) => (r.style.height = '')); // drop previous pins so measurements are fresh

    // Every row gets an equal share of the table's height. Measuring the tallest row and
    // pinning to that instead doesn't work here: on the Weekday chart the merged שחרית
    // cell spans every row, so its height is what the browser divides between them, and
    // it hands a row with two lines of parsha a bigger slice. That slice is a *result* of
    // the distribution, not the row's own requirement - pinning to it inflated the whole
    // table past the 8.5in page. The even share is the real target; the row only stays
    // taller if its own content genuinely needs more, which the tightened parsha
    // line-height now avoids.
    // The header is never shorter than a body row, so there are two cases and the table
    // has to end up exactly its own height either way:
    //   header fits in an equal share  -> every row (header included) takes that share
    //   header needs more than a share -> it keeps its height, the rest split what's left
    // Using one formula for both overflowed the page: the first case pushed a tall header
    // down to a share it couldn't fit in, the second handed a short header a share bigger
    // than it needed.
    const tableHeight = table.getBoundingClientRect().height;
    const headNatural = headRow.getBoundingClientRect().height;
    const evenShare = tableHeight / allRows.length;
    const target = headNatural <= evenShare ? evenShare : (tableHeight - headNatural) / bodyRows.length;
    bodyRows.forEach((r) => (r.style.height = target + 'px'));
    // The header never comes out shorter than a body row, and keeps its own greater
    // height where its text needs it.
    headRow.style.height = Math.max(target, headNatural) + 'px';
  });
}


// Right-to-left reading order after the parsha column: the workbook's own B..L/B..I
// order is "latest event of the week first" (Motzei Shabbos Maariv is column B) -
// reversed here so reading right-to-left after the parsha actually follows the week
// chronologically (Friday's Mincha/candle-lighting first, Motzei Shabbos Maariv last).
function rtlOrdered(columns) {
  return [...columns].reverse();
}

function renderPage(pageWeeks, pageIndex, totalPages, columns, buildRow, settings, sheet, state, onChange, effectiveSeason, { announced = false, showMolad = false } = {}) {
  const page = document.createElement('div');
  page.className = 'page';
  const isEnglish = state.settings.language === 'en';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const footerNote = sheet.season === 'weekday' ? WEEKDAY_FOOTER_NOTE : state.settings.footerNote;
  const orderedColumns = isEnglish ? columns : rtlOrdered(columns);
  const isWeekday = effectiveSeason === 'weekday';

  const colDefs = isEnglish ? [...orderedColumns.map((c) => c.key), 'parsha'] : ['parsha', ...orderedColumns.map((c) => c.key)];
  const colgroup = '<colgroup>' + colDefs.map((key) => `<col data-colkey="${key}"${sheet.columnWidths[key] ? ` style="width:${Number(sheet.columnWidths[key]) || 0}px"` : ''}>`).join('') + '</colgroup>';

  const theadCols = orderedColumns.map((c) => `<th${hebrewLang(c.header)}>${markHeaderRoom(nl2br(c.header))}</th>`).join('');
  // The Weekday chart titles its parsha column, matching the printed board; the Shabbos
  // charts leave that corner blank. (th is white-space: pre-line, so the \n is a break.)
  const parshaHeader = isWeekday ? 'Weekday\nזמנים' : isEnglish ? 'Parsha' : ' ';

  // On the Weekday chart, שחרית is one schedule for all days, not per-week: instead of
  // repeating it in every row (which would make a multi-line schedule absurdly tall over
  // many weeks), it prints once on a panel laid over the whole column, matching how it
  // looks in the original printed chart. It comes off the program's own WEEKDAY_SHACHARIS
  // with no per-cell override, which is what puts the same list on every chart at once.
  /* Which row's cell the panel hangs from. The middle one, and that is arithmetic rather
     than taste: the panel is sized in multiples of the cell it hangs from, and a cell is a
     hair shorter than a row (the collapsed border between two rows is not part of it, see
     .shacharis-panel). At 100% that is made up exactly, but under Fit to screen's zoom a
     hairline does not scale the way a percentage does and a little is left over per row.
     Hung from the first row, all of it lands at the foot: measured on a phone, 6px of chart
     above the panel against 12px below. Hung from the middle, the half above and the half
     below carry the same error in opposite directions and it cancels: 6.8px and 6.8px. */
  const panelRow = Math.round((pageWeeks.length - 0.7) / 2);

  /* Every day of חנוכה on this page, through Friday, across every week the page holds - one
     list, asked once, so the panel and the generic ר"ח ובה"ב heading below can never
     disagree about which days are חנוכה's. Through Friday (chanukahDaysThroughFriday, not
     the row-scoped chanukahDaysInWeek), since the panel's own heading already speaks for
     Sunday through Friday - a Friday that is itself חנוכה, some years also ר"ח טבת, still
     needs its morning said somewhere, and the panel is the only place that ever does. */
  const chanukahPageDays = isWeekday
    ? pageWeeks.flatMap((w) => chanukahDaysThroughFriday(w.serial, settings))
    : [];

  const panelHtml = (() => {
    if (!isWeekday) return '';
    const kinds = specialShacharisKinds(pageWeeks.map((w) => w.serial), settings);
    /* ר"ח טבת always falls entirely inside חנוכה's own eight days, so where it is the
       *only* ר"ח on the page, the standing "ר"ח ובה"ב" block would only repeat what the
       חנוכה-aware block below already says. Suppressed only then: a page that also holds
       some other ר"ח (שבט's, say) still gets the standing block for that one, since this
       page's Rosh Chodesh days are not all חנוכה's. */
    if (kinds.roshChodesh && chanukahPageDays.length) {
      const chanukahSet = new Set(chanukahPageDays);
      const otherRoshChodesh = pageWeeks.some((w) => {
        for (let offset = 6; offset >= 1; offset -= 1) {
          const serial = w.serial - offset;
          if (hasRoshChodesh(serial, settings) && !chanukahSet.has(serial)) return true;
        }
        return false;
      });
      if (!otherRoshChodesh) kinds.roshChodesh = false;
    }
    const heading = specialShacharisHeading(kinds);
    const special = heading ? WEEKDAY_SHACHARIS_SPECIAL : '';
    const chanukahBlocks = chanukahPanelBlocks(chanukahPageDays, settings);
    // Both of חנוכה's own blocks, heading and schedule together, inside one light-background
    // box of their own (.chanukah-highlight, see shacharis-grid.js's own handling of this one
    // div) - set apart from the standing ר"ח ובה"ב block beside it rather than carrying a mark
    // of their own the way the tag on a touching week's own מעריב row does.
    const chanukahInner = (chanukahBlocks.regular ? `<u>חנוכה</u>\n${chanukahBlocks.regular}` : '')
      + (chanukahBlocks.roshChodesh ? `${chanukahBlocks.regular ? '\n\n' : ''}<u>ר"ח טבת · חנוכה</u>\n${chanukahBlocks.roshChodesh}` : '');
    const chanukahHtml = chanukahInner ? `\n\n<div class="chanukah-highlight">${chanukahInner}</div>` : '';
    return WEEKDAY_SHACHARIS + (special ? `\n\n<u>${escText(heading)}</u>\n${special}` : '') + chanukahHtml;
  })();
  const panelLaid = isWeekday ? (shacharisGridHtml(panelHtml) || panelHtml) : '';

  const rows = pageWeeks
    .map((week, weekIdx) => {
      // The Weekday chart's מנחה/מעריב are computed now (sheets/weekday.js), but the
      // Tisha B'Av note and the Rules engine still don't reach it: both are keyed to the
      // קיץ/חורף columns, and a rule's column key is season-qualified ("kayitz:C"), so
      // there is nothing for a Weekday column to match against.
      const computed = buildRow(week, settings);
      const appliedColumns = new Set();
      // effectiveSeason (not sheet.season) - a חורף page that prints as קיץ (see
      // pageEffectiveSeason above) should also match "kayitz:"-qualified rules, same
      // as a real קיץ sheet would for these weeks.
      const ruled = isWeekday ? computed : applyRules(computed, withHebrewDate(week, settings), state.rules, effectiveSeason, appliedColumns);
      const { row, overriddenKeys } = mergeRow(ruled, sheet, week.serial);
      const cellHtml = (c) => {
        /* שחרית on the Weekday chart: one cell a row, like every other column, and the
           schedule on a panel laid over them.
           A rowspan cell was the obvious way to say "one schedule for the page" and it was
           the wrong one: it erased its column for the whole height of the page, so the row a
           reader was following stopped dead at שחרית and picked up again on the far side of
           it. These are real rows now, so the band and the rule under each of them are the
           row's own and cannot drift from the rest of the chart, and the schedule is said
           once on a panel over the top rather than repeated down the column.
           Written as real HTML in settings.js, so it prints out as-is instead of through
           nl2br/esc. */
        if (isWeekday && c.key === 'E') {
          // Every row but the one the panel hangs from is an empty cell carrying nothing
          // but its own row - a week made entirely of חנוכה included, whose own morning
          // now shows on that one shared panel too (see chanukahPageDays above), the same
          // as a week only partly inside חנוכה always has.
          if (weekIdx !== panelRow) return '<td class="shacharis-through"></td>';
          /* This row's cell is a row like the others and carries the panel, which is laid out
             of it and over the whole column.
             --rows is the page's row count and --above is how many rows sit above this one,
             and the two are what let the panel be a panel with nothing measured: this cell is
             one row tall and every row on the page is the same height (see
             syncHeaderRowHeight), so a length in multiples of 100% of this cell is a length in
             rows, on screen, on paper and under any zoom. See .shacharis-panel in app.css for
             the arithmetic. */
          return `<td class="shacharis-through is-panel"
            style="--rows: ${pageWeeks.length}; --above: ${panelRow}">
            <div class="shacharis-panel"><div class="shacharis-panel-in">${panelLaid}</div></div></td>`;
        }
        // מנחה/מעריב on the Weekday chart: computed from the shul's standing weekday
        // schedule (see sheets/weekday.js) and still editable on top, so typing over a
        // week stores an override the same as any other column. An override already
        // holds real HTML; a computed value is still sentinel/newline text and needs
        // nl2br, exactly like the Shabbos columns below.
        if (isWeekday && (c.key === 'B' || c.key === 'C')) {
          // The 11:30 "NEW" tag lives only here: a hand-typed override already wins
          // outright and is never printed through printOverrides, and every other reader
          // of this column (the week card, "what is on next", the messages page) reads
          // row[c.key] directly and never sees the tag either. See sheets/weekday.js.
          const overridden = overriddenKeys.has(c.key);
          const computedValue = overridden ? row[c.key] ?? '' : row.printOverrides?.[c.key] ?? row[c.key] ?? '';
          const value = announced ? announcedWeekCell(computedValue, c.key, week.serial) : computedValue;
          const html = overridden ? value : nl2br(value);
          return `<td><div class="cell" contenteditable="true" data-serial="${Number(week.serial)}" data-col="${c.key}" data-season="${effectiveSeason}">${html}</div></td>`;
        }
        const flagged = appliedColumns.has(c.key) && !overriddenKeys.has(c.key) ? 'ruled' : overriddenKeys.has(c.key) ? 'overridden' : '';
        // Overridden cells already hold real HTML (captured from the editable div,
        // possibly with manual <u> underlining); computed cells still need nl2br().
        // printOverrides is read here too, same as the Weekday chart's own B/C above: the
        // Shabbos chart's own Erev Shabbos מנחה column (I) carries the "חנוכה" tag on its
        // own extra 12:45 this same way (see choref.js), and every other reader of this
        // column - a hand-typed override, week.specialParsha, anything that reads row.I
        // directly - still sees the plain untagged time.
        const computedValue = overriddenKeys.has(c.key) ? row[c.key] ?? '' : row.printOverrides?.[c.key] ?? row[c.key] ?? '';
        const html = overriddenKeys.has(c.key) ? computedValue : nl2br(computedValue);
        // data-season records which season this *page* rendered as, so a later edit
        // (see the blur handler below) recomputes its "did this really change?"
        // baseline the same way, without having to re-derive the page split.
        return `<td class="${flagged}"><div class="cell" contenteditable="true"${hebrewLang(html)} data-serial="${Number(week.serial)}" data-col="${c.key}" data-season="${effectiveSeason}">${html}</div></td>`;
      };
      const cells = orderedColumns.map(cellHtml).join('');
      // A week whose Shabbos is Yom Tov has no parsha, so it carries the Yom Tov's own
      // name (see weeks.js). Printed as it stands, "סוכות" reads as though this row held
      // the times for Yom Tov; it holds the ordinary weekdays around it, so it is named
      // for the week: "שבוע של סוכות". A parsha is left exactly as it is.
      // The שבת charts say when the שבת itself is inside חנוכה, or is the שבת right in front
      // of it (never in a קיץ week, which חנוכה cannot fall in to begin with). The Weekday
      // chart says the same thing its own way: a week made entirely of חנוכה names it right
      // in the parsha cell; a week only partly חנוכה keeps its plain name, since it is not
      // the week the eight days belong to on their own.
      const chanukahLabel = isWeekday ? null : chanukahShabbosLabel(week.serial, settings);
      const weekAllChanukah = isWeekday && chanukahDaysInWeek(week.serial, settings).length === 5;
      // showMolad is closed by default (renderPage's own parameter) regardless of what
      // this week's own date works out to - see this function's own caller,
      // buildSheetPages, for why that default is what keeps the congregation's own
      // reading copy from ever showing it.
      // Worked out fresh from week.serial rather than read off a stored week.mevarchim /
      // week.molad: a sheet saved before this feature existed, or before some later fix
      // to the molad calculation itself, carries neither field, and the switch has no
      // effect on a sheet that was never regenerated since - caught on a real saved
      // sheet, where turning Molad on changed nothing. Reading the calendar directly off
      // the date it is already showing is also what the rest of this project does for
      // anything that must not go stale in a saved sheet (the Weekday chart's own
      // schedules, WEEKDAY_SHACHARIS and its kin, are the same pattern): the one place
      // that is ever asked is the one place that can never disagree with itself.
      const mevarchimMonth = !isWeekday && showMolad ? shabbosMevarchimMonth(week.serial, settings) : null;
      const molad = mevarchimMonth ? moladLabel(moladFor(mevarchimMonth.year, mevarchimMonth.month), settings) : null;
      const hasMevarchim = Boolean(molad);
      // A special parsha (שקלים, החדש, …) joins the parsha name's own line, the same
      // inline "· " join "· חנוכה" already uses below, rather than sitting on a line of
      // its own above the molad note - only on a week that also carries a molad, which
      // is the one case a third line (name, special parsha, molad, each on its own) was
      // measured tall enough to overflow a content-squeezed page's own row height (see
      // the molad note's own comment). Every other week's own special parsha is
      // untouched, still its own line under the parsha.
      const parshaCell = weekOfLabel(week.parsha, isEnglish)
        + (week.specialParsha && !hasMevarchim ? '\n' + week.specialParsha : '')
        + (week.specialParsha && hasMevarchim ? ` · ${week.specialParsha}` : '')
        + (chanukahLabel === 'chanukah' || weekAllChanukah ? ' · חנוכה' : '');
      // An explicit width from the column-width panel has to beat the CSS min-width
      // floor on .parsha-cell (see app.css) - otherwise setting a narrower one there
      // would silently do nothing. Inline, so it outranks the stylesheet.
      const parshaWidth = sheet.columnWidths.parsha ? ` style="min-width:${Number(sheet.columnWidths.parsha) || 0}px"` : '';
      // The molad is the same kind of note as ערב חנוכה below it: smaller, on a line of its
      // own under the parsha rather than beside it at full size, and only on the שבת chart
      // (isWeekday above keeps it off the Weekday chart's own week list entirely). Already
      // a complete, language-matched sentence (hebrew-calendar.js's own moladLabel), not
      // escaped again here any more than specialParsha or parsha are.
      // The "שבת מברכים" label itself was dropped - asked for directly - so the molad
      // line, where there is one, is what says this Shabbos is מברכים.
      //
      // is-molad sets its own, smaller size and nowrap (see .parsha-note.is-molad in
      // app.css): the molad sentence is long enough that at the ordinary note size it
      // wrapped to a second line on a content-squeezed page, measured directly on a real
      // generated חורף chart - which cannot be let happen, since every row on a page is
      // pinned to one shared height (syncHeaderRowHeight) and a row whose own content
      // needs more than that pushes past it, taking the whole 817px page past its own
      // fixed height with it (and, on a Shabbos chart, misaligns the Weekday chart
      // printed side by side with it, which lines up pair per row). nowrap on its own,
      // without the smaller size, makes it worse under table-layout:auto rather than
      // better: a cell's minimum width becomes the note's own whole width, so the
      // narrower the note, the narrower table-layout:auto in turn lets the column be -
      // measured directly, the column kept shrinking in step with the font with nothing
      // but nowrap, wrap and all. The two together are what breaks that loop.
      //
      // A week whose own special parsha (שקלים, החדש, …) also lands here joins the
      // parsha name's own line (see parshaCell above) rather than taking a line of its
      // own, which is what let a three-line cell (name, special parsha, molad) overflow
      // in the first place - except the one double-barrelled parsha name long enough on
      // its own to still wrap even joined ("ויקהל - פקודי · החדש", measured). Under the
      // Compact Hebrew molad (one line) that case is no better and no worse than before
      // the join: still three lines, ~5px past the page's own 817px. Under Yiddish, whose
      // own sentence is two lines (moladLabelYiddish's own <br>, asked for directly), the
      // same week is four lines total: tightened with .parsha-note.is-molad's own
      // line-height (see app.css), down from ~27px past to ~7px, close to Compact
      // Hebrew's own baseline rather than well past it. Shortening the molad sentence
      // itself would close the rest of the gap and has not been asked for.
      const mevarchimNote = hasMevarchim
        ? `<br><span class="parsha-note is-molad">${molad}</span>`
        : '';
      // ערב חנוכה is written smaller, on a line of its own under the parsha - it names the
      // week ahead rather than this one, so it does not belong beside the parsha at full
      // size the way "· חנוכה" does for a שבת that is itself inside the eight days.
      const parshaHtml = nl2br(parshaCell) + mevarchimNote + (chanukahLabel === 'erev' ? '<br><span class="parsha-note">ערב חנוכה</span>' : '');
      const parshaTd = `<td class="parsha-cell"${parshaWidth}${hebrewLang(parshaCell)}>${parshaHtml}</td>`;
      return `<tr>${isEnglish ? cells + parshaTd : parshaTd + cells}</tr>`;
    })
    .join('');
  const theadRow = isEnglish ? theadCols + `<th>${parshaHeader}</th>` : `<th>${parshaHeader}</th>` + theadCols;

  page.innerHTML = `
    <div class="page-header">
      <div class="header-row">
        <img class="header-icon" src="${safeHeaderImage(state.settings.headerIconImage)}" alt="">
        <div class="header-center">
          <img class="header-logo" src="/assets/logo-text.png" alt="${escAttr(state.settings.shulName)}"${hebrewLang(state.settings.shulName)}>
          ${state.settings.headerSubtitle ? `<div class="header-subtitle"${hebrewLang(state.settings.headerSubtitle)}>${escText(state.settings.headerSubtitle)}</div>` : ''}
        </div>
        <div class="header-rabbi"${hebrewLang(state.settings.headerRabbiLine)}>${nl2br(escText(state.settings.headerRabbiLine))}</div>
      </div>
    </div>
    <table dir="${dir}" class="${isWeekday ? 'weekday-table' : ''}">
      ${colgroup}
      <thead><tr>${theadRow}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="page-footer">
      <span class="footer-line"></span>
      <div class="footer-text">
        ${footerNote ? nl2br(escText(footerNote)) + '<br>' : ''}
        <span class="footer-address">${escText(state.settings.footerAddress)}</span>
      </div>
      <span class="footer-line"></span>
    </div>
  `;

  /** What this cell would hold with no manual override - what an edit is diffed against
   *  to decide whether it's a real change worth storing. */
  const baselineHtmlFor = (cellEl) => {
    const col = cellEl.dataset.col;
    const weekSeason = cellEl.dataset.season;
    const week = sheet.weeks.find((w) => w.serial === Number(cellEl.dataset.serial));
    const settingsResolved = resolveSettings(state.settings);
    const builtRow = splitBuild(weekSeason)({ ...week, date: new Date(week.date) }, settingsResolved);
    const computed = builtRow;
    const ruled = weekSeason === 'weekday' ? computed : applyRules(computed, withHebrewDate({ ...week, date: new Date(week.date) }, settingsResolved), state.rules, weekSeason);
    const raw = ruled[col] ?? '';
    // Every column, Weekday included, is built as plain text with underline sentinels
    // that nl2br has to mark up first - or the comparison would see markup-vs-none and
    // store a bogus override on a cell nobody actually edited.
    return normalizeRichText(nl2br(raw));
  };

  const commitCell = (cellEl) => {
    const serial = Number(cellEl.dataset.serial);
    const col = cellEl.dataset.col;
    const newHtml = normalizeRichText(cellEl.innerHTML);
    const before = getOverride(sheet, serial, col); // undefined = "no override"
    const after = newHtml === baselineHtmlFor(cellEl) ? undefined : newHtml;
    if (before === after) return; // no real change (e.g. just clicked in and out)
    applyOverrideValue(sheet, serial, col, after);
    const hist = getHistory(sheet.id);
    hist.undo.push({ serial, col, before, after });
    hist.redo = []; // a fresh edit invalidates any redo history
    onChange({ save: true });
  };

  page.querySelectorAll('.cell').forEach((cellEl) => {
    cellEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        document.execCommand('underline');
      }
    });
    cellEl.addEventListener('blur', () => {
      applyTimeShorthand(cellEl); // "1220 130" -> "12:20/1:30"
      commitCell(cellEl);
    });
  });

  return page;
}

/** Attaches the week's Hebrew date so rules can match on it (see rules.js). Computed
 *  here rather than stored on the sheet, so it works for sheets saved before hebrewDate
 *  conditions existed. */
function withHebrewDate(week, settings) {
  return { ...week, hebrew: hebrewDateExtended(week.serial, settings.useGregorianBefore1582) };
}

function splitBuild(season) {
  if (season === 'weekday') return buildWeekdayRow;
  return season === 'kayitz' ? buildKayitzRow : buildChorefRow;
}

// Converts UL_START/UL_END sentinels (see format.js) into real <u> elements *after*
// HTML-escaping the rest of the text, and \n into <br>. Plain <u> rather than a styled
// <span> specifically so the underline toolbar (and Ctrl/Cmd+U) can *remove* it: those
// go through execCommand, which only recognizes its own native markup and silently
// no-ops on a class-based underline it doesn't know how to undo.
function nl2br(str) {
  // Keep the three Tisha B'Av labels and times aligned in two shared columns.
  const evening = String(str).match(/^דרשה (\d{1,2}:\d{2})\nזמן 72 (\d{1,2}:\d{2})\nמעריב (\d{1,2}:\d{2})$/);
  if (evening) {
    const labels = ['דרשה', 'זמן 72', 'מעריב'];
    return '<span class="tisha-evening-grid" dir="rtl" style="display:inline-grid;grid-template-columns:max-content max-content;column-gap:0.45em;text-align:right;white-space:nowrap;line-height:1.2">' +
      labels.map((label, i) => '<span>' + label + '</span><span dir="ltr" style="text-align:right;font-variant-numeric:tabular-nums">' + evening[i + 1] + '</span>').join('') + '</span>';
  }

  // underlineTime writes its value as "<u> 6:42</u>". The space was meant as a lead-in
  // that would not show on a centred chart cell, and it does show: a cell holding several
  // times leaves 13.7px in front of an underlined one against 10.36px in front of a plain
  // one, and the rule itself starts a space before its own first digit. Dropped, so every
  // gap in a cell is the separator's width and nothing else. The character is a
  // non-breaking space rather than the plain one it looks like in the source, so it is
  // matched as whitespace rather than written out.
  const trimmed = escText(str).replace(new RegExp(UL_START + '\\s+', 'g'), UL_START);
  const escaped = trimmed.split(UL_START).join('<u>').split(UL_END).join('</u>');
  // The "NEW" tag (see NEW_TAG_START/MID/END in format.js): same after-escaping swap as
  // the underline sentinels just above, so a literal "<" typed by the shul can never be
  // read back as this markup - only the three PUA characters newMinyanTag() itself wrote
  // in sheets/weekday.js can trigger it.
  const tagged = escaped
    .split(NEW_TAG_START).join('<span class="new-minyan-tag">')
    .split(NEW_TAG_MID).join('<span class="tag-word">')
    .split(NEW_TAG_END).join('</span></span>');
  // The "חנוכה" tag (see CHANUKAH_TAG_START/MID/END in format.js, chanukahTag() in
  // sheets/weekday.js): the same mechanism again, for חנוכה's own extra/different weekday
  // מנחה/מעריב time sitting right on a touching week's own row.
  const chanukahTagged = tagged
    .split(CHANUKAH_TAG_START).join('<span class="chanukah-tag">')
    .split(CHANUKAH_TAG_MID).join('<span class="tag-word">')
    .split(CHANUKAH_TAG_END).join('</span></span>');
  return chanukahTagged.replace(/\n/g, '<br>');
}

