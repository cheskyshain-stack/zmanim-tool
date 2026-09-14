// "Install this app", on the congregation's menu.
//
// The site is installable already: `Page.getInstallabilityErrors` answers with an empty list and
// Chrome fires `beforeinstallprompt` on it. That is the manifest work, and the reason for the
// `display_override` / `display` pair in site.webmanifest (see CLAUDE.md). What was missing is
// anybody being asked.
//
// **Chrome's own bar cannot be summoned.** The one that drops down from the address bar is
// Chrome's, shown when its engagement heuristic is satisfied, and no page can ask for it. What a
// page can do is catch the event Chrome hands it, keep it, and call `prompt()`, which opens the
// same install dialog. That is all of this file.
//
// So there are two ways in, and both end at Chrome's dialog:
//
//   The row on the menu, which is there whenever Chrome says the site can be installed, and is
//   tapped by whoever wants it. This is the reliable one: a tap is a user gesture and Chrome has
//   never refused `prompt()` inside one.
//
//   Once by itself, on a device that has not been asked before (INSTALL_ASK_ONCE). Chrome may
//   refuse that, since a page calling `prompt()` with no gesture behind it is a page opening a
//   dialog nobody asked for, and the rule has moved between versions: measured here it went
//   through, on a desktop Chromium. If a phone refuses it, the refusal costs nothing, because the
//   row is still on the menu underneath. **Turn the automatic ask off by setting this to false**;
//   the row stays either way.
//
// An iPhone gets neither. Safari implements no part of this and there is no dialog on it to open,
// so the row says what to tap instead: Share, then Add to Home Screen. That is the only way onto
// an iPhone's home screen and it is worth the two lines, since half the shul is on one.
//
// Nothing here reaches the admin or the messages page. Those are addresses handed to one or two
// people, and a shul's board is what the neighbourhood opens.

const INSTALL_ASK_ONCE = true;

/** Per device and per browser, like the admin's unlock and the analytics opt out: a browser that
 *  refuses localStorage is asked every visit rather than broken. */
const ASKED_KEY = 'zmanim-install-asked';

const ICON_INSTALL = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>
</svg>`;

/** The event Chrome hands over, kept for as long as it is good for.
 *
 *  Caught at module load rather than when the menu is drawn, because Chrome fires it once and
 *  whoever is not listening at that moment does not get it. The menu is drawn and redrawn many
 *  times over; this is listened for once. */
let offer = null;
let onChange = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Without this Chrome shows its own bar as well as ours on the versions that still have one.
    e.preventDefault();
    offer = e;
    if (onChange) onChange();
  });
  // Installed from our row, from Chrome's own bar, or from the menu: either way there is nothing
  // left to offer, and the row goes rather than sitting there offering it again.
  window.addEventListener('appinstalled', () => {
    offer = null;
    remember();
    if (onChange) onChange();
  });
}

const remember = () => {
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* a browser that will not remember */ }
};
const alreadyAsked = () => {
  try { return Boolean(localStorage.getItem(ASKED_KEY)); } catch { return false; }
};

/** Already on the home screen, which is when there is nothing to offer.
 *
 *  Two questions because the two platforms answer different ones: Chrome runs an installed page in
 *  a standalone display mode, and an iPhone sets navigator.standalone and implements no display
 *  mode at all. */
const isInstalled = () => {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.navigator?.standalone === true;
  } catch { return false; }
};

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '')
  // An iPad on recent iPadOS says it is a Mac, and the touch points are what gives it away.
  || (/macintosh/i.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1);

export const INSTALL_TEXT = {
  offer: 'Install this app',
  ios: 'Add to home screen',
  iosHow: 'Tap Share, then Add to Home Screen.',
};

/** The row for the menu, or nothing at all.
 *
 *  Nothing where the page is already installed, and nothing on a browser that has neither the
 *  event nor a way of its own: a row that does nothing when tapped is worse than no row. */
export function installItemHtml() {
  if (isInstalled()) return '';
  if (offer) {
    return `<button type="button" class="luach-item luach-install no-print" data-install="prompt">
      ${ICON_INSTALL}<span class="luach-item-title">${INSTALL_TEXT.offer}</span>
    </button>`;
  }
  if (isIos()) {
    return `<div class="luach-item luach-install luach-install-ios no-print">
      ${ICON_INSTALL}<span class="luach-item-title">${INSTALL_TEXT.ios}
        <span class="luach-install-how">${INSTALL_TEXT.iosHow}</span></span>
    </div>`;
  }
  return '';
}

/** Opens Chrome's dialog, and lets the row go once it has been answered.
 *
 *  The event is good for one call, so it is dropped either way: somebody who says no is not asked
 *  again by us, and Chrome does not hand out a second event for the same page. */
async function ask() {
  if (!offer) return;
  const event = offer;
  offer = null;
  remember();
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Refused, usually for want of a user gesture. Nothing to say: the menu row is the other way.
  }
  if (onChange) onChange();
}

/** Wire the row, and take the one automatic ask if this device has not had it.
 *
 *  @param root - the drawn menu.
 *  @param redraw - how to draw it again, for when the event arrives after the first paint or the
 *    dialog has just been answered. Chrome decides when to fire, and on a cold load that is often
 *    a moment after the menu is on the screen. */
export function wireInstall(root, redraw) {
  onChange = redraw || null;
  root.querySelector('[data-install="prompt"]')?.addEventListener('click', ask);
  if (INSTALL_ASK_ONCE && offer && !alreadyAsked() && !isInstalled()) ask();
}
