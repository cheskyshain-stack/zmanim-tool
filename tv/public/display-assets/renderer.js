import { originalSheetHTML } from './original-sheet.js';
import { boardSchedules, usesCholHamoedAnnouncementArea } from './board-schedules.js';
import { groupAnnouncements, groupCholHamoedAnnouncements, renderAnnouncementGroup } from './announcements.js';
import { themeAt } from './appearance.js';
import { layoutFixedBoard } from './board-layout.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = escapeHTML;
const availableDedicationHTML = `<article class="tv-card dedication dedication-available" aria-label="Parnes Hayom — sponsorship available">
  <h2 lang="he" dir="rtl">פרנס היום</h2>
  <p class="availability-copy">Dedicate the <bdi lang="he">לימוד התורה</bdi> &amp; <bdi lang="he">תפילות</bdi><br>in our <bdi lang="he">בית מדרש</bdi> and share in the <bdi lang="he">זכות</bdi>:</p>
  <p class="availability-benefits">9 daily <bdi lang="he">מנינים</bdi> · 5 <bdi lang="he">כוללים</bdi><br>Close to 18 hours of learning</p>
  <dl class="availability-rates" aria-label="Sponsorship options">
    <div><dt>Day</dt><dd>$36</dd></div><div><dt>Shabbos</dt><dd>$50</dd></div>
    <div><dt>Week</dt><dd>$180</dd></div><div><dt>Month</dt><dd>$500</dd></div>
  </dl>
</article>`;
const zmanTime = value => {
  const parts = String(value ?? '').match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  if (!parts) return `<span class="zman-minutes">${esc(value)}</span>`;
  return `<span class="zman-minutes zman-clock"><span class="zman-hours">${parts[1]}</span><span class="zman-colon">:</span><span>${parts[2]}</span></span>${parts[3] ? `<span class="zman-seconds">${parts[3]}</span>` : ''}`;
};
const dateLabel = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',weekday:'short',timeZone:'UTC'});
const nextPeriod = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',hour12:true});
export function nextMinyanHTML(next, instant) {
  const remaining = Date.parse(next?.at) - Date.parse(instant);
  const label = '<div class="next-label">NEXT MINYAN</div>';
  if (!Number.isFinite(remaining) || remaining < 0) return label + '<p class="next-empty">No further minyan in the loaded schedule</p>';
  const minutes = Math.ceil(remaining / 60000), hours = Math.floor(minutes / 60), rest = minutes % 60;
  const countdown = !minutes ? 'Starting now' : hours
    ? `in ${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`
    : `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const period = nextPeriod.formatToParts(new Date(next.at)).find(part => part.type === 'dayPeriod')?.value || '';
  return `${label}<div class="next-service" dir="rtl"><strong lang="he">${esc(next.name)}</strong>${next.place ? `<span class="next-place" lang="he">${esc(next.place)}</span>` : ''}</div><div class="next-time" dir="ltr"><bdi>${esc(next.time)}</bdi> <span class="next-period">${esc(period)}</span></div><p class="next-countdown">${countdown}</p>`;
}
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
    host.innerHTML = `<div class="tv-stage board-layout stable-board"><div class="tv-preview-label" hidden>PRIVATE PREVIEW · NOT THE LIVE SCREEN</div><header class="tv-head"><div class="tv-brand" lang="he" dir="rtl"></div><section class="next-minyan" aria-label="Next minyan"></section><div class="tv-current"><div class="tv-date"></div><div class="tv-clock"></div></div></header><div class="tv-layout"><aside class="board-left-rail"><section class="board-zmanim"></section><section class="board-dedication" aria-label="פרנס היום"></section></aside><main class="tv-center"></main></div><section class="board-notices"></section><footer class="tv-footer"><span class="connection-state" role="status"></span><span class="key">Underlined: downstairs · * Ezras Nashim · ** Simcha hall<br>Times follow the shul’s published schedules</span></footer></div>`;
    this.stage = host.firstElementChild;
    this.stage.classList.add('right-column-board','fixed-bottom-board');
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
        this.dedicationKey = null;
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
    this.stage.classList.toggle('sponsorship-available', !dedication);
    setHTML(this.dedication, dedication ? cardHTML(dedication) : availableDedicationHTML);
    this.fitDedicationSlot(dedications);
    setHTML(this.zmanim, '<h2 dir="rtl">זמני היום</h2>' + (s.zmanim || []).map(z => `<div><bdi dir="ltr">${zmanTime(z.time)}</bdi><span dir="rtl">${esc(z.label)}</span></div>`).join(''));

    const groups = groupAnnouncements(items), groupsKey = JSON.stringify(groups);
    const upcoming = (snapshot.upcoming || []).filter(i => i.startsAt > instant).map(i => `<div class="tv-upcoming"><strong>${esc(i.title)}</strong><br>${dateLabel(i.data.appliesFrom)} – ${dateLabel(i.data.appliesTo)}</div>`).join('');
    const sheet = s.specialSheet && instant >= s.specialSheet.previewStartsAt && instant < s.specialSheet.endsAt ? s.specialSheet : null;
    const placement = sheet && instant >= sheet.coversBothAt ? 'both' : 'shabbos';
    const reserveCholHamoed = usesCholHamoedAnnouncementArea(s.presentation,sheet && {...sheet,placement});
    const holidayGroups = reserveCholHamoed ? groupCholHamoedAnnouncements(items) : [];
    // Deliberately omit the clock, next minyan, generatedAt and connection state.
    const scheduleKey = JSON.stringify([sheet ? [sheet.sourceId,sheet.title,sheet.year,sheet.sections,sheet.columnBreakAt,placement] : null,s.presentation,upcoming,reserveCholHamoed]);
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
      if (s.presentation) {
        const template = document.createElement('template');
        template.innerHTML = boardSchedules(s.presentation, upcoming, {reserveCholHamoed});
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
    const holidayArea = this.schedules.querySelector('.board-chol-hamoed-announcements');
    if (holidayArea) setHTML(holidayArea,holidayGroups.map(renderAnnouncementGroup).join(''));
    const layoutKey = scheduleKey + groupsKey + JSON.stringify(holidayGroups) + this.dedicationKey;
    if (this.layoutKey !== layoutKey) {
      this.layoutKey = layoutKey;
      layoutFixedBoard(this, groups, sheet);
    }
    this.renderNotices();
    setHTML(this.next, nextMinyanHTML(s.next, instant));
    const savedLabel = connection === 'cached' ? 'Using saved information' : stale ? 'Schedule update unavailable' : '';
    if (this.connection.textContent !== savedLabel) this.connection.textContent = savedLabel;
    this.connection.title = savedLabel && lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-US',{timeZone:'America/New_York'})} (New York)` : '';
    this.checkCapacity();
  }
  fitDedicationSlot(items) {
    const key = JSON.stringify(items.map(item=>[item.id,item.data]));
    if (key === this.dedicationKey) return;
    this.dedicationKey = key;
    // This slot always remains below the daily zmanim. Reserve the tallest
    // active copy so dedication rotation never moves the surrounding panels.
    const measure = document.createElement('section');
    measure.className = 'board-dedication dedication-measure';
    Object.assign(measure.style,{position:'absolute',left:'-10000px',top:'0',width:this.dedication.clientWidth+'px',height:'auto',visibility:'hidden',pointerEvents:'none'});
    this.stage.append(measure);
    let height = 128;
    for (const html of items.length ? items.map(cardHTML) : [availableDedicationHTML]) {
      measure.innerHTML = html;
      height = Math.max(height,measure.scrollHeight);
    }
    measure.remove();
    this.stage.style.setProperty('--dedication-slot-height',Math.ceil(height)+'px');
  }
  renderNotices() {
    const groups = this.noticePages?.[0] || [];
    setHTML(this.notices, groups.map(renderAnnouncementGroup).join(''));
    if(!this.stage.classList.contains('fixed-bottom-board'))this.notices.style.gridTemplateColumns = groups.map(g => `${g.slotSpan}fr`).join(' ');
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
