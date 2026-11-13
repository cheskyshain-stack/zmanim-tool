import { escAttr, escText } from '../util.js';
import { shulSessionExpiration } from '../session-expiration.js';

export const SEATS_SESSION_KEY = 'lakewood-commons-seats-session-v1';
export const SEATS_UNLOCK_KEY = 'lakewood-commons-seats-unlock';
const onlineKey = 'lakewood-commons-seats-online-session';

export function seatsSessionValid(session, endpoint, now = Date.now()) {
  return Boolean(session?.version === 1 && typeof session.name === 'string' && session.name.trim()
    && session.endpoint === endpoint && Number.isFinite(session.expires) && session.expires > now
    && (!endpoint || /^[a-f0-9]{64}$/.test(session.token || '')));
}

function storedSession() {
  let raw = null;
  try { raw = localStorage.getItem(SEATS_SESSION_KEY); } catch { /* Try this tab's storage. */ }
  try { if (!raw) raw = sessionStorage.getItem(SEATS_SESSION_KEY); } catch { /* Use the current session in memory. */ }
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}
function persist(session) {
  try { localStorage.setItem(SEATS_SESSION_KEY, JSON.stringify(session)); } catch { /* This visit still works. */ }
  try {
    sessionStorage.setItem(SEATS_UNLOCK_KEY, 'open');
    sessionStorage.setItem(SEATS_SESSION_KEY, JSON.stringify(session));
    if (session.token) sessionStorage.setItem(onlineKey, JSON.stringify(session));
  } catch { /* Keep the current session in memory. */ }
}
function clearSession() {
  try { localStorage.removeItem(SEATS_SESSION_KEY); } catch { /* The current view still locks. */ }
  try { sessionStorage.removeItem(onlineKey); sessionStorage.removeItem(SEATS_SESSION_KEY); sessionStorage.removeItem(SEATS_UNLOCK_KEY); } catch { /* The current view still locks. */ }
}

export async function seatsOpenSession(root, { title = 'Seats', intro = 'Sign in to open charts and name files.', requireOnline = false } = {}) {
  let endpoint = '', configError = '';
  try {
    const response = await fetch('/data/seats-sync.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const config = await response.json();
    if (config.endpoint) {
      const url = new URL(config.endpoint);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();
      endpoint = url.origin;
    }
  } catch { endpoint = storedSession()?.endpoint || ''; configError = 'Could not connect to the website. Check your connection and try again.'; }
  if (requireOnline && !endpoint) throw new Error(configError || 'The shared yahrzeit calendar is unavailable. Reload to try again.');
  let session = storedSession(), profile = session?.name || '';
  try {
    const saved = JSON.parse(localStorage.getItem('lakewood-commons-seats-shared-v1') || 'null');
    if (!profile && typeof saved?.profile === 'string') profile = saved.profile;
  } catch { /* The entry form works without local storage. */ }
  try {
    if (!session) {
      const previous = JSON.parse(sessionStorage.getItem(onlineKey) || 'null');
      if (previous?.endpoint === endpoint && previous.expires > Date.now()) session = { ...previous, version: 1 };
      // Retain an already unlocked offline visit while migrating to timed sign-in.
      else if (!endpoint && !configError && sessionStorage.getItem(SEATS_UNLOCK_KEY) === 'open') session = { version: 1, name: profile || 'Organizer', endpoint, expires: shulSessionExpiration(Date.now()) };
    }
  } catch { /* A malformed old session returns to the entry form. */ }
  if (!seatsSessionValid(session, endpoint)) {
    document.body.classList.add('seats-locked');
    root.innerHTML = `<section class="seats-lock no-print"><img class="seats-lock-photo" src="/assets/shul-240.jpg" alt="" width="240" height="141"><h1>${escText(title)}</h1><p>${escText(intro)}</p><form id="seats-unlock"><label for="seats-name">Your name</label><input id="seats-name" name="name" value="${escAttr(profile)}" maxlength="60" autocomplete="name" required><label for="seats-pin">PIN</label><input id="seats-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="off" required aria-describedby="pin-message"><button class="primary" type="submit">Open ${escText(title)}</button><p id="pin-message" role="status" aria-live="polite"></p></form></section>`;
    if (configError) root.querySelector('#pin-message').textContent = configError;
    session = await new Promise(resolve => root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = root.querySelector('[type=submit]'), message = root.querySelector('#pin-message');
      button.disabled = true; message.textContent = '';
      try {
        if (configError) { location.reload(); return; }
        const name = root.querySelector('#seats-name').value.trim(), pin = root.querySelector('#seats-pin').value;
        if (!name) throw new Error('Enter your name.');
        let result;
        if (endpoint) {
          const response = await fetch(endpoint + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }), cache: 'no-store' });
          result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Sign-in failed. Try again.');
        } else {
          if (!crypto.subtle) throw new Error('Open this page over HTTPS to check the PIN.');
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'lakewood-commons/seats/v1'));
          const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
          if (hash !== 'c5eebef6b017a917b05502fb6016a9dadfd75f31b2e48aa445175a5827a6cc55') throw new Error('That PIN did not match. Try again.');
          result = { name, expires: shulSessionExpiration(Date.now()) };
        }
        resolve({ ...result, name, endpoint, version: 1 });
      } catch (error) {
        message.textContent = error instanceof TypeError || error instanceof SyntaxError ? 'Could not connect. Check your connection and try again.' : error.message;
        root.querySelector('#seats-pin').focus({ preventScroll: true });
      } finally { button.disabled = false; }
    }));
  }
  persist(session); document.body.classList.remove('seats-locked');
  return seatsWatchSession(session);
}

function seatsWatchSession(session) {
  let expired = false, timer, onLock = () => location.reload();
  const lock = (clear = true) => {
    if (expired) return;
    expired = true; clearTimeout(timer);
    if (clear) clearSession();
    else try { sessionStorage.removeItem(onlineKey); sessionStorage.removeItem(SEATS_SESSION_KEY); sessionStorage.removeItem(SEATS_UNLOCK_KEY); } catch { /* A newer session is still available in local storage. */ }
    onLock();
  };
  const check = () => {
    if (expired) return;
    const remaining = session.expires - Date.now();
    if (remaining <= 0) { lock(); return; }
    clearTimeout(timer); timer = setTimeout(check, remaining);
  };
  window.addEventListener('storage', event => {
    if (event.key !== SEATS_SESSION_KEY || expired) return;
    let other = null;
    try { other = JSON.parse(event.newValue || 'null'); } catch { /* A malformed replacement requires sign-in. */ }
    if (!other || other.name !== session.name || other.token !== session.token || other.expires !== session.expires || other.endpoint !== session.endpoint) lock(false);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', check);
  check();
  return { session, lock, onLock: callback => { onLock = callback; } };
}
