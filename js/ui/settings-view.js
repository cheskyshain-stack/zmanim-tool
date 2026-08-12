import { TIMEZONES } from '../settings.js';
import { exportStateToFile, importStateFromText } from '../storage.js';
import { renderImageCropper } from './image-crop.js';
import { normalizeRichText } from '../format.js';
import { richTextToolbarHtml, wireRichTextToolbar, applyTimeShorthand } from './rich-text.js';

export function renderSettings(container, state, onSave, onStateReplaced) {
  const s = state.settings;
  container.innerHTML = `
    <h2>Settings</h2>
    <p class="hint">Mirrors the workbook's SETTINGS sheet. Saved in this browser.</p>
    <form id="settings-form" class="form-grid">
      <fieldset>
        <legend>Header &amp; footer</legend>
        <p class="hint">The wordmark (assets/logo-text.png, pulled from the workbook) prints at the top of every page as-is — replace that file to change it. The photo next to it can be replaced and cropped below without touching any files. Everything else here is plain editable text.</p>
        <div id="header-photo-cropper"></div>
        <label>Shul name (used in the Saved Sheets list)<input name="shulName" value="${esc(s.shulName)}"></label>
        <label>Header subtitle (under the logo)<input name="headerSubtitle" value="${esc(s.headerSubtitle)}"></label>
        <label>Header rabbi line (opposite side of the logo)<textarea name="headerRabbiLine" rows="2">${esc(s.headerRabbiLine)}</textarea></label>
        <label>Footer note<textarea name="footerNote" rows="2">${esc(s.footerNote)}</textarea></label>
        <label>Footer address<input name="footerAddress" value="${esc(s.footerAddress)}"></label>
      </fieldset>
      <fieldset>
        <legend>Weekday chart defaults</legend>
        <p class="hint">מנחה and מעריב on the Weekday chart aren't computed — every week's cell starts from the <strong>first line</strong> below, and you edit it per week by typing straight into the cell on the sheet. שחרית is one fixed schedule printed the same on every week's row. The footer note below replaces the regular one above, only on the Weekday chart.</p>
        <p class="hint">Every box here — and every cell on a sheet — takes times as shorthand: type <strong>1220 130</strong> and it becomes <strong>12:20/1:30</strong> when you click away. Select text first to use the buttons below on it.</p>
        ${richTextToolbarHtml('Selected text:')}
        <div class="rt-field-label">Starting מנחה times <span class="hint">— first line is what a new week starts on; the rest are kept as a handy list</span></div>
        <div class="opt-list" id="mincha-options">${optionRows(s.weekdayDefaultMincha)}</div>
        <button type="button" class="opt-add" data-list="mincha-options">+ Add a מנחה line</button>
        <div class="rt-field-label">Starting מעריב times <span class="hint">— first line is what a new week starts on; the rest are kept as a handy list</span></div>
        <div class="opt-list" id="maariv-options">${optionRows(s.weekdayDefaultMaariv)}</div>
        <button type="button" class="opt-add" data-list="maariv-options">+ Add a מעריב line</button>
        <div class="rt-field-label">שחרית schedule (same every week)</div>
        <div id="weekday-shacharis-editor" class="cell richtext-field" contenteditable="true" dir="ltr">${s.weekdayShacharis}</div>
        <label>Weekday chart footer note<textarea name="weekdayFooterNote" rows="3">${esc(s.weekdayFooterNote)}</textarea></label>
      </fieldset>
      <fieldset>
        <legend>Location</legend>
        <label>Location name<input name="locationName" value="${esc(s.locationName)}"></label>
        <label>Latitude<input name="latitude" type="number" step="any" value="${s.latitude}"></label>
        <label>Longitude<input name="longitude" type="number" step="any" value="${s.longitude}"></label>
        <label>Elevation (meters)<input name="elevation" type="number" step="any" value="${s.elevation}"></label>
        <label>Timezone<select name="timezoneId">${TIMEZONES.map((tz) => `<option value="${tz.id}" ${tz.id === s.timezoneId ? 'selected' : ''}>${esc(tz.label)}</option>`).join('')}</select></label>
      </fieldset>
      <fieldset>
        <legend>Display</legend>
        <label>Language
          <select name="language">
            <option value="he" ${s.language === 'he' ? 'selected' : ''}>עברית</option>
            <option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option>
          </select>
        </label>
        <label><input type="checkbox" name="inIsrael" ${s.inIsrael ? 'checked' : ''}> Zmanim used in Eretz Yisroel</label>
      </fieldset>
      <fieldset>
        <legend>Advanced zmanim settings — leave alone unless you know what you're doing</legend>
        <label>Horizon (degrees)<input name="horizon" type="number" step="any" value="${s.horizon}"></label>
        <label>Candle lighting (minutes before sunset)<input name="candleLightingMinutes" type="number" step="any" value="${s.candleLightingMinutes}"></label>
        <label>Ateret Torah Tzais offset (minutes)<input name="ateretTorahTzaisOffset" type="number" step="any" value="${s.ateretTorahTzaisOffset}"></label>
        <label><input type="checkbox" name="useAstronomicalChatzos" ${s.useAstronomicalChatzos ? 'checked' : ''}> Use astronomical chatzos for zmanim</label>
        <label><input type="checkbox" name="useElevation" ${s.useElevation ? 'checked' : ''}> Use elevation for zmanim calculation</label>
        <label><input type="checkbox" name="useGregorianBefore1582" ${s.useGregorianBefore1582 ? 'checked' : ''}> Use Gregorian dates before Oct 15, 1582</label>
      </fieldset>
      <div class="actions"><button type="submit" class="btn-primary">Save settings</button></div>
    </form>
    <form class="form-grid" onsubmit="return false" style="margin-top:1rem">
      <fieldset>
        <legend>Backup</legend>
        <p class="hint">Everything lives in this browser only — settings, saved sheets, and rules. Export downloads it all as one file; Import restores it (e.g. to move to another computer or your phone).</p>
        <div class="backup-row">
          <button type="button" id="export-btn">Export backup</button>
          <label class="file-label" for="import-input">Import backup</label>
          <input id="import-input" type="file" accept="application/json" hidden>
        </div>
      </fieldset>
    </form>
  `;

  container.querySelector('#export-btn').addEventListener('click', () => exportStateToFile(state));
  container.querySelector('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const imported = importStateFromText(text);
      Object.assign(state, imported);
      onStateReplaced();
      showToast('Backup restored');
    } catch (err) {
      alert('Could not read that backup file: ' + err.message);
    }
    e.target.value = '';
  });
  renderImageCropper(container.querySelector('#header-photo-cropper'), s.headerIconImage, (headerIconImage) => {
    onSave({ ...s, headerIconImage }); // saves immediately, independent of the "Save settings" button below
  });

  const shacharisEditor = container.querySelector('#weekday-shacharis-editor');

  // One toolbar serves every rich-text box in the Weekday fieldset, acting on whichever
  // was last focused — tracked on focusin because the toolbar buttons deliberately don't
  // take focus (see wireRichTextToolbar).
  let lastRichField = shacharisEditor;
  container.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('richtext-field')) lastRichField = e.target;
  });
  wireRichTextToolbar(container, () => lastRichField);

  // Shorthand times settle when you leave a box, and Ctrl/Cmd+U underlines, in every one
  // of these boxes — including option rows added after this point, hence the delegation.
  container.addEventListener(
    'blur',
    (e) => {
      if (e.target.classList?.contains('richtext-field')) applyTimeShorthand(e.target);
    },
    true // blur doesn't bubble; capture is how a delegated listener sees it
  );
  container.addEventListener('keydown', (e) => {
    if (e.target.classList?.contains('richtext-field') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      document.execCommand('underline');
    }
  });

  container.querySelectorAll('.opt-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const list = container.querySelector('#' + btn.dataset.list);
      list.insertAdjacentHTML('beforeend', optionRow(''));
      list.lastElementChild.querySelector('.richtext-field').focus();
    });
  });
  container.addEventListener('click', (e) => {
    if (e.target.classList?.contains('opt-remove')) e.target.closest('.opt-row').remove();
  });

  container.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = {
      ...s,
      shulName: fd.get('shulName'),
      headerSubtitle: fd.get('headerSubtitle'),
      headerRabbiLine: fd.get('headerRabbiLine'),
      footerNote: fd.get('footerNote'),
      footerAddress: fd.get('footerAddress'),
      weekdayDefaultMincha: readOptionList(container, 'mincha-options'),
      weekdayDefaultMaariv: readOptionList(container, 'maariv-options'),
      weekdayShacharis: normalizeRichText(shacharisEditor.innerHTML),
      weekdayFooterNote: fd.get('weekdayFooterNote'),
      locationName: fd.get('locationName'),
      latitude: Number(fd.get('latitude')),
      longitude: Number(fd.get('longitude')),
      elevation: Number(fd.get('elevation')),
      timezoneId: fd.get('timezoneId'),
      language: fd.get('language'),
      inIsrael: fd.get('inIsrael') === 'on',
      horizon: Number(fd.get('horizon')),
      candleLightingMinutes: Number(fd.get('candleLightingMinutes')),
      ateretTorahTzaisOffset: Number(fd.get('ateretTorahTzaisOffset')),
      useAstronomicalChatzos: fd.get('useAstronomicalChatzos') === 'on',
      useElevation: fd.get('useElevation') === 'on',
      useGregorianBefore1582: fd.get('useGregorianBefore1582') === 'on',
    };
    onSave(next);
    showToast('Settings saved');
  });
}

