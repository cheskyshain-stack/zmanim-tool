import { safeHeaderImage } from '../security.js';
import {
  resolveSettings, specialShacharisHeading, DEFAULT_ACCENT_COLOR, LEGACY_ACCENT_COLORS,
  WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL, WEEKDAY_FOOTER_NOTE,
} from '../settings.js';
import { hebrewDateExtended, weekOfLabel, specialShacharisKinds, hasRoshChodesh, shabbosMevarchimMonth, moladFor, moladLabel, excelWeekday } from '../hebrew-calendar.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { buildWeekdayRow, WEEKDAY_COLUMNS, chanukahDaysInWeek, chanukahDaysThroughFriday } from '../sheets/weekday.js';
import { chanukahShabbosLabel, chanukahPanelBlocks, chanukahShacharisDay } from '../posters/chanukah.js';
import { enteredTimeTraces, zman } from '../zmanim/trace.js';
import { inSpringDstWindow } from '../sheets/common.js';
import { hebrewLang, escText, escAttr, useStraightHebrewQuotes } from '../util.js';
import { splitWeeksIntoPages } from '../pagination.js';
import { applyRules } from '../rules.js';
import { mergeRow } from '../overrides.js';
import { announcedWeekCell } from '../announced.js';
import { shacharisGridHtml } from './shacharis-grid.js';
import {
  UL_START, UL_END, NEW_TAG_START, NEW_TAG_MID, NEW_TAG_END,
  CHANUKAH_TAG_START, CHANUKAH_TAG_MID, CHANUKAH_TAG_END,
  SMALL_START, SMALL_END,
  markHeaderRoom,
} from '../format.js';
import { setPrintPage } from './print-page.js';
import { switchHtml, wireSwitch } from './switch.js';
import { chartExplanationAttrs, timeExplanationAttrs } from './time-explanations.js';

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

/** The printed pages of one sheet, built and styled but not yet in the document.
 *
 *  All chart cells are read-only, including admin print copies. The readOnly flag selects
 *  the congregation's announced times; admin copies retain their calculated and saved values.
 *
 *  Row heights still need syncPageHeights() once the pages are in the document, since
 *  nothing can be measured before then. */
export function buildSheetPages(sheet, state, { readOnly = false, showMolad = false, splitSpringDst = false } = {}) {
  if (!sheet) return [];
  const settings = resolveSettings(state.settings);
  if (!sheet.style) sheet.style = { ...state.settings.sheetStyle };
  if (!sheet.columnWidths) sheet.columnWidths = {};
  const wks = sheet.weeks.map((w) => ({ ...w, date: new Date(w.date) }));
  const split = splitWeeksIntoPages(wks, sheet.pageSizes).map((pw) => ({ weeks: pw, effectiveSeason: pageEffectiveSeason(sheet, pw, settings) }));
  return split.map(({ weeks: pw, effectiveSeason }, i) => {
    const { columns, buildRow } = columnsAndBuilderFor(effectiveSeason);
    /* The congregation's copy quotes what the shul has announced: see js/announced.js.
       Admin print layouts keep the chart's calculated times and existing saved overrides.
       showMolad is carried the same explicit way, defaulting closed, for a stricter reason
       than that one: the congregation's own /chart/ page (chart-view.js) calls this with
       readOnly alone and nothing in this parameter's own name to fall back on, and must
       never show it regardless of what state.settings itself holds - settings.showMolad is
       carried whole into data/published.json (buildPublishedPayload, publish.js) for the
       admin's own next session to read back, and that published copy is read by nobody but
       luach.js, not by this file at all, so there is no path by which this chart's own
       congregation reader could pick the setting up even by mistake. Only renderSheet's own
       admin call passes it, read fresh off state.settings.showMolad there. */
    const springStart = sheet.season === 'choref' && splitSpringDst
      ? pw.findIndex(week => inSpringDstWindow(week.date, settings)) : -1;
    // This mixed page already uses summer formulas, rules and override keys. Keep those
    // keys in both sections: winter's Erev Shabbos I is summer's L, so an existing edit
    // must stay with the same minyan when its three unused Plag columns are hidden.
    const winterColumns = springStart > 0
      ? CHOREF_COLUMNS.map(column => column.key === 'I' ? { ...column, key: 'L' } : column) : columns;
    const el = renderPage(springStart > 0 ? pw.slice(0, springStart) : pw, i, split.length, winterColumns, buildRow, settings, sheet, state, effectiveSeason, { announced: readOnly, showMolad });
    if (springStart > 0) {
      const summerPage = renderPage(pw.slice(springStart), i, split.length, columns, buildRow, settings, sheet, state, effectiveSeason, { announced: readOnly, showMolad });
      const sections = document.createElement('div');
      sections.className = 'chart-sections';
      const winterTable = el.querySelector('table');
      winterTable.replaceWith(sections);
      sections.append(winterTable, summerPage.querySelector('table'));
    }
    fillChartLocationLegend(el);
    el.dataset.sheetLabel = sheetLabel(sheet);
    el.dataset.pageIndex = i;
    applyStyle(el, sheet.style, chartInk(state)); // variables only - row heights need the page in the document
    return el;
  });
}

