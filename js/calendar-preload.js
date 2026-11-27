let scheduled = false;

/** Warm public message-page assets without opening private messages or marking them read. */
export function preloadCalendar() {
  if (scheduled || location.protocol === 'file:' || navigator.connection?.saveData) return;
  scheduled = true;
  const warm = () => {
    if (!document.querySelector('[data-community-calendar]')) { scheduled = false; return; }
    if (document.visibilityState === 'hidden') {
      document.addEventListener('visibilitychange', warm, { once: true });
      return;
    }
    // Do not prerender the signed-in feed: only warm its public files.
    import('./ui/calendar-view.js').catch(() => {});
    fetch('/messages/', { priority: 'low' }).then(async response => {
      if (!response.ok) return;
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const css = page.querySelector('link[rel="stylesheet"]')?.getAttribute('href');
      if (!css) return;
      const url = new URL(css, new URL('/messages/', location.origin));
      if (url.origin === location.origin && url.pathname.startsWith('/css/')) {
        await fetch(url, { priority: 'low' }).then(result => result.arrayBuffer());
      }
    }).catch(() => { /* A failed warmup must not block the homepage or a later calendar visit. */ });
  };
  if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 500 });
  else setTimeout(warm, 0);
}