/** Saving re-renders this whole view, so any "saved!" state put on the button itself is
 *  wiped the instant it appears — which is exactly why the button felt like it did
 *  nothing. The confirmation lives on <body> instead, outside the part that re-renders. */
function showToast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast no-print';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-in'));
  setTimeout(() => {
    el.classList.remove('toast-in');
    setTimeout(() => el.remove(), 300);
  }, 2000);
}

/** One editable מנחה/מעריב option. These hold real HTML rather than plain text — the
 *  times on the printed board are partly underlined, and the sheet cells they fill in
 *  need to carry that formatting with them. */
function optionRow(html) {
  return `<div class="opt-row">
    <div class="cell richtext-field opt-input" contenteditable="true" dir="ltr">${html}</div>
    <button type="button" class="opt-remove" title="Remove this option">&times;</button>
  </div>`;
}

/** The stored settings value is one option per line (see sheets/weekday.js), so a blank
 *  value still gets one empty row to type into. */
function optionRows(stored) {
  const rows = String(stored || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (rows.length ? rows : ['']).map(optionRow).join('');
}

/** Collects an option list back into the stored one-per-line form. */
function readOptionList(container, id) {
  return [...container.querySelectorAll(`#${id} .opt-input`)]
    .map((el) => normalizeRichText(el.innerHTML))
    .filter(Boolean)
    .join('\n');
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
