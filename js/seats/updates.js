export function seatsCreateUpdates() {
  const current = document.querySelector('meta[name="seats-build"]')?.content;
  const valid = value => /^[a-f0-9]{16}$/.test(value || '');
  if (!/^https?:$/.test(location.protocol) || !valid(current)) return { check: async () => false, protect: () => {} };
  const parameter = 'seats-update', address = new URL(location.href);
  if (address.searchParams.get(parameter) === current) {
    address.searchParams.delete(parameter); history.replaceState(history.state, '', address);
  }
  let pending = '', checking = null, reloading = false, lastCheck = 0, lastActivity = 0;
  let canReload = () => !document.querySelector('form,dialog[open],.seat-editor:not([hidden])'), prepare = () => true;
  function refresh() {
    if (!pending || reloading) return false;
    const target = new URL(location.href);
    if (target.searchParams.get(parameter) === pending) { pending = ''; return false; }
    if (document.hidden || Date.now() - lastActivity < 1500 || !canReload()) return false;
    if (prepare() === false) return false;
    target.searchParams.set(parameter, pending);
    reloading = true; location.replace(target); return true;
  }
  async function check() {
    if (pending) { const refreshed = refresh(); if (refreshed || pending) return refreshed; }
    if (reloading || document.hidden) return false;
    if (checking) return checking;
    if (Date.now() - lastCheck < 5000) return false;
    lastCheck = Date.now();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 4000);
    checking = (async () => {
      try {
        const url = new URL('/seats/version.json', location.href); url.searchParams.set('check', Date.now().toString(36));
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return false;
        const { version } = await response.json();
        if (valid(version) && version !== current) pending = version;
        return refresh();
      } catch { return false; }
      finally { clearTimeout(timeout); checking = null; }
    })();
    return checking;
  }
  for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart', 'scroll', 'dragstart']) {
    window.addEventListener(type, () => { lastActivity = Date.now(); }, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', event => { if (event.persisted) check(); });
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  setInterval(() => { if (pending) refresh(); else if (Date.now() - lastCheck >= 60000) check(); }, 2000);
  return { check, protect: (guard, beforeReload = () => true) => { canReload = guard; prepare = beforeReload; } };
}
