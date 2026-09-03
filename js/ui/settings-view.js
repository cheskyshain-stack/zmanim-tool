import { TIMEZONES } from '../settings.js';
import { exportStateToFile, importStateFromText, isSheetFile, importSheetFromText } from '../storage.js';
import { renderImageCropper } from './image-crop.js';
import { normalizeRichText } from '../format.js';
import { richTextToolbarHtml, wireRichTextToolbar, applyTimeShorthand } from './rich-text.js';
import { getPublishToken, setPublishToken } from '../publish.js';
import { renderRules } from './rules-view.js';
import { escAttr } from '../util.js';

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
        <summary>Weekday chart defaults</summary>
        <div class="panel-body">
        <p class="hint">מנחה and מעריב on the Weekday chart start blank, because those times differ every week, so you type them straight into the cells on the sheet. שחרית is one fixed schedule printed the same on every week's row. The footer note below replaces the regular one above, only on the Weekday chart.</p>
        <p class="hint">This box, and every cell on a sheet, takes times as shorthand: type <strong>1220 130</strong> and it becomes <strong>12:20/1:30</strong> when you click away. Select text first to use the buttons below on it.</p>
        ${richTextToolbarHtml('Selected text:')}
        <div class="rt-field-label">שחרית schedule (every ordinary week)</div>
        <div id="weekday-shacharis-editor" class="cell richtext-field" contenteditable="true" dir="ltr">${s.weekdayShacharis}</div>
        <div class="rt-field-label">שחרית on ר"ח / בה"ב / תענית</div>
        <div id="weekday-shacharis-special-editor" class="cell richtext-field" contenteditable="true" dir="ltr">${s.weekdayShacharisSpecial}</div>
        <p class="hint">The printed chart shows both schedules together, with the ר"ח בה"ב ותענ"צ heading between them, exactly as before. Keeping them apart lets This week show the second one only on the weeks that actually have one of those days, and name which it is.</p>
        <label>Weekday chart footer note<textarea name="weekdayFooterNote" rows="3">${escAttr(s.weekdayFooterNote)}</textarea></label>
      </div>
      </details>
      <details class="panel">
        <summary>Location</summary>
        <div class="panel-body">
        <label>Location name<input name="locationName" value="${escAttr(s.locationName)}"></label>
        <label>Latitude<input name="latitude" type="number" step="any" value="${s.latitude}"></label>
        <label>Longitude<input name="longitude" type="number" step="any" value="${s.longitude}"></label>
        <label>Elevation (meters)<input name="elevation" type="number" step="any" value="${s.elevation}"></label>
        <label>Timezone<select name="timezoneId">${TIMEZONES.map((tz) => `<option value="${tz.id}" ${tz.id === s.timezoneId ? 'selected' : ''}>${escAttr(tz.label)}</option>`).join('')}</select></label>
      </div>
      </details>
      <details class="panel">
        <summary>Display</summary>
        <div class="panel-body">
        <label>Language
          <select name="language">
            <option value="he" ${s.language === 'he' ? 'selected' : ''}>עברית</option>
            <option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option>
          </select>
        </label>
        <label><input type="checkbox" name="inIsrael" ${s.inIsrael ? 'checked' : ''}> Zmanim used in Eretz Yisroel</label>
      </div>
      </details>
      <details class="panel">
        <summary>Advanced zmanim settings (leave alone unless you know what you're doing)</summary>
        <div class="panel-body">
        <label>Horizon (degrees)<input name="horizon" type="number" step="any" value="${s.horizon}"></label>
        <label>Candle lighting (minutes before sunset)<input name="candleLightingMinutes" type="number" step="any" value="${s.candleLightingMinutes}"></label>
        <label>Ateret Torah Tzais offset (minutes)<input name="ateretTorahTzaisOffset" type="number" step="any" value="${s.ateretTorahTzaisOffset}"></label>
        <label><input type="checkbox" name="useAstronomicalChatzos" ${s.useAstronomicalChatzos ? 'checked' : ''}> Use astronomical chatzos for zmanim</label>
        <label><input type="checkbox" name="useElevation" ${s.useElevation ? 'checked' : ''}> Use elevation for zmanim calculation</label>
        <label><input type="checkbox" name="useGregorianBefore1582" ${s.useGregorianBefore1582 ? 'checked' : ''}> Use Gregorian dates before Oct 15, 1582</label>
      </div>
      </details>
      <div class="actions"><button type="submit" class="btn-primary">Save settings</button></div>
    </form>
    <form class="form-grid" id="settings-publish" onsubmit="return false">
      <details class="panel">
        <summary>Publishing</summary>
        <div class="panel-body">
        <p class="hint">Publishing puts the season on the congregation's page at <strong>lczmanim.cjaffa.com</strong>. It writes one file into the site, and GitHub needs a token to allow that.</p>
        <details class="panel">
          <summary>How to make the token</summary>
          <div class="panel-body">
            <ol class="guide-steps">
              <li>Sign in to <strong>github.com</strong>.</li>
              <li>Click your <strong>profile picture</strong>, top right, then <strong>Settings</strong>.</li>
              <li>Scroll to the very bottom of the left sidebar: <strong>Developer settings</strong>.</li>
              <li><strong>Personal access tokens</strong>, then <strong>Fine-grained tokens</strong>.</li>
              <li><strong>Generate new token</strong>.</li>
              <li>Name it anything, for example <code>zmanim publish</code>, and pick an expiry.
                <span class="hint">When it expires, publishing stops until you make a new one and paste it here. A year is reasonable.</span>
              </li>
              <li>Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick <strong>zmanim-tool</strong>.</li>
              <li>Under <strong>Permissions</strong>, click <strong>+ Add permissions</strong>.
                <span class="hint">This is the step that is easy to miss: the list starts empty and says "No repository permissions added yet".</span>
              </li>
              <li>Search for <strong>Contents</strong>, tick it, and add it.</li>
              <li>Its dropdown will say <em>Read-only</em>. Change it to <strong>Read and write</strong>.
                <span class="hint">Metadata adds itself as Read-only. Leave it, it is required.</span>
              </li>
              <li><strong>Generate token</strong> at the bottom, and copy it straight away.
                <span class="hint">It starts with <code>github_pat_</code> and GitHub never shows it again.</span>
              </li>
              <li>Paste it below and press <strong>Save token</strong>.</li>
            </ol>
            <p class="hint">To check it worked, open <strong>This week</strong> and expand <em>Publish for the congregation</em>. A good token shows the publish button and, underneath, what is currently published. A bad one says so in plain words rather than failing quietly: "not allowed to write to this repository" means Contents was left on Read-only.</p>
          </div>
        </details>
        <p class="hint">The token is stored in this browser only, and deliberately kept out of the backup file, so exporting a backup never carries it. Anyone using this computer could take it and change the site, so do not set it on a shared machine. You can revoke it on GitHub at any time.</p>
        <label>Publishing token<input type="password" id="publish-token" autocomplete="off" placeholder="${getPublishToken() ? '' : 'github_pat_...'}" value="${getPublishToken()}"></label>
        <div class="backup-row">
          <button type="button" id="save-token-btn" class="btn-primary">Save token</button>
          <button type="button" id="clear-token-btn" class="btn-danger">Remove token</button>
        </div>
      </div>
      </details>
    </form>
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

  container.querySelector('#save-token-btn').addEventListener('click', () => {
    setPublishToken(container.querySelector('#publish-token').value);
    showToast(getPublishToken() ? 'Publishing token saved' : 'Publishing token removed');
  });
  container.querySelector('#clear-token-btn').addEventListener('click', () => {
    setPublishToken('');
    container.querySelector('#publish-token').value = '';
    showToast('Publishing token removed');
  });

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

  const shacharisEditor = container.querySelector('#weekday-shacharis-editor');
  const shacharisSpecialEditor = container.querySelector('#weekday-shacharis-special-editor');

  // One toolbar serves every rich-text box in the Weekday fieldset, acting on whichever
  // was last focused - tracked on focusin because the toolbar buttons deliberately don't
  // take focus (see wireRichTextToolbar).
  let lastRichField = shacharisEditor;
  container.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('richtext-field')) lastRichField = e.target;
  });
  wireRichTextToolbar(container, () => lastRichField);

  // Shorthand times settle when you leave a box, and Ctrl/Cmd+U underlines, in every one
  // of these boxes - including option rows added after this point, hence the delegation.
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
      weekdayShacharis: normalizeRichText(shacharisEditor.innerHTML),
      weekdayShacharisSpecial: normalizeRichText(shacharisSpecialEditor.innerHTML),
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