/** Explain the location marks on this physical page, after any DST sections are joined.
 *  Reading the rendered tables includes rules, saved edits and the weekday morning panel.
 *  Each Hebrew label is isolated with its own stars so the two meanings stay together. */
function fillChartLocationLegend(page) {
  const marks = new Set([...page.querySelectorAll('table')].flatMap(table =>
    [...table.textContent.matchAll(/\d{1,2}:\d{2}(?::\d{2})?\s*(\*{1,2})(?!\*)/g)].map(match => match[1])));
  const footer = page.querySelector('.footer-text');
  const hasDownstairs = [...page.querySelectorAll('table u')].some(time => /\d{1,2}:\d{2}/.test(time.textContent));
  // Rebuild standard location keys from this page, including ones in an older custom
  // footer. Other custom notes stay intact; the full downstairs sentence and only
  // the room stars this page uses share one line.
  for (const node of [...footer.childNodes]) {
    if (node.nodeType !== 3) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    const starKey = /בעזרת נשים|באולם השמחות/.test(text)
      && !text.replace(/בעזרת נשים|באולם השמחות|\*|\s/g, '');
    if (!starKey && text !== WEEKDAY_FOOTER_NOTE) continue;
    if (node.nextSibling?.nodeName === 'BR') node.nextSibling.remove();
    node.remove();
  }
  const existingNote = footer.textContent.replace(/\s+/g, ' ');
  const locations = [['*', 'בעזרת נשים'], ['**', 'באולם השמחות']].filter(([mark, label]) => {
    if (!marks.has(mark)) return false;
    const stars = mark.replace(/\*/g, '\\*');
    return !new RegExp(`(?:^|[^*])${stars}(?!\\*)\\s*${label}|${label}\\s*${stars}(?!\\*)`).test(existingNote);
  });
  if (!hasDownstairs && !locations.length) return;
  const legend = document.createElement('div');
  legend.className = 'chart-location-legend';
  legend.dir = 'rtl';
  if (hasDownstairs) {
    const entry = document.createElement('span');
    entry.className = 'chart-location-downstairs';
    entry.dir = 'ltr';
    const minyanim = document.createElement('bdi');
    minyanim.dir = 'rtl';
    minyanim.lang = 'he';
    minyanim.textContent = 'מנינים';
    const room = document.createElement('bdi');
    room.dir = 'rtl';
    room.lang = 'he';
    room.textContent = 'בבית מדרש למטה';
    entry.append('All underlined ', minyanim, ' will be ', room);
    legend.append(entry);
  }
  locations.forEach(([mark, label]) => {
    if (legend.childNodes.length) legend.append(' · ');
    const entry = document.createElement('bdi');
    entry.dir = 'rtl';
    entry.lang = 'he';
    entry.textContent = `${mark}${label}`;
    legend.append(entry);
  });
  footer.prepend(legend);
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
  const winterSheet = sheet.season === 'choref' ? sheet : companion?.season === 'choref' ? companion : null;
  if (winterSheet && !winterSheet.style) winterSheet.style = { ...state.settings.sheetStyle };

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
          ${winterSheet ? `<div class="poster-bar-switch">${switchHtml('chart-dst-headers', 'Spring clock change', [
            { value: 'one', label: 'One header', on: !winterSheet.style.splitSpringDst },
            { value: 'separate', label: 'Separate headers', on: Boolean(winterSheet.style.splitSpringDst) },
          ])}</div>
          <p class="hint">Separate headers keeps winter columns above the clock change and starts summer columns below it, on the same page. Applies to this print layout.</p>` : ''}
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
    <p id="page-fit-notice" class="hint no-print" hidden></p>
    <div id="sheet-stack">
      <div id="pages" class="pages"></div>
    </div>
  `;
  useStraightHebrewQuotes(container);
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
  const buildPagesFor = (sh) => buildSheetPages(sh, state, {
    showMolad: Boolean(state.settings.showMolad), splitSpringDst: Boolean(sh?.style?.splitSpringDst),
  });
  const shabbosFirst = sheet.season === 'weekday' && companion;
  const primaryPages = buildPagesFor(shabbosFirst ? companion : sheet);
  const companionPages = buildPagesFor(shabbosFirst ? sheet : companion);
  for (let i = 0; i < Math.max(primaryPages.length, companionPages.length); i++) {
    if (primaryPages[i]) pagesEl.appendChild(primaryPages[i]);
    if (companionPages[i]) pagesEl.appendChild(companionPages[i]);
  }

  // A page is supposed to be exactly 816px (11in x 8.5in at 100%, see the layout
  // invariant) - syncHeaderRowHeight shares that out evenly, but it is a CSS minimum, not
  // a cap, and a page whose own content genuinely needs more (most often the Weekday
  // chart's שחרית panel, which has to print every schedule in play - the everyday one,
  // ר"ח/בה"ב/תענית, and חנוכה's own two more on a week that is all three at once - stacked
  // in one card, regardless of how many weeks share the page) renders taller anyway. Paper
  // does not: a page over 11in x 8.5in is not one sheet any more, and the print engine
  // splits it across two, repeating the header and leaving the שחרית panel's own position
  // (calculated for the one tall page, not for wherever the split landed) sitting in the
  // wrong place on whichever physical sheet it ends up on - measured directly, from a real
  // print preview, as the confusing, overlapping-looking extra page this fits (or, failing
  // that, warns about) below.
  //
  // Asked for directly: shrink the text rather than make the admin rearrange weeks. One
  // scale for every page in #pages - both this sheet's own and its companion's, since they
  // print and are read as one job - not a scale per page, so flipping between pages of the
  // same chart never meets a size change that was not there on the paper itself. Each
  // page's own *current* font size is the starting point (not the stored sheet.style,
  // which stays exactly what the admin set - this never writes back to it, so a chart that
  // needed shrinking once does not quietly ship smaller forever after), stepped down 2% at
  // a time and re-measured for real after each step (syncHeaderRowHeight has to run again
  // too, since a smaller font changes what the even share itself comes out to), rather than
  // computed in one guess - a wall chart's own text does not shrink linearly with page
  // height the way a block of prose would, between the merged שחרית panel, the different
  // column counts a קיץ versus a חורף page carries, and rounding in syncHeaderRowHeight
  // itself.
  //
  // Floor is a hard technical one now, not a legibility one: asked for directly, an admin
  // who picks a page count low enough to need real shrinking (an entire season on its own
  // one page, among others) wants the result to fit over staying readable from a few feet
  // away, and picking that page count is itself the deliberate choice, the same as it
  // always was for 1 through 8. 10% keeps the scale a real, positive, renderable number;
  // short of even that the warning below still fires, naming which pages still do not fit
  // - shrinking the text buys room, not an unconditional guarantee for any combination of
  // weeks on any page count.
  const pageEls = [...pagesEl.querySelectorAll('.page')];
  const baseFontSizePt = pageEls.map((el) => parseFloat(getComputedStyle(el).getPropertyValue('--sheet-font-size')) || 10);
  const FIT_FLOOR = 0.1;
  const FIT_STEP = 0.02;
  const FIT_TOLERANCE = 8.5 * 96; // even sub-pixel overflow can shift the duplex chart frame
  const applyFitScale = (scale) => {
    pageEls.forEach((el, i) => el.style.setProperty('--sheet-font-size', (baseFontSizePt[i] * scale) + 'pt'));
    syncHeaderRowHeight(pagesEl);
  };
  const stillOverflowing = () => pageEls.filter((el) => el.getBoundingClientRect().height > FIT_TOLERANCE);
  const fitPaper = () => {
    if (!document.body.contains(pagesEl)) return;
    atPaperSize(pagesEl, () => {
      applyFitScale(1);
      let fitScale = 1;
      let overflowPages = stillOverflowing();
      while (overflowPages.length && fitScale > FIT_FLOOR) {
        fitScale = Math.max(FIT_FLOOR, fitScale - FIT_STEP);
        applyFitScale(fitScale);
        overflowPages = stillOverflowing();
      }

      const overflowWarningEl = container.querySelector('#page-overflow-warning');
      if (overflowPages.length) {
        const items = overflowPages.map((el) => {
          const height = el.getBoundingClientRect().height;
          return `${el.dataset.sheetLabel}, page ${Number(el.dataset.pageIndex) + 1} (${Math.round(height)}px, ${Math.round(height - 8.5 * 96)}px over one sheet)`;
        });
        overflowWarningEl.textContent = `This chart has more on a page than one sheet of paper holds, even shrunk as far as it can go and stay legible: ${items.join('; ')}. Go back to Print layouts and move some weeks to another page.`;
        overflowWarningEl.hidden = false;
      } else {
        overflowWarningEl.textContent = '';
        overflowWarningEl.hidden = true;
      }
      const fitNoticeEl = container.querySelector('#page-fit-notice');
      if (!overflowPages.length && fitScale < 1) {
        fitNoticeEl.textContent = `This chart's text is shrunk to ${Math.round(fitScale * 100)}% of the chosen size so every page fits on one sheet.`;
        fitNoticeEl.hidden = false;
      } else {
        fitNoticeEl.textContent = '';
        fitNoticeEl.hidden = true;
      }
    });
  };
  fitPaper();
  document.fonts?.ready?.then(() => {
    if (!document.body.contains(pagesEl)) return;
    fitPaper();
    autoFit(container);
  });
  if (chartBeforePrintHandler) window.removeEventListener('beforeprint', chartBeforePrintHandler);
  chartBeforePrintHandler = () => {
    if (document.body.contains(pagesEl)) fitPaper();
  };
  window.addEventListener('beforeprint', chartBeforePrintHandler);

  // Fit the paper at full size first. Measuring the phone's reduced preview hid an
  // overflowing mixed-header page and let its address print above the next header.
  autoFit(container);

  const restyleOwnPages = () => {
    pagesEl.querySelectorAll(`.page[data-sheet-label="${sheetLabel(sheet)}"]`).forEach((el) => applyStyle(el, sheet.style, chartInk(state)));
    syncHeaderRowHeight(pagesEl);
  };

  // Persists sheet.style as the app's "last used" style too, so the next *newly
  // generated* sheet starts from it (see generate-view.js / settings.js sheetStyle).
  const commit = () => {
    state.settings.sheetStyle = { ...sheet.style,
      splitSpringDst: winterSheet ? Boolean(winterSheet.style.splitSpringDst) : Boolean(state.settings.sheetStyle.splitSpringDst),
    };
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
  wireSwitch(container, 'chart-dst-headers', value => {
    winterSheet.style.splitSpringDst = value === 'separate';
    state.settings.sheetStyle.splitSpringDst = winterSheet.style.splitSpringDst;
    onChange({ save: true });
  });

}

