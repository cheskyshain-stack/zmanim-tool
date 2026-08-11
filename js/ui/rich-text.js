// Shared formatting toolbar for the app's contenteditable fields — the sheet's own cells
// (ui/sheet-view.js) and the שחרית schedule editor in Settings (ui/settings-view.js).
// Underline goes through execCommand, which already handles the add/remove toggle and
// partial selections correctly; text size is a plain <span class="big"> wrap, so what's
// stored stays readable HTML rather than the <font size> tags execCommand would emit.
import { normalizeTimeList, normalizeTimeShorthand } from '../format.js';

/** Toolbar markup. `label` prefixes it (e.g. "Selected text:") when it needs to say what
 *  it acts on. */
export function richTextToolbarHtml(label = '') {
  return `<span class="rt-toolbar no-print">
    ${label ? `<span class="rt-label">${label}</span>` : ''}
    <button type="button" data-rt="underline" title="Underline / remove underline from the selected text"><u>U</u></button>
    <button type="button" data-rt="big" title="Make the selected text bigger">A&plus;</button>
    <button type="button" data-rt="unbig" title="Put the selected text back to normal size">A&minus;</button>
  </span>`;
}

/** `getEditor()` is called per click so callers whose target moves (the sheet's toolbar
 *  acts on whichever cell was last focused) can resolve it late. */
export function wireRichTextToolbar(root, getEditor) {
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
    const normalized = normalizeTimeList(editorEl.textContent);
    if (normalized !== editorEl.textContent) editorEl.textContent = normalized;
    return;
  }
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
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
