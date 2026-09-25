import { originalSheetHTML, fitOriginalSheet } from './original-sheet.js';
import { boardSchedules, fitBoardSchedules } from './board-schedules.js';
import { groupAnnouncements, renderAnnouncementGroup } from './announcements.js';
import { themeAt } from './appearance.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = escapeHTML;
const zmanTime = value => {
  const parts = String(value ?? '').match(/^(\d{1,2}:\d{2})(:\d{2})$/);
  return parts ? `${esc(parts[1])}<span class="zman-seconds">${esc(parts[2])}</span>` : esc(value);
};
const dateLabel = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',weekday:'short',timeZone:'UTC'});
// Kept for existing editor imports. A notice is always one complete card.
export function announcementPages(item) { return [item]; }
export function cardHTML(item) {
  const d = item.data || {};
  if (item.kind === 'dedication') {
    const sponsor = d.anonymous ? 'Sponsored anonymously' : d.sponsor;
    const lines = [['dedication-type',d.dedicationType === 'Custom' ? '' : d.dedicationType],['dedication-name',d.dedicationName],['dedication-text',d.dedicationText],['dedication-message',d.message],['sponsor',sponsor]];
    return `<article class="tv-card dedication"><h2 lang="he" dir="rtl">פרנס היום</h2><div class="dedication-copy">${lines.filter(([,text])=>String(text||'').trim()).map(([name,text])=>`<p class="${name}" dir="auto">${esc(text)}</p>`).join('')}</div>${d.hebrewLabel ? `<p class="card-page" dir="auto">${esc(d.hebrewLabel)}</p>` : ''}</article>`;
  }
  return `<article class="tv-card ${esc(d.priority)}"><p class="eyebrow">${esc(d.category || 'Community')}</p><h2 dir="auto">${esc(item.title)}</h2><p dir="auto" style="white-space:pre-wrap">${esc(d.message)}</p>${d.contact || d.phone ? `<p class="contact"><bdi dir="auto">${esc(d.contact)}</bdi><bdi dir="ltr">${esc(d.phone)}</bdi></p>` : ''}</article>`;
}
function setHTML(node, html) {
  if (node._html === html) return false;
  node.innerHTML = html;
  node._html = html;
  return true;
}

/** The shell and schedule host stay mounted. Clock ticks, fetches, theme changes
 * and dedication rotation update their own nodes, never rebuild the chart. */
export class DisplayView {
  constructor(host) {
    this.host = host;
    this.slots = new Map();
    this.warning = [];
    host.innerHTML = `<div class="tv-stage board-layout stable-board"><div class="tv-preview-label" hidden>PRIVATE PREVIEW · NOT THE LIVE SCREEN</div><header class="tv-head"><div class="tv-brand" lang="he" dir="rtl"></div><section class="board-dedication"></section><div class="tv-date"></div><div class="tv-clock"></div></header><div class="tv-layout"><section class="board-zmanim"></section><main class="tv-center"></main></div><section class="board-notices"></section><footer class="tv-footer"><div class="next-minyan"></div><span class="connection-state" role="status"></span><span class="key">Underlined: downstairs · * Ezras Nashim · ** Simcha hall<br>Times follow the shul’s published schedules</span></footer></div>`;
    this.stage = host.firstElementChild;
    this.stage.classList.add('right-column-board');
    for (const [key, selector] of Object.entries({brand:'.tv-brand',date:'.tv-date',clock:'.tv-clock',dedication:'.board-dedication',zmanim:'.board-zmanim',schedules:'.tv-center',notices:'.board-notices',next:'.next-minyan',connection:'.connection-state'})) this[key] = this.stage.querySelector(selector);
    this.resize = () => {
      const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      const scale = Math.min(w / 1920, h / 1080);
      this.stage.style.transform = `scale(${scale})`;
      this.stage.style.left = (w - 1920 * scale) / 2 + 'px';
      this.stage.style.top = (h - 1080 * scale) / 2 + 'px';
    };
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    const fontsReady = document.fonts ? Promise.all([document.fonts.ready, document.fonts.load('700 28px David')]).catch(() => {}) : Promise.resolve();
    fontsReady.then(() => {
      if (this.destroyed) return;
      // Regular panels also measure the final Hebrew font, once at startup.
      if (this.snapshot) {
        if (!this.originalSheetBox) this.scheduleKey = null;
        this.headerKey = null;
        this.layoutKey = null;
        this.update(this.snapshot, this.options);
      }
      this.checkCapacity();
    });
  }
  choose(key, items, now) {
    if (!items.length) { this.slots.delete(key); return null; }
    let state = this.slots.get(key), selected = items.find(i => i.id === state?.id);
    if (!selected || now - state.at >= (selected.data.duration || 35) * 1000) {
      selected = items[selected ? (items.indexOf(selected) + 1) % items.length : 0];
      this.slots.set(key, {id:selected.id, at:now});
    }
    return selected;
  }
  update(snapshot, {now = Date.now(), stale = false, preview = false, theme = null, connection = 'live', lastSyncAt = null} = {}) {
    this.snapshot = snapshot;
    this.options = {now,stale,preview,theme,connection,lastSyncAt};
    const instant = preview ? snapshot.at : new Date(now).toISOString(), s = snapshot.schedule;
    this.stage.dataset.theme = theme || themeAt(snapshot.appearance, instant);
    this.stage.querySelector('.tv-preview-label').hidden = !preview;
    const items = (snapshot.items || []).filter(i => i.startsAt <= instant && (!i.endsAt || instant < i.endsAt));
    setHTML(this.brand, `<span class="brand-english" lang="en" dir="ltr">Bais Medrash of<br> Lakewood Commons</span><span class="brand-hebrew" lang="he" dir="rtl">${esc(s.shulName)}</span>`);
    setHTML(this.date, `<b dir="rtl">${esc(s.hebrewDate)}</b><br>${dateLabel(s.date)}${s.presentation ? ' · <bdi dir="rtl">' + esc(s.presentation.currentDay) + '</bdi>' : ''}`);
    const clock = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(instant));
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const dedications = items.filter(i => i.kind === 'dedication');
    const dedication = this.choose('dedication', dedications, now);
    setHTML(this.dedication, dedication ? cardHTML(dedication) : '');
    this.dedication.hidden = !dedication;
    this.fitDedicationHeader(dedications);
    setHTML(this.zmanim, '<h2 dir="rtl">זמני היום</h2>' + (s.zmanim || []).map(z => `<div><bdi dir="ltr">${zmanTime(z.time)}</bdi><span dir="rtl">${esc(z.label)}</span></div>`).join(''));

