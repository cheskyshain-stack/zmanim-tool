import { candleZipLocation, candleTimeAtLocation } from '../candle-lighting-lookup.js';
import { dateFromSerial } from '../zmanim/solar.js';
import { clock, meridiem } from '../upcoming.js';

/** Delegate from the stable homepage so minute-by-minute card replacements still work. */
export function wireCandleLightingDialog(root, settings) {
  let dialog = null, request = null, timer = null, generation = 0, serial = null, trigger = null;
  const cancel = () => { generation++; request?.abort(); request = null; clearTimeout(timer); timer = null; };
  const create = () => {
    dialog = document.createElement('dialog');
    dialog.className = 'luach-candle-dialog no-print';
    dialog.setAttribute('aria-labelledby', 'luach-candle-title');
    dialog.innerHTML = `<button type="button" class="luach-candle-close" aria-label="Close candle-lighting lookup">&times;</button>
      <h2 id="luach-candle-title">Candle lighting</h2>
      <p class="luach-candle-date"></p>
      <form class="luach-candle-form" novalidate>
        <label for="luach-candle-zip">U.S. ZIP code</label>
        <div class="luach-candle-fields"><input id="luach-candle-zip" name="zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" aria-describedby="luach-candle-status" required><button type="submit">Show time</button></div>
      </form>
      <p id="luach-candle-status" class="luach-candle-status" role="status" aria-live="polite"></p>
      <div class="luach-candle-result" hidden><p class="luach-candle-location"></p><p class="luach-candle-clock"></p><p class="luach-candle-zone"></p><p class="luach-candle-day" hidden></p><p class="luach-candle-method"></p></div>
      <p class="luach-candle-credit">ZIP locations: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a></p>`;
    root.appendChild(dialog);
    const form = dialog.querySelector('form'), input = dialog.querySelector('input'), button = form.querySelector('button');
    const status = dialog.querySelector('.luach-candle-status'), result = dialog.querySelector('.luach-candle-result');
    const reset = () => { cancel(); button.disabled = false; form.removeAttribute('aria-busy'); status.textContent = ''; status.classList.remove('is-result'); result.hidden = true; input.removeAttribute('aria-invalid'); };
    input.addEventListener('input', reset);
    form.addEventListener('submit', async event => {
      event.preventDefault(); reset();
      const zip = input.value.trim();
      if (!/^\d{5}$/.test(zip)) {
        status.textContent = 'Enter a five-digit U.S. ZIP code.';
        input.setAttribute('aria-invalid', 'true'); input.focus({ preventScroll: true }); return;
      }
      button.disabled = true; form.setAttribute('aria-busy', 'true'); status.textContent = 'Looking up ZIP code…';
      const current = generation, controller = new AbortController(); request = controller;
      timer = setTimeout(() => controller.abort(), 12000);
      try {
        const location = await candleZipLocation(zip, controller.signal);
        if (current !== generation || !dialog.open) return;
        const time = candleTimeAtLocation(serial, location, settings);
        dialog.querySelector('.luach-candle-location').textContent = location.title;
        dialog.querySelector('.luach-candle-clock').textContent = `${clock(time.mins)} ${meridiem(time.mins)}`;
        dialog.querySelector('.luach-candle-zone').textContent = time.timeZoneName;
        const day = dialog.querySelector('.luach-candle-day');
        day.hidden = time.dayOffset === 0;
        day.textContent = time.dayOffset ? dateFromSerial(serial + time.dayOffset).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : '';
        dialog.querySelector('.luach-candle-method').textContent = `${time.minutesBefore} minutes before sunset, using the ZIP code’s central location.`;
        result.hidden = false; status.textContent = '';
        // Announce the complete result after the independent location/time fields update.
        status.textContent = `${location.title}: ${clock(time.mins)} ${meridiem(time.mins)}, ${time.timeZoneName}${time.dayOffset ? ', ' + day.textContent : ''}.`;
        status.classList.add('is-result');
      } catch (error) {
        if (current !== generation || !dialog.open) return;
        status.classList.remove('is-result');
        status.textContent = error.name === 'AbortError' ? 'The lookup timed out. Please try again.'
          : error instanceof TypeError ? 'Could not connect. Check your internet connection and try again.' : error.message;
      } finally {
        if (current === generation) { clearTimeout(timer); timer = null; request = null; button.disabled = false; form.removeAttribute('aria-busy'); }
      }
    });
    dialog.querySelector('.luach-candle-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => { reset(); status.classList.remove('is-result'); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
  };
  const open = element => {
    if (dialog?.open) return;
    serial = Number(element.dataset.candleDate);
    if (!Number.isInteger(serial)) return;
    trigger = element;
    if (!dialog) create();
    dialog.querySelector('.luach-candle-date').textContent = dateFromSerial(serial).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    dialog.showModal();
    dialog.querySelector('input').focus({ preventScroll: true });
  };
  const click = event => { const element = event.target.closest('[data-candle-date]'); if (element && root.contains(element)) open(element); };
  const key = event => {
    const element = event.target.closest('[data-candle-date]');
    if (element && root.contains(element) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(element); }
  };
  const beforePrint = () => { if (dialog?.open) dialog.close(); };
  root.addEventListener('click', click); root.addEventListener('keydown', key); window.addEventListener('beforeprint', beforePrint);
  return () => { cancel(); root.removeEventListener('click', click); root.removeEventListener('keydown', key); window.removeEventListener('beforeprint', beforePrint); if (dialog?.open) dialog.close(); dialog?.remove(); };
}
