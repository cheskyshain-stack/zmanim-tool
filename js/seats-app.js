import { escAttr, escText } from './util.js';
import { keepPosition } from './ui/keep-position.js';
import { SEATS_STORAGE_KEY, SEATS_ROOM, SEATS_BOUNDS, SEATS_ROOM_UPDATE, SEATS_SEAT_WIDTH, SEATS_TABLE_HEIGHT, SEATS_BACK_WALKWAY_Y, SEATS_CROSS_WALKWAY, seatsItems, seatsFront, seatsSyncFront, seatsIsFixed, seatsChairPillar, seatsUid, seatsCreatePlan, seatsCreateState, seatsNormalizeState, seatsNeedsUpgrade, seatsUpgradePlan, seatsSetCount, seatsAssign, seatsAssigned, seatsAddNames, seatsRemovePeople, seatsWriteName } from './seats/model.js';
import { seatsRoomFeatures, seatsCabinetArt, seatsRavArt } from './seats/room.js';
import { seatsCreateZoom } from './seats/zoom.js';
import { seatsCreateAssignment, seatsCanDragNames } from './seats/assignment.js';
import { seatsCreateWorkspace } from './seats/workspace.js';
import { seatsPrintGeometry, seatsPreparePrint } from './seats/print.js';
import { seatsCreateEditor } from './seats/editor.js';
import { seatsReadNames, seatsCsvCell } from './seats/import.js';
import { seatsCreateSharing, SEATS_SHARING_KEY } from './seats/sharing.js';
import { seatsCreateRecords } from './seats/records.js';
import { seatsStartMarkup } from './seats/start.js';
import { seatsSortPeople } from './seats/name-sort.js';
import { seatsChartName, seatsDatedChartName } from './seats/chart-names.js';
import { seatsHasContent } from './seats/content.js';
import { seatsOpenSession } from './seats/session.js';
import { seatsFitName, seatsCommonNameFont } from './seats/name-layout.js';

const SEATS_NAME_SORT_KEY = 'lakewood-commons-seats-name-sort';
const SEATS_VIEW_KEY = 'lakewood-commons-seats-view-v1';

async function seatsEntry() {
  const root = document.getElementById('seats-app');
  const auth = await seatsOpenSession(root);
  seatsStart(root, auth);
}

