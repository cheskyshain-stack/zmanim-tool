import { renderOnePagePoster, layoutPosters } from '../../../js/ui/posters-view.js';
import { escAttr } from '../../../js/util.js';

// Use the original public schedule page's markup and stylesheet. Rosh Hashanah
// reads down one continuous column; longer seasonal sheets retain two columns.
// A shadow root contains its print styles so they cannot affect the Shul View.
const ASSET_BASE = new URL('./original/', import.meta.url);
const STYLE_URL = new URL('css/app.css', ASSET_BASE).href;
const SHEET_SETTINGS = { shulName: '', headerSubtitle: '', headerRabbiLine: '', headerIconImage: '' };
let fontReady;
function loadFonts() {
  if (!fontReady) fontReady = Promise.all([
    ['Frank Ruhl Libre', 'frank-ruhl-libre.woff2', '400 700'],
    ['David Libre', 'david-libre-400.woff2', '400'],
    ['David Libre', 'david-libre-700.woff2', '700'],
  ].map(async ([name, file, weight]) => {
    const face = new FontFace(name, `url(${new URL('assets/fonts/' + file, ASSET_BASE).href})`, { weight });
    try { await face.load(); document.fonts.add(face); } catch { /* The source font stack has local fallbacks. */ }
  }));
  return fontReady;
}

export function originalSheetHTML(sheet) {
  const html = renderOnePagePoster({
    own: true, title: sheet.title, hebrewYear: sheet.year,
    sections: sheet.sections || [], legend: [],
  }, SHEET_SETTINGS);
  const columnBreak = Number.isInteger(sheet.columnBreakAt) && sheet.columnBreakAt > 0 && sheet.columnBreakAt < (sheet.sections || []).length ? sheet.columnBreakAt : null;
  const columns = sheet.sourceId?.startsWith('rh:') && columnBreak === null ? 1 : 2;
  // Keep the original renderer's complete labels and sections. Structured public
  // time values let the screen balance runs without parsing printed clock text,
  // which may itself contain a note, a slash, an underline or a location mark.
  const rows = (sheet.sections || []).flatMap(section => section.rows.flatMap(row => [row, ...(row.extra ? [{label:row.extra.label,times:row.extra.times}] : [])]));
  const timeData = rows.map(row => ({times:row.times || [],note:row.note || '',sep:row.sep || '\u00a0/\u00a0'}));
  return `<div class="original-sheet-host" data-sheet-columns="${columns}"${columnBreak === null ? '' : ` data-sheet-break="${columnBreak}"`} data-sheet-times="${escAttr(JSON.stringify(timeData))}"><template class="original-sheet-content">${html}</template></div>`;
}

