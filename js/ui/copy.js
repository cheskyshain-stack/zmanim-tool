// Putting a message on the clipboard, in the four places this program offers to.
//
// **The fallback was behind the wrong test.** Every one of those four asked
// `navigator.clipboard?.writeText` and used the old hidden-textarea route only when that was
// **missing**. That is not how this fails in the field. The API is present almost everywhere
// now, and what it does instead is **be there and refuse**: an in-app browser, a page served
// over plain http, an Android webview, a permissions policy. Then `await` rejects, the catch
// fires, and the fallback that was written for exactly this moment is never reached, because
// the property it was guarding on existed.
//
// So the fallback goes behind the failure rather than behind the feature check. Somebody on the
// congregation's own week page pressed Copy text and got "Copy failed", which is how this was
// found.
//
// **And "Copy failed" on its own is not an answer.** The person wanted the message; being told
// the copying did not work leaves them holding nothing, on a phone, with no way to get at what
// they came for. So when both routes fail the text is put on the screen in a box, already
// selected, for them to copy by hand. A browser that will not let a page touch the clipboard
// will still let a person select text, and that is the one thing that always works.

/** The two ways of copying, tried in order. Never throws; answers whether it worked.
 *
 *  The old route is not a relic. `document.execCommand('copy')` is deprecated and still the
 *  thing that works in the places the modern API is refused, which are exactly the places this
 *  shul's congregation reads the site from: a link opened inside WhatsApp. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Present and refused, which is the common case. Fall through and try the other way.
  }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    /* Off the screen but not display:none and not hidden: a box the browser does not lay out
       cannot be selected, and a selection is what execCommand copies. Fixed rather than
       absolute so that adding it cannot scroll the page under whoever pressed the button. */
    box.style.position = 'fixed';
    box.style.top = '0';
    box.style.opacity = '0';
    box.style.pointerEvents = 'none';
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length); // iOS ignores select() on a readonly field
    const ok = document.execCommand('copy');
    box.remove();
    if (ok) return true;
  } catch {
    // Nothing left to try. The caller shows the text instead.
  }
  return false;
}

/** A button that copies, says so on itself, and hands the text over when it cannot.
 *
 *  `getText` is called on the press rather than when this is wired, because every one of these
 *  builds its message out of the week being looked at, which changes under the button.
 *
 *  It can also throw, and that is a different failure worth telling apart on the screen: the
 *  message could not be built at all, as against built and not copyable. */
export function wireCopyButton(btn, getText) {
  if (!btn) return;
  const said = btn.textContent;
  let box = null;
  btn.addEventListener('click', async () => {
    box?.remove();
    box = null;
    let text;
    try {
      text = await getText();
    } catch (err) {
      console.error('copy: could not build the text', err);
      btn.textContent = 'Nothing to copy';
      setTimeout(() => { btn.textContent = said; }, 2000);
      return;
    }
    if (await copyToClipboard(text)) {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = said; }, 2000);
      return;
    }
    /* Neither route worked, so the reader gets the text itself. Put after the button, selected,
       with one line saying why it is there. Not an alert: an alert cannot be scrolled and a
       message is several lines long. */
    box = document.createElement('div');
    box.className = 'copy-fallback';
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'This browser will not let the page copy for you. The message is here to '
      + 'copy by hand, and it is already selected.';
    const area = document.createElement('textarea');
    area.className = 'copy-fallback-text';
    area.readOnly = true;
    area.rows = Math.min(12, String(text).split('\n').length + 1);
    area.value = text;
    box.append(note, area);
    btn.insertAdjacentElement('afterend', box);
    area.focus();
    area.select();
    area.setSelectionRange(0, String(text).length);
    btn.textContent = said;
  });
}
