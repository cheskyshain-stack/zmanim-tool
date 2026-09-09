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

/** The screen itself: four digits and nothing else.
 *
 *  Deliberately says nothing about what is behind it. A page that explains it is the zmanim
 *  admin for a shul is an invitation to try four digits; a page asking for a PIN is a closed
 *  door with nothing written on it. */
export function renderLock(container, onOpen) {
  container.className = '';
  container.innerHTML = `
    <div class="lock">
      <form class="lock-card" id="lock-form">
        <h2 class="lock-title">Enter the PIN</h2>
        <input class="lock-pin" id="lock-pin" inputmode="numeric" autocomplete="off"
          pattern="[0-9]*" maxlength="4" aria-label="PIN" autofocus>
        <p class="lock-note" id="lock-note" role="status">This device will not be asked again for ${LOCK_DAYS} days.</p>
        <button type="submit" class="btn-primary">Open</button>
      </form>
    </div>`;
  const form = container.querySelector('#lock-form');
  const box = container.querySelector('#lock-pin');
  const note = container.querySelector('#lock-note');
  box.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await tryPin(box.value)) { onOpen(); return; }
    // The box is emptied rather than left holding a wrong answer to edit, which is how
    // every other PIN pad on a phone behaves.
    box.value = '';
    box.focus();
    note.textContent = 'That is not it. Try again.';
    form.classList.add('is-wrong');
    setTimeout(() => form.classList.remove('is-wrong'), 600);
  });
  // Four digits is the whole answer, so it is taken as soon as there are four of them and
  // the button is there for a keyboard that has no Go on it.
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 4);
    if (box.value.length === 4) form.requestSubmit();
  });
}
