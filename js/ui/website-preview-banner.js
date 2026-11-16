import { WEBSITE_PREVIEW_PARAM, isWebsitePreview, websiteNow, websitePreviewURL } from '../website-clock.js';

/** Mark a preview clearly, carry its date through real links, and leave live links
 * and the rest of the browser's storage alone. This chrome never reaches paper. */
export function installWebsitePreviewBanner(zone, routes) {
  if (!new URLSearchParams(location.search).has(WEBSITE_PREVIEW_PARAM)) return;
  const meta = document.createElement('meta');
  meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.append(meta);
  const banner = document.createElement('aside');
  banner.className = 'website-preview-banner no-print'; banner.setAttribute('aria-label', 'Website date preview');
  const label = document.createElement('span');
  label.textContent = isWebsitePreview() ? 'Preview: ' + new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(websiteNow()) : 'Invalid preview date. Showing the live website.';
  const exit = document.createElement('a');
  exit.textContent = 'Exit preview'; exit.dataset.websiteLive = 'true';
  exit.hidden = window.parent !== window;
  banner.append(label, exit); document.body.append(banner);
  document.body.classList.add('is-website-preview');
  let notifiedLocation = '';
  const updateLinks = () => {
    const live = new URL(location.href); live.searchParams.delete(WEBSITE_PREVIEW_PARAM); exit.href = live.href;
    if (!isWebsitePreview()) return;
    document.querySelectorAll('main a[href]').forEach(link => {
      if (link.dataset.websiteLive || link.hasAttribute('download')) return;
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { return; }
      const page = url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.origin !== location.origin || !['', ...routes].includes(page)) return;
      const href = websitePreviewURL(url).href;
      if (link.href !== href) link.href = href;
    });
    if (window.parent !== window && notifiedLocation !== location.href) {
      notifiedLocation = location.href;
      window.parent.postMessage({ type: 'zmanim-website-preview-location', url: location.href }, location.origin);
    }
  };
  updateLinks();
  const links = new MutationObserver(updateLinks);
  links.observe(document.getElementById('main'), { childList: true, subtree: true });
  const reserveSpace = () => document.documentElement.style.setProperty('--website-preview-banner-height', banner.getBoundingClientRect().height + 'px');
  reserveSpace();
  if (typeof ResizeObserver === 'function') new ResizeObserver(reserveSpace).observe(banner);
  else window.addEventListener('resize', reserveSpace);
}