const hostStyles = `
  /* Inherit every palette token across the shadow boundary. Safari does not
     support :host-context, so theme selection belongs to the outer stage. */
  :host {
    --sheet-background: var(--shul-sheet-background, #faf7ef);
    --sheet-text: var(--shul-sheet-text, #142a42);
    --sheet-gold: var(--shul-sheet-gold, #927638);
    --sheet-band: var(--shul-sheet-band, #eee5d0);
    --sheet-border: var(--shul-sheet-border, #d6cbb4);
    display:block; position:relative; width:100%; height:100%; overflow:hidden;
    background:var(--sheet-background); color:var(--sheet-text);
  }
  *,*::before,*::after { box-sizing:border-box; }
  .original-page { position:absolute; inset:0; min-width:0; min-height:0; overflow:hidden; visibility:hidden; }
  :host([data-sheet-ready="true"]) .original-page { visibility:visible; }
  .original-page .poster.is-onepage {
    --op-ink:var(--sheet-text); --op-band:var(--sheet-band);
    --op-rule:var(--sheet-gold); --op-hair:var(--sheet-border);
    width:100%; height:100%; min-height:0; margin:0; zoom:1!important;
    padding:7px;
    box-shadow:none; background:var(--sheet-background); color:var(--sheet-text);
  }
  /* The source stylesheet owns row padding, leading, column spacing and the
     extra air around multiline prayers. Keep its balanced time runs as separate
     lines at every screen width; the fitter sizes the whole chart to this box.
     Only the outer paper margin is reduced above for the screen. */
  .poster .onepage-title,.poster .onepage-sec-head,.onepage-label,.zman-pair-name { color:var(--sheet-gold); }
  .onepage-times,.onepage-note,.zman-pair-time { color:var(--sheet-text); }
  /* A compact table at the right of each physical column. Every time run
     starts at the same left edge, while long prayer names wrap in a shared,
     bounded label column. Widths use row ems so the existing fitter can grow
     the complete page without changing that table's proportions. */
  .onepage-row {
    display:grid; grid-template-columns:var(--sheet-label-width, 7em) var(--sheet-time-width, 9em);
    justify-content:start; align-items:baseline; gap:0.45em;
  }
  .onepage-label { min-width:0; text-align:right; overflow-wrap:normal; }
  .onepage-row:not(:has(.onepage-times)) .onepage-label { grid-column:1 / -1; }
  .onepage-times { min-width:0; text-align:left; direction:ltr; }
  .onepage-line { display:flex; align-items:flex-end; justify-content:flex-start; white-space:nowrap; }
  .onepage-t { display:inline-block; white-space:nowrap; }
  .onepage-t + .onepage-t::before { content:none; }
  .sheet-time-separator { white-space:pre; }
  .sheet-time-note { display:block; white-space:nowrap; font-size:0.75em; line-height:1.2; margin-bottom:0.1em; }
  .sheet-noted-time { display:inline-flex; flex-direction:column; align-items:flex-start; }
  .onepage-times:has(.zman-pairs) { line-height:1; }
  .zman-pairs { display:flex; justify-content:flex-start; }
  .onepage-row.sheet-measure { grid-template-columns:max-content max-content; }
  .onepage-row.sheet-measure .onepage-label { white-space:nowrap; }
  .onepage-times u { text-decoration-color:currentColor; }
  .page-header,.poster-legend { display:none!important; }
  :host([data-sheet-columns="1"]) .onepage-col + .onepage-col { display:none; }
`;

/** Equal-size groups preserve order and never leave one last time on its own.
 * Seven values become 3+2+2 (or 4+3 when the denser fit is more readable). */
function balancedCounts(length, maximum) {
  const count = Math.ceil(length / maximum), small = Math.floor(length / count), extra = length % count;
  return Array.from({length:count}, (_, index) => small + (index < extra ? 1 : 0));
}

function screenTimeRows(page, data) {
  return [...page.querySelectorAll('.onepage-row')].map((row, index) => ({row,data:data[index],times:row.querySelector('.onepage-times')}));
}

function arrangeTimeRuns(rows, maximum) {
  const timeNode = time => {
    const node = document.createElement('span'); node.className = 'onepage-t';
    if (time.name) {
      node.classList.add('zman-pair');
      const name = document.createElement('span'); name.className = 'zman-pair-name'; name.lang = 'he'; name.textContent = time.name;
      node.append(name);
    }
    const value = document.createElement(time.name ? 'span' : 'bdi');
    if (time.name) value.className = 'zman-pair-time';
    value.dir = 'ltr';
    if (time.underlined) { const underline = document.createElement('u'); underline.textContent = time.text; value.append(underline); }
    else value.textContent = time.text;
    value.append(document.createTextNode(time.mark || ''));
    node.append(value);
    return node;
  };
  for (const {data,times} of rows) {
    if (!times || !data) continue;
    const named = data.times.length > 1 && data.times.every(time => time.name);
    const counts = balancedCounts(data.times.length, maximum);
    const lines = []; let offset = 0;
    for (const count of counts) {
      const line = document.createElement('bdi'); line.className = 'onepage-line' + (named ? ' zman-pairs' : ''); line.dir = 'ltr';
      line.dataset.timeCount = String(count);
      for (let index = 0; index < count; index++) {
        if (index && !named) { const separator = document.createElement('span'); separator.className = 'sheet-time-separator'; separator.textContent = data.sep; line.append(separator); }
        const node = timeNode(data.times[offset + index]);
        // Source notes qualify the first saved time. Stack its own note over
        // that clock, keeping their left edges together; later clocks share
        // the same baseline without inheriting the note's meaning.
        if (!offset && !index && data.note && !named) {
          const note = document.createElement('bdi'); note.className = 'onepage-note sheet-time-note'; note.textContent = data.note;
          node.classList.add('sheet-noted-time'); node.prepend(note);
        }
        line.append(node);
      }
      lines.push(line); offset += count;
    }
    if (!data.times.length && data.note) {
      const note = document.createElement('bdi'); note.className = 'onepage-note sheet-time-note'; note.textContent = data.note; lines.push(note);
    }
    times.replaceChildren(...lines);
  }
}

