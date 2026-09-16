// The Settings screen.
//
// **There is no "Weekday chart defaults" panel and there should not be one again.** It held the
// two שחרית schedules and the Weekday chart's footer note as three editable fields, and the shul
// asked for them taken out and made part of the program. They are WEEKDAY_SHACHARIS,
// WEEKDAY_SHACHARIS_SPECIAL and WEEKDAY_FOOTER_NOTE in settings.js now, read straight from there
// by the chart, the week card, the One sheet, "what is on next" and the messages page alike.
//
// The reason is that they are not a preference. Those seven times are printed on the wall, named
// on the phone and written into the messages the shul sends out, and each of those readers has to
// be saying the same thing: a field that can be typed over in one browser is a way for the paper
// and the message to come apart, with nobody able to see which of them was edited. Changing the
// schedule is changing the program, and a change made here would have to be published to reach
// the congregation's page anyway. See the block comment over the two constants.
import { TIMEZONES } from '../settings.js';
import { exportStateToFile, importStateFromText, isSheetFile, importSheetFromText } from '../storage.js';
import { renderImageCropper } from './image-crop.js';
import { clearLegacyPublishToken } from '../publish.js';
import { renderRules } from './rules-view.js';
import { escAttr } from '../util.js';
import { switchHtml } from './switch.js';

