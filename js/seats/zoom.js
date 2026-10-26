export function seatsCreateZoom(root, { getWidth, setWidth, getWhole, onStart, onEnd, onChange }) {
  let pinch = null;
  const elements = () => ({ scroll: root.querySelector('.room-scroll'), stage: root.querySelector('.room-stage') });
  function refresh() {
    const { scroll, stage } = elements(); if (!scroll || !stage) return;
    const output = root.querySelector('#seats-zoom-level');
    if (output) output.textContent = getWidth() ? Math.round(stage.clientWidth / 1200 * 100) + '%' : getWhole() ? 'Whole chart' : 'Fit width';
    const view = root.querySelector('#chart-view');
    if (view) { view.value = getWhole() ? 'whole' : !getWidth() ? 'width' : getWidth() === 1200 ? 'actual' : 'custom'; view.querySelector('[value=custom]').textContent = Math.round(stage.clientWidth / 1200 * 100) + '%'; }
    const minus = root.querySelector('[data-action="zoom-out"]'), plus = root.querySelector('[data-action="zoom-in"]');
    if (minus) minus.disabled = stage.clientWidth <= scroll.clientWidth + 1;
    if (plus) plus.disabled = stage.clientWidth >= Math.max(3600, scroll.clientWidth * 3);
  }
  function apply(width, anchor = null, whole = false) {
    const { scroll, stage } = elements(); if (!scroll || !stage) return;
    const box = stage.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    const clientX = anchor?.clientX ?? viewport.left + scroll.clientWidth / 2;
    const fractionX = (clientX - box.left) / box.width;
    const fractionY = anchor ? (anchor.clientY - box.top) / box.height : 0;
    const clamped = Math.min(Math.max(3600, scroll.clientWidth * 3), Math.max(scroll.clientWidth, Math.round(width)));
    const next = width && clamped > scroll.clientWidth + 1 ? clamped : 0;
    setWidth(next, whole); stage.classList.toggle('is-zoomed', Boolean(next)); stage.classList.toggle('fits-room', whole);
    if (next) stage.style.width = next + 'px'; else { stage.style.removeProperty('width'); scroll.scrollTop = 0; }
    scroll.scrollLeft = next ? fractionX * stage.clientWidth - (clientX - viewport.left) : 0;
    if (anchor) {
      const after = stage.getBoundingClientRect();
      const delta = after.top + fractionY * after.height - anchor.clientY;
      if (getComputedStyle(scroll).overflowY === 'auto') scroll.scrollTop += delta;
      else window.scrollBy({ top: delta, behavior: 'instant' });
    }
    refresh(); onChange();
  }
  const center = touches => ({ clientX: (touches[0].clientX + touches[1].clientX) / 2, clientY: (touches[0].clientY + touches[1].clientY) / 2 });
  const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  root.addEventListener('touchstart', event => {
    if (event.touches.length !== 2 || !event.target.closest('.room-scroll')) return;
    event.preventDefault(); onStart();
    const { stage } = elements(), point = center(event.touches);
    pinch = { distance: distance(event.touches), width: stage.clientWidth, point };
  }, { passive: false });
  root.addEventListener('touchmove', event => {
    if (!pinch) return;
    event.preventDefault();
    if (event.touches.length < 2) return;
    const next = center(event.touches);
    apply(pinch.width * distance(event.touches) / Math.max(1, pinch.distance), pinch.point);
    // Follow the fingers without scheduling a later scroll after the gesture.
    const { scroll } = elements(); scroll.scrollLeft += pinch.point.clientX - next.clientX;
    const deltaY = pinch.point.clientY - next.clientY;
    if (getComputedStyle(scroll).overflowY === 'auto') scroll.scrollTop += deltaY;
    else window.scrollBy({ top: deltaY, behavior: 'instant' });
    pinch.point = next;
  }, { passive: false });
  function end(event) {
    if (!pinch) return;
    if (event.type !== 'touchcancel' && event.touches.length) { event.preventDefault(); return; }
    pinch = null; onEnd(); refresh();
  }
  root.addEventListener('touchend', end, { passive: false });
  root.addEventListener('touchcancel', end, { passive: false });
  window.addEventListener('resize', refresh);
  return { refresh, fit: () => apply(0), fitWhole: () => apply(0, null, true), actual: () => apply(1200),
    increase: () => apply(elements().stage.clientWidth * 1.3),
    decrease: () => apply(elements().stage.clientWidth / 1.3) };
}
