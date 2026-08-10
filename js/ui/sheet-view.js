import { resolveSettings } from '../settings.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { splitWeeksIntoPages } from '../pagination.js';
import { applyRules } from '../rules.js';
import { mergeRow, setOverride, clearOverride, getOverride } from '../overrides.js';
import { UL_START, UL_END } from '../format.js';

/** A שבת חורף sheet whose season reaches the spring DST cutover carries its tail
 *  weeks (sheet.springSplitIndex onward) as an actual שבת קיץ chart — not just extra
 *  columns — since the shul really is on the summer schedule by then. This resolves
 *  which "season" a given week INDEX in sheet.weeks should be treated as for every
 *  purpose (columns, row-building formulas, and which sheet-qualified rules apply):
 *  'choref' before the cutover, 'kayitz' from the cutover through Pesach. Sheets saved
 *  before this feature existed have no springSplitIndex, which defaults to "no split".*/
function effectiveSeasonForIndex(sheet, index) {
  if (sheet.season !== 'choref') return sheet.season;
  const cutover = sheet.springSplitIndex ?? sheet.weeks.length;
  return index >= cutover ? 'kayitz' : 'choref';
}
function columnsAndBuilderFor(effectiveSeason) {
  return effectiveSeason === 'kayitz' ? { columns: KAYITZ_COLUMNS, buildRow: buildKayitzRow } : { columns: CHOREF_COLUMNS, buildRow: buildChorefRow };
}

const FONT_CHOICES = ['David', 'David Libre', 'Guttman Yad', 'Frank Ruehl', 'Times New Roman', 'Arial', 'Segoe UI'];

// Undo/redo history per sheet, kept in memory only (module-level, keyed by sheet id) —
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

