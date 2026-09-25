import { renderOnePagePoster, layoutPosters } from '../../../js/ui/posters-view.js';

// Use the original public schedule page's markup and stylesheet. The complete
// Yamim Noraim and other seasonal sheets retain their original two columns.
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
  // A supplied high-holidays: sheet is one complete two-column page. Only a
  // standalone rh: source without an attached section uses a single column.
  const columns = sheet.sourceId?.startsWith('rh:') && columnBreak === null ? 1 : 2;
  return `<div class="original-sheet-host" data-sheet-columns="${columns}"${columnBreak === null ? '' : ` data-sheet-break="${columnBreak}"`}><template class="original-sheet-content">${html}</template></div>`;
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
  /* Preserve the original page, bands and row rules. Each column
     shares the same 40/60 label/time tracks, so labels may wrap and every time
     run starts at its column's left edge. The source balances long time runs. */
  .onepage-title,.onepage-cols { width:var(--sheet-content-width, 100%); align-self:center; }
  .onepage-row { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 3fr); }
  .onepage-label { min-width:0; text-align:right; }
  .onepage-times { min-width:0; text-align:left; direction:ltr; }
  .onepage-row:not(:has(.onepage-times)) .onepage-label { grid-column:1 / -1; }
  /* The dividing rule sits in the existing gutter. Both physical columns keep
     equal usable widths instead of one losing width to separator padding. */
  .onepage-cols { position:relative; }
  .onepage-col + .onepage-col { border-inline-start:0; padding-inline-start:0; }
  .onepage-cols::after { content:''; position:absolute; inset-block:0; left:50%; border-left:0.75pt solid var(--op-hair); pointer-events:none; }
  .onepage-times u { text-decoration-color:currentColor; }
  .page-header,.poster-legend { display:none!important; }
  :host([data-sheet-columns="1"]) .onepage-cols::after { content:none; }
  :host([data-sheet-columns="1"]) .onepage-col + .onepage-col { display:none; }
`;

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
    const fitWidth = width => {
      poster.style.setProperty('--sheet-content-width',`${width}%`);
      layoutPosters(page,options);
      return parseFloat(getComputedStyle(poster).getPropertyValue('--op-scale')) || 1;
    };
    // First fit the complete page at its original width. Modest narrowing may
    // bring each prayer and time closer, but must never make that text smaller.
    // The 80% floor also keeps the chart from becoming an isolated small table.
    const baseline = fitWidth(100);
    let acceptedWidth = 100;
    const overflows = () => [...page.querySelectorAll('.onepage-col,.onepage-row,.onepage-label,.onepage-times,.onepage-title')]
      .filter(node => node.clientWidth && node.clientHeight)
      .some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);
    for (const width of [95,90,85,80]) {
      const scale = fitWidth(width);
      if (scale + 0.0001 < baseline || overflows()) {
        fitWidth(acceptedWidth);
        break;
      }
      acceptedWidth = width;
    }
    host.dataset.sheetWidth = String(acceptedWidth);
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
