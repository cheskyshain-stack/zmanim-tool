import { renderOnePagePoster, layoutPosters } from '../../../js/ui/posters-view.js';

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
  const columns = sheet.sourceId?.startsWith('rh:') ? 1 : 2;
  return `<div class="original-sheet-host" data-sheet-columns="${columns}"><template class="original-sheet-content">${html}</template></div>`;
}

const hostStyles = `
  :host {
    --sheet-background: var(--shul-sheet-background, #faf7ef);
    --sheet-text: var(--shul-sheet-text, #142a42);
    --sheet-gold: var(--shul-sheet-gold, #927638);
    --sheet-band: var(--shul-sheet-band, #eee5d0);
    --sheet-border: var(--shul-sheet-border, #d6cbb4);
    display:block; position:relative; width:100%; height:100%; overflow:hidden;
    background:var(--sheet-background); color:var(--sheet-text);
  }
  :host-context(.tv-stage[data-theme="dark"]) {
    --sheet-background:var(--shul-sheet-background, #0b1423);
    --sheet-text:var(--shul-sheet-text, #f5f2ea);
    --sheet-gold:var(--shul-sheet-gold, #d8b76a);
    --sheet-band:var(--shul-sheet-band, #142238);
    --sheet-border:var(--shul-sheet-border, #34445c);
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
  .onepage-times u { text-decoration-color:currentColor; }
  .page-header,.poster-legend { display:none!important; }
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
    layoutPosters(page, { minimumScale: 0.4, maximumScale: 2, paddingInches: 0.08, fitWidth: true, dayBreakOnly: true, columnCount: Number(host.dataset.sheetColumns), observeResize: false });
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
