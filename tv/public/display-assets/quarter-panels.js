import { isCandleLighting } from './candle-lighting.js';
import { minyanKey, nextMinyanKey } from './minyan-timing.js';
const isShemaDeadline = group => group.auxiliary && /^(?:סזק(?:ר)?ש|סוףזמן(?:קריאתשמע|ק(?:ר)?ש))/.test(String(group.label).replace(/[^\p{L}\p{N}]/gu,''));
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
// Layout offsets ignore FLIP transforms, including an animated ancestor that
// temporarily becomes an offset parent. Shared density refits must not treat a
// row still moving into place as overflow.
function layoutTop(node, ancestor) {
  let top = 0;
  for (let current = node; current && current !== ancestor; current = current.offsetParent) {
    top += current.offsetTop;
    // offsetTop starts at its parent's padding edge, inside any border.
    if (current.offsetParent && current.offsetParent !== ancestor) top += current.offsetParent.clientTop;
  }
  return top;
}
const layoutBottom = (node, ancestor) => layoutTop(node, ancestor) + node.offsetHeight;

function timeHTML(event) {
  if(event.isText)return `<span class="quarter-relative-time" lang="he" dir="rtl">${esc(event.time)}</span>`;
  return `<span class="quarter-time" data-time="${esc(event.at)}" data-minyan="${esc(minyanKey(event))}" title="${esc(event.place)}">${event.reckoning ? `<small class="quarter-reckoning" lang="he" dir="rtl">${esc(event.reckoning)}</small>` : ''}<span class="quarter-time-clock"><span class="quarter-time-value${event.underlined ? ' is-downstairs' : ''}">${esc(event.time)}</span>${event.mark ? `<sup>${esc(event.mark)}</sup>` : ''}</span></span>`;
}

