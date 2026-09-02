// Posters: the sheets the shul hangs that are not the zmanim board.
//
// One so far, שבת שובה, and the tab is shaped for the others to follow rather than built
// around the one: pick a poster on the left, it draws on the right, and Print sends what
// is on the screen. Announcements and the Yom Tov schedules land here next.
//
// A poster is a real 8.5in by 11in page in the document, the same way a chart page is, so
// what is on the screen is what comes out of the printer and there is no second layout to
// keep in step. See .poster in app.css and the @page rule in print.css.
import { resolveSettings } from '../settings.js';
import { buildShuvaPoster, shuvaWeekOf, SHUVA_TEXT } from '../posters/shuva.js';
import { printButtonHtml, wirePrintButton } from './print-page.js';
import { fontStackFor } from './sheet-view.js';
import { hebrewLang } from '../util.js';

/** Times New Roman, the face the Word posters the shul already hangs were set in. Fixed
 *  rather than taken from the sheet style: a poster is its own document and does not
 *  change when somebody picks a different font for the board. fontStackFor() adds the
 *  shipped stand-in behind it, so an Android phone with no Times New Roman still gets a
 *  serif Hebrew rather than falling back to a sans. */
const POSTER_FONT = 'Times New Roman';

/** The posters this tab knows how to draw. One entry per poster: what to call it, which
 *  sheets it can come from, and how to build it. */
const POSTERS = [
  {
    key: 'shuva',
    label: 'שבת שובה דרשה',
    sheetsFor: (state) => state.sheets.filter((s) => shuvaWeekOf(s)),
    build: buildShuvaPoster,
    render: renderShuvaPoster,
  },
];

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One time as the boards write it: plain is the main bais medrash, underlined is למטה,
 *  and a * after it is בעזרת נשים. Same three marks as the chart, so somebody reading both
 *  is reading one system. */
function timeHtml(t) {
  const star = t.nashim ? '*' : '';
  return t.underlined ? `<u>${esc(t.text)}</u>${star}` : `${esc(t.text)}${star}`;
}

function renderShuvaPoster(poster, settings) {
  const rabbi = String(settings.headerRabbiLine || '').split('\n').filter(Boolean);
  return `<div class="poster" dir="rtl" style="--poster-font-family: ${esc(fontStackFor(POSTER_FONT))}">
    <img class="poster-head" src="/assets/poster-head.png"
         alt="${esc(settings.shulName)}" width="2016" height="451">
    <div class="poster-rabbi">${rabbi.map((l) => `<div${hebrewLang(l)}>${esc(l)}</div>`).join('')}</div>
    <h2 class="poster-title" lang="he">${esc(SHUVA_TEXT.title)}</h2>
    ${SHUVA_TEXT.lines.map((l) => `<p class="poster-line" lang="he">${esc(l)}</p>`).join('')}
    ${poster.drasha ? `<p class="poster-at" lang="he">${esc(SHUVA_TEXT.at)} <bdi>${esc(poster.drasha)}</bdi></p>` : ''}
    <p class="poster-mincha" lang="he">${esc(SHUVA_TEXT.minchaLabel)}
      <bdi>${poster.mincha.map(timeHtml).join(', ')}</bdi></p>
    ${poster.legend.length ? `<div class="poster-legend">${poster.legend.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
  </div>`;
}

let chosen = POSTERS[0].key;
let chosenSheetId = null;

export function renderPosters(container, state) {
  const settings = resolveSettings(state.settings);
  const poster = POSTERS.find((p) => p.key === chosen) || POSTERS[0];
  const sheets = poster.sheetsFor(state);
  const sheet = sheets.find((s) => s.id === chosenSheetId) || sheets[0] || null;
  const built = sheet ? poster.build(sheet, state, settings) : null;

  container.className = 'is-sheet-view';
  container.innerHTML = `
    <h2 class="no-print">Posters</h2>
    <p class="hint no-print">The sheets the shul hangs that are not the zmanim board. The times come off the chart itself, so a poster is right the year it is printed and every year after.</p>
    <div class="poster-bar no-print">
      <label>Poster
        <select id="poster-pick">
          ${POSTERS.map((p) => `<option value="${p.key}" ${p.key === poster.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </label>
      ${sheets.length > 1
        ? `<label>From
             <select id="poster-sheet">
               ${sheets.map((s) => `<option value="${esc(s.id)}" ${sheet && s.id === sheet.id ? 'selected' : ''}>${esc(s.season)} ${esc(s.hebrewYear)}</option>`).join('')}
             </select>
           </label>`
        : ''}
      ${built ? printButtonHtml() : ''}
    </div>
    ${built
      ? poster.render(built, settings)
      : `<p class="hint no-print">No generated chart covers שבת שובה yet. Generate the season that holds it and this fills in.</p>`}`;

  container.querySelector('#poster-pick')?.addEventListener('change', (e) => {
    chosen = e.target.value;
    chosenSheetId = null;
    renderPosters(container, state);
  });
  container.querySelector('#poster-sheet')?.addEventListener('change', (e) => {
    chosenSheetId = e.target.value;
    renderPosters(container, state);
  });
  if (built) wirePrintButton(container);
}
