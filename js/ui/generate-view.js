import { computeSeasonWeeks } from '../sheets/weeks.js';
import { resolveSettings } from '../settings.js';
import { validatePageSizes, defaultPageSizes } from '../pagination.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { excelSerial } from '../zmanim/solar.js';
import { newId } from '../storage.js';

export function renderGenerate(container, state, tables, onGenerate) {
  const todayHebrewYear = hebrewDateExtended(excelSerial(new Date())).year;
  container.innerHTML = `
    <h2>Generate a sheet</h2>
    <form id="gen-form" class="form-grid">
      <fieldset>
        <legend>Which sheet</legend>
        <label><input type="radio" name="season" value="kayitz" checked> שבת קיץ (Pesach → Sukkos)</label>
        <label><input type="radio" name="season" value="choref"> שבת חורף (Sukkos → Pesach)</label>
        <label>Hebrew year<input type="number" name="hebrewYear" value="${todayHebrewYear}"></label>
        <div class="actions"><button type="submit">Compute weeks</button></div>
      </fieldset>
    </form>
    <div id="gen-preview"></div>
  `;

  container.querySelector('#gen-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const season = fd.get('season');
    const hebrewYear = Number(fd.get('hebrewYear'));
    const settings = resolveSettings(state.settings);
    const { weeks } = computeSeasonWeeks(season, hebrewYear, settings, tables);
    renderPreview(container.querySelector('#gen-preview'), season, hebrewYear, weeks, state, onGenerate);
  });
}

function renderPreview(el, season, hebrewYear, weeks, state, onGenerate) {
  if (weeks.length === 0) {
    el.innerHTML = `<p class="hint">No qualifying Shabbosim found for that range — double check the Hebrew year.</p>`;
    return;
  }
  const defaults = defaultPageSizes(weeks.length);
  el.innerHTML = `
    <p><strong>${weeks.length} weeks</strong> found (${weeks[0].date.toDateString()} – ${weeks[weeks.length - 1].date.toDateString()}).</p>
    <ol class="week-list">${weeks.map((w) => `<li>${w.date.toISOString().slice(0, 10)} — ${esc(w.parsha)}${w.specialParsha ? ' (' + esc(w.specialParsha) + ')' : ''}</li>`).join('')}</ol>
    <form id="page-form" class="form-grid">
      <fieldset>
        <legend>Split across 3 printable pages (must add up to ${weeks.length})</legend>
        <label>Page 1 weeks<input type="number" name="p1" min="0" value="${defaults[0]}"></label>
        <label>Page 2 weeks<input type="number" name="p2" min="0" value="${defaults[1]}"></label>
        <label>Page 3 weeks<input type="number" name="p3" min="0" value="${defaults[2]}"></label>
        <div id="page-error" class="error"></div>
        <div class="actions"><button type="submit">Generate sheet</button></div>
      </fieldset>
    </form>
  `;
  el.querySelector('#page-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const sizes = [Number(fd.get('p1')), Number(fd.get('p2')), Number(fd.get('p3'))];
    const err = validatePageSizes(weeks.length, sizes);
    const errEl = el.querySelector('#page-error');
    if (err) {
      errEl.textContent = err;
      return;
    }
    errEl.textContent = '';
    const sheet = {
      id: newId('sheet'),
      season,
      hebrewYear,
      createdAt: new Date().toISOString(),
      weeks: weeks.map((w) => ({ serial: w.serial, date: w.date.toISOString(), parsha: w.parsha, specialParsha: w.specialParsha })),
      pageSizes: sizes,
      overrides: {},
      style: { ...state.settings.sheetStyle }, // remembers whatever style was last used
    };
    onGenerate(sheet);
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
