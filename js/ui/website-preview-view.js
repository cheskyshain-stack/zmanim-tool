import { loadPublished } from '../publish.js';
import { resolveSettings } from '../settings.js';
import { WEBSITE_PREVIEW_PARAM, websiteLocalFields, websitePreviewInstant, websitePreviewURL } from '../website-clock.js';
import { escAttr } from '../util.js';

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
          <p class="hint" id="website-preview-note" role="status" hidden></p>
        </form>
        <div class="website-preview-canvas"><div class="website-preview-device"><iframe id="website-preview-frame" title="Congregation website preview"></iframe></div></div>
      </div>`;
      const form = container.querySelector('form'), date = form.querySelector('#website-preview-date'), time = form.querySelector('#website-preview-time');
      const page = form.querySelector('#website-preview-page'), screen = form.querySelector('#website-preview-screen');
      const note = form.querySelector('#website-preview-note'), open = form.querySelector('#website-preview-open');
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
      const show = () => {
        if (!form.reportValidity()) return;
        try {
          const at = websitePreviewInstant(date.value, time.value, zone);
          const url = websitePreviewURL(new URL(page.value, location.origin), at.instant).href;
          open.href = url;
          expectedInstant = at.instant.toISOString();
          let currentURL = frame.getAttribute('src');
          try { currentURL = frame.contentWindow.location.href; } catch { /* A failed frame can be opened again. */ }
          if (currentURL !== url) frame.src = url;
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
