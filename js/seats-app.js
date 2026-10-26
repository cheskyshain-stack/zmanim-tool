import { escAttr, escText } from './util.js';
import { keepPosition } from './ui/keep-position.js';
import { SEATS_STORAGE_KEY, SEATS_ROOM, SEATS_BOUNDS, SEATS_LAYOUT_VERSION, seatsItems, seatsFront, seatsSyncFront, seatsIsFixed, seatsUid, seatsCreateState, seatsNormalizeState, seatsUpgradePlan, seatsSetCount, seatsAssign, seatsAssigned, seatsAddNames } from './seats/model.js';
import { seatsRoomFeatures, seatsCabinetArt, seatsRavArt } from './seats/room.js';
import { seatsCreateZoom } from './seats/zoom.js';
import { seatsPrintGeometry, seatsPreparePrint } from './seats/print.js';
import { seatsCreateEditor } from './seats/editor.js';
import { seatsReadNames, seatsCsvCell } from './seats/import.js';

// This is the requested casual-entry gate, independent of the existing admin PIN.
async function seatsEntry() {
  const root = document.getElementById('seats-app');
  const unlockKey = 'lakewood-commons-seats-unlock';
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(unlockKey) === 'open'; } catch { /* ask again */ }
  if (unlocked) return seatsStart(root, unlockKey);
  document.body.classList.add('seats-locked');
  root.innerHTML = `<section class="seats-lock no-print"><img src="/assets/logo-building-icon.png" alt="" width="64" height="54"><h1>Seats</h1><p>Enter the four-digit PIN.</p><form id="seats-unlock"><label class="sr-only" for="seats-pin">PIN</label><input id="seats-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required aria-describedby="pin-message"><button class="primary" type="submit">Open Seats</button><p id="pin-message" role="status" aria-live="polite"></p></form><a href="/admin/">Back to admin</a></section>`;
  const form = root.querySelector('form'), input = root.querySelector('input');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!crypto.subtle) { root.querySelector('#pin-message').textContent = 'Open this page over HTTPS to check the PIN.'; return; }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.value + 'lakewood-commons/seats/v1'));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== 'c5eebef6b017a917b05502fb6016a9dadfd75f31b2e48aa445175a5827a6cc55') {
      root.querySelector('#pin-message').textContent = 'That PIN did not match. Try again.';
      input.value = ''; input.focus(); return;
    }
    try { sessionStorage.setItem(unlockKey, 'open'); } catch { /* this visit still opens */ }
    document.body.classList.remove('seats-locked');
    seatsStart(root, unlockKey);
  });
  input.focus({ preventScroll: true });
}

