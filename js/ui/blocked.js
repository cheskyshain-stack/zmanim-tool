// What a reader sees when a content filter answers in place of this site, and the thing that
// gets them out of it.
//
// Asked for by the shul, and it is the right ask. The screen already said whose fault it was
// not, which stopped a filtered congregant going to a gabbai about the shul's site being empty.
// But it left them with a problem and no move: "a filter would need this address allowed" is
// true and is not something most people know how to act on.
//
// So the screen writes the request for them. It names the site, it names **the exact address
// that was blocked**, which the error already carries, and it is sitting in a box with a Copy
// button under it, ready to send to whoever runs the filter. That turns everybody who hits this
// into somebody who can get it fixed, which is worth more than any number of whitelist requests
// sent from this end: filters are a personal choice here, one household at a time, and the
// person standing in front of the block page is the only one who knows which filter it is.
//
// The address is read off `location` rather than written down, so this keeps naming the right
// site the day it moves to the shul's own domain, and keeps naming the right file whichever of
// them the filter happened to catch.
import { wireCopyButton } from './copy.js';

/** Who the site belongs to, for the request. Written here rather than read from the published
 *  settings, because the settings are in the file the filter just blocked. */
const SHUL = 'Bais Medrash of Lakewood Commons, 44 Coles Way, Lakewood NJ 08701';

/** The message to send to a filter company, naming this site and the address that was refused.
 *
 *  Short on purpose. It is going to be pasted into a form or a text message from a phone, by
 *  somebody who only wants the zmanim, and a page of explanation is a page they will not send. */
export function whitelistRequest(blockedUrl) {
  return [
    'Please allow this website on my filter:',
    '',
    `    ${location.origin}`,
    '',
    `It is the zmanim and davening times for ${SHUL}.`,
    '',
    'The page opens but the times do not show, because this address is being blocked:',
    '',
    `    ${blockedUrl || `${location.origin}/data/`}`,
    '',
    'Please allow the whole site, including every file under it.',
  ].join('\n');
}

/** The blocked screen, whole: what happened, and the request to send about it.
 *
 *  `what` is the one sentence that differs between the congregation's pages, where the zmanim
 *  are what cannot be read, and the admin, where it is the calendar tables. */
export function showBlocked(host, { blockedUrl, what }) {
  const wrap = document.createElement('div');
  wrap.className = 'blocked';

  const lead = document.createElement('p');
  lead.className = 'blocked-lead';
  lead.textContent = `${what} The page itself is fine. Something on this phone or its network, `
    + 'usually a content filter, is answering instead of the site.';

  const ask = document.createElement('p');
  ask.className = 'hint';
  ask.textContent = 'To fix it, send this to whoever runs the filter. It names the site and the '
    + 'exact address being blocked.';

  const text = whitelistRequest(blockedUrl);
  const box = document.createElement('textarea');
  box.className = 'blocked-text';
  box.readOnly = true;
  box.rows = 1;
  box.value = text;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blocked-copy';
  btn.textContent = 'Copy this message';

  wrap.append(lead, ask, box, btn);
  host.replaceChildren(wrap);
  /* Sized to what it actually holds, once it is in the page and has a width.
     Counting the lines in the string and setting `rows` to that was wrong on a phone: the lines
     wrap, so the box was several rows shorter than its contents and the end of the message was
     cut off inside it. The point of showing the message is that it can be read. Re-measured on
     a resize, since turning a phone sideways rewraps every line in it. */
  const fit = () => {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  // The same copy button the rest of the program uses, which matters more here than anywhere:
  // a phone that will not let the page reach the clipboard puts the text on the screen instead,
  // and this screen is already the one for a phone that is refusing things.
  wireCopyButton(btn, () => text);
}