export function renderSheet(container, state, sheet, onChange) {
  if (!sheet.style) sheet.style = { ...state.settings.sheetStyle };
  if (!sheet.style.accentColor) sheet.style.accentColor = state.settings.sheetStyle.accentColor || '#54595f'; // sheets saved before this control existed
  if (!sheet.columnWidths) sheet.columnWidths = {};
  const settings = resolveSettings(state.settings);
  const weeks = sheet.weeks.map((w) => ({ ...w, date: new Date(w.date) }));
  // The core (חורף-layout) weeks are paginated per pageSizes as usual; any tail weeks
  // past the spring DST cutover become one extra page, forced to hold together as a
  // single real שבת קיץ chart rather than being split by the core page-size controls.
  const cutover = sheet.season === 'choref' ? (sheet.springSplitIndex ?? weeks.length) : weeks.length;
  const coreWeeks = weeks.slice(0, cutover);
  const springWeeks = weeks.slice(cutover);
  const corePages = splitWeeksIntoPages(coreWeeks, sheet.pageSizes).map((pageWeeks) => ({ weeks: pageWeeks, effectiveSeason: sheet.season === 'kayitz' ? 'kayitz' : 'choref' }));
  const pages = springWeeks.length ? [...corePages, { weeks: springWeeks, effectiveSeason: 'kayitz' }] : corePages;
  const isEnglish = state.settings.language === 'en';
  // Column-width panel covers every column key actually used on any page — CHOREF's
  // own columns plus (if there's a trailing קיץ page) any קיץ-only keys not already in
  // that set.
  const panelColumns = springWeeks.length ? [...CHOREF_COLUMNS, ...KAYITZ_COLUMNS.filter((c) => !CHOREF_COLUMNS.some((cc) => cc.key === c.key))] : sheet.season === 'kayitz' ? KAYITZ_COLUMNS : CHOREF_COLUMNS;
  const colOrder = isEnglish ? [...panelColumns.map((c) => c.key), 'parsha'] : ['parsha', ...rtlOrdered(panelColumns).map((c) => c.key)];
  const colLabel = { parsha: isEnglish ? 'Parsha' : 'פרשה', ...Object.fromEntries(panelColumns.map((c) => [c.key, c.header.replace(/\n/g, ' ')])) };

  const hist = getHistory(sheet.id);
  container.innerHTML = `
    <div class="sheet-toolbar no-print">
      <button id="back-btn">&larr; Back</button>
      <button id="print-btn">Print</button>
      <button id="undo-btn" title="Undo last cell edit" ${hist.undo.length ? '' : 'disabled'}>&#8630; Undo</button>
      <button id="redo-btn" title="Redo" ${hist.redo.length ? '' : 'disabled'}>&#8631; Redo</button>
      <span class="hint">Click a cell to edit it (select text + Ctrl/Cmd+U to underline/un-underline). Rule-affected cells show a light yellow background.</span>
    </div>
    <div class="style-toolbar no-print">
      <label>Font
        <select id="style-font">${FONT_CHOICES.map((f) => `<option value="${f}" ${f === sheet.style.fontFamily ? 'selected' : ''}>${f}</option>`).join('')}</select>
      </label>
      <label>Text size
        <input id="style-size" type="range" min="6" max="18" step="0.5" value="${sheet.style.fontSizePt}">
        <span id="style-size-label">${sheet.style.fontSizePt}pt</span>
      </label>
      <label>Logo size
        <input id="style-header" type="range" min="0.6" max="1.6" step="0.1" value="${sheet.style.headerScale}">
      </label>
      <label>Page color
        <input id="style-color" type="color" value="${sheet.style.accentColor}">
      </label>
      <button id="style-reset" type="button">Reset style</button>
    </div>
    <details class="col-width-panel no-print">
      <summary>Column widths (auto by default — set a number to override, clear it to go back to auto)</summary>
      <div class="col-width-grid">
        ${colOrder
          .map(
            (key) => `
          <label class="col-width-input">
            <span>${esc(colLabel[key] || key)}</span>
            <input type="number" min="20" max="400" step="5" data-colkey="${key}" placeholder="auto" value="${sheet.columnWidths[key] ?? ''}">
          </label>`
          )
          .join('')}
        <button id="col-width-reset" type="button">Reset all to auto</button>
      </div>
    </details>
    <div id="pages"></div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => onChange({ back: true }));
  container.querySelector('#print-btn').addEventListener('click', () => window.print());
  container.querySelector('#undo-btn').addEventListener('click', () => {
    const action = hist.undo.pop();
    if (!action) return;
    applyOverrideValue(sheet, action.serial, action.col, action.before);
    hist.redo.push(action);
    onChange({ save: true }); // app.js re-renders the whole sheet view on save
  });
  container.querySelector('#redo-btn').addEventListener('click', () => {
    const action = hist.redo.pop();
    if (!action) return;
    applyOverrideValue(sheet, action.serial, action.col, action.after);
    hist.undo.push(action);
    onChange({ save: true });
  });

  const pagesEl = container.querySelector('#pages');
  const totalPages = pages.length;
  pages.forEach(({ weeks: pageWeeks, effectiveSeason }, pageIndex) => {
    const { columns, buildRow } = columnsAndBuilderFor(effectiveSeason);
    pagesEl.appendChild(renderPage(pageWeeks, pageIndex, totalPages, columns, buildRow, settings, sheet, state, onChange, effectiveSeason));
  });

  applyStyle(pagesEl, sheet.style);

  // Column-width controls: update every page's <col> live as you type, commit (save) on change.
  container.querySelectorAll('.col-width-input input').forEach((input) => {
    const key = input.dataset.colkey;
    const applyWidth = () => {
      const px = input.value === '' ? undefined : Number(input.value);
      pagesEl.querySelectorAll(`col[data-colkey="${key}"]`).forEach((col) => {
        col.style.width = px ? px + 'px' : '';
      });
      return px;
    };
    input.addEventListener('input', applyWidth);
    input.addEventListener('change', () => {
      const px = applyWidth();
      if (px === undefined) delete sheet.columnWidths[key];
      else sheet.columnWidths[key] = px;
      onChange({ save: true });
    });
  });
  container.querySelector('#col-width-reset').addEventListener('click', () => {
    sheet.columnWidths = {};
    onChange({ save: true });
  });

  const fontSel = container.querySelector('#style-font');
  const sizeInput = container.querySelector('#style-size');
  const sizeLabel = container.querySelector('#style-size-label');
  const headerInput = container.querySelector('#style-header');
  // Persists sheet.style as the app's "last used" style too, so the next *newly
  // generated* sheet starts from it (see generate-view.js / settings.js sheetStyle).
  const commit = () => {
    state.settings.sheetStyle = { ...sheet.style };
    onChange({ save: true });
  };
  fontSel.addEventListener('change', () => {
    sheet.style.fontFamily = fontSel.value;
    applyStyle(pagesEl, sheet.style);
    commit();
  });
  sizeInput.addEventListener('input', () => {
    sheet.style.fontSizePt = Number(sizeInput.value);
    sizeLabel.textContent = sheet.style.fontSizePt + 'pt';
    applyStyle(pagesEl, sheet.style);
  });
  sizeInput.addEventListener('change', commit);
  headerInput.addEventListener('input', () => {
    sheet.style.headerScale = Number(headerInput.value);
    applyStyle(pagesEl, sheet.style);
  });
  headerInput.addEventListener('change', commit);
  const colorInput = container.querySelector('#style-color');
  colorInput.addEventListener('input', () => {
    sheet.style.accentColor = colorInput.value;
    applyStyle(pagesEl, sheet.style);
  });
  colorInput.addEventListener('change', commit);
  container.querySelector('#style-reset').addEventListener('click', () => {
    sheet.style = { fontFamily: 'Times New Roman', fontSizePt: 10, headerScale: 1, accentColor: '#54595f' };
    commit(); // app.js re-renders the whole sheet view on save
  });
}

function applyStyle(pagesEl, style) {
  pagesEl.style.setProperty('--sheet-font-family', `"${style.fontFamily}", "David Libre", "Times New Roman", serif`);
  pagesEl.style.setProperty('--sheet-font-size', style.fontSizePt + 'pt');
  pagesEl.style.setProperty('--sheet-header-scale', style.headerScale);
  pagesEl.style.setProperty('--sheet-accent', style.accentColor);
}

// Right-to-left reading order after the parsha column: the workbook's own B..L/B..I
// order is "latest event of the week first" (Motzei Shabbos Maariv is column B) —
// reversed here so reading right-to-left after the parsha actually follows the week
// chronologically (Friday's Mincha/candle-lighting first, Motzei Shabbos Maariv last).
function rtlOrdered(columns) {
  return [...columns].reverse();
}

function renderPage(pageWeeks, pageIndex, totalPages, columns, buildRow, settings, sheet, state, onChange, effectiveSeason) {
  const page = document.createElement('div');
  page.className = 'page';
  const isEnglish = state.settings.language === 'en';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const orderedColumns = isEnglish ? columns : rtlOrdered(columns);

  const colDefs = isEnglish ? [...orderedColumns.map((c) => c.key), 'parsha'] : ['parsha', ...orderedColumns.map((c) => c.key)];
  const colgroup = '<colgroup>' + colDefs.map((key) => `<col data-colkey="${key}"${sheet.columnWidths[key] ? ` style="width:${sheet.columnWidths[key]}px"` : ''}>`).join('') + '</colgroup>';

  const theadCols = orderedColumns.map((c) => `<th>${nl2br(c.header)}</th>`).join('');
  const parshaHeader = isEnglish ? 'Parsha' : ' ';

  const rows = pageWeeks
    .map((week) => {
      const computed = buildRow(week, settings);
      const appliedColumns = new Set();
      // effectiveSeason (not sheet.season) — on a שבת חורף sheet's trailing
      // spring-cutover page, these weeks are rendered as an actual שבת קיץ chart, so
      // "kayitz:"-qualified rules should apply to them too, same as a real קיץ sheet.
      const ruled = applyRules(computed, week, state.rules, effectiveSeason, appliedColumns);
      const { row, overriddenKeys } = mergeRow(ruled, sheet, week.serial);
      const cells = orderedColumns
        .map((c) => {
          const flagged = appliedColumns.has(c.key) && !overriddenKeys.has(c.key) ? 'ruled' : overriddenKeys.has(c.key) ? 'overridden' : '';
          // Overridden cells already hold real HTML (captured from the editable div,
          // possibly with manual <u> underlining); computed cells still need nl2br().
          const html = overriddenKeys.has(c.key) ? row[c.key] ?? '' : nl2br(row[c.key] ?? '');
          return `<td class="${flagged}"><div class="cell" contenteditable="true" data-serial="${week.serial}" data-col="${c.key}">${html}</div></td>`;
        })
        .join('');
      const parshaCell = week.parsha + (week.specialParsha ? '\n' + week.specialParsha : '');
      const parshaTd = `<td class="parsha-cell">${nl2br(parshaCell)}</td>`;
      return `<tr>${isEnglish ? cells + parshaTd : parshaTd + cells}</tr>`;
    })
    .join('');
  const theadRow = isEnglish ? theadCols + `<th>${parshaHeader}</th>` : `<th>${parshaHeader}</th>` + theadCols;

  page.innerHTML = `
    <div class="page-header">
      <div class="header-row">
        <img class="header-icon" src="${state.settings.headerIconImage || 'assets/logo-building-icon.png'}" alt="">
        <div class="header-center">
          <img class="header-logo" src="assets/logo-text.png" alt="${esc(state.settings.shulName)}">
          ${state.settings.headerSubtitle ? `<div class="header-subtitle">${esc(state.settings.headerSubtitle)}</div>` : ''}
        </div>
        <div class="header-rabbi">${nl2br(esc(state.settings.headerRabbiLine))}</div>
      </div>
    </div>
    <table dir="${dir}">
      ${colgroup}
      <thead><tr>${theadRow}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="page-footer">
      <span class="footer-line"></span>
      <div class="footer-text">
        ${state.settings.footerNote ? nl2br(esc(state.settings.footerNote)) + '<br>' : ''}
        <span class="footer-address">${esc(state.settings.footerAddress)}</span>
      </div>
      <span class="footer-line"></span>
    </div>
  `;

  page.querySelectorAll('.cell').forEach((cellEl) => {
    cellEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        document.execCommand('underline');
      }
    });
    cellEl.addEventListener('blur', () => {
      const serial = Number(cellEl.dataset.serial);
      const col = cellEl.dataset.col;
      const weekIndex = sheet.weeks.findIndex((w) => w.serial === serial);
      const week = sheet.weeks[weekIndex];
      const weekSeason = effectiveSeasonForIndex(sheet, weekIndex);
      const settingsResolved = resolveSettings(state.settings);
      const computed = splitBuild(weekSeason)({ ...week, date: new Date(week.date) }, settingsResolved);
      const ruled = applyRules(computed, { ...week, date: new Date(week.date) }, state.rules, weekSeason);
      const baselineHtml = nl2br(ruled[col] ?? '');
      const newHtml = normalizeCellHtml(cellEl.innerHTML);
      const before = getOverride(sheet, serial, col); // undefined = "no override"
      const after = newHtml === baselineHtml ? undefined : newHtml;
      if (before === after) return; // no real change (e.g. just clicked in and out)
      applyOverrideValue(sheet, serial, col, after);
      const hist = getHistory(sheet.id);
      hist.undo.push({ serial, col, before, after });
      hist.redo = []; // a fresh edit invalidates any redo history
      onChange({ save: true });
    });
  });

  return page;
}

function splitBuild(season) {
  return season === 'kayitz' ? buildKayitzRow : buildChorefRow;
}

// Light contenteditable HTML cleanup so a trivial click-in/click-out doesn't register
// as a change: trims a trailing <br> (left behind by pressing Enter at the end) and
// normalizes &nbsp; to a plain space.
function normalizeCellHtml(html) {
  return html
    .replace(/(<br\s*\/?>)+\s*$/i, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Converts UL_START/UL_END sentinels (see format.js) into real <span class="ul">
// elements *after* HTML-escaping the rest of the text, and \n into <br>.
function nl2br(str) {
  const escaped = esc(str)
    .split(UL_START)
    .join('<span class="ul">')
    .split(UL_END)
    .join('</span>');
  return escaped.replace(/\n/g, '<br>');
}
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
