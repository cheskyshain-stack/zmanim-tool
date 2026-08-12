// Shared formatting toolbar for the app's contenteditable fields — the sheet's own cells
// (ui/sheet-view.js) and the שחרית schedule editor in Settings (ui/settings-view.js).
// Underline goes through execCommand, which already handles the add/remove toggle and
// partial selections correctly; text size is a plain <span class="big"> wrap, so what's
// stored stays readable HTML rather than the <font size> tags execCommand would emit.
import { normalizeTimeList, normalizeTimeShorthand } from '../format.js';

/** The modifier key as this machine's user would write it, for the shortcut hints. */
const MOD = /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

/** Toolbar markup. `label` prefixes it (e.g. "Selected text:") when it needs to say what
 *  it acts on. Each button's tooltip names its keyboard shortcut — the toolbar is the
 *  only place they're discoverable. */
export function richTextToolbarHtml(label = '') {
  return `<span class="rt-toolbar no-print">
    ${label ? `<span class="rt-label">${label}</span>` : ''}
    <button type="button" data-rt="underline" title="Underline / remove underline from the selected text  (${MOD}+U)"><u>U</u></button>
    <button type="button" data-rt="big" title="Make the selected text bigger  (${MOD}+Shift+&gt;)">A&plus;</button>
    <button type="button" data-rt="unbig" title="Put the selected text back to normal size  (${MOD}+Shift+&lt;)">A&minus;</button>
  </span>`;
}

/** Ctrl+Shift+> / Ctrl+Shift+< for the size buttons, matching what Word and Google Docs
 *  use. Underline needs nothing: Ctrl+U is already built into contenteditable, and it
 *  fires an input event, so the edit saves the same way a toolbar click does.
 *
 *  One listener for the whole app, resolving the editor from whatever has focus — the
 *  sheet's cells and the Settings שחרית editor both qualify, and neither can be reached
 *  by a keystroke without being focused first. Registered once, since the views that use
 *  the toolbar re-render freely. */
let shortcutsWired = false;
function wireShortcutsOnce() {
  if (shortcutsWired) return;
  shortcutsWired = true;
  document.addEventListener('keydown', (e) => {
    const editor = document.activeElement;
    if (!editor?.isContentEditable || !(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    // Reading both the shifted character and the unshifted key, since which one arrives
    // depends on the keyboard layout.
    const cmd = ['>', '.'].includes(e.key) ? 'big' : ['<', ','].includes(e.key) ? 'unbig' : null;
    if (!cmd) return;
    e.preventDefault();
    applyRichTextCommand(cmd, editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** `getEditor()` is called per click so callers whose target moves (the sheet's toolbar
 *  acts on whichever cell was last focused) can resolve it late. */
export function wireRichTextToolbar(root, getEditor) {
  wireShortcutsOnce();
  root.querySelectorAll('[data-rt]').forEach((btn) => {
    // Without this the button steals focus on press, which collapses the selection in
    // the editor before the click handler ever runs — leaving nothing to format.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const editor = getEditor();
      if (!editor) return;
      applyRichTextCommand(btn.dataset.rt, editor);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

export function applyRichTextCommand(cmd, editor) {
  if (cmd === 'underline') {
    document.execCommand('underline');
    return;
  }
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  if (cmd === 'big') {
    const span = document.createElement('span');
    span.className = 'big';
    span.appendChild(range.extractContents());
    range.insertNode(span);
    reselect(sel, span);
    return;
  }
  if (cmd === 'unbig') {
    // Selection sitting *inside* one big span (the common case — you enlarged a line,
    // then selected part of it): unwrap that whole span rather than splitting it.
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const enclosing = node.closest?.('span.big');
    if (enclosing && editor.contains(enclosing)) {
      enclosing.replaceWith(...enclosing.childNodes);
      return;
    }
    // Otherwise the selection spans several — strip any it fully contains.
    const frag = range.extractContents();
    frag.querySelectorAll('span.big').forEach((s) => s.replaceWith(...s.childNodes));
    range.insertNode(frag);
  }
}

/** Whether a run of text is nothing but times and the punctuation that separates them,
 *  so expanding bare digits in it is unambiguous.
 *
 *  Without this the expansion reaches into ordinary text: "10 דק׳" became "10:00 דק׳"
 *  and "TEST123" became "TEST1:23" — and because it runs on blur, merely clicking into
 *  a cell and back out was enough to rewrite it and save an override. Any letter in the
 *  run means it isn't a bare time list, so leave it alone. In a formatted field this is
 *  applied per text node, so times and words can still coexist there — a line of times
 *  is expanded even when a Hebrew line right above it isn't. */
function isBareTimeList(text) {
  return /\d/.test(text) && !/\p{L}/u.test(text);
}

/** Rewrites shorthand times in place inside a contenteditable ("1220 130" ->
 *  "12:20/1:30"). Call it on blur, not while typing, or it fights the caret.
 *
 *  With no markup in the field it can work on the text wholesale, separators included.
 *  Once part of the text is underlined or resized, it only expands digits within each
 *  text node and leaves separators alone: the spaces between times may then live in
 *  different nodes than the times themselves, and rewriting across that boundary would
 *  mean rebuilding the field's HTML — which would throw away exactly the formatting the
 *  user just applied. */
export function applyTimeShorthand(editorEl) {
  if (!editorEl.children.length) {
    if (!isBareTimeList(editorEl.textContent)) return;
    const normalized = normalizeTimeList(editorEl.textContent);
    if (normalized !== editorEl.textContent) editorEl.textContent = normalized;
    return;
  }
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    if (!isBareTimeList(node.nodeValue)) return;
    const normalized = normalizeTimeShorthand(node.nodeValue);
    if (normalized !== node.nodeValue) node.nodeValue = normalized;
  });
}

function reselect(sel, node) {
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(node);
  sel.addRange(r);
}