const sheetLabel = (sh) => (sh.season === 'kayitz' ? 'שבת קיץ' : sh.season === 'choref' ? 'שבת חורף' : 'Weekday');


// --- Fit to screen -----------------------------------------------------------------
// Module-level, not per-render: print controls redraw the sheet, and the view should
// keep the user's chosen preview scale each time.
let chartBeforePrintHandler;
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
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000' : '#fff';
}

function grayChartAccent(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return DEFAULT_ACCENT_COLOR;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16));
  const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, '0');
  return '#' + gray.repeat(3);
}

function applyStyle(target, style, ink = style.ink) {
  target.style.padding = chartPad(style.paddingY, 0.35) + 'in ' + chartPad(style.paddingX, 0.5) + 'in';
  // CSS filters rasterize chart text in PDFs. Set neutral colours directly instead.
  target.style.filter = '';
  target.classList.toggle('is-mono', ink === 'mono');
  target.querySelectorAll('table, .header-center, .header-rabbi, .page-footer').forEach(el => {
    el.style.filter = '';
  });
  const savedAccent = String(style.accentColor || DEFAULT_ACCENT_COLOR).toLowerCase();
  const colour = LEGACY_ACCENT_COLORS.includes(savedAccent) ? DEFAULT_ACCENT_COLOR : savedAccent;
  const accent = ink === 'mono' ? grayChartAccent(colour) : colour;
  target.style.setProperty('--sheet-font-family', fontStackFor(style.fontFamily));
  target.style.setProperty('--sheet-font-size', style.fontSizePt + 'pt');
  target.style.setProperty('--sheet-header-scale', style.headerScale);
  target.style.setProperty('--sheet-accent', accent);
  target.style.setProperty('--sheet-head-ink', headerInkFor(accent));
}

