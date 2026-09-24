import { renderOnePagePoster, layoutPosters } from '../../../js/ui/posters-view.js';

// Use the original public schedule page's markup, stylesheet and two-column fit.
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
  return `<div class="original-sheet-host"><template class="original-sheet-content">${html}</template></div>`;
}

const hostStyles = `
  :host { display:block; position:relative; width:100%; height:100%; overflow:hidden; background:#fff; color:#000; }
  *,*::before,*::after { box-sizing:border-box; }
  .original-page { position:absolute; inset:0; min-width:0; min-height:0; overflow:hidden; }
  .original-page .poster.is-onepage { width:100%; height:100%; min-height:0; margin:0; zoom:1!important; box-shadow:none; background:#fff; color:#000; }
  .page-header,.poster-legend { display:none!important; }
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
  const fit = () => {
    if (!host.isConnected || !host.clientWidth || !host.clientHeight) return;
    // Printer margins/minimum type were designed for an eleven-inch sheet.
    // Reclaim those margins inside this shorter screen box, retaining the
    // original rows and two-column fitting algorithm for every calendar year.
    layoutPosters(page, { minimumScale: 0.4, paddingInches: 0.08 });
    host.dataset.sheetReady = 'true';
    host.dispatchEvent(new CustomEvent('original-sheet-fitted', { bubbles: true }));
  };
  host.refitOriginalSheet = fit;
  host.originalSheetReady = Promise.all([loaded, loadFonts()]).then(() => {
    fit();
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host.isConnected) { resize.disconnect(); return; }
        fit();
      });
    });
    resize.observe(host);
    host.disconnectOriginalSheet = () => { cancelAnimationFrame(frame); resize.disconnect(); };
    return host;
  });
  return host.originalSheetReady;
}
