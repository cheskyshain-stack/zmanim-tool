import {DisplayView, escapeHTML as esc} from './renderer.js';
import {ANNOUNCEMENT_GROUPS, groupAnnouncements} from './announcements.js';
import {formatInstant,phase} from './time.js';

const categoryFor = {hall:'Simcha hall information',rav:'Rav’s hours',community:'Community services',support:'Donation appeals'};

/** Admin-only interaction layer around the same components used by /display/.
 * Never inserts controls into measured schedule/card content. Edits always use
 * protected records, including their version and timing, not public snapshots. */
export function mountScreenEditor(container, {snapshot, items, can, onEdit, onAdd, onRemoveDedication, selectedArea, onSelect = () => {}}) {
  const records = new Map(items.map(item => [item.id,item]));
  const groups = groupAnnouncements(snapshot.items);
  const areas = [...ANNOUNCEMENT_GROUPS, ...groups.filter(group => !ANNOUNCEMENT_GROUPS.some(area => area.id === group.id))];
  let selected = areas.some(area => area.id === selectedArea) ? selectedArea : groups[0]?.id || 'community';
  const dedications = items.filter(item => item.kind === 'dedication' && ['showing','scheduled'].includes(phase(item,snapshot.at))).sort((a,b) => (a.startsAt || '').localeCompare(b.startsAt || ''));
  const dedicationControls = can('dedication') ? `<section class="panel screen-dedication-controls"><div class="screen-area-heading"><h2 dir="auto">פרנס היום · Below זמני היום</h2><button type="button" id="screen-add-dedication">+ Add פרנס היום</button></div><p class="muted">Remove from screen stops a dedication from appearing and keeps it saved under Hidden.</p><div class="screen-dedication-items">${dedications.map(item => `<article class="screen-item"><div><span class="tag">${phase(item,snapshot.at) === 'showing' ? 'Showing now' : 'Scheduled'}</span><h3 dir="auto">${esc(item.data?.dedicationName || item.internalName || item.data?.dedicationText || 'פרנס היום')}</h3><p>${formatInstant(item.startsAt)} → ${formatInstant(item.endsAt)}</p></div><div class="actions"><button type="button" data-screen-edit="${esc(item.id)}">Edit dedication</button>${onRemoveDedication ? `<button type="button" class="remove-from-screen" data-screen-remove="${esc(item.id)}">Remove from screen</button>` : ''}</div></article>`).join('') || '<p class="muted">No active or upcoming dedications.</p>'}</div></section>` : '';
  container.innerHTML = `<div class="screen-edit-intro"><div><h2>Edit on the screen</h2><p>Tap an announcement to edit it. Tap an area heading to add information there.</p></div><span class="screen-time">${esc(formatInstant(snapshot.at))} · New York</span></div><div class="preview-host screen-edit-preview" aria-label="Shul View with editable announcement areas"></div>${dedicationControls}${can('announcement') ? `<div class="screen-area-picker" role="group" aria-label="Choose an announcement area">${areas.map(area => `<button type="button" data-screen-area="${esc(area.id)}" aria-pressed="false"><strong>${esc(area.title)}</strong><span>${groups.find(group => group.id === area.id)?.sections.length || 0} showing</span></button>`).join('')}</div><section class="screen-area-detail panel" aria-labelledby="screen-area-title"></section>` : ''}`;
  const warning = document.createElement('p');
  warning.className = 'notice';warning.hidden = true;warning.setAttribute('role','status');
  const host = container.querySelector('.preview-host');
  host.before(warning);
  const view = new DisplayView(host);
  view.update(snapshot, {preview:true});
  const detail = container.querySelector('.screen-area-detail');

  function decorate() {
    view.checkCapacity();
    const warningText = [...new Set([...(snapshot.warnings || []),...view.warning])].join(' ');
    warning.hidden = !warningText;
    if (warning.textContent !== warningText) warning.textContent = warningText;
    for (const section of host.querySelectorAll('.announcement-section')) {
      const item = records.get(section.dataset.sourceId);
      if (!item || !can(item.kind)) continue;
      section.classList.add('screen-edit-target');
      section.setAttribute('role','button');
      section.tabIndex = 0;
      section.setAttribute('aria-label',`Edit announcement: ${item.title || 'Untitled'}`);
    }
    if (can('announcement')) for (const group of host.querySelectorAll('.announcement-group')) {
      const heading = group.querySelector('h2');
      heading.dataset.screenGroup = group.dataset.announcementGroup;
      heading.classList.add('screen-edit-target');
      heading.setAttribute('role','button');
      heading.tabIndex = 0;
      heading.setAttribute('aria-label',`Manage ${heading.textContent} area`);
      group.classList.toggle('screen-selected-area',group.dataset.announcementGroup === selected);
    }
    const dedication = host.querySelector('.board-dedication');
    if (dedication && can('dedication') && !dedication.hidden) {
      const current = records.get(view.slots.get('dedication')?.id);
      dedication.classList.add('screen-edit-target');
      dedication.setAttribute('role','button');
      dedication.tabIndex = 0;
      dedication.setAttribute('aria-label',current ? 'Edit displayed פרנס היום' : 'Add פרנס היום sponsorship');
    }
  }

  function chooseArea(id, scroll = false) {
    if (!can('announcement') || !areas.some(area => area.id === id)) return;
    selected = id;
    onSelect(id);
    const area = areas.find(area => area.id === id);
    const active = (groups.find(group => group.id === id)?.sections || []).map(section => records.get(section.sourceId)).filter(Boolean);
    container.querySelectorAll('[data-screen-area]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.screenArea === id)));
    detail.innerHTML = `<div class="screen-area-heading"><div><p class="screen-area-eyebrow">Selected announcement area</p><h2 id="screen-area-title">${esc(area.title)}</h2></div><button type="button" id="screen-add-announcement" class="primary">+ Add announcement here</button></div><p class="muted">${active.length ? 'Choose an announcement below to edit its full text and display dates.' : 'Nothing is showing in this area yet. Add an announcement and choose when it should appear.'} Drafts and future announcements are under Saved items.</p><div class="screen-area-items">${active.map(item => `<article class="screen-item"><div><h3 dir="auto">${esc(item.title || 'Untitled')}</h3><p dir="auto">${esc(item.data.message)}</p>${item.data.contact || item.data.phone ? `<p class="screen-contact"><bdi dir="auto">${esc(item.data.contact)}</bdi> <bdi dir="ltr">${esc(item.data.phone)}</bdi></p>` : ''}</div><button type="button" data-screen-edit="${esc(item.id)}">Edit announcement</button></article>`).join('')}</div>`;
    decorate();
    if (scroll) detail.scrollIntoView({block:'nearest',behavior:'smooth'});
  }

  function activate(target) {
    const remove = target.closest('[data-screen-remove]');
    if (remove) {
      const item = records.get(remove.dataset.screenRemove);
      if (!remove.disabled && item?.kind === 'dedication' && item.status === 'published' && can('dedication')) onRemoveDedication?.(item,remove);
      return;
    }
    const section = target.closest('.announcement-section');
    const editButton = target.closest('[data-screen-edit]');
    const id = section?.dataset.sourceId || editButton?.dataset.screenEdit;
    if (id) {
      const item = records.get(id);
      if (section && can('announcement')) chooseArea(section.closest('.announcement-group').dataset.announcementGroup);
      if (item && can(item.kind)) onEdit(item);
      return;
    }
    const heading = target.closest('[data-screen-group]');
    const areaButton = target.closest('[data-screen-area]');
    if (heading || areaButton) { chooseArea(heading?.dataset.screenGroup || areaButton.dataset.screenArea,!!heading);return; }
    if (target.closest('#screen-add-announcement') && can('announcement')) {
      const group = ANNOUNCEMENT_GROUPS.some(area => area.id === selected) ? selected : 'separate';
      onAdd({kind:'announcement',status:'draft',data:{displayGroup:group,category:categoryFor[group] || 'General reminders'}});
      return;
    }
    if (target.closest('#screen-add-dedication') && can('dedication')) { onAdd({kind:'dedication',status:'draft',data:{}});return; }
    if (target.closest('.board-dedication') && can('dedication')) {
      const current = records.get(view.slots.get('dedication')?.id);
      if (current) onEdit(current);
      else onAdd({kind:'dedication',status:'draft',data:{}});
      return;
    }
    const group = target.closest('.announcement-group');
    if (group) chooseArea(group.dataset.announcementGroup,true);
  }
  const click = event => {
    // Links inside the preview must not navigate away from unsaved admin work.
    if (event.target.closest('.preview-host a')) {event.preventDefault();return;}
    activate(event.target);
  };
  const key = event => {
    if (!['Enter',' '].includes(event.key) || event.target.getAttribute('role') !== 'button') return;
    event.preventDefault();activate(event.target);
  };
  container.addEventListener('click',click);
  container.addEventListener('keydown',key);
  // The regular display may redraw once its Hebrew font finishes loading.
  // Reapply interaction attributes without changing dimensions or public markup.
  const observer = new MutationObserver(decorate);
  observer.observe(host,{childList:true,subtree:true});
  decorate();
  chooseArea(selected);
  return {chooseArea,destroy(){observer.disconnect();container.removeEventListener('click',click);container.removeEventListener('keydown',key);view.destroy();}};
}
