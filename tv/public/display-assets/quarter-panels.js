const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function clockHTML(time) {
  const parts = String(time).match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  return parts ? `<span class="quarter-clock-hours">${parts[1]}</span><span>:</span><span>${parts[2]}</span><small>${parts[3] || ''}</small>` : esc(time);
}
function html(node, value) {
  if (node._html === value) return;
  node.innerHTML = value;
  node._html = value;
}
function timeHTML(event) {
  return `<span class="quarter-time" data-time="${esc(event.at)}" title="${esc(event.place)}">${event.reckoning ? `<small class="quarter-reckoning" lang="he" dir="rtl">${esc(event.reckoning)}</small>` : ''}<span class="quarter-time-value${event.underlined ? ' is-downstairs' : ''}">${esc(event.time)}</span>${event.mark ? `<sup>${esc(event.mark)}</sup>` : ''}</span>`;
}

/** Keep source-date rows mounted. Only expired content leaves the frame. */
export class QuarterPanel {
  constructor(host, kind) {
    this.host = host;
    this.kind = kind;
    this.departing = new Set();
    host.innerHTML = `<header class="quarter-panel-head"><h2 lang="he" dir="rtl">${kind === 'zmanim' ? 'זמני היום' : 'זמני תפילה'}</h2></header><div class="quarter-viewport"><div class="quarter-flow"></div></div><div class="quarter-more"></div>` + (kind === 'prayers' ? '<div class="quarter-legend"><span><u>Underlined</u>: downstairs</span><span>* Ezras Nashim · ** Simcha hall</span></div>' : '');
    this.viewport = host.querySelector('.quarter-viewport');
    this.flow = host.querySelector('.quarter-flow');
    this.more = host.querySelector('.quarter-more');
  }
  invalidate() { this.key = null; }
  descriptors(data) {
    const days = this.kind === 'zmanim' ? data.zmanDays || [] : data.prayerDays || [];
    const rows = [];
    for (const day of days) {
      const entries = this.kind === 'zmanim' ? day.zmanim : day.groups;
      if (!entries?.length && !day.note) continue;
      rows.push({key:`day:${day.date}`,day:day.date,type:'heading',html:`<h3 lang="he" dir="rtl"><span>${esc(day.title)}</span>${day.relativeLabel ? `<small>${esc(day.relativeLabel)}</small>` : ''}</h3><p lang="he" dir="rtl">${esc(day.hebrewDate)}</p>`});
      if (!entries?.length) rows.push({key:`note:${day.date}`,day:day.date,type:'note',html:esc(day.note)});
      else if (this.kind === 'zmanim') for (const zman of entries) rows.push({key:`z:${day.date}:${zman.key}`,day:day.date,type:'zman',at:zman.at,html:`<bdi class="quarter-zman-clock" dir="ltr">${clockHTML(zman.time)}</bdi><span class="quarter-zman-name" lang="he" dir="rtl">${esc(zman.label)}</span>`});
      else for (const group of entries) rows.push({key:`p:${group.key}`,day:day.date,type:'prayer',long:String(group.label).length>13||String(group.label).trim().split(/\s+/).length>1,html:`<h4 lang="he" dir="rtl">${esc(group.label)}</h4><div class="quarter-times" dir="ltr">${group.events.map(timeHTML).join('')}</div>`});
    }
    return rows;
  }
  update(data, instant) {
    const rows = this.descriptors(data), key = JSON.stringify(rows);
    const stamp = Date.parse(instant), previousInstant = this.instant;
    this.instant = stamp;
    if (key === this.key) return;
    const animate = Boolean(this.key) && stamp >= previousInstant && stamp-previousInstant < 120000 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const old = new Map();
    // Capture the painted position before canceling an interrupted movement.
    for (const node of this.flow.children) {
      if (!node.hidden && node.getClientRects().length) old.set(node.dataset.motion,{rect:node.getBoundingClientRect(),clone:node.cloneNode(true)});
      for (const animation of node.getAnimations()) animation.cancel();
    }
    for (const ghost of this.departing) ghost.remove();
    this.departing.clear();
    this.key = key;
    const existing = new Map([...this.flow.children].map(node => [node.dataset.motion,node]));
    const retained = new Set();
    let cursor = this.flow.firstElementChild;
    for (const row of rows) {
      const node = existing.get(row.key) || document.createElement(row.type === 'heading' ? 'header' : row.type === 'prayer' ? 'section' : 'div');
      node.className = row.type === 'heading' ? 'quarter-day-heading' : row.type === 'prayer' ? 'quarter-prayer-group' : row.type === 'zman' ? 'quarter-zman-row' : 'quarter-empty';
      node.classList.toggle('quarter-long-name',Boolean(row.long));
      node.dataset.motion = row.key;
      node.dataset.day = row.day;
      node.dataset.rowType = row.type;
      if (row.type === 'zman') node.dataset.time = row.at || '';
      node.hidden = false;
      html(node,row.html);
      for (const time of node.querySelectorAll('[data-time]')) time.hidden = false;
      if (node !== cursor) this.flow.insertBefore(node,cursor);
      cursor = node.nextElementSibling;
      retained.add(node);
    }
    for (const node of [...this.flow.children]) if (!retained.has(node)) node.remove();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'quarter-empty';
      empty.textContent = 'The next dates are not available in the saved schedule.';
      this.flow.replaceChildren(empty);
    }
    this.fitRows();
    if (animate) this.moveRows(old);
  }
  fitRows() {
    const bottom = this.viewport.getBoundingClientRect().bottom;
    let ended = false,total = 0,hidden = 0;
    const visibleDays = new Set();
    for (const node of this.flow.children) {
      if (node.dataset.rowType === 'heading') { node.hidden = ended; continue; }
      const times = node.matches('[data-time]') ? [node] : [...node.querySelectorAll('[data-time]')];
      if (!times.length) {
        node.hidden = ended || node.getBoundingClientRect().bottom > bottom + .5;
        if (!node.hidden && node.dataset.day) visibleDays.add(node.dataset.day);
        else ended = true;
        continue;
      }
      total += times.length;
      // Fit a complete three-time line, including any labels above its digits.
      const size = node.dataset.rowType === 'prayer' ? 3 : 1;
      for (let i=0;i<times.length;i+=size) {
        const line=times.slice(i,i+size);
        const labelBottom = i === 0 ? node.querySelector('h4')?.getBoundingClientRect().bottom || 0 : 0;
        if (ended || Math.max(labelBottom,...line.map(time=>time.getBoundingClientRect().bottom)) > bottom + .5) {
          ended = true;
          for (const time of line) { time.hidden = true; hidden++; }
        }
      }
      node.hidden = times.every(time=>time.hidden);
      if (!node.hidden) visibleDays.add(node.dataset.day);
    }
    for (const heading of this.flow.querySelectorAll('.quarter-day-heading')) if (!visibleDays.has(heading.dataset.day)) heading.hidden = true;
    this.more.textContent = hidden ? 'Later times appear as space opens' : '';
    this.host.dataset.visibleTimes = String(total-hidden);
    this.host.dataset.laterTimes = String(hidden);
    this.host.dataset.visibleDays = String(visibleDays.size);
  }
  moveRows(old) {
    const stage = this.host.closest('.tv-stage'),scale=stage.getBoundingClientRect().width/1920;
    const viewport = this.viewport.getBoundingClientRect();
    const current = new Map([...this.flow.children].map(node=>[node.dataset.motion,node]));
    const options = {duration:2400,easing:'cubic-bezier(.25,.65,.3,1)',fill:'both'};
    for (const [key,before] of old) {
      if (current.has(key)) continue;
      const ghost = before.clone;
      ghost.classList.add('quarter-departing');
      ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{position:'absolute',left:(before.rect.left-viewport.left)/scale+'px',top:(before.rect.top-viewport.top)/scale+'px',width:before.rect.width/scale+'px',margin:'0',pointerEvents:'none',zIndex:'2'});
      this.viewport.append(ghost);
      this.departing.add(ghost);
      const distance = (before.rect.bottom-viewport.top)/scale+12;
      ghost.animate([{transform:'translateY(0)',opacity:1},{transform:`translateY(${-distance}px)`,opacity:0}],options).finished.then(()=>{ghost.remove();this.departing.delete(ghost);}).catch(()=>{});
    }
    const entering = [...current].find(([key,node])=>!old.has(key)&&!node.hidden&&node.getClientRects().length);
    const entryDistance = entering ? Math.max(24,(viewport.bottom-entering[1].getBoundingClientRect().top)/scale) : 0;
    for (const [key,node] of current) {
      if (node.hidden || !node.getClientRects().length) continue;
      const after = node.getBoundingClientRect(),before = old.get(key)?.rect;
      const distance = before ? (before.top-after.top)/scale : entryDistance;
      if (Math.abs(distance)>.5) node.animate([{transform:`translateY(${distance}px)`},{transform:'translateY(0)'}],options);
    }
  }
  destroy() {
    for (const node of this.flow.children) for (const animation of node.getAnimations()) animation.cancel();
    for (const ghost of this.departing) ghost.remove();
    this.departing.clear();
  }
}