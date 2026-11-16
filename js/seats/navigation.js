// Keep one Seats home entry beneath the open chart or folder.
export function seatsCreateNavigation({ read, restore }) {
  const browser = window.history;
  const key = 'seatsView';
  let applying = false, returning = false;
  const home = { version: 1, screen: 'home', dialog: null };
  const isHome = view => view.screen === 'home' && !view.dialog;
  const current = () => ({ version: 1, ...read() });
  const write = (method, view, url = location.href) => browser[method]({ ...browser.state, [key]: view }, '', url);
  let last = current();
  if (browser.state?.[key]?.version !== 1) {
    const url = location.href, homeUrl = new URL(url);
    homeUrl.searchParams.delete('page');
    write('replaceState', home, homeUrl);
    if (!isHome(last)) write('pushState', last, url);
  }
  function sync() {
    if (applying || returning) return;
    const view = current(), previous = browser.state?.[key];
    if (isHome(view) && previous && !isHome(previous)) {
      returning = true; browser.back(); return;
    }
    if (JSON.stringify(view) !== JSON.stringify(previous)) write(!isHome(view) && isHome(previous || home) ? 'pushState' : 'replaceState', view);
    last = view;
  }
  window.addEventListener('popstate', async event => {
    const view = event.state?.[key];
    if (view?.version !== 1) return;
    returning = false; applying = true;
    try {
      if (await restore(view) === false) write('pushState', last);
      else { last = current(); write('replaceState', last); }
    } finally { applying = false; }
  });
  sync();
  return { sync };
}