export function renderSettings(container, state, onSave, onStateReplaced, onRulesChange = () => {}) {
  const s = state.settings;
  container.innerHTML = `
    <h2>Settings</h2>
    <p class="hint">Mirrors the workbook's SETTINGS sheet. Saved in this browser.</p>
    <!-- Rules sit outside the form: they are saved as they are made, not by the Save
         button at the bottom, and a nested form is not valid HTML anyway. -->
    <details class="panel" id="rules-panel">
      <summary>Rules</summary>
      <div class="panel-body" id="rules-host"></div>
    </details>
    <form id="settings-form" class="form-grid">
      <details class="panel" open>
        <summary>Header &amp; footer</summary>
        <div class="panel-body">
        <p class="hint">The wordmark (assets/logo-text.png, pulled from the workbook) prints at the top of every page as-is. Replace that file to change it. The photo next to it can be replaced and cropped below without touching any files. Everything else here is plain editable text.</p>
        <div id="header-photo-cropper"></div>
        <label>Shul name (used in the Saved Sheets list)<input name="shulName" value="${escAttr(s.shulName)}"></label>
        <label>Header subtitle (under the logo)<input name="headerSubtitle" value="${escAttr(s.headerSubtitle)}"></label>
        <label>Header rabbi line (opposite side of the logo)<textarea name="headerRabbiLine" rows="2">${escAttr(s.headerRabbiLine)}</textarea></label>
        <label>Footer note<textarea name="footerNote" rows="2">${escAttr(s.footerNote)}</textarea></label>
        <label>Footer address<input name="footerAddress" value="${escAttr(s.footerAddress)}"></label>
      </div>
      </details>
      <details class="panel">
        <summary>Location</summary>
        <div class="panel-body">
        <label>Location name<input name="locationName" value="${escAttr(s.locationName)}"></label>
        <label>Latitude<input name="latitude" type="number" step="any" value="${escAttr(s.latitude)}"></label>
        <label>Longitude<input name="longitude" type="number" step="any" value="${escAttr(s.longitude)}"></label>
        <label>Elevation (meters)<input name="elevation" type="number" step="any" value="${escAttr(s.elevation)}"></label>
        <label>Timezone<select name="timezoneId">${TIMEZONES.map((tz) => `<option value="${tz.id}" ${tz.id === s.timezoneId ? 'selected' : ''}>${escAttr(tz.label)}</option>`).join('')}</select></label>
      </div>
      </details>
      <details class="panel">
        <summary>Display</summary>
        <div class="panel-body">
        <div class="settings-switch">${switchHtml('language', 'Language', [
          // In a bdi: it sits in an otherwise-LTR line beside English and would be
          // reordered against it.
          { value: 'he', label: '<bdi lang="he">עברית</bdi>', on: s.language === 'he' },
          { value: 'en', label: 'English', on: s.language !== 'he' },
        ])}</div>
        <label><input type="checkbox" name="inIsrael" ${s.inIsrael ? 'checked' : ''}> Zmanim used in Eretz Yisroel</label>
      </div>
      </details>
      <details class="panel">
        <summary>Advanced zmanim settings (leave alone unless you know what you're doing)</summary>
        <div class="panel-body">
        <label>Horizon (degrees)<input name="horizon" type="number" step="any" value="${escAttr(s.horizon)}"></label>
        <label>Candle lighting (minutes before sunset)<input name="candleLightingMinutes" type="number" step="any" value="${escAttr(s.candleLightingMinutes)}"></label>
        <label>Ateret Torah Tzais offset (minutes)<input name="ateretTorahTzaisOffset" type="number" step="any" value="${escAttr(s.ateretTorahTzaisOffset)}"></label>
        <label><input type="checkbox" name="useAstronomicalChatzos" ${s.useAstronomicalChatzos ? 'checked' : ''}> Use astronomical chatzos for zmanim</label>
        <label><input type="checkbox" name="useElevation" ${s.useElevation ? 'checked' : ''}> Use elevation for zmanim calculation</label>
        <label><input type="checkbox" name="useGregorianBefore1582" ${s.useGregorianBefore1582 ? 'checked' : ''}> Use Gregorian dates before Oct 15, 1582</label>
      </div>
      </details>
      <div class="actions"><button type="submit" class="btn-primary">Save settings</button></div>
    </form>
    <section class="panel">
      <h3>Automatic charts</h3>
      <p class="hint">The website creates its charts automatically. No publishing key is needed or saved here. Changes to shared website settings are managed through the site repository.</p>
      <p class="hint">If you previously created a GitHub key for this website, revoke it in <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">GitHub token settings</a>. Removing the browser copy does not revoke the key itself.</p>
    </section>
    <form class="form-grid" id="settings-backup" onsubmit="return false">
      <details class="panel">
        <summary>Backup</summary>
        <div class="panel-body">
        <p class="hint">Everything lives in this browser only: settings, saved sheets, and rules. Export downloads it all as one file; Import restores it (e.g. to move to another computer or your phone). Import also takes a single-sheet file saved with "Save a copy" in Saved sheets, and adds it to what you already have rather than replacing anything.</p>
        <div class="backup-row">
          <button type="button" id="export-btn">Export backup</button>
          <label class="file-label" for="import-input">Import backup</label>
          <input id="import-input" type="file" accept="application/json" hidden>
        </div>
      </div>
      </details>
    </form>
  `;

  clearLegacyPublishToken();

  container.querySelector('#export-btn').addEventListener('click', () => exportStateToFile(state));
  container.querySelector('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      // A single-sheet copy is added to what's already here; a full backup replaces it.
      if (isSheetFile(text)) {
        state.sheets.push(importSheetFromText(text));
        onStateReplaced();
        showToast('Sheet added');
      } else {
        Object.assign(state, importStateFromText(text));
        onStateReplaced();
        showToast('Backup restored');
      }
    } catch (err) {
      alert('Could not read that backup file: ' + err.message);
    }
    e.target.value = '';
  });
  renderImageCropper(container.querySelector('#header-photo-cropper'), s.headerIconImage, (headerIconImage) => {
    onSave({ ...s, headerIconImage }); // saves immediately, independent of the "Save settings" button below
  });

  // The Rules screen, whole, inside the first panel. It re-renders into its own host as
  // you add or edit a rule, which leaves the rest of Settings untouched.
  renderRules(container.querySelector('#rules-host'), state, onRulesChange);

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
 *  wiped the instant it appears - which is exactly why the button felt like it did
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

