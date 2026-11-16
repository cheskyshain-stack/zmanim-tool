import { excelWeekday } from '../hebrew-calendar.js';
import { shulNow } from '../zmanim/solar.js';
import { websiteNow } from '../website-clock.js';
import { weekEndsMins } from '../upcoming.js';
import { currentSerial } from './nav-helpers.js';

export function currentChartWeek(state, settings) {
  const today = shulNow(websiteNow(), settings).serial;
  const shabbos = today + 7 - excelWeekday(today);
  return currentSerial([shabbos, shabbos + 7], settings, serial => weekEndsMins(serial, state, settings));
}

// All decoration is a sibling of .pages, outside every printable/exported sheet.
// Measure painted rectangles so scaled phone charts and full-size charts agree.
export function wireChartCurrentWeek(container, state, settings, onWeekChange) {
  const pages = container.querySelector('.pages'), fit = pages?.parentElement;
  if (!fit) return () => {};
  const layer = document.createElement('div');
  layer.className = 'chart-current-week-layer no-print';
  layer.setAttribute('aria-hidden', 'true'); layer.dataset.html2canvasIgnore = 'true';
  const badge = document.createElement('p');
  badge.className = 'chart-current-week-badge no-print'; badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  container.querySelector('.week-nav-when').after(badge);
  fit.classList.add('has-current-week-layer'); fit.append(layer);
  let frame = 0, disposed = false, lastSerial = null;
  function update() {
    frame = 0;
    if (disposed || !container.isConnected || window.matchMedia('print').matches) return;
    const serial = currentChartWeek(state, settings);
    if (serial !== lastSerial) {
      lastSerial = serial;
      if (onWeekChange?.()) return;
    }
    const rows = [...pages.querySelectorAll(`tr[data-week-serial="${serial}"]`)];
    layer.replaceChildren(); badge.hidden = !rows.length;
    if (!rows.length) return;
    const parsha = rows[0].querySelector('.parsha-cell');
    const name = (parsha?.querySelector('.parsha-cell-name') || parsha)?.innerText.split('\n')[0].trim() || '';
    if (badge.textContent !== (name ? 'This week · ' + name : 'This week')) {
      const label = document.createElement('bdi'); label.textContent = name;
      if (/[\u0590-\u05ff]/.test(name)) label.lang = 'he';
      badge.replaceChildren(document.createTextNode(name ? 'This week · ' : 'This week'), label);
    }
    const base = fit.getBoundingClientRect();
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      // The standing Shacharis panel belongs to every week. Leave it unshaded.
      const panel = row.closest('.page').querySelector('.shacharis-panel')?.getBoundingClientRect();
      const cut = panel && panel.top < rect.bottom && panel.bottom > rect.top && panel.left > rect.left && panel.right < rect.right;
      const segments = cut ? [[rect.left, panel.left], [panel.right, rect.right]] : [[rect.left, rect.right]];
      for (const [left, right] of segments) {
        const band = document.createElement('div'); band.className = 'chart-current-week-band';
        Object.assign(band.style, { left: `${left - base.left}px`, top: `${rect.top - base.top}px`, width: `${right - left}px`, height: `${rect.height}px` });
        layer.append(band);
      }
      const arrow = document.createElement('div'); arrow.className = 'chart-current-week-arrow';
      const edge = row.closest('.page').getBoundingClientRect().right;
      const margin = Math.max(0, edge - rect.right), gap = Math.min(5, margin / 5);
      const width = Math.min(11, rect.height * .65, margin - gap - 1);
      if (width < 2) continue;
      const height = Math.max(3, Math.min(14, rect.height * .8, width * 1.5));
      Object.assign(arrow.style, { left: `${rect.right - base.left + gap}px`, top: `${rect.top - base.top + (rect.height - height) / 2}px`, width: `${width}px`, height: `${height}px` });
      layer.append(arrow);
    }
  }
  function schedule() { if (!disposed) { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); } }
  function wake() { if (document.visibilityState !== 'hidden') schedule(); }
  const observer = new ResizeObserver(schedule); observer.observe(fit); observer.observe(pages);
  window.addEventListener('resize', schedule); window.addEventListener('focus', wake);
  window.addEventListener('pageshow', wake); window.addEventListener('afterprint', schedule);
  document.addEventListener('visibilitychange', wake);
  const timer = setInterval(wake, 60000);
  document.fonts?.ready?.then(schedule); schedule();
  return () => {
    disposed = true; cancelAnimationFrame(frame); clearInterval(timer); observer.disconnect();
    window.removeEventListener('resize', schedule); window.removeEventListener('focus', wake);
    window.removeEventListener('pageshow', wake); window.removeEventListener('afterprint', schedule);
    document.removeEventListener('visibilitychange', wake);
    layer.remove(); badge.remove(); fit.classList.remove('has-current-week-layer');
  };
}