    const groups = groupAnnouncements(items), groupsKey = JSON.stringify(groups);
    const upcoming = (snapshot.upcoming || []).filter(i => i.startsAt > instant).map(i => `<div class="tv-upcoming"><strong>${esc(i.title)}</strong><br>${dateLabel(i.data.appliesFrom)} – ${dateLabel(i.data.appliesTo)}</div>`).join('');
    const sheet = s.specialSheet && instant >= s.specialSheet.previewStartsAt && instant < s.specialSheet.endsAt ? s.specialSheet : null;
    const placement = sheet && instant >= sheet.coversBothAt ? 'both' : 'shabbos';
    // Deliberately omit the clock, next minyan, generatedAt and connection state.
    const scheduleKey = JSON.stringify([sheet ? [sheet.sourceId,sheet.title,sheet.year,sheet.sections,sheet.columnBreakAt,placement] : null, sheet && placement === 'both' ? null : s.presentation,upcoming]);
    if (scheduleKey !== this.scheduleKey) {
      this.scheduleKey = scheduleKey;
      let box = null;
      if (sheet) {
        const sourceKey = JSON.stringify([sheet.sourceId,sheet.title,sheet.year,sheet.sections,sheet.columnBreakAt]);
        if (this.originalSheetKey !== sourceKey) {
          this.originalSheetBox?.querySelector('.original-sheet-host')?.disconnectOriginalSheet?.();
          box = document.createElement('section');
          box.className = 'schedule-sheet-box original-sheet-box';
          box.innerHTML = originalSheetHTML(sheet);
          this.originalSheetBox = box;
          this.originalSheetKey = sourceKey;
        } else box = this.originalSheetBox;
        box.dataset.placement = placement;
        box.setAttribute('aria-label', `${sheet.title} ${sheet.yearLabel}`);
      }
      // Preserve the connected original page even when an adjacent weekly
      // reference changes or the page expands into both schedule columns.
      for (const child of [...this.schedules.children]) if (child !== box) child.remove();
      this.schedules.style.removeProperty('grid-template-columns');
      if (!(sheet && placement === 'both') && s.presentation) {
        const template = document.createElement('template');
        template.innerHTML = boardSchedules(s.presentation, upcoming);
        if (sheet) template.content.querySelector('.board-shabbos')?.remove();
        this.schedules.append(template.content);
      }
      if (box) {
        if (box.parentElement !== this.schedules) this.schedules.prepend(box);
      } else {
        this.originalSheetBox?.querySelector('.original-sheet-host')?.disconnectOriginalSheet?.();
        this.originalSheetBox = null;
        this.originalSheetKey = null;
      }
    }
    const layoutKey = scheduleKey + groupsKey + this.headerKey;
    if (this.layoutKey !== layoutKey) {
      this.layoutKey = layoutKey;
      this.layoutBoard(groups, sheet, placement);
    }
    this.renderNotices();
    const next = s.next && s.next.at >= instant ? s.next : null;
    setHTML(this.next, `<span class="next-label">Next minyan</span>${next ? `<strong dir="auto">${esc(next.name)} <bdi dir="ltr">${esc(next.time)}</bdi></strong><span class="next-place" dir="auto">${esc(next.place)}</span>` : '<strong>No further minyan in the loaded schedule</strong>'}`);
    const savedLabel = connection === 'cached' ? 'Using saved information' : stale ? 'Schedule update unavailable' : '';
    if (this.connection.textContent !== savedLabel) this.connection.textContent = savedLabel;
    this.connection.title = savedLabel && lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-US',{timeZone:'America/New_York'})} (New York)` : '';
    this.checkCapacity();
  }
  fitDedicationHeader(items) {
    const key = JSON.stringify(items.map(item=>[item.id,item.data]));
    if (key === this.headerKey) return;
    this.headerKey = key;
    this.stage.classList.toggle('has-dedication',!!items.length);
    this.stage.style.removeProperty('--board-head-height');
    this.stage.style.removeProperty('--dedication-card-width');
    if (!items.length) return;
    // Start at half the available width. Expand only when saved copy would
    // wrap into extra lines; reserve one size for every active dedication so
    // rotation, clock ticks and theme changes never move the schedules.
    const fullWidth = this.dedication.offsetWidth;
    const measure = document.createElement('section');
    measure.className = 'board-dedication dedication-measure';
    Object.assign(measure.style,{position:'absolute',left:'-10000px',top:'0',height:'auto',visibility:'hidden',pointerEvents:'none'});
    measure.style.setProperty('--dedication-card-width','100%');
    this.stage.append(measure);
    const copies = items.map(item=>({html:cardHTML(item)}));
    const size = (copy,width) => {
      measure.style.width = width+'px';
      measure.innerHTML = copy.html;
      return {height:measure.scrollHeight,overflow:measure.scrollWidth>width+1};
    };
    for (const copy of copies) copy.fullHeight = size(copy,fullWidth).height;
    const fits = width => copies.every(copy=>{
      const measured = size(copy,width);
      return !measured.overflow && measured.height<=copy.fullHeight+1;
    });
    let width = Math.ceil(fullWidth/2);
    if (!fits(width)) {
      let low = width, high = fullWidth;
      while (high-low>1) {
        const middle = Math.floor((low+high)/2);
        if (fits(middle)) high=middle;
        else low=middle;
      }
      width=high;
    }
    let height = 104;
    for (const copy of copies) height=Math.max(height,size(copy,width).height);
    measure.remove();
    this.stage.style.setProperty('--dedication-card-width',width+'px');
    this.stage.style.setProperty('--board-head-height',Math.ceil(height+14)+'px');
  }
  noticeHeight(pages) {
    const measure = document.createElement('section');
    measure.className = 'board-notices notice-measure';
    Object.assign(measure.style, {position:'absolute',left:'0',top:'-10000px',width:this.notices.offsetWidth+'px',height:'auto',gridAutoRows:'auto',visibility:'hidden',pointerEvents:'none'});
    this.stage.append(measure);
    let height = 0;
    for (const groups of pages) {
      measure.style.gridTemplateColumns = groups.map(g => `${g.slotSpan}fr`).join(' ');
      measure.innerHTML = groups.map(renderAnnouncementGroup).join('');
      height = Math.max(height, measure.scrollHeight + 4);
    }
    measure.remove();
    return height;
  }
  layoutBoard(groups, sheet, placement) {
    // Every published announcement stays visible together, including beside a
    // special chart. Clock ticks and theme changes never rerun this measurement.
    this.stage.classList.remove('right-extended','special-expanded','week-extended','week-wide-notices','compact-notice-spacing','compact-zmanim-spacing');
    this.stage.style.removeProperty('--week-notice-rail');
    this.stage.classList.toggle('without-notices', !groups.length);
    this.stage.classList.toggle('all-notices', !!groups.length);
    this.stage.classList.toggle('sheet-notices', !!sheet && !!groups.length);
    this.stage.classList.toggle('sheet-wide-notices', !!sheet && !!groups.length && placement === 'both');
    this.stage.style.setProperty('--notice-height', groups.length ? '280px' : '0px');
    this.noticePages = groups.length ? [groups] : [];
    this.noticePage = 0;
    if (sheet) this.stage.classList.add('right-extended');
    if (groups.length) this.stage.style.setProperty('--notice-height', Math.max(280,this.noticeHeight(this.noticePages))+'px');
    let fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
    const zmanimOverflows = () => this.zmanim.scrollHeight > this.zmanim.clientHeight + 2;
    if (groups.length && (fit.weekly?.overflow || fit.special?.overflow || zmanimOverflows())) {
      // Preserve the full dedication and schedule type sizes by reclaiming
      // surplus notice spacing only when the panels above actually need it.
      this.stage.classList.add('compact-notice-spacing');
      this.stage.style.setProperty('--notice-height', Math.max(280,this.noticeHeight(this.noticePages))+'px');
      fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
      if (fit.weekly?.overflow || fit.special?.overflow || zmanimOverflows()) {
        // Narrow notice columns can dictate the whole row's height. Try a
        // modest width balance and keep it only when every complete card fits
        // in less height. The saved groups and their order remain untouched.
        const balanced = [groups.map(group=>({...group,slotSpan:Math.sqrt(group.slotSpan)}))];
        const balancedHeight = Math.max(280,this.noticeHeight(balanced));
        if (balancedHeight < parseFloat(this.stage.style.getPropertyValue('--notice-height'))) {
          this.noticePages = balanced;
          this.stage.style.setProperty('--notice-height',balancedHeight+'px');
          fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
        }
      }
    }
    if (groups.length && !sheet && fit.special?.overflow) {
      // A long Shabbos keeps reading down the right column. Measure the whole
      // announcement row again at its narrower width before fitting the left
      // panels, so every saved notice remains visible on the same screen.
      this.stage.classList.add('right-extended');
      const extended = [groups], balanced = [groups.map(group=>({...group,slotSpan:Math.sqrt(group.slotSpan)}))];
      const extendedHeight = Math.max(280,this.noticeHeight(extended));
      const balancedHeight = Math.max(280,this.noticeHeight(balanced));
      this.noticePages = balancedHeight < extendedHeight ? balanced : extended;
      this.stage.style.setProperty('--notice-height',Math.min(extendedHeight,balancedHeight)+'px');
      fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
    }
    if (zmanimOverflows()) this.stage.classList.add('compact-zmanim-spacing');
    if (groups.length && (fit.weekly?.overflow || zmanimOverflows())) {
      // A Selichos or Chol Hamoed week can need the full height as well. Keep
      // both schedules intact and move the four complete announcement areas
      // into a measured two-by-two left rail, beneath the daily zmanim. A
      // taller dedication can need this same rail for the daily zmanim alone.
      this.stage.classList.add('week-extended','week-wide-notices','right-extended','compact-notice-spacing');
      this.noticePages = [groups];
      let best = null;
      for (const width of [600,640,680,720,760,800,840,880]) {
        this.stage.style.setProperty('--week-notice-rail',width+'px');
        const height = Math.max(280,this.noticeHeight(this.noticePages));
        this.stage.style.setProperty('--notice-height',height+'px');
        const trial = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
        const overflow = (trial.weekly?.overflow || 0) + (trial.special?.overflow || 0) + Math.max(0,this.zmanim.scrollHeight-this.zmanim.clientHeight-2);
        if (!best || overflow < best.overflow) best = {width,height,overflow};
        if (!overflow) break;
      }
      this.stage.style.setProperty('--week-notice-rail',best.width+'px');
      this.stage.style.setProperty('--notice-height',best.height+'px');
      fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
    }
    if (zmanimOverflows()) this.stage.classList.add('compact-zmanim-spacing');
    if (this.originalSheetBox) fitOriginalSheet(this.originalSheetBox);
  }
  renderNotices() {
    const groups = this.noticePages?.[0] || [];
    setHTML(this.notices, groups.map(renderAnnouncementGroup).join(''));
    this.notices.style.gridTemplateColumns = groups.map(g => `${g.slotSpan}fr`).join(' ');
    this.notices.dataset.page = String((this.noticePage || 0)+1);
    this.notices.dataset.pages = String(this.noticePages?.length || 0);
    this.notices.setAttribute('aria-label', 'All current announcements');
  }
  checkCapacity() {
    this.warning = [...this.stage.querySelectorAll('.announcement-group,.board-dedication,.board-weekly,.board-shabbos,.board-zmanim')]
      .filter(e => !e.hidden && e.getClientRects().length && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2))
      .map(e => e.classList.contains('announcement-group') ? `The ${e.querySelector('h2')?.textContent || 'announcement'} area needs more space. Review the full screen before publishing.` : 'Screen content exceeds its panel. Shorten the dedication or review the full screen before publishing.');
  }
  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    this.originalSheetBox?.querySelector('.original-sheet-host')?.disconnectOriginalSheet?.();
  }
}
