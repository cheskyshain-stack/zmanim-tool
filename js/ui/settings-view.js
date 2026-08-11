import { TIMEZONES } from '../settings.js';
import { renderImageCropper } from './image-crop.js';
import { normalizeRichText } from '../format.js';
import { richTextToolbarHtml, wireRichTextToolbar } from './rich-text.js';

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
        <p class="hint">מנחה and מעריב on the Weekday chart are each a dropdown on every week's cell, not computed — list one option per line below (the first line is what a fresh week starts on); picking "Other…" on the sheet itself lets you type a one-off value for just that week. שחרית is one fixed schedule printed the same on every week's row. The footer note below replaces the regular one above, only on the Weekday chart.</p>
        <label>Default מנחה options (one per line)<textarea name="weekdayDefaultMincha" rows="4">${esc(s.weekdayDefaultMincha)}</textarea></label>
        <label>Default מעריב options (one per line)<textarea name="weekdayDefaultMaariv" rows="4">${esc(s.weekdayDefaultMaariv)}</textarea></label>
        <div class="rt-field-label">שחרית schedule (same every week)</div>
        ${richTextToolbarHtml('Selected text:')}
        <div id="weekday-shacharis-editor" class="cell richtext-field" contenteditable="true" dir="ltr">${s.weekdayShacharis}</div>
        <p class="hint">Click into the שחרית box to edit it. Select some text first, then use the buttons above to underline it or change its size (Ctrl/Cmd+U also toggles underline).</p>
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
  shacharisEditor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      document.execCommand('underline');
    }
  });
  wireRichTextToolbar(container, () => shacharisEditor);

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
      weekdayDefaultMincha: fd.get('weekdayDefaultMincha'),
      weekdayDefaultMaariv: fd.get('weekdayDefaultMaariv'),
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

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
