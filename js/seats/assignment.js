import { seatsItems } from './model.js';

export const seatsCanDragNames = () => matchMedia('(min-width:701px) and (pointer:fine)').matches;

export function seatsCreateAssignment(root, { getPlan, getMode, onStart, onEnd, onDrop }) {
  let active = null, pending = null, hovered = null, ghost = null, frame = 0, point = null;
  function refresh() {
    root.querySelectorAll('[data-person]').forEach(node => { node.draggable = getMode() === 'people' && seatsCanDragNames(); });
  }
  function targetAt(x, y) {
    const node = document.elementFromPoint(x, y), seat = node?.closest('.room-stage .table-seat[data-seat]');
    if (seat) return { node: seat, tableId: seat.dataset.table, index: Number(seat.dataset.seat) };
    const waiting = node?.closest('#people-list');
    return waiting ? { node: waiting, waiting: true } : null;
  }
  function highlight(target) {
    hovered?.classList.remove('name-drop-target'); hovered = target?.node || null;
    hovered?.classList.add('name-drop-target');
  }
  function autoScroll() {
    if (!active) return;
    const scroll = root.querySelector('.room-scroll');
    if (scroll && point) {
      const box = scroll.getBoundingClientRect(), speed = (value, before, after) => value < before + 28 ? -Math.max(0, before + 28 - value) / 3 : value > after - 28 ? Math.max(0, value - after + 28) / 3 : 0;
      if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) {
        scroll.scrollLeft += speed(point.x, box.left, box.right); scroll.scrollTop += speed(point.y, box.top, box.bottom);
        highlight(targetAt(point.x, point.y));
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }
  function begin(personId, pointer = false, source = null) {
    const plan = getPlan(), person = plan.people.find(person => person.id === personId);
    if (!person) return false;
    active = { personId, planId: plan.id, pointer, copy: false, source };
    source?.classList.add('name-drag-source'); document.body.classList.add('seats-dragging-name');
    if (pointer) {
      ghost = document.createElement('div'); ghost.className = 'seat-drag-label no-print'; ghost.textContent = person.name; document.body.appendChild(ghost);
    }
    onStart(); frame = requestAnimationFrame(autoScroll); return true;
  }
  function finish() {
    const previous = active; active = null; pending = null; point = null;
    cancelAnimationFrame(frame); highlight(null); ghost?.remove(); ghost = null;
    previous?.source?.classList.remove('name-drag-source'); document.body.classList.remove('seats-dragging-name');
    if (previous) onEnd(); return previous;
  }
  function move(event) {
    point = { x: event.clientX, y: event.clientY }; active.copy = event.ctrlKey || event.altKey;
    if (ghost) { ghost.style.left = point.x + 14 + 'px'; ghost.style.top = point.y + 14 + 'px'; }
    const target = targetAt(point.x, point.y); highlight(target); return target;
  }
  root.addEventListener('dragstart', event => {
    const source = event.target.closest('[data-person]');
    if (!source || getMode() !== 'people' || !seatsCanDragNames() || !begin(source.dataset.person, false, source)) return;
    event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('application/x-seats-person', JSON.stringify({ planId: active.planId, personId: active.personId }));
  });
  root.addEventListener('dragover', event => {
    if (!active || active.pointer) return;
    event.preventDefault(); const target = move(event);
    event.dataTransfer.dropEffect = target ? active.copy ? 'copy' : 'move' : 'none';
  });
  root.addEventListener('drop', event => {
    if (!active || active.pointer) return;
    event.preventDefault(); const target = move(event), data = finish();
    if (target) onDrop(data, target);
  });
  document.addEventListener('dragend', () => { if (active && !active.pointer) finish(); }, true);
  root.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || getMode() !== 'people' || !seatsCanDragNames()) return;
    const seat = event.target.closest('.room-stage .table-seat[data-seat]'); if (!seat) return;
    const table = seatsItems(getPlan()).find(table => table.id === seat.dataset.table), personId = table?.seats[Number(seat.dataset.seat)];
    if (personId) pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, personId, source: seat };
  });
  root.addEventListener('pointermove', event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    if (!active) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
      if (!begin(pending.personId, true, pending.source)) { pending = null; return; }
      root.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); move(event);
  });
  root.addEventListener('pointerup', event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    if (!active) { pending = null; return; }
    event.preventDefault(); const target = move(event), data = finish();
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (target) onDrop(data, target);
  });
  root.addEventListener('pointercancel', () => { if (active?.pointer || pending) finish(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && (active || pending)) { event.preventDefault(); finish(); } });
  window.addEventListener('blur', () => { if (active || pending) finish(); });
  return { refresh };
}