function seatsStart(root, auth) {
  let state = seatsCreateState(), storageError = '', notice = '', selected = 'A1';
  let selectedPerson = null, search = '', showAssigned = false, zoom = 0, wholeRoom = false, history = [], future = [], importing = false;
  let readingNames = 0;
  let deletingNames = false, deleteSelection = new Set();
  let overflowTables = new Set(), drag = null, suppressClick = false, conflict = false;
  let storedRaw = null, pinching = false;
  let sharing = null, printing = false, sharingLinks = '';
  let screen = 'home';
  let nameOrder = 'first';
  try { if (localStorage.getItem(SEATS_NAME_SORT_KEY) === 'last') nameOrder = 'last'; } catch { /* Keep the default when preferences cannot be saved. */ }
  const measure = document.createElement('canvas').getContext('2d');
  try {
    storedRaw = localStorage.getItem(SEATS_STORAGE_KEY);
    if (storedRaw) {
      state = seatsNormalizeState(JSON.parse(storedRaw));
      if (state.plans.some(seatsNeedsUpgrade)) {
        try { if (!localStorage.getItem(SEATS_STORAGE_KEY + '-before-room-' + SEATS_ROOM_UPDATE)) localStorage.setItem(SEATS_STORAGE_KEY + '-before-room-' + SEATS_ROOM_UPDATE, storedRaw); } catch { /* keep the original until the next save */ }
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
  const rememberedShared = new Set();
  let sharedRaw = null;
  try {
    sharedRaw = localStorage.getItem(SEATS_SHARING_KEY);
    const saved = JSON.parse(sharedRaw || 'null');
    if (saved?.version === 1 && Array.isArray(saved.entries)) for (const entry of saved.entries) if (typeof entry.localId === 'string') rememberedShared.add(entry.localId);
  } catch { if (sharedRaw) for (const current of state.plans) rememberedShared.add(current.id); }
  const retained = savedPlans();
  if (!conflict && storedRaw && retained.length < state.plans.length) {
    try { const key = SEATS_STORAGE_KEY + '-before-empty-drafts-2026-10-26'; if (!localStorage.getItem(key)) localStorage.setItem(key, storedRaw); } catch { /* Only unchanged automatic drafts are omitted. */ }
  }
  if (!conflict) {
    state.plans = retained.length ? retained : seatsCreateState().plans;
    if (!state.plans.some(current => current.id === state.activeId)) state.activeId = state.plans[0].id;
  }
  const plan = () => state.plans.find(item => item.id === state.activeId);
  const item = () => [...plan().tables, ...plan().objects].find(entry => entry.id === selected);
  const itemBottom = entry => SEATS_BOUNDS.bottom - (entry.type ? 0 : 14);
  const copy = value => JSON.parse(JSON.stringify(value));
  const number = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));
  const html = value => escText(value);
  const attr = value => escAttr(value);
  const svgNumber = value => Math.round(value * 100) / 100;
  const pageHelp = () => sharing?.linked(plan().id)
    ? 'This chart is on the website. Changes save automatically for everyone signed in.'
    : seatsHasContent(plan()) ? 'Changes save on this device. Save puts this chart in Saved charts on the website.'
      : 'Add names or change the setup to start saving. Empty charts stay out of Saved charts.';
  const records = seatsCreateRecords({ getState: () => state, isEligible: keepPlan, getName: () => sharing?.editorName,
    isShared: id => sharing?.linked(id), notify: message => { storageError = message; }, fresh: false });
  for (const current of state.plans) current.name = seatsChartName(current.name, records.info(current.id));
  try {
    const view = JSON.parse(sessionStorage.getItem(SEATS_VIEW_KEY) || 'null');
    if (!new URL(location.href).searchParams.has('page') && view?.screen === 'editor') {
      if (!state.plans.some(current => current.id === view.id) && view.draft) {
        const draft = seatsNormalizeState({ version: 1, activeId: view.draft.id, plans: [view.draft] }).plans[0];
        seatsUpgradePlan(draft);
        if (!seatsHasContent(draft)) state.plans = [...savedPlans(), draft];
      }
      if (state.plans.some(current => current.id === view.id)) {
        state.activeId = view.id; screen = 'editor'; selected = typeof view.selected === 'string' ? view.selected : 'A1';
        zoom = Number.isFinite(view.zoom) && view.zoom >= 0 ? Math.min(6000, view.zoom) : 0; wholeRoom = view.whole === true;
      }
    }
  } catch { /* Invalid view preferences do not affect saved charts. */ }

  const editor = seatsCreateEditor({
    getPlan: plan, commit: change,
    seatNode: (tableId, index) => root.querySelector('.room-stage .table-seat[data-table="' + CSS.escape(tableId) + '"][data-seat="' + index + '"]'),
    onSelect: tableId => { selected = tableId; renderInPlace(); }, notify: alertMessage,
    canEdit: (tableId, index) => sharing?.canEdit(tableId, index) !== false,
    onActivity: value => sharing?.activity(value),
  });

  const zoomControls = seatsCreateZoom(root, {
    getWidth: () => zoom, setWidth: (value, whole = false) => { zoom = value; wholeRoom = whole; }, getWhole: () => wholeRoom, onChange: () => editor.sync(),
    onStart: () => {
      pinching = true; suppressClick = true;
      if (drag) { state = drag.before; drag.node.setAttribute('transform', 'translate(' + drag.x + ' ' + drag.y + ')'); drag = null; }
    },
    onEnd: () => { pinching = false; sharing?.flush(); setTimeout(() => { suppressClick = false; }, 100); },
  });
  const assignmentControls = seatsCreateAssignment(root, {
    getPlan: plan, getMode: () => 'people',
    onStart: () => { suppressClick = true; },
    onEnd: () => { setTimeout(() => { suppressClick = false; }, 0); },
    onDrop: dropName,
  });
  const workspaceControls = seatsCreateWorkspace(root, {
    getMode: () => 'people', onResize: () => { assignmentControls.refresh(); zoomControls.refresh(); editor.sync(); },
  });

  function keepPlan(current) { return seatsHasContent(current) || rememberedShared.has(current.id) || sharing?.linked(current.id); }
  function savedPlans() { return state.plans.filter(keepPlan); }
  function storedState() {
    const plans = savedPlans();
    return plans.length ? { ...state, plans, activeId: plans.some(current => current.id === state.activeId) ? state.activeId : plans[0].id } : null;
  }
  function savedLabel() { return sharing?.linked(plan().id) ? sharing.label() : keepPlan(plan()) ? 'Saved on this device' : 'Not saved yet'; }
  function canSaveCurrent() { return Boolean(sharing?.linked(plan().id) || seatsHasContent(plan())); }
  function rememberView() {
    try {
      sessionStorage.setItem(SEATS_VIEW_KEY, JSON.stringify({ screen, id: plan().id, selected, zoom, whole: wholeRoom,
        draft: screen === 'editor' && !keepPlan(plan()) ? plan() : null }));
    } catch { /* Stored charts still work when view preferences cannot be saved. */ }
  }
  function syncSaveStatus() {
    const button = root.querySelector('[data-action=save-site]');
    if (button) button.disabled = !sharing?.enabled || sharing?.saving || !canSaveCurrent();
    const saved = root.querySelector('.saved-label'); if (saved && !storageError) saved.textContent = savedLabel();
    const help = root.querySelector('#seats-page-help'); if (help) help.textContent = pageHelp();
  }
  function save() {
    if (conflict) return false;
    try {
      const snapshot = storedState();
      if (snapshot) { const json = JSON.stringify(snapshot); localStorage.setItem(SEATS_STORAGE_KEY, json); storedRaw = json; }
      else { localStorage.removeItem(SEATS_STORAGE_KEY); storedRaw = null; }
      storageError = ''; records.sync(); sharing?.localChanged(); syncSaveStatus(); rememberView(); return !storageError;
    }
    catch { storageError = 'Changes cannot be saved in this browser. Download a backup before closing this page.'; return false; }
  }
  function renderInPlace() {
    const scroll = root.querySelector('.room-scroll');
    const position = scroll ? [scroll.scrollLeft, scroll.scrollTop] : [0, 0];
    const peopleTop = root.querySelector('.people-list')?.scrollTop || 0;
    const panelTop = root.querySelector('.seats-panel')?.scrollTop || 0;
    const expanded = [...root.querySelectorAll('details[id][open]')].map(node => node.id);
    keepPosition(root, () => {
      render();
      for (const id of expanded) { const node = root.querySelector('#' + CSS.escape(id)); if (node) node.open = true; }
      const next = root.querySelector('.room-scroll');
      if (next) { next.scrollLeft = position[0]; next.scrollTop = position[1]; }
      const people = root.querySelector('.people-list'); if (people) people.scrollTop = peopleTop;
      const panel = root.querySelector('.seats-panel'); if (panel) panel.scrollTop = panelTop;
    });
    editor.sync(); zoomControls.refresh();
  }
  function change(fn, message = null, redraw = true) {
    const before = copy(state);
    notice = '';
    try { fn(); }
    catch (error) { state = before; notice = error.message; renderInPlace(); return false; }
    if (JSON.stringify(before) === JSON.stringify(state)) {
      if (message !== null) notice = message;
      renderInPlace(); return true;
    }
    const onlyShared = sharing?.linked(before.activeId) && state.activeId === before.activeId && before.plans.map(plan => plan.id).join() === state.plans.map(plan => plan.id).join();
    if (!onlyShared) { history.push(before); future = []; if (history.length > 25) history.shift(); }
    if (message !== null) notice = message;
    save();
    if (redraw) renderInPlace();
    else {
      document.title = 'Seats | ' + plan().name;
      root.querySelector('[data-action=undo]').disabled = sharing?.linked(plan().id) ? !sharing.canUndo() : !history.length;
      root.querySelector('[data-action=redo]').disabled = sharing?.linked(plan().id) ? !sharing.canRedo() : !future.length;
    }
    return true;
  }
  function restoreLocalHistory(snapshot) {
    for (const current of state.plans.filter(plan => sharing?.linked(plan.id))) {
      const index = snapshot.plans.findIndex(plan => plan.id === current.id);
      if (index >= 0) snapshot.plans[index] = current;
      else snapshot.plans.push(current);
    }
    state = snapshot;
  }
  function alertMessage(message) { notice = message; renderInPlace(); }
  function activatePage(id) {
    if (readingNames) { alertMessage('Reading names. Please wait before changing charts.'); return false; }
    if (!state.plans.some(plan => plan.id === id) || editor.flush() === false) return false;
    editor.close(); state.plans = state.plans.filter(current => current.id === id || keepPlan(current));
    screen = 'editor'; state.activeId = id; selected = ''; selectedPerson = null;
    deletingNames = false; deleteSelection.clear(); notice = ''; save(); renderInPlace();
    return true;
  }
  function openPageTools(intent) {
    if (intent === 'pages' && readingNames) return alertMessage('Reading names. Please wait before changing charts.');
    if (editor.flush() === false) return;
    editor.close();
    if (intent === 'pages') sharing?.leavePageLink();
    sharing?.open(intent);
  }
  function showHome() {
    if (readingNames) return alertMessage('Reading names. Please wait before changing charts.');
    if (editor.flush() === false) return false;
    editor.close();
    sharing?.leavePageLink();
    screen = 'home'; render(); zoomControls.refresh(); sharing?.viewChanged();
    window.scrollTo({ top: 0, behavior: 'instant' });
    const heading = root.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    return true;
  }
  function createChart() {
    if (readingNames) return alertMessage('Reading names. Please wait before changing charts.');
    if (editor.flush() === false) return;
    const plans = savedPlans();
    if (plans.length >= 30) return alertMessage('You can keep up to 30 charts on this device. Delete an old device copy from saved charts to make room.');
    editor.close();
    sharing?.leavePageLink();
    const next = seatsCreatePlan(seatsDatedChartName(new Date(), plans.map(plan => plan.name)));
    state.plans = [...plans, next]; state.activeId = next.id;
    screen = 'editor'; selected = 'A1'; selectedPerson = null;
    deletingNames = false; deleteSelection.clear(); search = ''; showAssigned = false;
    zoom = 0; wholeRoom = false; history = []; future = []; notice = '';
    save(); render(); zoomControls.refresh(); sharing?.viewChanged();
    window.scrollTo({ top: 0, behavior: 'instant' });
    sharing?.open('names');
  }
  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function nameMeasure(text, font) {
    measure.font = font + 'px Arial';
    return measure.measureText(text).width;
  }
  function nameText(name, x, y, width, height, tableId, maxFont = 13) {
    const { font, lines, fits } = seatsFitName(name, width, height, nameMeasure, maxFont);
    if (!fits) overflowTables.add(tableId);
    const start = y + height / 2 - (lines.length - 1) * font * 0.55 + font * 0.33;
    const rtl = /[א-ת]/.test(name) && !/[A-Za-z]/.test(name);
    return `<text class="seat-name" text-anchor="middle" font-size="${font}" direction="${rtl ? 'rtl' : 'ltr'}" style="unicode-bidi:plaintext">${lines.map((line, index) => `<tspan x="${svgNumber(x)}" y="${svgNumber(start + index * font * 1.1)}">${html(line)}</tspan>`).join('')}</text>`;
  }
  function diagram(interactive = true) {
    const current = plan(), geometry = seatsPrintGeometry(current.paper), printScale = interactive ? 1 : geometry.xScale;
    const wideName = (name, x, y, width, height, id, maxFont) => nameText(name, x, y, width * printScale, height, id, maxFont);
    const people = new Map(current.people.map(person => [person.id, person.name]));
    const nameLayouts = current.tables.flatMap(table => table.seats.filter(id => people.has(id)).map(id => seatsFitName(people.get(id), table.width * printScale / Math.max(1, table.count), table.height - 4, nameMeasure)));
    for (const rav of current.objects.filter(object => object.type === 'rav' && people.has(object.seats[0]))) {
      const size = Math.min(rav.width - 2, rav.height - 30);
      nameLayouts.push(seatsFitName(people.get(rav.seats[0]), size, size - 4, nameMeasure, 11));
    }
    const commonFont = seatsCommonNameFont(nameLayouts);
    const seatName = (name, x, y, width, height, id, maxFont = 13) => wideName(name, x, y, width, height, id, Math.min(commonFont, maxFont));
    const controls = entry => interactive ? `id="room-item-${attr(entry.id)}" data-item="${attr(entry.id)}" role="button" tabindex="0" aria-label="${attr('Table ' + entry.label + (entry.count === null ? ', seats not set' : ', ' + entry.count + ' seats'))}"` : '';
    const tables = current.tables.map(table => {
      const count = table.count ?? 0, width = table.width / Math.max(1, count);
      const labelY = table.y < SEATS_BOUNDS.top + 18 ? SEATS_BOUNDS.top - 5 - table.y : -5;
      const seats = Array.from({ length: count }, (_, index) => {
        const name = people.get(table.seats[index]);
        return `<g data-facing="north" class="table-seat${name ? ' assigned' : ''}" ${interactive ? `id="seat-${attr(table.id)}-${index}" data-seat="${index}" data-table="${attr(table.id)}" role="button" tabindex="0" aria-label="${attr(table.label + ', seat ' + (index + 1) + ': ' + (name || 'empty'))}"` : ''}>
          <rect class="seat-area" x="${svgNumber(index * width + 1)}" y="2" width="${svgNumber(Math.max(1, width - 2))}" height="${table.height - 4}"/>
          ${name ? seatName(name, width * (index + 0.5), 2, width, table.height - 4, table.id) : `<text class="empty-seat" x="${svgNumber(width * (index + 0.5))}" y="${table.height / 2 + 4}" text-anchor="middle">${index + 1}</text>`}
          ${seatsChairPillar(current, table.id, index + 1) ? '' : `<path class="chair-marker" d="M${svgNumber(width * (index + 0.5) - 6)} ${table.height + 3} h12 v5 q0 3 -3 3 h-6 q-3 0 -3 -3 z M${svgNumber(width * (index + 0.5) - 4)} ${table.height + 11} v3 m8 0 v-3"/>`}
        </g>`;
      }).join('');
      return `<g ${controls(table)} transform="translate(${table.x} ${table.y})" class="room-item table-item${interactive && selected === table.id ? ' selected' : ''}">
        <rect class="table-surface" width="${table.width}" height="${table.height}" rx="2"/>
        <g class="drag-handle" aria-label="Move table"><rect x="${table.width / 2 - 24}" y="${labelY - 13}" width="48" height="17" fill="transparent"/><text class="table-label" x="${table.width / 2}" y="${labelY}" text-anchor="middle">${html(table.label)}</text></g>
        ${count ? seats : `<text class="pending-seats" x="${table.width / 2}" y="${table.height / 2 + 4}" text-anchor="middle">${table.count === null ? 'Set seat count' : 'No seats'}</text>`}
      </g>`;
    }).join('');
    const objects = current.objects.map(object => {
      const attributes = interactive ? `id="room-item-${attr(object.id)}" data-item="${attr(object.id)}" role="button" tabindex="0" aria-label="${attr(object.label)}"` : '';
      let art;
      if (object.type === 'cabinet') art = seatsCabinetArt(object, object.height > object.width ? nameText : wideName);
      else if (object.type === 'rav') art = seatsRavArt(object, people, seatName, interactive, printScale);
      else if (object.type === 'pillar' && seatsIsFixed(object)) art = `<rect width="${object.width}" height="${object.height}" class="object-surface chair-pillar" fill="url(#pillar-${interactive ? 'screen' : 'print'})"/>`;
      else if (object.type === 'amud') {
        const width = object.width / printScale;
        art = `<rect x="${(object.width - width) / 2}" width="${width}" height="${object.height}" class="object-surface amud-surface"/>${wideName(object.label, object.width / 2, 0, width, object.height, object.label)}`;
      }
      else art = `${object.type === 'label' ? '' : `<rect width="${object.width}" height="${object.height}" rx="1" class="object-surface" ${object.type === 'pillar' ? `fill="url(#pillar-${interactive ? 'screen' : 'print'})"` : ''}/>`}${wideName(object.label, object.width / 2, 0, object.width, object.height, object.label)}`;
      return `<g ${attributes} transform="translate(${object.x} ${object.y})" class="room-item room-object${['bimah', 'amud'].includes(object.type) ? ' room-landmark' : ''}${object.type === 'rav' ? ' rav-station' : seatsIsFixed(object) ? ' fixed-fixture' : ' drag-handle'}${interactive && selected === object.id ? ' selected' : ''}">${art}</g>`;
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
      <label for="layout-item">Selected ${entry?.type ? 'object' : 'table'}</label><select id="layout-item">${tableOptions()}</select>
      ${entry ? `<label for="item-label">Label</label><input id="item-label" value="${attr(entry.label)}" maxlength="80">
        ${isTable ? `<label for="seat-count">Seats at this table</label><input id="seat-count" type="number" min="0" max="16" step="1" placeholder="Not set yet" value="${entry.count ?? ''}"><label class="check-label"><input id="auto-size" type="checkbox" ${entry.autoSize !== false ? 'checked' : ''}> Size table from seat count</label><p class="field-note">Five seats is the standard size. Chairs face the Aron Kodesh.</p>` : ''}
        <div class="field-pair"><div><label for="item-width">Width</label><input id="item-width" type="number" min="${isTable ? 60 : entry.type === 'rav' ? 30 : 20}" max="1100" value="${entry.width}" ${fixed || (isTable && entry.autoSize !== false) ? 'disabled' : ''}></div><div><label for="item-height">Depth</label><input id="item-height" type="number" min="${isTable ? 40 : entry.type === 'rav' ? 70 : 20}" max="600" value="${entry.height}" ${fixed ? 'disabled' : ''}></div></div>
        ${fixed ? '<p class="field-note">Fixed room fixture.</p>' : `<details class="position-details"><summary>Position &amp; remove</summary><div class="field-pair"><div><label for="item-x">Left</label><input id="item-x" type="number" value="${entry.x}" min="17" max="${SEATS_BOUNDS.right - entry.width}"></div><div><label for="item-y">Top</label><input id="item-y" type="number" value="${entry.y}" min="70" max="${itemBottom(entry) - entry.height}"></div></div><button type="button" class="danger" data-action="remove-item">Remove ${isTable ? 'table' : 'object'}</button></details>`}` : ''}
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
  function visiblePeople() {
    const assigned = seatsAssigned(plan());
    return seatsSortPeople(plan().people.filter(person => (deletingNames || showAssigned || !assigned.has(person.id)) && person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), nameOrder);
  }
  function peopleList() {
    const people = visiblePeople();
    return people.length ? people.map(person => deletingNames
      ? `<label class="person-row name-delete-row${deleteSelection.has(person.id) ? ' active' : ''}"><input id="delete-person-${attr(person.id)}" type="checkbox" data-delete-person="${attr(person.id)}" aria-label="${attr('Select ' + person.name)}" ${deleteSelection.has(person.id) ? 'checked' : ''}><span class="person-name"><bdi>${html(person.name)}</bdi><small>${html(locationOf(person.id))}</small></span></label>`
      : `<div class="person-row${selectedPerson === person.id ? ' active' : ''}"><button type="button" class="person-name" data-person="${attr(person.id)}" draggable="${seatsCanDragNames()}" aria-pressed="${selectedPerson === person.id}"><bdi>${html(person.name)}</bdi><small>${html(locationOf(person.id))}</small></button><button type="button" class="person-edit" data-edit-person="${attr(person.id)}" aria-label="${attr('Edit ' + person.name)}" title="Edit name">✎</button><button type="button" class="person-delete danger" data-delete-name="${attr(person.id)}" aria-label="${attr('Delete ' + person.name)}">Delete</button></div>`).join('') : `<p class="empty-list">${plan().people.length ? 'No matching people.' : 'Add names below or upload a list.'}</p>`;
  }
  function deleteControls() {
    if (!deletingNames) return '';
    const visible = visiblePeople(), allSelected = visible.length && visible.every(person => deleteSelection.has(person.id));
    return `<p class="field-note">Select names to delete. Seated people are included. Undo can restore deleted names and seats.</p><div class="people-delete-actions"><button type="button" data-action="select-delete-shown" ${visible.length ? '' : 'disabled'}>${allSelected ? 'Clear shown' : 'Select all shown'}</button><button type="button" class="danger" data-action="delete-selected-names" ${deleteSelection.size ? '' : 'disabled'}>Delete selected (${deleteSelection.size})</button><button type="button" class="danger" data-action="delete-all-names">Delete all names (${plan().people.length})</button></div>`;
  }
  function deleteNames(all = false, personId = null) {
    editor.flush(); editor.close();
    const ids = all ? plan().people.map(person => person.id) : plan().people.filter(person => (personId ? person.id === personId : deleteSelection.has(person.id))).map(person => person.id);
    if (!ids.length) return;
    if (!window.confirm('Delete ' + (all ? 'all ' : '') + ids.length + (ids.length === 1 ? ' name' : ' names') + ' from this plan? Their seats will be cleared. Undo can restore them.')) return;
    change(() => {
      const count = seatsRemovePeople(plan(), ids);
      deleteSelection.clear(); selectedPerson = null;
      notice = count + (count === 1 ? ' name deleted.' : ' names deleted.') + ' Undo restores names and seats.';
    });
  }
  function peoplePanel() {
    const assigned = seatsAssigned(plan());
    return `<div class="people-heading"><h2>People</h2><button type="button" data-action="toggle-delete-names" aria-pressed="${deletingNames}" ${plan().people.length ? '' : 'disabled'}>${deletingNames ? 'Done' : 'Delete names'}</button></div><p class="people-summary">${plan().people.length - assigned.size} waiting for a seat</p><label class="sr-only" for="people-search">Search names</label><input id="people-search" type="search" placeholder="Search names..." value="${attr(search)}"><div class="people-sort"><label for="people-sort">Sort names</label><select id="people-sort"><option value="first" ${nameOrder === 'first' ? 'selected' : ''}>First name</option><option value="last" ${nameOrder === 'last' ? 'selected' : ''}>Last name</option></select></div>${deletingNames ? '' : `<label class="check-label"><input id="show-assigned" type="checkbox" ${showAssigned ? 'checked' : ''}> Include seated people</label>`}<div id="people-delete-controls">${deleteControls()}</div><div id="people-list" class="people-list">${peopleList()}</div>
      <p class="field-note">${seatsCanDragNames() ? 'Drag list names to add seats. Drag between seats to move; Ctrl/Option-drag copies. Drag back to the list to unassign. You can also click a name then a seat.' : 'Click any seat and type. Choose an existing name from the suggestions, or enter a new name.'}</p>
      <button type="button" class="people-upload" data-action="upload-names" ${importing ? 'disabled' : ''}>${importing ? 'Reading names...' : html(sharing?.nameFilesLabel || 'Name files')}</button>`;
  }
  function peopleManualTools() {
    const table = seatsItems(plan()).find(entry => entry.id === selected);
    return `<details id="manual-names"><summary>Add names</summary><label for="new-names">One name per line</label><textarea id="new-names" rows="4" placeholder="English or Hebrew names"></textarea><button type="button" data-action="add-names">Add names</button></details>
      <details id="seat-list"><summary>Choose a seat from a list</summary><label for="selected-item">Table</label><select id="selected-item">${tableOptions()}</select>${table?.count ? `<div class="seat-list">${table.seats.map((id, index) => `<button type="button" data-open-seat="${index}" data-table="${attr(table.id)}">${index + 1}. <bdi>${html(plan().people.find(person => person.id === id)?.name || 'Empty')}</bdi></button>`).join('')}</div>` : '<p class="field-note">This table has no seats.</p>'}</details>`;
  }
  function render() {
    rememberView();
    if (screen !== 'editor') {
      document.title = 'Seats | Bais Medrash of Lakewood Commons';
      document.body.classList.remove('seats-people-mode');
      root.innerHTML = seatsStartMarkup() +
        (storageError ? `<div class="storage-warning no-print" role="alert">${html(storageError)}${conflict ? '<button type="button" data-action="download-recovery">Download stored data</button><button type="button" data-action="enable-save">Save this version instead</button>' : ''}</div>` : '') +
        `<p id="seats-notice" class="seats-notice no-print" role="status" aria-live="polite">${html(notice)}</p><input id="names-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden><input id="backup-file" type="file" accept=".json" hidden>`;
      return;
    }
    if (!item()) selected = plan().tables[0]?.id || plan().objects[0]?.id || '';
    if (!plan().people.some(person => person.id === selectedPerson)) selectedPerson = null;
    deleteSelection = new Set([...deleteSelection].filter(id => plan().people.some(person => person.id === id)));
    if (!plan().people.length) deletingNames = false;
    overflowTables = new Set();
    const current = plan(), assigned = seatsAssigned(current), unset = current.tables.filter(table => table.count === null).length;
    const capacity = seatsItems(current).reduce((total, table) => total + (table.count ?? 0), 0);
    const room = diagram(), printRoom = diagram(false), printGeometry = seatsPrintGeometry(current.paper);
    document.title = 'Seats | ' + current.name;
    document.body.classList.add('seats-people-mode');
    document.documentElement.style.setProperty('--seats-page-width', printGeometry.contentWidth + 'in');
    document.documentElement.style.setProperty('--seats-page-height', printGeometry.contentHeight + 'in');
    document.documentElement.style.setProperty('--seats-print-aspect', printGeometry.contentWidth / (printGeometry.contentHeight - printGeometry.header));
    let pageSize = document.getElementById('seats-page-size');
    if (!pageSize) { pageSize = document.createElement('style'); pageSize.id = 'seats-page-size'; document.head.appendChild(pageSize); }
    const css = '@page { size: ' + (current.paper === 'auto' ? 'landscape' : current.paper === 'tabloid' ? '17in 11in' : '11in 8.5in') + '; margin: ' + printGeometry.margin + 'in; }';
    if (pageSize.textContent !== css) pageSize.textContent = css;
    root.innerHTML = `<button type="button" class="text-button seats-editor-home no-print" data-action="home">← Seats home</button><section class="seats-top no-print"><div><div class="title-line"><h1>Seats</h1><span class="tool-badge">SEATING PLANNER</span></div><div class="plan-line"><label for="chart-name">Chart name</label><input id="chart-name" value="${attr(current.name)}" maxlength="80"><span class="saved-label">${storageError ? 'Backup needed' : html(savedLabel())}</span></div></div>
      <div class="top-actions"><button type="button" class="primary" data-action="save-site" ${!sharing?.enabled || sharing?.saving || !canSaveCurrent() ? 'disabled' : ''}>Save</button><button type="button" data-action="open-pages"><svg class="page-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M3 7V5h7l2 2h9v13H3Z"/><path d="M3 10h18"/></svg>Saved charts</button><button type="button" data-action="print">Print / PDF</button><details id="chart-more" class="chart-more"><summary>More</summary><div><button type="button" data-action="date-name">Use today’s date</button><button type="button" data-action="chart-history">Change history</button><button type="button" data-action="backup">Download backup</button><button type="button" data-action="lock">Lock</button></div></details></div></section>
      <p id="seats-page-help" class="seats-page-help no-print">${pageHelp()}</p>
      <section class="seats-controls no-print"><div class="print-settings"><label>Print size <select id="paper-size"><option value="auto" ${current.paper === 'auto' ? 'selected' : ''}>Printer paper (auto fit)</option><option value="letter" ${current.paper === 'letter' ? 'selected' : ''}>Letter landscape</option><option value="tabloid" ${current.paper === 'tabloid' ? 'selected' : ''}>11 × 17 landscape</option></select></label><label>Print style <select id="print-color"><option value="mono" ${current.monochrome ? 'selected' : ''}>Black &amp; white</option><option value="color" ${!current.monochrome ? 'selected' : ''}>Color</option></select></label></div></section>
      <p class="print-paper-hint no-print">${current.paper === 'auto' ? 'Choose your paper size and <strong>Landscape</strong> in the printer dialog. The chart fills the printable width and height.' : `In the printer dialog, choose <strong>${current.paper === 'tabloid' ? '11 × 17 / Tabloid' : 'Letter'}</strong> and <strong>Landscape</strong>. Use <strong>Printer paper (auto fit)</strong> to fill a different paper size.`}</p>
      <div id="seats-sharing-status" class="sharing-status no-print" role="status" aria-live="polite">${sharing?.markup() || ''}</div>
      ${storageError ? `<div class="storage-warning no-print" role="alert">${html(storageError)}${conflict ? '<button type="button" data-action="download-recovery">Download stored data</button><button type="button" data-action="enable-save">Save this version instead</button>' : ''}</div>` : ''}
      <div class="seats-workspace no-print"><aside class="seats-panel">${peoplePanel()}<details id="people-extra-tools"><summary>Add names &amp; other tools</summary>${peopleManualTools()}<details id="room-settings"><summary>Table &amp; room settings</summary>${layoutPanel()}</details><div class="upload-area"><p class="field-note">Excel, CSV, or text. ${sharing?.linked(current.id) ? 'Names are shared with the other organizers.' : 'Names stay on this device until you save this page to the site.'}</p><button type="button" class="text-button" data-action="template">Download example CSV</button></div><details id="plan-files"><summary>Plans &amp; backups</summary><button type="button" data-action="backup">Download backup</button><button type="button" data-action="restore">Restore backup</button><button type="button" data-action="export-list">Download seating list</button></details><details id="seats-help"><summary>How to use Seats</summary><p>There are 8 tables in the outside columns and 9 in each middle column. A7 has 3 seats. A8, C1, B6, and C6 have 4 seats. Other tables start with 5 seats. C1 and D1 have a small gap between them. The rav’s seat faces the room beside the Aron Kodesh.</p><p>Click a seat and start typing a name. Choosing an existing name adds it to this seat and keeps its other seats. Copy name and Paste name give another seat the same name without moving the original. Ctrl+C and Ctrl+V also work on focused seats. Undo and Redo reverse changes.</p><p>Use Delete beside a name to remove one person. Delete names lets you select several people or delete the whole list, including seated people. Undo restores deleted names and seats.</p><p>Upload a Name column, First name and Last name columns, or one name per line. Excel imports the first worksheet and skips duplicate names.</p><p>Saved charts opens the folder of charts on the website and this device. Download a backup to keep a spare copy.</p>${sharing?.enabled ? '<p>Save puts the current chart on the website. Later changes save automatically. Anyone signed in can open it from Saved charts and edit it. Both people see each other’s changes. Undo keeps the other organizer’s work.</p>' : ''}<p>Printer paper (auto fit) fills the printable width and height of the paper selected in your printer dialog. Use Landscape and turn off browser headers and footers. For a fixed-size PDF, choose Letter or 11 × 17 and select Save as PDF. Match that size in the printer dialog, including Android’s paper-size picker.</p></details></details></aside>
      <section class="seats-canvas"><div class="canvas-heading"><h2>Room layout</h2><p>${current.tables.length} tables · ${capacity} seats · ${assigned.size} seated${unset ? ` · ${unset} not set` : ''}</p><div class="canvas-buttons"><button type="button" data-action="undo" ${(sharing?.linked(current.id) ? sharing.canUndo() : history.length) ? '' : 'disabled'}>Undo</button><button type="button" data-action="redo" ${(sharing?.linked(current.id) ? sharing.canRedo() : future.length) ? '' : 'disabled'}>Redo</button><label class="chart-view-label"><span class="sr-only">Chart view</span><select id="chart-view"><option value="width" ${!zoom && !wholeRoom ? 'selected' : ''}>Full width</option><option value="whole" ${wholeRoom ? 'selected' : ''}>Whole chart</option><option value="actual" ${zoom === 1200 ? 'selected' : ''}>100%</option><option value="custom" hidden ${zoom && zoom !== 1200 ? 'selected' : ''}>${zoom ? Math.round(zoom / 1200 * 100) + '%' : 'Zoomed'}</option></select></label><output id="seats-zoom-level" class="sr-only" aria-label="Chart zoom">${zoom ? Math.round(zoom / 1200 * 100) + '%' : wholeRoom ? 'Whole chart' : 'Fit width'}</output><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div></div>
        ${unset ? '<p class="setup-hint">Next: set the number of seats at each table. You can also apply a count to a whole column.</p>' : ''}
        ${overflowTables.size ? `<p class="fit-warning" role="alert">Some names do not fit: ${html([...overflowTables].join(', '))}. Increase those tables’ width or depth before printing.</p>` : ''}
        <div class="room-scroll"><div class="room-stage${zoom ? ' is-zoomed' : ''}${wholeRoom ? ' fits-room' : ''}" ${zoom ? `style="width:${zoom}px"` : ''}>${room}</div></div>
        <div class="canvas-foot"><span>${seatsCanDragNames() ? 'Drag names to seats · Ctrl/Option-drag to copy · Zoom for a closer view' : 'Click a seat to type · Pinch or use + to zoom'}</span><span>${current.monochrome ? 'Black & white' : 'Color'} print preview</span></div></section></div>
      <p id="seats-notice" class="seats-notice no-print" role="status" aria-live="polite">${html(notice)}</p>
      <input id="names-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden><input id="backup-file" type="file" accept=".json" hidden>

      <section id="seats-print" class="seats-print${current.paper === 'auto' ? ' auto-paper' : ''}"><header><h1 class="minyan-logo" aria-label="7:30 Minyan"><span class="minyan-logo-time">7:30</span> <span class="minyan-logo-name">Minyan</span></h1></header>${printRoom}</section>`;
    seatsPreparePrint(root.querySelector('#seats-print .room-diagram'), printGeometry);
    sharing?.decorate(root);
    workspaceControls.refresh(); assignmentControls.refresh();
  }
  function dropName(data, target) {
    if (!data || data.planId !== plan().id) return;
    editor.flush(); editor.close();
    const person = plan().people.find(person => person.id === data.personId); if (!person) return;
    const source = seatsItems(plan()).find(table => table.seats.includes(person.id));
    if (!target.waiting && sharing?.canEdit(target.tableId, target.index) === false) return;
    if (target.waiting) {
      if (source) change(() => seatsAssign(plan(), source.id, source.seats.indexOf(person.id), null), person.name + ' returned to the waiting list.');
      return;
    }
    const table = seatsItems(plan()).find(table => table.id === target.tableId);
    if (!table || target.index < 0 || target.index >= table.count) return;
    if (table.seats[target.index] === person.id && !data.copy) return;
    const previous = plan().people.find(person => person.id === table.seats[target.index]);
    const copying = data.copy || (!data.pointer && Boolean(source));
    selectedPerson = null; selected = table.id;
    change(() => {
      if (copying) seatsWriteName(plan(), table.id, target.index, person.name, { duplicate: true });
      else seatsAssign(plan(), table.id, target.index, person.id);
    }, (copying ? 'Copied ' : 'Assigned ') + person.name + ' to ' + table.label + ', seat ' + (target.index + 1) + '.' + (previous && previous.id !== person.id ? ' ' + previous.name + ' is waiting for a seat.' : ''));
  }
  function openSeat(tableId, index) {
    if (sharing?.canEdit(tableId, index) === false) return;
    const table = seatsItems(plan()).find(entry => entry.id === tableId);
    if (!table || index >= (table.count ?? 0)) return;
    if (selectedPerson) {
      const person = plan().people.find(entry => entry.id === selectedPerson);
      change(() => seatsWriteName(plan(), table.id, index, person.name, { personId: person.id }), person.name + ' added to ' + table.label + ', seat ' + (index + 1) + '. Existing seats kept.');
      selectedPerson = null; renderInPlace(); return;
    }
    editor.open(tableId, index);
  }

  function addObject(type) {
    if (type === 'table' && plan().tables.length >= 200) return alertMessage('A plan can contain up to 200 tables.');
    if (type !== 'table' && plan().objects.length >= 200) return alertMessage('A plan can contain up to 200 room objects.');
    change(() => {
      const id = seatsUid(); selected = id;
      if (type === 'table') plan().tables.push({ id, label: 'T' + (plan().tables.length + 1), column: '', x: 490, y: 400, width: SEATS_SEAT_WIDTH * 5, height: SEATS_TABLE_HEIGHT, count: 5, seats: Array(5).fill(null), autoSize: true, anchor: 'center' });
      else {
        const defaults = { pillar: ['Pillar', 36, 36], cabinet: ['Sefarim cabinet', 65, 160], bimah: ['Bimah', 110, 100], amud: ['Amud', 64, 48], label: ['Label', 150, 40] }[type];
        const object = { id, type, label: defaults[0], x: 550, y: 400, width: defaults[1], height: defaults[2] };
        const occupied = [...plan().tables.map(table => ({ ...table, height: table.height + 14 })), ...plan().objects,
          { x: 17, y: SEATS_CROSS_WALKWAY.top, width: 1166, height: SEATS_CROSS_WALKWAY.bottom - SEATS_CROSS_WALKWAY.top }, { x: 41, y: SEATS_BACK_WALKWAY_Y, width: 1118, height: 936 - SEATS_BACK_WALKWAY_Y },
          { x: 41, y: SEATS_CROSS_WALKWAY.bottom, width: 62, height: SEATS_BACK_WALKWAY_Y - SEATS_CROSS_WALKWAY.bottom }, { x: 968, y: SEATS_CROSS_WALKWAY.bottom, width: 62, height: SEATS_BACK_WALKWAY_Y - SEATS_CROSS_WALKWAY.bottom },
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
    home: showHome,
    'start-create': createChart,
    'start-saved': () => openPageTools('pages'),
    save: () => { if (editor.flush() === false) return; const ok = save(); notice = ok ? (sharing?.linked(plan().id) ? 'Changes are saved to the shared plan automatically.' : keepPlan(plan()) ? 'Plan saved in this browser.' : 'Empty charts are not saved.') : 'Download a backup to keep this plan.'; renderInPlace(); },
    undo: () => { editor.close(); if (sharing?.linked(plan().id)) return sharing.undo(); if (history.length) { future.push(copy(state)); restoreLocalHistory(history.pop()); save(); notice = 'Last change undone.'; renderInPlace(); } },
    redo: () => { editor.close(); if (sharing?.linked(plan().id)) return sharing.redo(); if (future.length) { history.push(copy(state)); restoreLocalHistory(future.pop()); save(); notice = 'Last change restored.'; renderInPlace(); } },
    'save-site': () => openPageTools('save'),
    'open-pages': () => openPageTools('pages'),
    'chart-history': () => openPageTools('history'),
    'date-name': () => { if (editor.flush() === false) return; change(() => { plan().name = seatsDatedChartName(new Date(), state.plans.filter(current => current.id !== plan().id).map(current => current.name)); }); const input = root.querySelector('#chart-name'); input.focus({ preventScroll: true }); input.select(); },
    fit: () => zoomControls.fit(),
    'fit-whole': () => zoomControls.fitWhole(),
    'zoom-actual': () => zoomControls.actual(),
    'zoom-in': () => zoomControls.increase(),
    'zoom-out': () => zoomControls.decrease(),
    print: () => { if (editor.flush() === false) return; if (overflowTables.size) return alertMessage('Printing paused because some names do not fit. Increase the affected tables’ width or depth.'); window.print(); },
    lock: () => auth.lock(),
    'rename-plan': () => { const name = window.prompt('Page name', plan().name); if (name?.trim()) change(() => { plan().name = name.trim().slice(0, 80); }, 'Page renamed.'); },
    'new-plan': createChart,
    backup: () => { editor.flush(); const snapshot = storedState(); if (!snapshot) return alertMessage('Add names or change the setup before downloading a chart backup.'); const chartRecords = Object.fromEntries(snapshot.plans.map(plan => [plan.id, { ...records.info(plan.id), ...(sharing?.metadata(plan.id) || {}) }])); download('seats-backup.json', JSON.stringify({ ...snapshot, chartRecords }, null, 2), 'application/json'); },
    restore: () => { editor.flush(); root.querySelector('#backup-file').click(); },
    'upload-names': () => openPageTools('names'),
    template: () => download('seats-names-example.csv', '\uFEFFName\r\nYosef Cohen\r\nMoshe Levi\r\n', 'text/csv;charset=utf-8'),
    'export-list': () => {
      editor.flush();
      const rows = [['Name', 'Table', 'Seat']];
      for (const person of seatsSortPeople(plan().people, nameOrder)) {
        const table = seatsItems(plan()).find(entry => entry.seats.includes(person.id));
        rows.push([person.name, table?.label || 'Unassigned', table ? table.seats.indexOf(person.id) + 1 : '']);
      }
      download('seats-list.csv', '\uFEFF' + rows.map(row => row.map(seatsCsvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    },
    'add-names': () => { const names = root.querySelector('#new-names').value.split(/\r?\n/); change(() => { const result = seatsAddNames(plan(), names); notice = result.added + ' names added; ' + result.duplicates + ' duplicates skipped.'; }); },
    'toggle-delete-names': () => { editor.flush(); editor.close(); deletingNames = !deletingNames; deleteSelection.clear(); selectedPerson = null; renderInPlace(); },
    'select-delete-shown': () => { const visible = visiblePeople(), clear = visible.every(person => deleteSelection.has(person.id)); visible.forEach(person => { if (clear) deleteSelection.delete(person.id); else deleteSelection.add(person.id); }); renderInPlace(); },
    'delete-selected-names': () => deleteNames(),
    'delete-all-names': () => deleteNames(true),
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
    const button = event.target.closest('[data-action],[data-add],[data-person],[data-edit-person],[data-delete-name],[data-open-seat]');
    if (button?.dataset.action) { const menu = button.closest('#chart-more'); if (menu) menu.open = false; return actions[button.dataset.action]?.(); }
    if (button?.dataset.add) return addObject(button.dataset.add);
    if (button?.dataset.person) { selectedPerson = selectedPerson === button.dataset.person ? null : button.dataset.person; notice = selectedPerson ? 'Now choose a seat inside a table.' : ''; renderInPlace(); return; }
    if (button?.dataset.deleteName) return deleteNames(false, button.dataset.deleteName);
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
    if (event.target.id === 'people-search') { search = event.target.value; root.querySelector('#people-list').innerHTML = peopleList(); root.querySelector('#people-delete-controls').innerHTML = deleteControls(); }
  });
  root.addEventListener('wheel', () => {
    if (document.activeElement?.matches('input[type="number"]')) document.activeElement.blur();
  }, { passive: true, capture: true });
  root.addEventListener('change', async event => {
    const control = event.target, id = control.id;
    if (id === 'people-sort') { nameOrder = control.value === 'last' ? 'last' : 'first'; try { localStorage.setItem(SEATS_NAME_SORT_KEY, nameOrder); } catch { /* Sorting remains available for this visit. */ } renderInPlace(); return; }
    if (control.dataset.deletePerson) { if (control.checked) deleteSelection.add(control.dataset.deletePerson); else deleteSelection.delete(control.dataset.deletePerson); renderInPlace(); return; }
    if (id === 'selected-item' || id === 'layout-item') { selected = control.value; renderInPlace(); return; }
    if (id === 'chart-view') { if (control.value === 'whole') zoomControls.fitWhole(); else if (control.value === 'actual') zoomControls.actual(); else zoomControls.fit(); return; }
    if (id === 'chart-name') { const name = control.value.trim(); if (name) return change(() => { plan().name = name.slice(0, 80); }, null, false); control.value = plan().name; return; }
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
      const targetId = plan().id; let reading = true; readingNames++; importing = true; renderInPlace();
      try {
        const file = control.files[0], names = await seatsReadNames(file);
        readingNames--; reading = false;
        change(() => { const target = state.plans.find(entry => entry.id === targetId); if (!target) throw new Error('The selected plan is no longer open.'); const result = seatsAddNames(target, names); notice = result.added + ' names added; ' + result.duplicates + ' duplicates skipped.'; });
        await sharing.uploadNameFile(file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Names', names);
      } catch (error) { notice = error.message; }
      finally { if (reading) readingNames--; }
      importing = false; renderInPlace();
    }
    if (id === 'backup-file' && control.files[0]) {
      try {
        if (control.files[0].size > 8 * 1024 * 1024) throw new Error('Choose a backup smaller than 8 MB.');
        const backup = JSON.parse(await control.files[0].text()), restored = seatsNormalizeState(backup);
        const additions = restored.plans.filter(restoredPlan => { seatsUpgradePlan(restoredPlan); restoredPlan.name = seatsChartName(restoredPlan.name, backup.chartRecords?.[restoredPlan.id]); return seatsHasContent(restoredPlan); });
        if (!additions.length) throw new Error('That backup contains no names or customized charts.');
        if (additions.length + savedPlans().length > 30) throw new Error('Restoring this file would exceed 30 saved plans.');
        change(() => { state.plans = savedPlans(); for (const restoredPlan of additions) { const oldId = restoredPlan.id, wasActive = oldId === restored.activeId; restoredPlan.id = seatsUid(); records.restore(restoredPlan.id, backup.chartRecords?.[oldId]); state.plans.push(restoredPlan); if (wasActive) state.activeId = restoredPlan.id; } if (!state.plans.some(current => current.id === state.activeId)) state.activeId = state.plans[0].id; screen = 'editor'; selected = ''; selectedPerson = null; conflict = false; }, 'Backup restored as additional plans. Your existing plans were kept.');
      } catch (error) { alertMessage(error.message); }
    }
  });
  root.addEventListener('keydown', event => {
    if (event.target.id === 'chart-name' && event.key === 'Enter') { event.preventDefault(); event.target.blur(); return; }
    const entryNode = event.target.closest('[data-item]'), seatNode = event.target.closest('.table-seat[data-seat]');
    if (seatNode && (event.ctrlKey || event.metaKey) && ['c', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault(); const fn = event.key.toLowerCase() === 'c' ? editor.copy : editor.paste;
      fn(seatNode.dataset.table, Number(seatNode.dataset.seat)); return;
    }
    if (seatNode && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault(); editor.open(seatNode.dataset.table, Number(seatNode.dataset.seat), event.key); return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && (seatNode || entryNode)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
    if (!root.querySelector('#room-settings')?.open || !entryNode || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (seatsIsFixed(plan().objects.find(object => object.id === entryNode.dataset.item))) return;
    event.preventDefault(); selected = entryNode.dataset.item;
    const delta = event.shiftKey ? 1 : 8;
    change(() => { const entry = item(); entry.x = number(entry.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), SEATS_BOUNDS.left, SEATS_BOUNDS.right - entry.width); entry.y = number(entry.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0), SEATS_BOUNDS.top, itemBottom(entry) - entry.height); if (['B1','C1','D1'].includes(entry.id)) seatsSyncFront(plan()); });
  });
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.drag-handle'), node = handle?.closest('[data-item]');
    if (pinching || !root.querySelector('#room-settings')?.open || !node || event.button !== 0) return;
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
      if (['B1','C1','D1'].includes(drag.entry.id)) seatsSyncFront(plan());
      if (!sharing?.linked(plan().id)) { history.push(drag.before); future = []; if (history.length > 25) history.shift(); }
      save(); notice = 'Position saved.'; suppressClick = true; renderInPlace(); setTimeout(() => { suppressClick = false; }, 0);
    }
    else { selected = drag.entry.id; renderInPlace(); }
    drag = null; sharing?.flush();
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', event => {
    if (screen !== 'editor' || !(event.ctrlKey || event.metaKey) || event.target.closest('input,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') { event.preventDefault(); (key === 'y' || event.shiftKey ? actions.redo : actions.undo)(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== SEATS_STORAGE_KEY || sharing?.linked(plan().id)) return;
    storedRaw = event.newValue;
    conflict = true; storageError = 'Seats changed in another tab. Reload to use that version, or download a backup before saving this version instead.'; renderInPlace();
  });
  window.addEventListener('beforeprint', () => { printing = true; editor.flush(); document.body.classList.toggle('seats-print-error', overflowTables.size > 0); });
  window.addEventListener('afterprint', () => { printing = false; document.body.classList.remove('seats-print-error'); sharing?.flush(); });
  window.addEventListener('pagehide', () => {
    const name = root.querySelector('#chart-name')?.value.trim();
    if (name && name !== plan().name) change(() => { plan().name = name.slice(0, 80); }, null, false);
    editor.flush(); save();
  });
  sharing = seatsCreateSharing({
    getState: () => state, getLocalPlans: savedPlans, canPublish: () => seatsHasContent(plan()), isViewingChart: () => screen === 'editor', isBusy: () => Boolean(drag || pinching || printing), notify: alertMessage,
    activatePage, restoreBackup: () => actions.restore(), newChart: () => actions['new-plan'](), initialName: auth.session.name, onSignInRequired: () => auth.lock(), onSignOut: () => auth.lock(), getRecord: id => records.info(id),
    pickNamesFile: () => root.querySelector('#names-file').click(),
    useNames: (names, name) => { if (!change(() => { const result = seatsAddNames(plan(), names); notice = name + ': ' + result.added + ' names added; ' + result.duplicates + ' existing names skipped.'; })) throw new Error(notice); },
    keepDeletedCopy: (id, metadata) => { const existing = records.info(id); records.restore(id, { ...existing, ...metadata, history: [...existing.history, ...(metadata.history || [])] }); save(); renderInPlace(); },
    removeLocal: id => { rememberedShared.delete(id); change(() => { state.plans = state.plans.filter(plan => plan.id !== id); if (!state.plans.length) state.plans = [seatsCreatePlan(seatsDatedChartName())]; if (!state.plans.some(plan => plan.id === state.activeId)) state.activeId = state.plans[0].id; selectedPerson = null; selected = ''; }, 'Chart removed from this device.'); },
    updatePlan: (id, incoming, activate = false) => {
      const focused = document.activeElement;
      const draft = root.contains(focused) && focused.matches('input:not([type=checkbox]),textarea') && focused.id ? { id: focused.id, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
      if (activate) { editor.flush(); editor.close(); screen = 'editor'; }
      incoming.name = seatsChartName(incoming.name, sharing?.metadata(id) || records.info(id));
      if (seatsNeedsUpgrade(incoming)) {
        try { const key = SEATS_STORAGE_KEY + '-before-room-' + SEATS_ROOM_UPDATE + '-shared-' + id; if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: incoming.id, plans: [incoming] })); } catch { /* Existing names remain in the chart when a spare copy cannot be written. */ }
        const released = seatsUpgradePlan(incoming);
        notice = 'Room layout updated. Existing names were kept.' + (released ? ' ' + released + ' people returned to the waiting list after the updated seat counts.' : '');
      }
      state.plans = state.plans.filter(current => current.id === id || (!activate && current.id === state.activeId) || keepPlan(current));
      const index = state.plans.findIndex(plan => plan.id === id);
      if (index < 0) state.plans.push(incoming); else state.plans[index] = incoming;
      if (activate) { state.activeId = id; selected = ''; selectedPerson = null; }
      save(); renderInPlace();
      if (draft && !activate) {
        const input = root.querySelector('#' + CSS.escape(draft.id));
        if (input) { input.value = draft.value; input.focus({ preventScroll: true }); if (draft.start !== null && input.setSelectionRange) { try { input.setSelectionRange(draft.start, draft.end); } catch { /* Number controls have no text selection. */ } } }
      }
    },
    recoverPlan: (incoming, reason) => {
      const recovery = copy(incoming); recovery.id = seatsUid(); recovery.name = (recovery.name.slice(0, 50) + ' (unsynced copy)').slice(0, 80);
      try { localStorage.setItem(SEATS_STORAGE_KEY + '-shared-recovery-' + Date.now(), JSON.stringify(recovery)); } catch { download('seats-unsynced-recovery.json', JSON.stringify({ version: 1, activeId: recovery.id, plans: [recovery] }), 'application/json'); }
      if (state.plans.length < 30) state.plans.push(recovery);
      notice = reason + ' Your changes were kept as an unsynced local copy. The shared plan shows the latest online version.';
    },
    onStatus: () => {
      const links = state.plans.filter(plan => sharing?.linked(plan.id)).map(plan => plan.id).join();
      if (links !== sharingLinks) { history = []; future = []; sharingLinks = links; }
      syncSaveStatus();
      const nameFiles = root.querySelector('.people-upload'); if (nameFiles && !importing) nameFiles.textContent = sharing?.nameFilesLabel || 'Name files';
      const status = root.querySelector('#seats-sharing-status'); if (status) status.innerHTML = sharing?.markup() || '';
      sharing?.decorate(root);
      keepPosition(root, () => { workspaceControls.refresh(); zoomControls.refresh(); }); editor.sync();
    },
  });
  auth.onLock(() => { editor.flush(); save(); location.reload(); });
  render(); save(); zoomControls.refresh(); sharing.start();
}

seatsEntry();