/** Keep source-date rows mounted. Only expired content leaves the frame. */
export class QuarterPanel {
  constructor(host, kind) {
    this.host = host;
    this.kind = kind;
    this.departing = new Set();
    host.innerHTML = `<header class="quarter-panel-head"><h2 lang="he" dir="rtl">${kind === 'zmanim' ? 'זמני היום' : 'זמני תפילה'}</h2></header><div class="quarter-viewport"><div class="quarter-flow"></div></div>` + (kind === 'prayers' ? '<div class="quarter-legend"><span><u>Underlined</u>: downstairs</span><span>* Ezras Nashim · ** Simcha hall</span></div>' : '');
    this.viewport = host.querySelector('.quarter-viewport');
    this.flow = host.querySelector('.quarter-flow');
  }
  invalidate() { this.key = null; }
  descriptors(data) {
    const days = this.kind === 'zmanim' ? data.zmanDays || [] : data.prayerSections || data.prayerDays || [];
    const rows = [];
    for (const day of days) {
      const entries = this.kind === 'zmanim' ? day.zmanim : day.groups?.filter(group => !isShemaDeadline(group) && !(group.auxiliary && isCandleLighting(group.label)));
      if (!entries?.length && !day.note) continue;
      const section = day.key || 'day:'+day.date,sourceDate = day.sourceDate || day.date;
      const heading = day.relativeLabel === 'אתמול' ? day.relativeLabel : day.displayTitle || day.title;
      const fullDate = [day.relativeLabel,day.title,day.hebrewDate].filter(Boolean).join(' · ');
      rows.push({key:section,section,day:sourceDate,type:'heading',html:`<h3 lang="he" dir="rtl" aria-label="${esc(fullDate)}">${esc(heading)}</h3>`});
      if (!entries?.length) rows.push({key:`note:${section}`,section,day:sourceDate,type:'note',html:esc(day.note)});
      else if (this.kind === 'zmanim') for (const zman of entries) rows.push({key:`z:${day.date}:${zman.key}`,section,day:day.date,type:'zman',at:zman.at,html:`<bdi class="quarter-zman-clock" dir="ltr">${clockHTML(zman.time)}</bdi><span class="quarter-zman-name" lang="he" dir="rtl">${esc(zman.label)}</span>`});
      else for (const group of entries) {
        const label = /^מנחה\s+ערב\s+שבת$/.test(group.label) ? 'מנחה' : group.label;
        rows.push({key:`p:${group.key}`,section,day:group.sourceDate || day.date,type:'prayer',printed:Boolean(group.printed),
          columns:Math.max(1,Math.min(3,group.events.filter(event=>!event.isText).length)),
          long:String(label).length>13||!group.printed&&group.events.length!==1&&String(label).trim().split(/\s+/).length>1,
          html:`<h4 lang="he" dir="rtl">${esc(label)}</h4><div class="quarter-times" dir="ltr">${group.events.map(timeHTML).join('')}</div>${group.note?`<p class="quarter-row-note" lang="he" dir="rtl">${esc(group.note)}</p>`:''}`});
      }
    }
    return rows;
  }
  update(data, instant, {deferFit = false} = {}) {
    const rows = this.descriptors(data), key = JSON.stringify(rows);
    const entries = rows.filter(row => row.type !== 'heading');
    // Include overnight carryover above today. When today is finished, reserve
    // the first upcoming source date instead of only yesterday's last group.
    this.requiredDay = entries.find(row => row.day >= data.date)?.day || entries[0]?.day || null;
    const stamp = Date.parse(instant), previousInstant = this.instant;
    this.instant = stamp;
    if (key === this.key) return false;
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
    this.highlightedKey = null;
    const existing = new Map([...this.flow.children].map(node => [node.dataset.motion,node]));
    const retained = new Set();
    let cursor = this.flow.firstElementChild;
    for (const row of rows) {
      const node = existing.get(row.key) || document.createElement(row.type === 'heading' ? 'header' : row.type === 'prayer' ? 'section' : 'div');
      node.className = row.type === 'heading' ? 'quarter-day-heading' : row.type === 'prayer' ? 'quarter-prayer-group' : row.type === 'zman' ? 'quarter-zman-row' : 'quarter-empty';
      node.classList.toggle('quarter-long-name',Boolean(row.long));
      node.classList.toggle('quarter-printed-row',Boolean(row.printed));
      if(row.printed||row.type==='prayer'&&row.columns===1)node.dataset.timeColumns=String(row.columns);else delete node.dataset.timeColumns;
      node.dataset.motion = row.key;
      node.dataset.day = row.day;
      node.dataset.section = row.section;
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
    this.pendingMotion = animate ? old : null;
    if (!deferFit) this.refit();
    return true;
  }
  highlightNext(next, instant) {
    const key = nextMinyanKey(next, instant);
    if (this.highlightedKey === key) return;
    this.highlightedKey = key;
    for (const time of this.flow.querySelectorAll('[data-minyan]')) {
      const active = Boolean(key) && time.dataset.minyan === key;
      time.classList.toggle('is-next-minyan', active);
      if (active) time.setAttribute('aria-current', 'time');
      else time.removeAttribute('aria-current');
    }
  }
  revealRows() {
    for (const node of this.flow.children) {
      node.hidden = false;
      for (const time of node.querySelectorAll('[data-time]')) time.hidden = false;
    }
  }
  /** Natural height through the whole remaining current day, including any
   * earlier carryover. Values use design pixels and ignore active transforms.
   * Hidden flags are restored before returning, without replacing any nodes. */
  firstDayMetrics() {
    const rows = [...this.flow.children];
    const targets = rows.filter(node => node.dataset.day === this.requiredDay);
    const availableHeight = this.viewport.clientHeight;
    if (!targets.length) return {date:null,startDate:null,requiredHeight:0,availableHeight,fits:true};
    const flags = [...new Set([...rows,...this.flow.querySelectorAll('[data-time]')])].map(node => [node,node.hidden]);
    this.revealRows();
    let requiredHeight;
    try {
      const last = targets.at(-1);
      requiredHeight = layoutBottom(last, this.viewport) - layoutTop(this.flow, this.viewport);
    } finally {
      for (const [node,hidden] of flags) node.hidden = hidden;
    }
    return {date:this.requiredDay,startDate:rows.find(node => node.dataset.day)?.dataset.day || this.requiredDay,
      requiredHeight,availableHeight,fits:requiredHeight <= availableHeight + .5};
  }
  /** Refit after a shared density change. Staged updates animate only after
   * both panels have their final geometry, keeping the original moving rows. */
  refit() {
    this.revealRows();
    this.fitRows();
    const old = this.pendingMotion;
    this.pendingMotion = null;
    if (old) this.moveRows(old);
  }
  fitRows() {
    const bottom = this.viewport.clientHeight;
    let ended = false,total = 0,hidden = 0;
    const visibleDays = new Set(),visibleSections = new Set();
    const showSection = node => {visibleDays.add(node.dataset.day);visibleSections.add(node.dataset.section);};
    for (const node of this.flow.children) {
      if (node.dataset.rowType === 'heading') { node.hidden = ended; continue; }
      const times = node.matches('[data-time]') ? [node] : [...node.querySelectorAll('[data-time]')];
      if(node.classList.contains('quarter-printed-row')) {
        node.hidden=ended || layoutBottom(node,this.viewport)>bottom+.5;
        total+=times.length;
        if(node.hidden){ended=true;hidden+=times.length;}else showSection(node);
        continue;
      }
      if (!times.length) {
        node.hidden = ended || layoutBottom(node, this.viewport) > bottom + .5;
        if (!node.hidden && node.dataset.day) showSection(node);
        else ended = true;
        continue;
      }
      total += times.length;
      // Fit a complete three-time line, including any labels above its digits.
      const size = node.dataset.rowType === 'prayer' ? 3 : 1;
      for (let i=0;i<times.length;i+=size) {
        const line=times.slice(i,i+size);
        const label = i === 0 ? node.querySelector('h4') : null;
        const labelBottom = label ? layoutBottom(label, this.viewport) : 0;
        if (ended || Math.max(labelBottom,...line.map(time=>layoutBottom(time, this.viewport))) > bottom + .5) {
          ended = true;
          for (const time of line) { time.hidden = true; hidden++; }
        }
      }
      node.hidden = times.every(time=>time.hidden);
      if (!node.hidden) showSection(node);
    }
    for (const heading of this.flow.querySelectorAll('.quarter-day-heading')) if (!visibleSections.has(heading.dataset.section)) heading.hidden = true;
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