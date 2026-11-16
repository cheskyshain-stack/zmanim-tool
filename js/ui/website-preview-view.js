import { loadPublished } from '../publish.js';
import { resolveSettings } from '../settings.js';
import { WEBSITE_PREVIEW_PARAM, websiteLocalFields, websitePreviewInstant, websitePreviewURL } from '../website-clock.js';
import { escAttr } from '../util.js';
import { keepPosition } from './keep-position.js';

const WEBSITE_PREVIEW_SELECTION = 'zmanim-website-preview-selection';
const WEBSITE_PREVIEW_PAGES = [['/', 'Home'], ['/week/', 'Zmanim'], ['/chart/', 'Charts'], ['/schedules/', 'Special schedules'], ['/donate/', 'Donate']];

export function renderWebsitePreview(container) {
  let disposed = false, observer = null, previewMessageListener = null, expectedInstant = '';
  const draw = async () => {
    container.innerHTML = '<h2>Website preview</h2><p class="hint" role="status">Loading the published website settings...</p>';
    try {
      const published = await loadPublished();
      if (disposed || !container.isConnected) return;
      const zone = resolveSettings(published.settings).timezone.id;
      const zoneLabel = zone === 'America/New_York' ? 'New York' : zone.replaceAll('_', ' ');
      let selected = { ...websiteLocalFields(new Date(), zone), page: '/', screen: 'auto' };
      try {
        const saved = JSON.parse(sessionStorage.getItem(WEBSITE_PREVIEW_SELECTION));
        if (saved && WEBSITE_PREVIEW_PAGES.some(([path]) => path === saved.page) && ['auto', 'phone', 'desktop'].includes(saved.screen)) {
          websitePreviewInstant(saved.date, saved.time, zone); selected = saved;
        }
      } catch { /* A missing or invalid previous selection starts at the real current time. */ }
      container.innerHTML = `<div class="website-preview-view">
        <h2>Website preview</h2>
        <p class="hint">See the published congregation website at a chosen date and time. This does not change the live site.</p>
        <form id="website-preview-form" class="website-preview-controls">
          <label>Date<input id="website-preview-date" type="date" min="1900-01-01" max="2199-12-31" required></label>
          <label>Time (${escAttr(zoneLabel)})<input id="website-preview-time" type="time" required></label>
          <label>Page<select id="website-preview-page">${WEBSITE_PREVIEW_PAGES.map(([path, name]) => `<option value="${path}">${name}</option>`).join('')}</select></label>
          <label>Screen<select id="website-preview-screen"><option value="auto">Fit available width</option><option value="phone">Phone</option><option value="desktop">Desktop</option></select></label>
          <div class="website-preview-actions"><button type="submit" class="btn-primary">Show preview</button><button type="button" id="website-preview-today">Today</button><a id="website-preview-open" target="_blank" rel="noopener">Open in new tab</a></div>
        </form>
        <div class="website-preview-date-nav" role="group" aria-label="Change preview date">
          <button type="button" id="website-preview-previous" aria-label="Previous day" title="Previous day">−</button>
          <span id="website-preview-day" aria-live="polite" aria-atomic="true"></span>
          <button type="button" id="website-preview-next" aria-label="Next day" title="Next day">+</button>
        </div>
        <p class="hint" id="website-preview-note" role="status" hidden></p>
        <div class="website-preview-canvas"><div class="website-preview-device"><iframe id="website-preview-frame" title="Congregation website preview"></iframe></div></div>
      </div>`;
      const form = container.querySelector('form'), date = form.querySelector('#website-preview-date'), time = form.querySelector('#website-preview-time');
      const page = form.querySelector('#website-preview-page'), screen = form.querySelector('#website-preview-screen');
      const note = container.querySelector('#website-preview-note'), open = form.querySelector('#website-preview-open');
      const previous = container.querySelector('#website-preview-previous'), next = container.querySelector('#website-preview-next');
      const day = container.querySelector('#website-preview-day');
      const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const canvas = container.querySelector('.website-preview-canvas'), device = container.querySelector('.website-preview-device'), frame = container.querySelector('iframe');
      date.value = selected.date; time.value = selected.time; page.value = selected.page; screen.value = selected.screen;
      const size = () => {
        const available = canvas.clientWidth;
        const width = screen.value === 'phone' ? 390 : screen.value === 'desktop' ? 1200 : available;
        const height = screen.value === 'phone' ? 780 : 800;
        const scale = Math.min(1, available / width);
        frame.style.width = width + 'px'; frame.style.height = height + 'px'; frame.style.transform = `scale(${scale})`;
        device.style.width = width * scale + 'px'; device.style.height = height * scale + 'px';
      };
      const show = ({ retainPage = false } = {}) => {
        if (!form.reportValidity()) return;
        try {
          const at = websitePreviewInstant(date.value, time.value, zone);
          let currentURL = frame.getAttribute('src');
          try { currentURL = frame.contentWindow.location.href; } catch { /* A failed frame can be opened again. */ }
          let target = new URL(page.value, location.origin);
          if (retainPage && currentURL) {
            const current = new URL(currentURL, location.origin);
            if (current.origin === location.origin && current.pathname === page.value) target = current;
          }
          const url = websitePreviewURL(target, at.instant).href;
          open.href = url;
          expectedInstant = at.instant.toISOString();
          if (currentURL !== url) frame.src = url;
          day.textContent = dayFormat.format(at.instant);
          previous.disabled = date.value <= date.min; next.disabled = date.value >= date.max;
          selected = { date: date.value, time: time.value, page: page.value, screen: screen.value };
          try { sessionStorage.setItem(WEBSITE_PREVIEW_SELECTION, JSON.stringify(selected)); } catch { /* Preview still works without storage. */ }
          note.textContent = at.repeated ? 'This time occurs twice when the clocks change. The preview uses its first occurrence.' : '';
          note.hidden = !at.repeated; note.classList.remove('error'); size();
        } catch (error) {
          note.textContent = error.message; note.hidden = false; note.classList.add('error');
        }
      };
      form.addEventListener('submit', event => { event.preventDefault(); show(); });
      [date, time, page, screen].forEach(field => field.addEventListener('change', show));
      form.querySelector('#website-preview-today').addEventListener('click', () => {
        const now = websiteLocalFields(new Date(), zone); date.value = now.date; time.value = now.time; show();
      });
      [[previous, -1], [next, 1]].forEach(([button, amount]) => button.addEventListener('click', () => keepPosition(container, () => {
        if (!date.reportValidity()) return;
        date.stepUp(amount); show({ retainPage: true });
      })));
      previewMessageListener = event => {
        if (disposed || event.origin !== location.origin || event.source !== frame.contentWindow
          || event.data?.type !== 'zmanim-website-preview-location' || typeof event.data.url !== 'string') return;
        try {
          const url = new URL(event.data.url);
          if (url.origin !== location.origin || url.searchParams.get(WEBSITE_PREVIEW_PARAM) !== expectedInstant
            || !WEBSITE_PREVIEW_PAGES.some(([path]) => path === url.pathname)) return;
          page.value = url.pathname; open.href = url.href;
          selected.page = url.pathname;
          try { sessionStorage.setItem(WEBSITE_PREVIEW_SELECTION, JSON.stringify(selected)); } catch { /* No remembered selection. */ }
        } catch { /* Ignore unrelated or malformed frame messages. */ }
      };
      window.addEventListener('message', previewMessageListener);
      observer = new ResizeObserver(size); observer.observe(canvas); show();
    } catch {
      if (disposed) return;
      container.innerHTML = '<h2>Website preview</h2><p class="error">The published website settings could not be loaded.</p><button type="button" id="website-preview-retry">Try again</button>';
      container.querySelector('button').addEventListener('click', draw);
    }
  };
  if (!/^https?:$/.test(location.protocol)) container.innerHTML = '<h2>Website preview</h2><p>Website previews are available in the online admin.</p>';
  else draw();
  return () => { disposed = true; observer?.disconnect(); if (previewMessageListener) window.removeEventListener('message', previewMessageListener); };
}