function seatsStart(root, unlockKey) {
  let state = seatsCreateState(), storageError = '', notice = '', mode = 'layout', selected = 'A1';
  let selectedPerson = null, search = '', showAssigned = false, zoom = 0, history = [], future = [], importing = false;
  let overflowTables = new Set(), drag = null, suppressClick = false, conflict = false;
  let storedRaw = null, pinching = false;
  const measure = document.createElement('canvas').getContext('2d');
  try {
    storedRaw = localStorage.getItem(SEATS_STORAGE_KEY);
    if (storedRaw) {
      state = seatsNormalizeState(JSON.parse(storedRaw));
      if (state.plans.some(plan => plan.layoutVersion !== SEATS_LAYOUT_VERSION)) {
        try { if (!localStorage.getItem(SEATS_STORAGE_KEY + '-before-room-v' + SEATS_LAYOUT_VERSION)) localStorage.setItem(SEATS_STORAGE_KEY + '-before-room-v' + SEATS_LAYOUT_VERSION, storedRaw); } catch { /* keep the original until the next save */ }
        let released = 0;
        for (const plan of state.plans) released += seatsUpgradePlan(plan);
        notice = 'Room layout updated. Existing names were kept.' + (released ? ' ' + released + ' people returned to the waiting list after the updated seat counts.' : '');
      }
    }
  } catch {
    if (storedRaw) {
      storageError = 'Your saved plan could not be opened. It has been kept untouched. Download the stored data or restore a saved backup before saving over it.';
      conflict = true;
    } else storageError = 'Changes cannot be saved in this browser. Download a backup before closing this page.';
  }
  const plan = () => state.plans.find(item => item.id === state.activeId);
  const item = () => [...plan().tables, ...plan().objects].find(entry => entry.id === selected);
  const itemBottom = entry => SEATS_BOUNDS.bottom - (entry.type ? 0 : 14);
  const copy = value => JSON.parse(JSON.stringify(value));
  const number = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));
  const html = value => escText(value);
  const attr = value => escAttr(value);
  const svgNumber = value => Math.round(value * 100) / 100;

  const editor = seatsCreateEditor({
    getPlan: plan, commit: change,
    seatNode: (tableId, index) => root.querySelector('.room-stage .table-seat[data-table="' + CSS.escape(tableId) + '"][data-seat="' + index + '"]'),
    onSelect: tableId => { selected = tableId; renderInPlace(); }, notify: alertMessage,
  });

  const zoomControls = seatsCreateZoom(root, {
    getWidth: () => zoom, setWidth: value => { zoom = value; }, onChange: () => editor.sync(),
    onStart: () => {
      pinching = true; suppressClick = true;
      if (drag) { state = drag.before; drag.node.setAttribute('transform', 'translate(' + drag.x + ' ' + drag.y + ')'); drag = null; }
    },
    onEnd: () => { pinching = false; setTimeout(() => { suppressClick = false; }, 100); },
  });

  function save() {
    if (conflict) return false;
    try { const json = JSON.stringify(state); localStorage.setItem(SEATS_STORAGE_KEY, json); storedRaw = json; storageError = ''; return true; }
    catch { storageError = 'Changes cannot be saved in this browser. Download a backup before closing this page.'; return false; }
  }
  function renderInPlace() {
    const scroll = root.querySelector('.room-scroll');
    const position = scroll ? [scroll.scrollLeft, scroll.scrollTop] : [0, 0];
    const peopleTop = root.querySelector('.people-list')?.scrollTop || 0;
    keepPosition(root, render);
    const next = root.querySelector('.room-scroll');
    if (next) { next.scrollLeft = position[0]; next.scrollTop = position[1]; }
    const people = root.querySelector('.people-list'); if (people) people.scrollTop = peopleTop;
    editor.sync(); zoomControls.refresh();
  }
  function change(fn, message = null) {
    const before = copy(state);
    notice = '';
    try { fn(); }
    catch (error) { state = before; notice = error.message; renderInPlace(); return false; }
    if (JSON.stringify(before) === JSON.stringify(state)) {
      if (message !== null) notice = message;
      renderInPlace(); return true;
    }
    history.push(before); future = []; if (history.length > 25) history.shift();
    if (message !== null) notice = message;
    save(); renderInPlace(); return true;
  }
  function alertMessage(message) { notice = message; renderInPlace(); }
  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function wrapped(text, font, width) {
    measure.font = font + 'px Arial';
    const lines = [], words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (measure.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && measure.measureText(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function nameText(name, x, y, width, height, tableId, maxFont = 13) {
    let font = maxFont, lines = [], fits = false;
    for (; font >= 8; font -= 0.5) {
      lines = wrapped(name, font, width - 6);
      const wholeWords = name.split(/\s+/).every(word => measure.measureText(word).width <= width - 6);
      if (wholeWords && lines.length * font * 1.1 <= height - 3) { fits = true; break; }
    }
    if (!fits) {
      font = 8; lines = wrapped(name, font, width - 6);
      if (lines.length * font * 1.1 > height - 3 || lines.some(line => measure.measureText(line).width > width - 6)) overflowTables.add(tableId);
    }
    const start = y + height / 2 - (lines.length - 1) * font * 0.55 + font * 0.33;
    const rtl = /[א-ת]/.test(name) && !/[A-Za-z]/.test(name);
    return `<text class="seat-name" text-anchor="middle" font-size="${font}" direction="${rtl ? 'rtl' : 'ltr'}" style="unicode-bidi:plaintext">${lines.map((line, index) => `<tspan x="${svgNumber(x)}" y="${svgNumber(start + index * font * 1.1)}">${html(line)}</tspan>`).join('')}</text>`;
  }
  function diagram(interactive = true) {
    const current = plan(), geometry = seatsPrintGeometry(current.paper), printScale = interactive ? 1 : geometry.xScale;
    const wideName = (name, x, y, width, height, id, maxFont) => nameText(name, x, y, width * printScale, height, id, maxFont);
    const people = new Map(current.people.map(person => [person.id, person.name]));
    const controls = entry => interactive ? `id="room-item-${attr(entry.id)}" data-item="${attr(entry.id)}" role="button" tabindex="0" aria-label="${attr('Table ' + entry.label + (entry.count === null ? ', seats not set' : ', ' + entry.count + ' seats'))}"` : '';
    const tables = current.tables.map(table => {
      const count = table.count ?? 0, width = table.width / Math.max(1, count);
      const seats = Array.from({ length: count }, (_, index) => {
        const name = people.get(table.seats[index]);
        return `<g data-facing="north" class="table-seat${name ? ' assigned' : ''}" ${interactive ? `id="seat-${attr(table.id)}-${index}" data-seat="${index}" data-table="${attr(table.id)}" role="button" tabindex="0" aria-label="${attr(table.label + ', seat ' + (index + 1) + ': ' + (name || 'empty'))}"` : ''}>
          <rect class="seat-area" x="${svgNumber(index * width + 1)}" y="2" width="${svgNumber(Math.max(1, width - 2))}" height="${table.height - 4}"/>
          ${name ? wideName(name, width * (index + 0.5), 2, width, table.height - 4, table.id) : `<text class="empty-seat" x="${svgNumber(width * (index + 0.5))}" y="${table.height / 2 + 4}" text-anchor="middle">${index + 1}</text>`}
          <path class="chair-marker" d="M${svgNumber(width * (index + 0.5) - 6)} ${table.height + 3} h12 v5 q0 3 -3 3 h-6 q-3 0 -3 -3 z M${svgNumber(width * (index + 0.5) - 4)} ${table.height + 11} v3 m8 0 v-3"/>
        </g>`;
      }).join('');
      return `<g ${controls(table)} transform="translate(${table.x} ${table.y})" class="room-item table-item${interactive && selected === table.id ? ' selected' : ''}">
        <rect class="table-surface" width="${table.width}" height="${table.height}" rx="2"/>
        <g class="drag-handle" aria-label="Move table"><rect x="${table.width / 2 - 24}" y="-18" width="48" height="17" fill="transparent"/><text class="table-label" x="${table.width / 2}" y="-5" text-anchor="middle">${html(table.label)}</text></g>
        ${count ? seats : `<text class="pending-seats" x="${table.width / 2}" y="${table.height / 2 + 4}" text-anchor="middle">${table.count === null ? 'Set seat count' : 'No seats'}</text>`}
      </g>`;
    }).join('');
    const objects = current.objects.map(object => {
      const attributes = interactive ? `id="room-item-${attr(object.id)}" data-item="${attr(object.id)}" role="button" tabindex="0" aria-label="${attr(object.label)}"` : '';
      let art;
      if (object.type === 'cabinet') art = seatsCabinetArt(object, object.height > object.width ? nameText : wideName);
      else if (object.type === 'rav') art = seatsRavArt(object, people, wideName, interactive, printScale);
      else art = `${object.type === 'label' ? '' : `<rect width="${object.width}" height="${object.height}" rx="1" class="object-surface" ${object.type === 'pillar' ? `fill="url(#pillar-${interactive ? 'screen' : 'print'})"` : ''}/>`}${wideName(object.label, object.width / 2, 0, object.width, object.height, object.label)}`;
      return `<g ${attributes} transform="translate(${object.x} ${object.y})" class="room-item room-object${object.type === 'rav' ? ' rav-station' : seatsIsFixed(object) ? ' fixed-fixture' : ' drag-handle'}${interactive && selected === object.id ? ' selected' : ''}">${art}</g>`;
    }).join('');
    return `<svg class="room-diagram${current.monochrome ? ' monochrome' : ''}" viewBox="${interactive ? `0 15 ${SEATS_ROOM.width} ${SEATS_ROOM.height - 15}` : geometry.viewBox}" xmlns="http://www.w3.org/2000/svg" ${interactive ? 'role="group" aria-label="Shul seating layout"' : 'aria-label="Printable seating layout"'}>
      <defs><pattern id="pillar-${interactive ? 'screen' : 'print'}" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M-1 1 l2 -2 M0 6 l6 -6 M5 7 l2 -2" stroke="currentColor" stroke-width="0.7"/></pattern></defs>
      <g class="room-art"${interactive ? '' : ` transform="scale(${printScale} 1)"`}>${seatsRoomFeatures(current)}${objects}${tables}</g>
    </svg>`;
  }
  function tableOptions() {
    return `<optgroup label="Tables">${plan().tables.map(table => `<option value="${attr(table.id)}" ${selected === table.id ? 'selected' : ''}>${html(table.label)}${table.count === null ? ' · seats not set' : ' · ' + table.count + ' seats'}</option>`).join('')}</optgroup>${plan().objects.length ? `<optgroup label="Room objects">${plan().objects.map(object => `<option value="${attr(object.id)}" ${selected === object.id ? 'selected' : ''}>${html(object.label)}</option>`).join('')}</optgroup>` : ''}`;
  }
  function layoutPanel() {
    const entry = item(), isTable = entry && !entry.type, fixed = seatsIsFixed(entry);
    return `<h2>${isTable ? 'Table settings' : entry ? 'Object settings' : 'Room setup'}</h2>
      <label for="selected-item">Selected ${entry?.type ? 'object' : 'table'}</label><select id="selected-item">${tableOptions()}</select>
      ${entry ? `<label for="item-label">Label</label><input id="item-label" value="${attr(entry.label)}" maxlength="80">
        ${isTable ? `<label for="seat-count">Seats at this table</label><input id="seat-count" type="number" min="0" max="16" step="1" placeholder="Not set yet" value="${entry.count ?? ''}"><label class="check-label"><input id="auto-size" type="checkbox" ${entry.autoSize !== false ? 'checked' : ''}> Size table from seat count</label><p class="field-note">Five seats is the standard size. Chairs face the Aron Kodesh.</p>` : ''}
        <div class="field-pair"><div><label for="item-width">Width</label><input id="item-width" type="number" min="${isTable ? 60 : entry.type === 'rav' ? 30 : 20}" max="1100" value="${entry.width}" ${fixed || (isTable && entry.autoSize !== false) ? 'disabled' : ''}></div><div><label for="item-height">Depth</label><input id="item-height" type="number" min="${isTable ? 40 : entry.type === 'rav' ? 70 : 20}" max="600" value="${entry.height}" ${fixed ? 'disabled' : ''}></div></div>
        ${fixed ? '<p class="field-note">Fixed to the back wall.</p>' : `<details class="position-details"><summary>Position &amp; remove</summary><div class="field-pair"><div><label for="item-x">Left</label><input id="item-x" type="number" value="${entry.x}" min="17" max="${SEATS_BOUNDS.right - entry.width}"></div><div><label for="item-y">Top</label><input id="item-y" type="number" value="${entry.y}" min="70" max="${itemBottom(entry) - entry.height}"></div></div><button type="button" class="danger" data-action="remove-item">Remove ${isTable ? 'table' : 'object'}</button></details>`}` : ''}
      <details id="bulk-settings"><summary>Set seats for a column or all tables</summary><label for="bulk-target">Apply to</label><select id="bulk-target"><option value="all">All tables</option>${['A', 'B', 'C', 'D'].map(column => `<option>${column}</option>`).join('')}</select><label for="bulk-count">Seats per table</label><input id="bulk-count" type="number" min="0" max="16" step="1" placeholder="Enter a number"><button type="button" data-action="apply-count">Apply seat count</button></details>
      <div class="room-tools"><h3>Add to room</h3><div class="tool-grid"><button type="button" data-add="table">+ Table</button><button type="button" data-add="pillar">+ Pillar</button><button type="button" data-add="cabinet">+ Sefarim cabinet</button><button type="button" data-add="bimah">+ Bimah</button><button type="button" data-add="amud">+ Amud</button><button type="button" data-add="label">+ Label</button></div></div>
      <p class="field-note">Drag a table label or room object to move it. Scroll anywhere on a table. Arrow keys move a focused item.</p>`;
  }
  function locationOf(personId) {
    for (const table of seatsItems(plan())) {
      const index = table.seats.indexOf(personId);
      if (index >= 0) return table.label + ' · Seat ' + (index + 1);
    }
    return 'Needs a seat';
  }
  function peopleList() {
    const assigned = seatsAssigned(plan());
    const people = plan().people.filter(person => (showAssigned || !assigned.has(person.id)) && person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    return people.length ? people.map(person => `<div class="person-row${selectedPerson === person.id ? ' active' : ''}"><button type="button" class="person-name" data-person="${attr(person.id)}" aria-pressed="${selectedPerson === person.id}"><bdi>${html(person.name)}</bdi><small>${html(locationOf(person.id))}</small></button><button type="button" class="person-edit" data-edit-person="${attr(person.id)}" aria-label="${attr('Edit ' + person.name)}">✎</button></div>`).join('') : `<p class="empty-list">${plan().people.length ? 'No matching people.' : 'Add names below or upload a list.'}</p>`;
  }
  function peoplePanel() {
    const assigned = seatsAssigned(plan()), table = seatsItems(plan()).find(entry => entry.id === selected);
    return `<h2>People</h2><p class="people-summary">${plan().people.length - assigned.size} waiting for a seat</p><label class="sr-only" for="people-search">Search names</label><input id="people-search" type="search" placeholder="Search names..." value="${attr(search)}"><label class="check-label"><input id="show-assigned" type="checkbox" ${showAssigned ? 'checked' : ''}> Include seated people</label><div id="people-list" class="people-list">${peopleList()}</div>
      <p class="field-note">Click any seat and type. Choose an existing name from the suggestions, or enter a new name.</p>
      <details id="manual-names"><summary>Add names</summary><label for="new-names">One name per line</label><textarea id="new-names" rows="4" placeholder="English or Hebrew names"></textarea><button type="button" data-action="add-names">Add names</button></details>
      <details id="seat-list"><summary>Choose a seat from a list</summary><label for="selected-item">Table</label><select id="selected-item">${tableOptions()}</select>${table?.count ? `<div class="seat-list">${table.seats.map((id, index) => `<button type="button" data-open-seat="${index}" data-table="${attr(table.id)}">${index + 1}. <bdi>${html(plan().people.find(person => person.id === id)?.name || 'Empty')}</bdi></button>`).join('')}</div>` : '<p class="field-note">Set the table’s seat count in Edit layout first.</p>'}</details>`;
  }
  function render() {
    if (!item()) selected = plan().tables[0]?.id || plan().objects[0]?.id || '';
    if (!plan().people.some(person => person.id === selectedPerson)) selectedPerson = null;
    overflowTables = new Set();
    const current = plan(), assigned = seatsAssigned(current), unset = current.tables.filter(table => table.count === null).length;
    const capacity = seatsItems(current).reduce((total, table) => total + (table.count ?? 0), 0);
    const room = diagram(), printRoom = diagram(false), printGeometry = seatsPrintGeometry(current.paper);
    document.title = 'Seats | ' + current.name;
    document.body.classList.toggle('seats-layout-mode', mode === 'layout');
    document.documentElement.style.setProperty('--seats-page-width', printGeometry.contentWidth + 'in');
    document.documentElement.style.setProperty('--seats-page-height', printGeometry.contentHeight + 'in');
    let pageSize = document.getElementById('seats-page-size');
    if (!pageSize) { pageSize = document.createElement('style'); pageSize.id = 'seats-page-size'; document.head.appendChild(pageSize); }
    const css = '@page { size: ' + (current.paper === 'tabloid' ? '17in 11in' : '11in 8.5in') + '; margin: 0.15in; }';
    if (pageSize.textContent !== css) pageSize.textContent = css;
    root.innerHTML = `<section class="seats-top no-print"><div><div class="title-line"><h1>Seats</h1><span class="tool-badge">SEATING PLANNER</span></div><div class="plan-line"><label class="sr-only" for="plan-select">Saved plan</label><select id="plan-select">${state.plans.map(entry => `<option value="${attr(entry.id)}" ${entry.id === current.id ? 'selected' : ''}>${html(entry.name)}</option>`).join('')}</select><button type="button" class="text-button" data-action="rename-plan">Rename</button><span class="saved-label">${storageError ? 'Backup needed' : 'Saved in this browser'}</span></div></div>
      <div class="top-actions"><button type="button" data-action="save">Save plan</button><button type="button" class="primary" data-action="print">Print / PDF</button><button type="button" class="text-button" data-action="lock">Lock</button></div></section>
      <section class="seats-controls no-print"><div class="mode-tabs" role="group" aria-label="Planner mode"><button type="button" data-mode="layout" aria-pressed="${mode === 'layout'}">Edit layout</button><button type="button" data-mode="people" aria-pressed="${mode === 'people'}">Assign names</button></div><div class="print-settings"><label>Print size <select id="paper-size"><option value="letter" ${current.paper === 'letter' ? 'selected' : ''}>Letter landscape</option><option value="tabloid" ${current.paper === 'tabloid' ? 'selected' : ''}>11 × 17 landscape</option></select></label><label>Print style <select id="print-color"><option value="mono" ${current.monochrome ? 'selected' : ''}>Black &amp; white</option><option value="color" ${!current.monochrome ? 'selected' : ''}>Color</option></select></label></div></section>
      <p class="print-paper-hint no-print">In the printer dialog, choose <strong>${current.paper === 'tabloid' ? '11 × 17 / Tabloid' : 'Letter'}</strong> and <strong>Landscape</strong>.</p>
      ${storageError ? `<div class="storage-warning no-print" role="alert">${html(storageError)}${conflict ? '<button type="button" data-action="download-recovery">Download stored data</button><button type="button" data-action="enable-save">Save this version instead</button>' : ''}</div>` : ''}
      <div class="seats-workspace no-print"><aside class="seats-panel">${mode === 'layout' ? layoutPanel() : peoplePanel()}<div class="upload-area"><button type="button" data-action="upload-names" ${importing ? 'disabled' : ''}>↑ ${importing ? 'Reading names...' : 'Upload names'}</button><p class="field-note">Excel, CSV, or text. Names stay in this browser.</p><button type="button" class="text-button" data-action="template">Download example CSV</button></div><details id="plan-files"><summary>Plans &amp; backups</summary><button type="button" data-action="new-plan">New plan from this layout</button><button type="button" data-action="backup">Download backup</button><button type="button" data-action="restore">Restore backup</button><button type="button" data-action="export-list">Download seating list</button></details><details id="seats-help"><summary>How to use Seats</summary><p>There are 8 tables in the outside columns and 9 in each middle column. A7, A8, D7, and D8 have 3 seats. B2, C2, B6, and C6 have 4 seats. Other tables start with 5 seats. The rav’s seat faces the room beside the Aron Kodesh.</p><p>Click a seat and start typing a name. Suggestions show existing people. Copy name and Paste name give another seat the same name without moving the original. Ctrl+C and Ctrl+V also work on focused seats. Undo and Redo reverse changes.</p><p>Upload a Name column, First name and Last name columns, or one name per line. Excel imports the first worksheet and skips duplicate names.</p><p>Plans save on this device. Download a backup to move them to another computer or keep a spare copy.</p><p>Print uses the selected paper size. Choose the same size in your printer settings, use Landscape, turn off browser headers and footers, or select Save as PDF. On Android, the paper size must also be chosen in the printer dialog.</p></details></aside>
      <section class="seats-canvas"><div class="canvas-heading"><h2>Room layout</h2><p>${current.tables.length} tables · ${capacity} seats · ${assigned.size} seated${unset ? ` · ${unset} not set` : ''}</p><div class="canvas-buttons"><button type="button" data-action="undo" ${history.length ? '' : 'disabled'}>Undo</button><button type="button" data-action="redo" ${future.length ? '' : 'disabled'}>Redo</button><button type="button" data-action="fit" aria-label="Fit room on screen">Fit</button><button type="button" data-action="zoom-actual" aria-label="Show chart at 100 percent">100%</button><output id="seats-zoom-level" aria-label="Chart zoom">${zoom ? Math.round(zoom / 1200 * 100) + '%' : 'Fit'}</output><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div></div>
        ${unset ? '<p class="setup-hint">Next: set the number of seats at each table. You can also apply a count to a whole column.</p>' : ''}
        ${overflowTables.size ? `<p class="fit-warning" role="alert">Some names do not fit: ${html([...overflowTables].join(', '))}. Increase those tables’ width or depth before printing.</p>` : ''}
        <div class="room-scroll"><div class="room-stage" ${zoom ? `style="width:${zoom}px"` : ''}>${room}</div></div>
        <div class="canvas-foot"><span>Click a seat to type · Pinch or use + to zoom · Drag labels to move tables</span><span>${current.monochrome ? 'Black & white' : 'Color'} print preview</span></div></section></div>
      <p id="seats-notice" class="seats-notice no-print" role="status" aria-live="polite">${html(notice)}</p>
      <input id="names-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden><input id="backup-file" type="file" accept=".json" hidden>

      <section id="seats-print" class="seats-print"><header><h1>${html(current.name)}</h1><p>Bais Medrash of Lakewood Commons<br>${capacity} seats · ${assigned.size} assigned</p></header>${printRoom}</section>`;
    seatsPreparePrint(root.querySelector('#seats-print .room-diagram'), printGeometry);
  }
  function openSeat(tableId, index) {
    const table = seatsItems(plan()).find(entry => entry.id === tableId);
    if (!table || index >= (table.count ?? 0)) return;
    if (selectedPerson) {
      const person = plan().people.find(entry => entry.id === selectedPerson);
      change(() => seatsAssign(plan(), table.id, index, selectedPerson), (person?.name || 'Person') + ' assigned to ' + table.label + ', seat ' + (index + 1) + '.');
      selectedPerson = null; renderInPlace(); return;
    }
    editor.open(tableId, index);
  }

  function addObject(type) {
    if (type === 'table' && plan().tables.length >= 200) return alertMessage('A plan can contain up to 200 tables.');
    if (type !== 'table' && plan().objects.length >= 200) return alertMessage('A plan can contain up to 200 room objects.');
    change(() => {
      const id = seatsUid(); selected = id;
      if (type === 'table') plan().tables.push({ id, label: 'T' + (plan().tables.length + 1), column: '', x: 490, y: 400, width: 215, height: 48, count: 5, seats: Array(5).fill(null), autoSize: true, anchor: 'center' });
      else {
        const defaults = { pillar: ['Pillar', 36, 36], cabinet: ['Sefarim cabinet', 65, 160], bimah: ['Bimah', 110, 100], amud: ['Amud', 64, 48], label: ['Label', 150, 40] }[type];
        const object = { id, type, label: defaults[0], x: 550, y: 400, width: defaults[1], height: defaults[2] };
        const occupied = [...plan().tables.map(table => ({ ...table, height: table.height + 14 })), ...plan().objects,
          { x: 17, y: 536, width: 1166, height: 62 }, { x: 41, y: 858, width: 1118, height: 78 },
          { x: 41, y: 598, width: 62, height: 260 }, { x: 968, y: 598, width: 62, height: 260 },
          { ...seatsFront(plan()).aron }];
        let found = false;
        for (let y = 130; y <= SEATS_BOUNDS.bottom - object.height && !found; y += 10) {
          for (let x = 30; x <= 1170 - object.width; x += 10) {
            if (occupied.every(box => x + object.width + 7 <= box.x || x >= box.x + box.width + 7 || y + object.height + 7 <= box.y || y >= box.y + box.height + 7)) {
              object.x = x; object.y = y; found = true; break;
            }
          }
        }
        plan().objects.push(object);
      }
    }, 'Added. Drag it into position, or edit its position in the sidebar.');
  }
  const actions = {
    save: () => { editor.flush(); const ok = save(); notice = ok ? 'Plan saved in this browser.' : 'Download a backup to keep this plan.'; renderInPlace(); },
    undo: () => { editor.close(); if (history.length) { future.push(copy(state)); state = history.pop(); save(); notice = 'Last change undone.'; renderInPlace(); } },
    redo: () => { editor.close(); if (future.length) { history.push(copy(state)); state = future.pop(); save(); notice = 'Last change restored.'; renderInPlace(); } },
    fit: () => zoomControls.fit(),
    'zoom-actual': () => zoomControls.actual(),
    'zoom-in': () => zoomControls.increase(),
    'zoom-out': () => zoomControls.decrease(),
    print: () => { editor.flush(); if (overflowTables.size) return alertMessage('Printing paused because some names do not fit. Increase the affected tables’ width or depth.'); window.print(); },
    lock: () => { editor.flush(); try { sessionStorage.removeItem(unlockKey); } catch { /* reload still locks */ } location.reload(); },
    'rename-plan': () => { const name = window.prompt('Plan name', plan().name); if (name?.trim()) change(() => { plan().name = name.trim().slice(0, 80); }, 'Plan renamed.'); },
    'new-plan': () => {
      editor.flush();
      if (state.plans.length >= 30) return alertMessage('You can keep up to 30 plans in this browser.');
      const name = window.prompt('Name for the new plan'); if (!name?.trim()) return;
      change(() => { const next = copy(plan()); next.id = seatsUid(); next.name = name.trim().slice(0, 80); next.people = []; seatsItems(next).forEach(table => { table.seats = table.seats.map(() => null); }); state.plans.push(next); state.activeId = next.id; selectedPerson = null; }, 'New plan created with this layout and empty seats.');
    },
    backup: () => { editor.flush(); download('seats-backup.json', JSON.stringify(state, null, 2), 'application/json'); },
    restore: () => { editor.flush(); root.querySelector('#backup-file').click(); },
    'upload-names': () => { editor.flush(); root.querySelector('#names-file').click(); },
    template: () => download('seats-names-example.csv', '\uFEFFName\r\nYosef Cohen\r\nMoshe Levi\r\n', 'text/csv;charset=utf-8'),
    'export-list': () => {
      editor.flush();
      const rows = [['Name', 'Table', 'Seat']];
      for (const person of [...plan().people].sort((a, b) => a.name.localeCompare(b.name))) {
        const table = seatsItems(plan()).find(entry => entry.seats.includes(person.id));
        rows.push([person.name, table?.label || 'Unassigned', table ? table.seats.indexOf(person.id) + 1 : '']);
      }
      download('seats-list.csv', '\uFEFF' + rows.map(row => row.map(seatsCsvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    },
    'add-names': () => { const names = root.querySelector('#new-names').value.split(/\r?\n/); change(() => { const result = seatsAddNames(plan(), names); notice = result.added + ' names added; ' + result.duplicates + ' duplicates skipped.'; }); },
    'apply-count': () => {
      const value = root.querySelector('#bulk-count').value, target = root.querySelector('#bulk-target').value;
      if (value === '') return alertMessage('Enter a seat count first.');
      change(() => { const tables = plan().tables.filter(table => target === 'all' || table.column === target); let removed = 0; tables.forEach(table => { removed += seatsSetCount(table, value, plan()); }); notice = 'Updated ' + tables.length + ' tables.' + (removed ? ' ' + removed + ' people returned to the waiting list.' : ''); });
    },
    'remove-item': () => { const entry = item(); if (entry && !seatsIsFixed(entry)) change(() => { plan().tables = plan().tables.filter(table => table.id !== selected); plan().objects = plan().objects.filter(object => object.id !== selected); selected = ''; }, 'Removed. Assigned people remain on the waiting list. Undo restores the item.'); },
    'download-recovery': () => download('seats-stored-recovery.txt', storedRaw || '', 'text/plain'),
    'enable-save': () => { conflict = false; save(); notice = 'This version is now saved.'; renderInPlace(); },
  };
  root.addEventListener('click', event => {
    if (suppressClick) return;
    const button = event.target.closest('[data-action],[data-mode],[data-add],[data-person],[data-edit-person],[data-open-seat]');
    if (button?.dataset.action) return actions[button.dataset.action]?.();
    if (button?.dataset.mode) { editor.flush(); selectedPerson = null; mode = button.dataset.mode; notice = ''; renderInPlace(); return; }
    if (button?.dataset.add) return addObject(button.dataset.add);
    if (button?.dataset.person) { selectedPerson = selectedPerson === button.dataset.person ? null : button.dataset.person; notice = selectedPerson ? 'Now choose a seat inside a table.' : ''; renderInPlace(); return; }
    if (button?.dataset.editPerson) {
      const person = plan().people.find(entry => entry.id === button.dataset.editPerson);
      const name = window.prompt('Edit name. Leave blank to remove this person.', person.name);
      if (name === null) return;
      change(() => { if (name.trim()) person.name = name.trim().slice(0, 160); else { plan().people = plan().people.filter(entry => entry.id !== person.id); seatsItems(plan()).forEach(table => { table.seats = table.seats.map(id => id === person.id ? null : id); }); } }, 'Name updated.'); return;
    }
    if (button?.hasAttribute('data-open-seat')) return openSeat(button.dataset.table, Number(button.dataset.openSeat));
    const seat = event.target.closest('.table-seat[data-seat]');
    if (seat) return openSeat(seat.dataset.table, Number(seat.dataset.seat));
    const object = event.target.closest('[data-item]');
    if (object) { selected = object.dataset.item; renderInPlace(); }
  });
  root.addEventListener('input', event => {
    if (event.target.id === 'people-search') { search = event.target.value; root.querySelector('#people-list').innerHTML = peopleList(); }
  });
  root.addEventListener('wheel', () => {
    if (document.activeElement?.matches('input[type="number"]')) document.activeElement.blur();
  }, { passive: true, capture: true });
  root.addEventListener('change', async event => {
    const control = event.target, id = control.id;
    if (id === 'selected-item') { selected = control.value; renderInPlace(); return; }
    if (id === 'plan-select') { editor.flush(); state.activeId = control.value; selected = ''; selectedPerson = null; notice = ''; save(); renderInPlace(); return; }
    if (id === 'paper-size' || id === 'print-color') return change(() => { if (id === 'paper-size') plan().paper = control.value; else plan().monochrome = control.value === 'mono'; });
    if (id === 'show-assigned') { showAssigned = control.checked; renderInPlace(); return; }
    if (id === 'auto-size') return change(() => { item().autoSize = control.checked; if (control.checked) seatsSetCount(item(), item().count, plan()); });
    if (id === 'seat-count') return change(() => { const removed = seatsSetCount(item(), control.value, plan()); if (removed) notice = removed + ' people returned to the waiting list.'; });
    if (id.startsWith('item-') && id !== 'item-label' && seatsIsFixed(item())) return;
    if (id.startsWith('item-')) return change(() => {
      const entry = item(); if (!entry) return;
      if (id === 'item-label') { if (control.value.trim()) entry.label = control.value.trim().slice(0, 80); }
      if (id === 'item-width') entry.width = number(control.value, entry.type === 'rav' ? 30 : entry.type ? 20 : 60, SEATS_BOUNDS.right - entry.x);
      if (id === 'item-height') entry.height = number(control.value, entry.type === 'rav' ? 70 : entry.type ? 20 : 40, itemBottom(entry) - entry.y);
      if (id === 'item-x') entry.x = number(control.value, SEATS_BOUNDS.left, SEATS_BOUNDS.right - entry.width);
      if (id === 'item-y') entry.y = number(control.value, SEATS_BOUNDS.top, itemBottom(entry) - entry.height);
      if (['B1','C1','D1'].includes(entry.id)) seatsSyncFront(plan());
    });
    if (id === 'names-file' && control.files[0]) {
      const targetId = plan().id; importing = true; renderInPlace();
      try {
        const names = await seatsReadNames(control.files[0]);
        change(() => { const target = state.plans.find(entry => entry.id === targetId); if (!target) throw new Error('The selected plan is no longer open.'); const result = seatsAddNames(target, names); notice = result.added + ' names added; ' + result.duplicates + ' duplicates skipped.'; mode = 'people'; });
      } catch (error) { notice = error.message; }
      importing = false; renderInPlace();
    }
    if (id === 'backup-file' && control.files[0]) {
      try {
        if (control.files[0].size > 8 * 1024 * 1024) throw new Error('Choose a backup smaller than 8 MB.');
        const restored = seatsNormalizeState(JSON.parse(await control.files[0].text()));
        if (restored.plans.length + state.plans.length > 30) throw new Error('Restoring this file would exceed 30 saved plans.');
        change(() => { for (const restoredPlan of restored.plans) { const wasActive = restoredPlan.id === restored.activeId; seatsUpgradePlan(restoredPlan); restoredPlan.id = seatsUid(); state.plans.push(restoredPlan); if (wasActive) state.activeId = restoredPlan.id; } selected = ''; selectedPerson = null; conflict = false; }, 'Backup restored as additional plans. Your existing plans were kept.');
      } catch (error) { alertMessage(error.message); }
    }
  });
  root.addEventListener('keydown', event => {
    const entryNode = event.target.closest('[data-item]'), seatNode = event.target.closest('.table-seat[data-seat]');
    if (seatNode && (event.ctrlKey || event.metaKey) && ['c', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault(); const fn = event.key.toLowerCase() === 'c' ? editor.copy : editor.paste;
      fn(seatNode.dataset.table, Number(seatNode.dataset.seat)); return;
    }
    if (seatNode && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault(); editor.open(seatNode.dataset.table, Number(seatNode.dataset.seat), event.key); return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && (seatNode || entryNode)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
    if (mode !== 'layout' || !entryNode || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (seatsIsFixed(plan().objects.find(object => object.id === entryNode.dataset.item))) return;
    event.preventDefault(); selected = entryNode.dataset.item;
    const delta = event.shiftKey ? 1 : 8;
    change(() => { const entry = item(); entry.x = number(entry.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), SEATS_BOUNDS.left, SEATS_BOUNDS.right - entry.width); entry.y = number(entry.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0), SEATS_BOUNDS.top, itemBottom(entry) - entry.height); });
  });
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.drag-handle'), node = handle?.closest('[data-item]');
    if (pinching || mode !== 'layout' || !node || event.button !== 0) return;
    const svg = node.ownerSVGElement, point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const start = point.matrixTransform(svg.getScreenCTM().inverse());
    const entry = [...plan().tables, ...plan().objects].find(value => value.id === node.dataset.item);
    if (seatsIsFixed(entry)) return;
    drag = { pointer: event.pointerId, svg, node, entry, start, x: entry.x, y: entry.y, moved: false, before: copy(state) };
    svg.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const point = drag.svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const current = point.matrixTransform(drag.svg.getScreenCTM().inverse());
    const dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; selected = drag.entry.id;
    drag.entry.x = number(drag.x + dx, SEATS_BOUNDS.left, SEATS_BOUNDS.right - drag.entry.width);
    drag.entry.y = number(drag.y + dy, SEATS_BOUNDS.top, itemBottom(drag.entry) - drag.entry.height);
    drag.node.setAttribute('transform', 'translate(' + drag.entry.x + ' ' + drag.entry.y + ')');
  });
  function endDrag(event) {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (event.type === 'pointercancel') { state = drag.before; renderInPlace(); }
    else if (drag.moved) {
      history.push(drag.before); future = []; if (history.length > 25) history.shift();
      save(); notice = 'Position saved.'; suppressClick = true; renderInPlace(); setTimeout(() => { suppressClick = false; }, 0);
    }
    else { selected = drag.entry.id; renderInPlace(); }
    drag = null;
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.target.closest('input,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') { event.preventDefault(); (key === 'y' || event.shiftKey ? actions.redo : actions.undo)(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== SEATS_STORAGE_KEY) return;
    storedRaw = event.newValue;
    conflict = true; storageError = 'Seats changed in another tab. Reload to use that version, or download a backup before saving this version instead.'; renderInPlace();
  });
  window.addEventListener('beforeprint', () => { editor.flush(); document.body.classList.toggle('seats-print-error', overflowTables.size > 0); });
  window.addEventListener('afterprint', () => document.body.classList.remove('seats-print-error'));
  render(); zoomControls.refresh();
}

seatsEntry();