/** Measure at paper size even when Fit to screen or Side by side is active. */
function atPaperSize(pagesEl, measure) {
  const pages = [...pagesEl.querySelectorAll('.page')].filter(page => page.getClientRects().length);
  if (!pages.length) return;
  const styles = [
    [pagesEl, 'zoom', '1'], [pagesEl, 'transform', 'none'],
    ...pages.flatMap(page => [
      [page, 'zoom', '1'], [page, 'height', 'auto'], [page, 'min-height', '8.5in'],
    ]),
  ].map(([el, name, temporary]) => ({ el, name, temporary,
    value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) }));
  styles.forEach(({ el, name, temporary }) => el.style.setProperty(name, temporary, 'important'));
  try {
    return measure(pages);
  } finally {
    styles.forEach(({ el, name, value, priority }) => {
      if (value) el.style.setProperty(name, value, priority);
      else el.style.removeProperty(name);
    });
  }
}

/** Reserve one chart area for the whole print job. Header/footer text and saved
 *  margins can differ between the two sheets, so use the space every page can hold.
 *  Rows share that height, with a taller header only where its content needs it. */
function syncHeaderRowHeight(pagesEl) {
  atPaperSize(pagesEl, pages => {
    const layouts = pages.map(page => {
      const header = page.querySelector('.page-header');
      const footer = page.querySelector('.page-footer');
      const sections = page.querySelector('.chart-sections');
      const tables = [...page.querySelectorAll('table')];
      [header, footer, sections, ...tables].filter(Boolean).forEach(el => {
        el.style.height = '';
        el.style.flex = 'none';
      });
      page.querySelectorAll('tr').forEach(row => { row.style.height = ''; });
      page.querySelectorAll('.parsha-cell-name, .parsha-cell-sub').forEach(el => { el.style.marginTop = ''; });
      const style = getComputedStyle(page);
      const paddingTop = header.getBoundingClientRect().top - page.getBoundingClientRect().top;
      const paddingBottom = parseFloat(style.paddingBottom) || 0;
      const headerGap = tables[0].getBoundingClientRect().top - header.getBoundingClientRect().bottom;
      const footerGap = footer.getBoundingClientRect().top - tables.at(-1).getBoundingClientRect().bottom;
      return { header, footer, sections, tables, paddingTop, paddingBottom, headerGap, footerGap,
        top: paddingTop + header.getBoundingClientRect().height + headerGap,
        bottom: 8.5 * 96 - paddingBottom - footer.getBoundingClientRect().height - footerGap };
    });
    // Whole CSS pixels keep the shared frame stable through table border rounding.
    const top = Math.ceil(Math.max(...layouts.map(layout => layout.top)));
    const bottom = Math.floor(Math.min(...layouts.map(layout => layout.bottom)));
    const chartHeight = Math.max(0, bottom - top);
    layouts.forEach(({ header, footer, sections, tables, paddingTop, paddingBottom, headerGap, footerGap }) => {
      header.style.height = (top - paddingTop - headerGap) + 'px';
      footer.style.height = (8.5 * 96 - bottom - paddingBottom - footerGap) + 'px';
      const borders = tables.map(table => table.getBoundingClientRect().height
        - [...table.rows].reduce((sum, row) => sum + row.getBoundingClientRect().height, 0));
      if (sections) {
        const rows = tables.flatMap(table => [...table.rows]);
        const gap = tables[1].getBoundingClientRect().top - tables[0].getBoundingClientRect().bottom;
        const available = chartHeight - gap * (tables.length - 1)
          - borders.reduce((sum, border) => sum + border, 0);
        // Both headers share the body row height. Content remains the floor so an
        // overflowing page grows and the paper's shrink-to-fit loop can see it.
        const height = Math.max(available / rows.length, ...rows.map(row => row.getBoundingClientRect().height));
        rows.forEach(row => { row.style.height = height + 'px'; });
        tables.forEach((table, index) => {
          table.style.height = (height * table.rows.length + borders[index]) + 'px';
        });
        // Let the last table take the fractional remainder after browser rounding.
        const used = tables.slice(0, -1).reduce((sum, table) => sum + table.getBoundingClientRect().height, 0);
        tables.at(-1).style.height = Math.max(0, chartHeight - gap * (tables.length - 1) - used) + 'px';
      } else {
        const table = tables[0];
        const headRow = table.querySelector('thead tr');
        const bodyRows = [...table.querySelectorAll('tbody tr')];
        if (!headRow || !bodyRows.length) return;
        const headNatural = headRow.getBoundingClientRect().height;
        const available = chartHeight - borders[0];
        const evenShare = available / (bodyRows.length + 1);
        const target = headNatural <= evenShare ? evenShare : (available - headNatural) / bodyRows.length;
        bodyRows.forEach(row => { row.style.height = Math.max(0, target) + 'px'; });
        headRow.style.height = Math.max(evenShare, headNatural) + 'px';
        // A table's height is a minimum: real content can still grow it. Account for
        // its collapsed border so pinned rows do not add half a pixel to every page.
        table.style.height = chartHeight + 'px';
      }
    });
    centerMoladNotes(pagesEl);
  });
}


