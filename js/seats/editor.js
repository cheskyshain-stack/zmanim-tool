import { escAttr, escText } from '../util.js';
import { seatsWriteName, seatsItems } from './model.js';

export function seatsCreateEditor({ getPlan, commit, seatNode, onSelect, notify }) {
  const card = document.createElement('section');
  card.className = 'seat-editor no-print'; card.hidden = true;
  card.setAttribute('aria-label', 'Edit seat'); document.body.appendChild(card);
  let active = null, copied = '', suggestions = [], highlight = -1;
  const text = value => escText(value), attr = value => escAttr(value);
  const personAt = (tableId, index) => {
    const plan = getPlan(), table = seatsItems(plan).find(entry => entry.id === tableId);
    return plan.people.find(person => person.id === table?.seats[index]);
  };
  function position() {
    if (!active) return;
    const node = seatNode(active.tableId, active.index);
    if (!node) { close(); return; }
    const box = node.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    card.style.left = Math.max(left + 8, Math.min(left + width - card.offsetWidth - 8, box.left)) + 'px';
    const below = box.bottom + 9, above = box.top - card.offsetHeight - 9;
    card.style.top = Math.max(top + 8, Math.min(top + height - card.offsetHeight - 8, below + card.offsetHeight < top + height ? below : above)) + 'px';
  }
  function close() {
    active = null; card.hidden = true;
    document.querySelectorAll('.table-seat.is-active').forEach(node => node.classList.remove('is-active'));
  }
  function save({ personId = null, duplicate = false, next = 0 } = {}) {
    if (!active) return;
    const target = { ...active }, name = card.querySelector('input').value;
    close();
    const ok = commit(() => seatsWriteName(getPlan(), target.tableId, target.index, name, { personId, duplicate }), 'Seat saved.');
    if (!ok) return;
    if (next) {
      const seats = seatsItems(getPlan()).flatMap(table => table.seats.map((_, index) => ({ tableId: table.id, index })));
      const index = seats.findIndex(seat => seat.tableId === target.tableId && seat.index === target.index);
      const destination = seats[(index + next + seats.length) % seats.length];
      if (destination) open(destination.tableId, destination.index);
    } else seatNode(target.tableId, target.index)?.focus({ preventScroll: true });
  }
  function location(person) {
    for (const table of seatsItems(getPlan())) {
      const index = table.seats.indexOf(person.id);
      if (index >= 0) return table.label + ' · Seat ' + (index + 1) + ' · move here';
    }
    return 'Not seated';
  }
  function suggest() {
    if (!active) return;
    const input = card.querySelector('input'), query = input.value.trim().toLocaleLowerCase();
    suggestions = query ? getPlan().people.filter(person => person.name.toLocaleLowerCase().includes(query)).slice(0, 6) : [];
    highlight = -1;
    card.querySelector('.seat-suggestions').innerHTML = suggestions.map((person, index) => `<button type="button" role="option" id="seat-suggestion-${index}" data-suggest="${attr(person.id)}" tabindex="-1" aria-selected="false"><bdi>${text(person.name)}</bdi><small>${text(location(person))}</small></button>`).join('');
    input.setAttribute('aria-expanded', String(suggestions.length > 0)); input.removeAttribute('aria-activedescendant');
    position();
  }
  function open(tableId, index, initial) {
    if (active) save();
    const table = seatsItems(getPlan()).find(entry => entry.id === tableId);
    if (!table || index < 0 || index >= (table.count ?? 0)) return;
    onSelect(tableId);
    active = { tableId, index };
    const name = initial ?? personAt(tableId, index)?.name ?? '';
    card.innerHTML = `<form><div class="seat-editor-heading"><h2>${text(table.label)} · Seat ${index + 1}</h2><button type="button" data-editor="close" aria-label="Close seat editor">×</button></div><label for="seat-name-input">Name</label><input id="seat-name-input" maxlength="160" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="seat-suggestions" aria-expanded="false" value="${attr(name)}" placeholder="Start typing a name..."><div id="seat-suggestions" class="seat-suggestions" role="listbox" aria-label="Matching names"></div><p>Type a new name or choose a suggestion.<br>Enter saves. Tab saves and opens the next seat.</p><div class="seat-editor-actions"><button class="primary" type="submit">Save</button><button type="button" data-editor="clear">Clear</button><button type="button" data-editor="copy">Copy name</button><button type="button" data-editor="paste" ${copied ? '' : 'disabled'}>Paste name</button></div><small>Copy and paste keeps the original seat.</small></form>`;
    card.hidden = false; position();
    const input = card.querySelector('input'); input.focus({ preventScroll: true });
    if (initial === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    suggest(); sync();
  }
  function sync() {
    document.querySelectorAll('.table-seat.is-active').forEach(node => node.classList.remove('is-active'));
    if (active) { seatNode(active.tableId, active.index)?.classList.add('is-active'); position(); }
  }
  function copyName(tableId = active?.tableId, index = active?.index) {
    const name = active && active.tableId === tableId && active.index === index ? card.querySelector('input').value.trim() : personAt(tableId, index)?.name;
    if (!name) { notify('This seat has no name to copy.'); return; }
    copied = name;
    card.querySelector('[data-editor="paste"]')?.removeAttribute('disabled');
    notify('Name copied. Select another seat and use Paste name or Ctrl+V.');
  }
  function pasteName(tableId = active?.tableId, index = active?.index) {
    if (!copied || tableId === undefined) return;
    close();
    commit(() => seatsWriteName(getPlan(), tableId, index, copied, { duplicate: true }), 'Copied name to a separate seat.');
    seatNode(tableId, index)?.focus({ preventScroll: true });
  }
  card.addEventListener('input', event => { if (event.target.matches('input')) suggest(); });
  card.addEventListener('submit', event => { event.preventDefault(); save(); });
  card.addEventListener('pointerdown', event => { if (event.target.closest('[data-suggest]')) event.preventDefault(); });
  card.addEventListener('click', event => {
    const suggestion = event.target.closest('[data-suggest]');
    if (suggestion) return save({ personId: suggestion.dataset.suggest });
    const action = event.target.closest('[data-editor]')?.dataset.editor;
    if (action === 'close') close();
    if (action === 'clear') { card.querySelector('input').value = ''; save(); }
    if (action === 'copy') copyName();
    if (action === 'paste') pasteName();
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); const target = active; close(); seatNode(target.tableId, target.index)?.focus({ preventScroll: true }); }
    if (!event.target.matches('input')) return;
    if (event.key === 'Tab') { event.preventDefault(); save({ next: event.shiftKey ? -1 : 1 }); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault(); highlight = (highlight + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      card.querySelectorAll('[role=option]').forEach((node, index) => node.setAttribute('aria-selected', String(index === highlight)));
      event.target.setAttribute('aria-activedescendant', 'seat-suggestion-' + highlight);
    }
    if (event.key === 'Enter' && highlight >= 0) { event.preventDefault(); save({ personId: suggestions[highlight].id }); }
  });
  window.addEventListener('scroll', position, { passive: true });
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  return { open, close, sync, flush: save, copy: copyName, paste: pasteName };
}
