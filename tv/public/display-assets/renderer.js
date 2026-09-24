import { originalSheetHTML, fitOriginalSheet } from './original-sheet.js';
import { boardSchedules, fitBoardSchedules } from './board-schedules.js';
import { groupAnnouncements, renderAnnouncementGroup } from './announcements.js';
import { themeAt } from './appearance.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = escapeHTML;
const dateLabel = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',weekday:'short',timeZone:'UTC'});
// Kept for existing editor imports. A notice is always one complete card.
export function announcementPages(item) { return [item]; }
export function cardHTML(item) {
  const d = item.data || {};
  if (item.kind === 'dedication') return `<article class="tv-card dedication"><h2 lang="he" dir="rtl">פרנס היום</h2><p class="dedication-type" dir="auto">${esc(d.dedicationType === 'Custom' ? '' : d.dedicationType)}</p><p class="dedication-name" dir="auto">${esc(d.dedicationName)}</p><p dir="auto">${esc(d.dedicationText)}</p>${d.message ? `<p dir="auto">${esc(d.message)}</p>` : ''}<p class="sponsor" dir="auto">${d.anonymous ? 'Sponsored anonymously' : esc(d.sponsor)}</p><p class="card-page" dir="auto">${esc(d.hebrewLabel)}</p></article>`;
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
    host.innerHTML = `<div class="tv-stage board-layout stable-board"><div class="tv-preview-label" hidden>PRIVATE PREVIEW · NOT THE LIVE SCREEN</div><header class="tv-head"><div class="tv-brand" lang="he" dir="rtl"></div><a class="shul-donate" href="https://baismedrashoflakewoodcommons.org/donate/"><img src="/display-assets/donate-qr.png" alt="Scan to donate to the shul"><div><strong>Support our shul</strong><small>baismedrashof<wbr>lakewoodcommons.org</small></div></a><section class="board-dedication"></section><div class="tv-date"></div><div class="tv-clock"></div></header><div class="tv-layout"><section class="board-zmanim"></section><main class="tv-center"></main></div><section class="board-notices"></section><footer class="tv-footer"><div class="next-minyan"></div><span class="connection-state" role="status"></span><span class="key">Underlined: downstairs · * Ezras Nashim · ** Simcha hall<br>Times follow the shul’s published schedules</span></footer></div>`;
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
      if (this.snapshot && !this.originalSheetBox) {
        this.scheduleKey = null;
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
    setHTML(this.brand, `${esc(s.shulName)}<small dir="ltr">LAKEWOOD COMMONS</small>`);
    setHTML(this.date, `<b dir="rtl">${esc(s.hebrewDate)}</b><br>${dateLabel(s.date)}${s.presentation ? ' · <bdi dir="rtl">' + esc(s.presentation.currentDay) + '</bdi>' : ''}`);
    const clock = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(instant));
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const dedication = this.choose('dedication', items.filter(i => i.kind === 'dedication'), now);
    setHTML(this.dedication, dedication ? cardHTML(dedication) : '');
    this.dedication.hidden = !dedication;
    setHTML(this.zmanim, '<h2 dir="rtl">זמני היום</h2>' + (s.zmanim || []).map(z => `<div><bdi dir="ltr">${esc(z.time)}</bdi><span dir="rtl">${esc(z.label)}</span></div>`).join(''));

    const groups = groupAnnouncements(items), groupsKey = JSON.stringify(groups);
    const upcoming = (snapshot.upcoming || []).filter(i => i.startsAt > instant).map(i => `<div class="tv-upcoming"><strong>${esc(i.title)}</strong><br>${dateLabel(i.data.appliesFrom)} – ${dateLabel(i.data.appliesTo)}</div>`).join('');
    const sheet = s.specialSheet && instant >= s.specialSheet.previewStartsAt && instant < s.specialSheet.endsAt ? s.specialSheet : null;
    const placement = sheet && instant >= sheet.coversBothAt ? 'both' : 'shabbos';
    // Deliberately omit the clock, next minyan, generatedAt and connection state.
    const scheduleKey = JSON.stringify([sheet ? [sheet.sourceId,sheet.title,sheet.year,sheet.sections,placement] : null, sheet && placement === 'both' ? null : s.presentation,upcoming]);
    if (scheduleKey !== this.scheduleKey) {
      this.scheduleKey = scheduleKey;
      let box = null;
      if (sheet) {
        const sourceKey = JSON.stringify([sheet.sourceId,sheet.title,sheet.year,sheet.sections]);
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
    const layoutKey = scheduleKey + groupsKey;
    if (this.layoutKey !== layoutKey) {
      this.layoutKey = layoutKey;
      this.layoutBoard(groups, sheet, placement, now);
    }
    this.renderNotices(now);
    const next = s.next && s.next.at >= instant ? s.next : null;
    setHTML(this.next, `<span class="next-label">Next minyan</span>${next ? `<strong dir="auto">${esc(next.name)} <bdi dir="ltr">${esc(next.time)}</bdi></strong><span class="next-place" dir="auto">${esc(next.place)}</span>` : '<strong>No further minyan in the loaded schedule</strong>'}`);
    const savedLabel = connection === 'cached' ? 'Using saved information' : stale ? 'Schedule update unavailable' : '';
    if (this.connection.textContent !== savedLabel) this.connection.textContent = savedLabel;
    this.connection.title = savedLabel && lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-US',{timeZone:'America/New_York'})} (New York)` : '';
    this.checkCapacity();
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
  layoutBoard(groups, sheet, placement, now) {
    // Reserve the right column before laying out notices. Neither the clock nor
    // notice rotation reruns this measurement or changes the schedule geometry.
    this.stage.classList.remove('right-extended','special-expanded','week-extended');
    this.stage.classList.toggle('without-notices', !groups.length);
    this.stage.style.setProperty('--notice-height', groups.length ? '340px' : '0px');
    let pages = groups.length ? [groups] : [];
    if (groups.length) this.stage.style.setProperty('--notice-height', Math.max(340,this.noticeHeight(pages))+'px');
    const fit = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {compactWeekly:false});
    if (sheet || fit.special?.overflow) {
      this.stage.classList.add('right-extended');
      this.stage.classList.toggle('special-expanded', !!sheet && placement === 'both');
      const perPage = sheet && placement === 'both' ? 1 : 2;
      pages = [];
      for (let i = 0; i < groups.length; i += perPage) pages.push(groups.slice(i,i+perPage));
      if (groups.length) {
        const minimum = sheet && placement === 'both' ? 460 : 340;
        this.stage.style.setProperty('--notice-height', Math.max(minimum,this.noticeHeight(pages))+'px');
      }
    }
    let fitted = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
    // Exception-heavy Selichos weeks also need a full-height center reference.
    // Move complete notices to the left rail instead of covering any prayer.
    if (fitted.weekly?.overflow) {
      this.stage.classList.add('right-extended','week-extended');
      pages = groups.map(group => [group]);
      if (groups.length) this.stage.style.setProperty('--notice-height', Math.max(460,this.noticeHeight(pages))+'px');
      fitted = fitBoardSchedules(this.schedules, this.snapshot.schedule.presentation, {allowCompact:true});
    }
    const previous = this.noticePages?.[this.noticePage || 0]?.map(g => g.id).join('|');
    this.noticePages = pages;
    const current = pages.findIndex(page => page.map(g => g.id).join('|') === previous);
    this.noticePage = current < 0 ? 0 : current;
    if (current < 0) this.noticeStarted = now;
    if (this.originalSheetBox) fitOriginalSheet(this.originalSheetBox);
  }
  renderNotices(now) {
    let groups = this.noticePages?.[this.noticePage || 0] || [];
    if (now < this.noticeStarted) this.noticeStarted = now;
    // A whole group stays together. Longer pages get longer reading time.
    const duration = Math.max(60000, groups.reduce((n,g) => n+g.charCount,0)/14*1000);
    if (this.noticePages?.length > 1 && now-this.noticeStarted >= duration) {
      this.noticePage = (this.noticePage+1)%this.noticePages.length;
      this.noticeStarted = now;
      groups = this.noticePages[this.noticePage];
    }
    setHTML(this.notices, groups.map(renderAnnouncementGroup).join(''));
    this.notices.style.gridTemplateColumns = groups.map(g => `${g.slotSpan}fr`).join(' ');
    this.notices.dataset.page = String((this.noticePage || 0)+1);
    this.notices.dataset.pages = String(this.noticePages?.length || 0);
    this.notices.setAttribute('aria-label', `Announcements ${this.notices.dataset.page} of ${this.notices.dataset.pages}`);
  }
  checkCapacity() {
    this.warning = [...this.stage.querySelectorAll('.announcement-group,.board-dedication,.board-weekly,.board-shabbos')]
      .filter(e => e.getClientRects().length && e.scrollHeight > e.clientHeight + 2)
      .map(e => e.classList.contains('announcement-group') ? `The ${e.querySelector('h2')?.textContent || 'announcement'} area needs more space. Review the full screen before publishing.` : 'Screen content exceeds its panel. Review the full screen before publishing.');
  }
  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    this.originalSheetBox?.querySelector('.original-sheet-host')?.disconnectOriginalSheet?.();
  }
}