/** Keeps a parsha name at the row's own vertical centre on a week that also carries a
 *  compact Hebrew molad note (the .parsha-cell-centered cells built in buildRow above),
 *  with the molad note (and, on the rare week that also carries one, the ערב חנוכה note
 *  beside it) centred in whatever room is left below the name, rather than letting
 *  vertical-align: middle on the <td> centre the name and the note as one two-line block.
 *
 *  Written by measuring and setting an explicit margin-top rather than attempted in CSS
 *  alone, same as the row heights just above: a percentage height inside a table cell is
 *  exactly the kind of thing that does not reliably resolve, and a flex-column version of
 *  this measured a 0px sub-region in a real browser - the opposite of centred. Needs the
 *  row's own height to already be final, so it runs last, after every row in this table
 *  has its real height pinned above. */
function centerMoladNotes(pagesEl) {
  pagesEl.querySelectorAll('.parsha-cell-centered').forEach((td) => {
    const nameEl = td.querySelector('.parsha-cell-name');
    const subEl = td.querySelector('.parsha-cell-sub');
    if (!nameEl || !subEl) return;
    nameEl.style.marginTop = '';
    subEl.style.marginTop = ''; // drop previous pins so measurements are fresh
    // margin-top positions against the <td>'s content box, not its border box - the
    // padding has to come off cellHeight first, or the name lands pushed one padding's
    // worth below true centre (measured directly: ~1.9px off on a ~17px padding, enough
    // to see).
    const cellStyle = getComputedStyle(td);
    const paddingTop = parseFloat(cellStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(cellStyle.paddingBottom) || 0;
    const contentHeight = td.getBoundingClientRect().height - paddingTop - paddingBottom;
    const nameHeight = nameEl.getBoundingClientRect().height;
    const subHeight = subEl.getBoundingClientRect().height;
    const spaceAbove = Math.max(0, (contentHeight - nameHeight) / 2);
    nameEl.style.marginTop = spaceAbove + 'px';
    const spaceBelow = Math.max(0, contentHeight - spaceAbove - nameHeight);
    subEl.style.marginTop = Math.max(0, (spaceBelow - subHeight) / 2) + 'px';
  });
}


// Right-to-left reading order after the parsha column: the workbook's own B..L/B..I
// order is "latest event of the week first" (Motzei Shabbos Maariv is column B) -
// reversed here so reading right-to-left after the parsha actually follows the week
// chronologically (Friday's Mincha/candle-lighting first, Motzei Shabbos Maariv last).
function rtlOrdered(columns) {
  return [...columns].reverse();
}

function renderPage(pageWeeks, pageIndex, totalPages, columns, buildRow, settings, sheet, state, effectiveSeason, { announced = false, showMolad = false } = {}) {
  const page = document.createElement('div');
  page.className = 'page';
  const isEnglish = state.settings.language === 'en';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const footerNote = sheet.season === 'weekday' ? WEEKDAY_FOOTER_NOTE : state.settings.footerNote;
  const orderedColumns = isEnglish ? columns : rtlOrdered(columns);
  const isWeekday = effectiveSeason === 'weekday';

  const colDefs = isEnglish ? [...orderedColumns.map((c) => c.key), 'parsha'] : ['parsha', ...orderedColumns.map((c) => c.key)];
  const colgroup = '<colgroup>' + colDefs.map((key) => `<col data-colkey="${key}"${sheet.columnWidths[key] ? ` style="width:${Number(sheet.columnWidths[key]) || 0}px"` : ''}>`).join('') + '</colgroup>';

  const theadCols = orderedColumns.map((c) => `<th${hebrewLang(c.header)}>${markHeaderRoom(headerHtml(c))}</th>`).join('');
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
  const panelTraces = isWeekday ? [
    ...enteredTimeTraces(WEEKDAY_SHACHARIS + WEEKDAY_SHACHARIS_SPECIAL, 'the standing weekday morning schedule'),
    ...chanukahPageDays.flatMap(serial => {
      const day = chanukahShacharisDay(serial, settings);
      return [...day.lines, zman('נץ', day.netz)];
    }),
  ] : [];

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
            <div class="shacharis-panel"><div class="shacharis-panel-in"${timeExplanationAttrs({ header: 'שחרית', chartName: 'Weekday chart', printed: panelHtml, times: panelTraces })}>${panelLaid}</div></div></td>`;
        }
        // מנחה/מעריב on the Weekday chart: computed from the shul's standing weekday
        // schedule (see sheets/weekday.js), with any existing saved overrides retained.
        // An override already holds real HTML; a computed value is still sentinel/newline text and needs
        // nl2br, exactly like the Shabbos columns below.
        if (isWeekday && (c.key === 'B' || c.key === 'C')) {
          // The 11:30 "NEW" tag lives only here: a hand-typed override already wins
          // outright and is never printed through printOverrides, and every other reader
          // of this column (the week card, "what is on next", the messages page) reads
          // row[c.key] directly and never sees the tag either. See sheets/weekday.js.
          const overridden = overriddenKeys.has(c.key);
          const computedValue = overridden ? row[c.key] ?? '' : row.printOverrides?.[c.key] ?? row[c.key] ?? '';
          const value = announced ? announcedWeekCell(computedValue, c.key, week.serial, settings) : computedValue;
          const html = overridden ? value : nl2br(value);
          return `<td><div class="cell" data-serial="${Number(week.serial)}" data-col="${c.key}" data-season="${effectiveSeason}"${chartExplanationAttrs(row, c.key, c.header, `${week.parsha || ''} · Weekday chart`, { value, announcedWeek: announced ? { anchor: week.serial, settings } : null })}>${html}</div></td>`;
        }
        const flagged = appliedColumns.has(c.key) && !overriddenKeys.has(c.key) ? 'ruled' : overriddenKeys.has(c.key) ? 'overridden' : '';
        // Saved overrides already hold real HTML, possibly with manual <u> underlining;
        // computed cells still need nl2br().
        // printOverrides is read here too, same as the Weekday chart's own B/C above: the
        // Shabbos chart's own Erev Shabbos מנחה column (I) carries the "חנוכה" tag on its
        // own extra 12:15 this same way (see choref.js), and every other reader of this
        // column - a hand-typed override, week.specialParsha, anything that reads row.I
        // directly - still sees the plain untagged time.
        const computedValue = overriddenKeys.has(c.key) ? row[c.key] ?? '' : row.printOverrides?.[c.key] ?? row[c.key] ?? '';
        const html = overriddenKeys.has(c.key) ? computedValue : nl2br(computedValue);
        return `<td class="${flagged}"><div class="cell"${hebrewLang(html)} data-serial="${Number(week.serial)}" data-col="${c.key}" data-season="${effectiveSeason}"${chartExplanationAttrs(row, c.key, c.header, `${week.parsha || ''} · ${sheet.name || effectiveSeason}`)}>${html}</div></td>`;
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
      // A special parsha (שקלים, החדש, …) always joins the parsha name's own line, the
      // same inline "· " join "· חנוכה" already uses below, rather than sitting on a
      // line of its own under it - asked for directly, in place of the line it used to
      // get only on a week with no molad, which read as two different conventions for
      // the same thing depending on what else that week happened to carry. A week that
      // also has a molad note can come out three lines this way (name · special, then
      // the molad's own line, now itself sometimes two more under Yiddish) - the
      // chart's own auto-shrink absorbs that the same way it absorbs any other page that
      // needs more room than 816px holds, rather than this reaching for a second
      // convention to dodge it.
      const parshaCell = weekOfLabel(week.parsha, isEnglish)
        + (week.specialParsha ? ` · ${week.specialParsha}` : '')
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
      // needs more than that pushes past it, taking the whole 816px page past its own
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
      // the join: still three lines, ~5px past the page's own 816px. Under Yiddish, whose
      // own sentence is two lines (moladLabelYiddish's own <br>, asked for directly), the
      // same week is four lines total: tightened with .parsha-note.is-molad's own
      // line-height (see app.css), down from ~27px past to ~7px, close to Compact
      // Hebrew's own baseline rather than well past it. Shortening the molad sentence
      // itself would close the rest of the gap and has not been asked for.
      const mevarchimNote = hasMevarchim ? `<span class="parsha-note is-molad">${molad}</span>` : '';
      // ערב חנוכה is written smaller, on a line of its own under the parsha - it names the
      // week ahead rather than this one, so it does not belong beside the parsha at full
      // size the way "· חנוכה" does for a שבת that is itself inside the eight days.
      const erevChanukahNote = chanukahLabel === 'erev' ? '<span class="parsha-note">ערב חנוכה</span>' : '';
      // A week with a molad note used to have the parsha name pulled up off the row's own
      // centre, since vertical-align:middle on the <td> centres the name and the note
      // together as one two-line block - asked to stop: the name should sit exactly where
      // it sits on a week with no molad, and the molad note should hang under it, centred
      // in whatever room is left below. parsha-cell-centered (app.css) and
      // centerMoladNotes below do that by measuring and writing an explicit margin-top on
      // each of .parsha-cell-name/.parsha-cell-sub, the same technique
      // syncHeaderRowHeight already uses for the row itself - a flex-column attempt at
      // this (height: 100% on a wrapper inside the <td>, an empty ::before as the
      // matching spacer) measured as not reaching the cell's real height at all in a real
      // browser: percentage heights inside a table cell are exactly the kind of thing
      // that does not reliably resolve, and the sub region came out 0px, the note centred
      // on a single point rather than in the space below the name.
      // Only the compact Hebrew molad gets it, asked for directly: the Yiddish molad is
      // two lines of its own (moladLabelYiddish's own <br>) and may not leave enough room
      // below the name to stay centred in it, so that format keeps the plain stacked
      // layout it already had.
      const centerMolad = hasMevarchim && settings.moladFormat !== 'yiddish';
      const parshaClass = centerMolad ? 'parsha-cell parsha-cell-centered' : 'parsha-cell';
      const parshaHtml = centerMolad
        ? `<div class="parsha-cell-name">${nl2br(parshaCell)}</div>`
          + `<div class="parsha-cell-sub">${[mevarchimNote, erevChanukahNote].filter(Boolean).join('<br>')}</div>`
        : nl2br(parshaCell) + [mevarchimNote, erevChanukahNote].filter(Boolean).map((n) => '<br>' + n).join('');
      const parshaTd = `<td class="${parshaClass}"${parshaWidth}${hebrewLang(parshaCell)}>${parshaHtml}</td>`;
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

  // SVG artwork prints even when a browser omits CSS backgrounds. Add it after the
  // schedule grid is built so it cannot affect time parsing, text or row measurements.
  page.querySelectorAll('.chanukah-highlight').forEach(highlight => {
    highlight.insertAdjacentHTML('afterbegin', '<svg class="chanukah-highlight-fill" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="1" height="1"/></svg>');
  });
  useStraightHebrewQuotes(page);

  return page;
}

/** Attaches the week's Hebrew date so rules can match on it (see rules.js). Computed
 *  here rather than stored on the sheet, so it works for sheets saved before hebrewDate
 *  conditions existed. */
function withHebrewDate(week, settings) {
  return { ...week, hebrew: hebrewDateExtended(week.serial, settings.useGregorianBefore1582) };
}

/** A column's heading, its first line at the heading's own regular size and, when the
 *  column is marked headerSub (sheets/kayitz.js, sheets/choref.js), every line after that
 *  smaller - what the name on the first line is read against, whether that is two opinions,
 *  a room or the day the מנין falls on. Not every multi-line heading is this
 *  shape: the Weekday chart's own "מנחה\nמעריב" names two coequal תפילות on two lines, and
 *  "הדלקת\nנרות" is one phrase broken in two, so headerSub is a flag the column sets rather
 *  than a pattern guessed from the text, to keep those two from being read the same way.
 *  Wrapped only for this <th>'s own HTML: c.header itself stays the plain string it always
 *  was, because rules-view's own checkbox labels, week-view's and weekly-reader's week card,
 *  and erev-text.js all read that same string apart from this table and do not know
 *  smallText()'s sentinel - only this function's own call to nl2br does. */
function headerHtml(c) {
  if (!c.headerSub) return nl2br(c.header);
  const [first, ...rest] = String(c.header).split('\n');
  const isRoom = line => /^\([^()]+\)$/.test(line);
  if (rest.some(isRoom)) {
    // Each line uses its own font's line height instead of the heading's full-size strut.
    // markHeaderRoom wraps the room text as a direct child of this compact group.
    return '<span class="chart-room-heading"><span>' + nl2br(first) + '</span>'
      + rest.map(line => isRoom(line) ? nl2br(line)
        : '<span class="cell-small">' + nl2br(line) + '</span>').join('') + '</span>';
  }
  // Other headings keep their standard line breaks and smaller basis text.
  return nl2br(first) + rest.map(line => '<br><span class="cell-small">' + nl2br(line) + '</span>').join('');
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
  // smallText() (format.js): the stricter/alternate reading beside the main one - פלג under
  // its מנחה, מ"א beside גר"א - set smaller, same idea as .head-room on a heading.
  const smalled = chanukahTagged
    .split(SMALL_START).join('<span class="cell-small">')
    .split(SMALL_END).join('</span>');
  return smalled.replace(/\n/g, '<br>');
}