/** Measure natural widths in row ems, independent of the current fitted size. */
function measureTableRows(rows) {
  rows.forEach(({row}) => row.classList.add('sheet-measure'));
  for (const item of rows) {
    const font = parseFloat(getComputedStyle(item.row).fontSize);
    // offsetWidth stays in the sheet's layout coordinates; a phone/4K stage
    // applies an outer transform that must not change the measured em width.
    item.labelWidth = item.row.querySelector('.onepage-label').offsetWidth / font;
    item.twoLineWidth = 0;
    if (item.times && item.labelWidth > 7) {
      // Word boundaries matter: half a label's unwrapped width can still
      // produce three lines. Measure the narrowest width that really holds
      // this complete label in two lines, instead of widening every label.
      const label = item.row.querySelector('.onepage-label').cloneNode(true);
      label.style.cssText = 'position:absolute;visibility:hidden;white-space:normal;max-width:none;min-width:0;';
      item.row.append(label);
      const lineHeight = parseFloat(getComputedStyle(label).lineHeight) || font * 1.2;
      let low = 7, high = item.labelWidth;
      for (let pass = 0; pass < 10; pass++) {
        const width = (low + high) / 2; label.style.width = width + 'em';
        if (label.scrollHeight <= lineHeight * 2 + 1 && label.scrollWidth <= label.clientWidth + 1) high = width;
        else low = width;
      }
      item.twoLineWidth = high + 0.05;
      label.remove();
    }
    item.timeWidth = Math.max(0,...[...(item.times?.querySelectorAll('.onepage-line,.sheet-time-note') || [])].map(line => line.scrollWidth / font));
  }
  rows.forEach(({row}) => row.classList.remove('sheet-measure'));
}

function tableWidths(rows, byColumn) {
  const groups = new Map();
  for (const item of rows) {
    const key = byColumn ? item.row.closest('.onepage-col') : 'all';
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(item);
  }
  let changed = false;
  for (const items of groups.values()) {
    // A normal short label sets the shared width; longer labels get two
    // complete lines instead of their full unwrapped width.
    const labels = items.filter(item => item.times).map(item => Math.max(Math.min(7,item.labelWidth),item.twoLineWidth));
    const label = Math.max(1,...labels) + 0.03, time = Math.max(1,...items.map(item => item.timeWidth)) + 0.06;
    for (const {row} of items) {
      const labelWidth = `${label.toFixed(3)}em`, timeWidth = `${time.toFixed(3)}em`;
      changed ||= row.style.getPropertyValue('--sheet-label-width') !== labelWidth || row.style.getPropertyValue('--sheet-time-width') !== timeWidth;
      row.style.setProperty('--sheet-label-width',labelWidth);
      row.style.setProperty('--sheet-time-width',timeWidth);
    }
  }
  return changed;
}

/** Returns a promise for the first fitted page. Later size/font changes refit the
 * same page without replacing the announcements or the surrounding schedules. */
