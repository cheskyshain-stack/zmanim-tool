/** In a fitted Android app, Chrome colors the bottom bar from the installed manifest.
 *  Its versioned start URL arrives together with the navy manifest theme. Until that
 *  update, keep cream unless an exposed bottom inset can actually be painted navy.
 *  Keep the launch marker out of shared links and remember it only in this app session. */
export function wireInstalledSystemBars() {
  const url = new URL(location.href);
  const navyLaunch = url.searchParams.get('app-theme') === 'navy-v1';
  if (navyLaunch) {
    url.searchParams.delete('app-theme');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  if (!android || !installed || !window.ResizeObserver) return;
  const theme = document.querySelector('meta[name="theme-color"]');
  if (!theme) return;

  let navyManifest = navyLaunch;
  try {
    navyManifest ||= sessionStorage.getItem('zmanim-installed-theme') === 'navy-v1';
    if (navyLaunch) sessionStorage.setItem('zmanim-installed-theme', 'navy-v1');
  } catch { /* The launch URL is enough for this page when storage is blocked. */ }
  document.documentElement.classList.add('has-system-area');
  const area = document.createElement('div');
  area.className = 'luach-system-area';
  area.setAttribute('aria-hidden', 'true');
  document.body.append(area);
  const update = () => {
    const color = navyManifest || area.getBoundingClientRect().height > 0 ? '#142b46' : '#faf7f0';
    if (theme.content !== color) theme.content = color;
  };
  new ResizeObserver(update).observe(area);
  window.addEventListener('pageshow', update);
  update();
}
