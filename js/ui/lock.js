// The PIN on the admin screen.
//
// What this is for, said plainly, because it matters for what it is worth: the admin is a
// page on a public site and anybody who guesses /admin/ lands on it. This asks for four
// digits before the program is drawn, so somebody who wanders in is turned away.
//
// What it is not is security. Everything here runs in the reader's own browser, so anybody
// who wants past it can get past it: the check is theirs to run and theirs to skip. Two
// things are done to make it worth the trouble it is rather than a padlock painted on:
//
//  - The PIN is not written anywhere. What ships is a SHA-256 of it with a salt, so reading
//    the source, or the repository, does not hand anyone the number. It is four digits, so
//    the hash could be worked back by trying ten thousand of them; that is a different
//    person from the one this is for.
//  - Nothing behind it is secret anyway. The shul's charts live in this browser's own
//    storage, so a stranger opening the admin gets an empty program, and publishing to the
//    congregation's site needs the publish token, which is not here and is not this.
//
// If the shul ever wants the admin actually closed rather than merely shut, that is a
// different job and not a front-end one: it needs something in front of the site that can
// refuse to serve the page at all.
const LOCK_KEY = 'zmanim-admin-unlock';
/** How long a device stays open once the PIN is entered. The shul asked for three days. */
const LOCK_DAYS = 3;
const LOCK_WINDOW_MS = LOCK_DAYS * 24 * 60 * 60 * 1000;
/** Salted, so the hash is this site's and not one that turns up in a table of hashed PINs. */
const LOCK_SALT = 'lczmanim/admin/v1';
const LOCK_PIN_HASH = '3757a5fadacf69c7ef2e879974dc1c96224d96f07c83f319a9e10c7b838a5c7a';

/** Whether this page asks at all.
 *
 *  Not on the USB copy, which is a folder somebody is holding: file:// has no crypto.subtle
 *  to check a PIN with, and a stick in a drawer is already about as private as the drawer.
 *  Not either where the browser will not give us crypto.subtle for some other reason, an
 *  admin served over plain http on a shul's own network being the one that happens: a gate
 *  that cannot check the answer must not be a gate that never opens. */
export function pinAvailable() {
  return /^https?:$/.test(location.protocol) && Boolean(globalThis.crypto?.subtle);
}

/** When this device last answered, or 0. */
function openedAt() {
  try {
    const at = Number(JSON.parse(localStorage.getItem(LOCK_KEY) || '{}').at);
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

/** Whether the program may be drawn without asking. Three days from the last answer, on
 *  this device and this browser: the mark is in localStorage, so another phone, another
 *  browser, or a private window asks again, which is what was wanted.
 *
 *  A clock that has gone backwards (a device where the date was wrong and got fixed) reads
 *  as not open rather than as open forever, since the difference is checked both ways. */
export function isOpen() {
  if (!pinAvailable()) return true;
  const at = openedAt();
  const since = Date.now() - at;
  return at > 0 && since >= 0 && since < LOCK_WINDOW_MS;
}

/** The four digits, hashed the way the constant above was. */
async function hashOf(pin) {
  const bytes = new TextEncoder().encode(String(pin) + LOCK_SALT);
  const out = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Take the answer. Writes the mark on this device when it is right. */
export async function tryPin(pin) {
  if (!/^\d{4}$/.test(String(pin).trim())) return false;
  if (await hashOf(String(pin).trim()) !== LOCK_PIN_HASH) return false;
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ at: Date.now() }));
  } catch {
    // A browser that will not store it still gets in; it will just ask again next time.
  }
  return true;
}

/** Forget this device, so the next visit asks. Not wired to anything yet: it is here so
 *  "this phone is not mine any more" has an answer that is not clearing site data. */
export function closeLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* nothing to forget */ }
}

/** The screen itself: a mark, four dots and a keypad.
 *
 *  Over the whole window rather than inside the program's page: a lock with the app drawn
 *  behind it looks like a page that failed to load, and this way there is one thing on the
 *  screen and it is the question.
 *
 *  It says nothing about what is behind it, and nothing about how long an answer lasts. A
 *  page that explains it is a shul's zmanim program is an invitation to try four digits, and
 *  a page that says "you will not be asked again for three days" is a page that tells a
 *  stranger how long a device they borrowed stays open.
 *
 *  Its own keypad rather than a text box, which is the difference between this and a form:
 *  on a phone no keyboard slides up over it, and on a desk the number row still works,
 *  because the keys are listened for as well. */
export function renderLock(container, onOpen) {
  container.className = '';
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'];
  const key = (k) => {
    if (k === null) return '<span class="lock-key-gap" aria-hidden="true"></span>';
    if (k === 'del') {
      return `<button type="button" class="lock-key is-del" data-key="del" aria-label="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6H9.5L4 12l5.5 6H20a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="M17 9.5 12.5 14M12.5 9.5 17 14"/>
          </svg>
        </button>`;
    }
    return `<button type="button" class="lock-key" data-key="${k}">${k}</button>`;
  };
  container.innerHTML = `
    <div class="lock-screen" id="lock-screen">
      <div class="lock-panel" id="lock-panel" role="group" aria-label="PIN">
        <span class="lock-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/>
            <path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/>
          </svg>
        </span>
        <div class="lock-dots" id="lock-dots" role="status" aria-live="polite" aria-label="No digits entered">
          ${[0, 1, 2, 3].map(() => '<span class="lock-dot"></span>').join('')}
        </div>
        <div class="lock-keys" id="lock-keys">${keys.map(key).join('')}</div>
      </div>
    </div>`;

  const screen = container.querySelector('#lock-screen');
  const panel = container.querySelector('#lock-panel');
  const dotsBox = container.querySelector('#lock-dots');
  const dots = [...container.querySelectorAll('.lock-dot')];
  document.body.classList.add('is-locked');
  let pin = '';
  let checking = false;

  const paint = () => {
    dots.forEach((d, i) => d.classList.toggle('is-on', i < pin.length));
    dotsBox.setAttribute('aria-label', `${pin.length} of 4 digits entered`);
  };
  const wrong = () => {
    panel.classList.add('is-wrong');
    setTimeout(() => {
      panel.classList.remove('is-wrong');
      pin = '';
      paint();
      checking = false;
    }, 500);
  };
  const done = () => {
    /* A moment of "yes" before the program appears, because four dots going out and a whole
       app arriving in the same frame reads as a glitch rather than as an answer. */
    panel.classList.add('is-open');
    setTimeout(() => {
      document.body.classList.remove('is-locked');
      screen.remove();
      onOpen();
    }, 420);
  };
  const push = async (digit) => {
    if (checking || pin.length >= 4) return;
    pin += digit;
    paint();
    if (pin.length < 4) return;
    checking = true;
    if (await tryPin(pin)) done(); else wrong();
  };
  const back = () => {
    if (checking || !pin) return;
    pin = pin.slice(0, -1);
    paint();
  };

  container.querySelector('#lock-keys').addEventListener('click', (event) => {
    const btn = event.target.closest('.lock-key');
    if (!btn) return;
    if (btn.dataset.key === 'del') back(); else push(btn.dataset.key);
  });
  // The number row and the keypad on a real keyboard, so a desk does not have to use a
  // mouse for four digits. Kept on the window rather than on an input, since there is no
  // input: the whole screen is the control.
  const onKey = (event) => {
    if (!document.body.classList.contains('is-locked')) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (/^\d$/.test(event.key)) { event.preventDefault(); push(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); back(); }
  };
  window.addEventListener('keydown', onKey);
  paint();
}
