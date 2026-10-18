/** Android's installed app can draw white navigation buttons over page content.
 *  Only request navy once the real bottom safe area has a matching navy background.
 *  A missing inset retains the working cream theme, rather than hiding the buttons. */
export function wireInstalledSystemBars() {
  const android = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  if (!android || !installed || !window.ResizeObserver) return;
  const viewport = document.querySelector('meta[name="viewport"]');
  const theme = document.querySelector('meta[name="theme-color"]');
  if (!viewport || !theme) return;

  viewport.content = viewport.content.replace(/,?\s*viewport-fit\s*=\s*[^,]+/gi, '') + ', viewport-fit=cover';
  document.documentElement.classList.add('has-system-area');
  const area = document.createElement('div');
  area.className = 'luach-system-area';
  area.setAttribute('aria-hidden', 'true');
  document.body.append(area);
  const update = () => {
    const color = area.getBoundingClientRect().height > 0 ? '#142b46' : '#faf7f0';
    if (theme.content !== color) theme.content = color;
  };
  new ResizeObserver(update).observe(area);
  window.addEventListener('pageshow', update);
  update();
}

/** Read only browser/display information, on the user's Copy details press.
 *  No settings, storage, payment data, network requests or device identifiers. */
export function systemBarsReport() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  probe.setAttribute('aria-hidden', 'true');
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft };
  probe.remove();
  const area = document.querySelector('.luach-system-area');
  const box = area?.getBoundingClientRect();
  return JSON.stringify({
    check: 'app-display-2026-10-18',
    browser: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform,
    modes: Object.fromEntries(['browser', 'standalone', 'minimal-ui', 'fullscreen'].map(mode => [mode, matchMedia(`(display-mode: ${mode})`).matches])),
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    theme: document.querySelector('meta[name="theme-color"]')?.content,
    safeArea: insets,
    systemArea: box ? { height: box.height, top: box.top, bottom: box.bottom, color: getComputedStyle(area).backgroundColor } : null,
    pageSize: { width: innerWidth, height: innerHeight },
    screenSize: { width: screen.width, height: screen.height, ratio: devicePixelRatio },
    visualViewport: window.visualViewport ? { height: visualViewport.height, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } : null,
  }, null, 2);
}
