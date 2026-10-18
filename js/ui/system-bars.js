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