export function fitOriginalSheet(box) {
  const host = box.matches?.('.original-sheet-host') ? box : box.querySelector('.original-sheet-host');
  if (!host) return Promise.resolve(null);
  if (host.originalSheetReady) { host.refitOriginalSheet?.(); return host.originalSheetReady; }
  const content = host.querySelector('template.original-sheet-content');
  if (!content) return Promise.resolve(null);
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = STYLE_URL;
  const styles = document.createElement('style'); styles.textContent = hostStyles;
  const page = document.createElement('div'); page.className = 'original-page';
  page.append(content.content.cloneNode(true));
  page.querySelectorAll('.page-header,.poster-legend').forEach((part) => part.remove());
  // Title and all schedule rows remain. The outer Shul View supplies its own
  // shul name, clock, date and location legend.
  content.remove();
  const rows = screenTimeRows(page,JSON.parse(host.dataset.sheetTimes || '[]'));
  delete host.dataset.sheetTimes;
  const loaded = new Promise((resolve) => { stylesheet.onload = resolve; stylesheet.onerror = resolve; });
  shadow.append(stylesheet, styles, page);
  let lastSize = '';
  let assetsReady = false;
  let disposed = false;
  let resize;
  let frame = 0;
  host.disconnectOriginalSheet = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize?.disconnect();
  };
  const fit = () => {
    if (!assetsReady || disposed) return;
    if (!host.isConnected || !host.clientWidth || !host.clientHeight) return;
    const size = `${host.clientWidth}:${host.clientHeight}`;
    // Polls, clock ticks, theme switches, and a ResizeObserver's initial callback
    // do not change the page. Repeatedly running the print fitter moves rows
    // between columns and needlessly exposes intermediate layout to the reader.
    if (size === lastSize) return;
    // Printer margins/minimum type were designed for an eleven-inch sheet.
    // Reclaim those margins inside this shorter screen box, retaining the
    // original rows and full-day boundaries for every calendar year.
    const options = { minimumScale: 0.4, maximumScale: 2, paddingInches: 0.08, fitWidth: true, dayBreakOnly: true, columnCount: Number(host.dataset.sheetColumns), columnBreakAt: host.dataset.sheetBreak ? Number(host.dataset.sheetBreak) : null, observeResize: false };
    const poster = page.querySelector('.poster');
    const candidate = maximum => {
      arrangeTimeRuns(rows,maximum);
      poster.style.setProperty('--op-scale','1');
      measureTableRows(rows);
      tableWidths(rows,false);
      // Fit the complete compact table, rather than limiting the label to a
      // percentage that could shrink every clock despite unused time space.
      layoutPosters(page,options);
      // Column balancing moves whole source sections. Keep widths on their rows
      // during the print fitter's temporary gathering, then reconcile the final
      // physical columns before measuring again.
      let stable = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!tableWidths(rows,true)) { stable = true; break; }
        layoutPosters(page,options);
      }
      // A rare split can alternate as its two tables change width. A shared
      // width across both columns is a deterministic, complete-page fallback.
      if (!stable) { tableWidths(rows,false); layoutPosters(page,options); }
      return Number(poster.style.getPropertyValue('--op-scale'));
    };
    const three = candidate(3);
    const needsFour = rows.some(item => item.data?.times.length > 3);
    const four = needsFour ? candidate(4) : three;
    if (needsFour && three >= four) candidate(3);
    host.dataset.sheetTimesPerLine = String(needsFour && four > three ? 4 : 3);
    lastSize = size;
    host.originalSheetFitCount = (host.originalSheetFitCount || 0) + 1;
    host.dataset.sheetReady = 'true';
    host.dispatchEvent(new CustomEvent('original-sheet-fitted', { bubbles: true }));
  };
  host.refitOriginalSheet = fit;
  host.originalSheetReady = Promise.all([loaded, loadFonts()]).then(() => {
    if (disposed) return host;
    assetsReady = true;
    fit();
    resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host.isConnected) { resize.disconnect(); return; }
        fit();
      });
    });
    resize.observe(host);
    return host;
  });
  return host.originalSheetReady;
}
