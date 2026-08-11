import { TIMEZONES } from '../settings.js';
import { renderImageCropper } from './image-crop.js';
import { normalizeRichText } from '../format.js';
import { richTextToolbarHtml, wireRichTextToolbar, applyTimeShorthand } from './rich-text.js';

export function renderSettings(container, state, onSave) {
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
        <p class="hint">מנחה and מעריב on the Weekday chart aren't computed — each week's cell starts from the first option below, and you pick a different one (or type straight into the cell) per week on the sheet itself. שחרית is one fixed schedule printed the same on every week's row. The footer note below replaces the regular one above, only on the Weekday chart.</p>
        <p class="hint">Every box in this section takes times as shorthand: type <strong>1220 130</strong> and it becomes <strong>12:20/1:30</strong> when you click away. Select text first to use the buttons below on it.</p>
        ${richTextToolbarHtml('Selected text:')}
        <div class="rt-field-label">Default מנחה options</div>
        <div class="opt-list" id="mincha-options">${optionRows(s.weekdayDefaultMincha)}</div>
        <button type="button" class="opt-add" data-list="mincha-options">+ Add a מנחה option</button>
        <div class="rt-field-label">Default מעריב options</div>
        <div class="opt-list" id="maariv-options">${optionRows(s.weekdayDefaultMaariv)}</div>
        <button type="button" class="opt-add" data-list="maariv-options">+ Add a מעריב option</button>
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
      <div class="actions"><button type="submit">Save settings</button></div>
    </form>
  `;
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
  });
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
