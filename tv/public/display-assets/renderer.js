import { themeAt } from './appearance.js';
import { MINYAN_HOLD_MS } from './minyan-timing.js';
import { quarterSchedule } from './quarter-schedules.js';
import { QuarterPanel } from './quarter-panels.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = escapeHTML;
const availableDedicationHTML = `<article class="tv-card dedication dedication-available" aria-label="Parnes Hayom: sponsorship available">
  <h2 lang="he" dir="rtl">פרנס היום</h2>
  <p class="availability-copy">Dedicate the <bdi lang="he">לימוד התורה</bdi> &amp; <bdi lang="he">תפילות</bdi><br>in our <bdi lang="he">בית מדרש</bdi> and share in the <bdi lang="he">זכות</bdi>:</p>
  <p class="availability-benefits">9 daily <bdi lang="he">מנינים</bdi> · 5 <bdi lang="he">כוללים</bdi><br>Close to 18 hours of learning</p>
  <dl class="availability-rates" aria-label="Sponsorship options">
    <div><dt>Day</dt><dd>$36</dd></div><div><dt>Shabbos</dt><dd>$50</dd></div>
    <div><dt>Week</dt><dd>$180</dd></div><div><dt>Month</dt><dd>$500</dd></div>
  </dl>
</article>`;
const dateLabel = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',weekday:'short',timeZone:'UTC'});
const nextPeriod = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',hour12:true});
export function nextMinyanHTML(next, instant) {
  const remaining = Date.parse(next?.at) - Date.parse(instant);
  const label = '<div class="next-label">NEXT MINYAN</div>';
  if (!Number.isFinite(remaining) || remaining < -MINYAN_HOLD_MS) return label + '<p class="next-empty">No further minyan in the loaded schedule</p>';
  const minutes = Math.max(0, Math.ceil(remaining / 60000)), hours = Math.floor(minutes / 60), rest = minutes % 60;
  const countdown = remaining <= 0 ? 'now' : `in ${hours} hour${hours === 1 ? '' : 's'} ${rest} minute${rest === 1 ? '' : 's'}`;
  const period = nextPeriod.formatToParts(new Date(next.at)).find(part => part.type === 'dayPeriod')?.value || '';
  return `${label}<div class="next-service" dir="rtl"><strong lang="he">${esc(next.name)}</strong></div><div class="next-time" dir="ltr"><bdi>${esc(next.time)}</bdi> <span class="next-period">${esc(period)}</span></div>${next.place ? `<div class="next-location"><span class="next-location-label">Location</span><span class="next-place" lang="he" dir="rtl">${esc(next.place)}</span></div>` : ''}<p class="next-countdown">${countdown}</p>`;
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

/** Each quarter keeps its DOM mounted while elapsed times move out of view. */
export class DisplayView {
  constructor(host) {
    this.host = host;
    this.slots = new Map();
    this.warning = [];
    host.innerHTML = `<div class="tv-stage quarter-board"><div class="tv-preview-label" hidden>PRIVATE PREVIEW · NOT THE LIVE SCREEN</div>
      <section class="quarter-panel quarter-zmanim" aria-label="זמני היום"></section>
      <main class="quarter-center">
        <section class="quarter-focus">
          <header class="quarter-brandbar"><div class="tv-brand" lang="he" dir="rtl"></div><div class="tv-current"><div class="tv-clock"></div><div class="tv-date"></div></div></header>
          <section class="next-minyan" aria-label="Next minyan"></section>
        </section>
        <section class="board-dedication" aria-label="פרנס היום"></section>
      </main>
      <section class="quarter-panel quarter-prayers" aria-label="Daily prayer schedule"></section>
      <span class="connection-state" role="status"></span>
    </div>`;
    this.stage = host.firstElementChild;
    for (const [key, selector] of Object.entries({brand:'.tv-brand',date:'.tv-date',clock:'.tv-clock',dedication:'.board-dedication',next:'.next-minyan',connection:'.connection-state'})) this[key] = this.stage.querySelector(selector);
    this.zmanimPanel = new QuarterPanel(this.stage.querySelector('.quarter-zmanim'), 'zmanim');
    this.prayerPanel = new QuarterPanel(this.stage.querySelector('.quarter-prayers'), 'prayers');
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
    const fontsReady = document.fonts ? Promise.all([document.fonts.ready, document.fonts.load('700 40px David')]).catch(() => {}) : Promise.resolve();
    fontsReady.then(() => {
      if (this.destroyed) return;
      this.zmanimPanel.invalidate();
      this.prayerPanel.invalidate();
      this.dedicationKey = null;
      if (this.snapshot) this.update(this.snapshot, this.options);
    });
  }
  choose(key, items, now) {
    if (!items.length) { this.slots.delete(key); return null; }
    let state = this.slots.get(key), selected = items.find(i => i.id === state?.id);
    if (!selected || now - state.at >= (selected.data.duration || 35) * 1000 || now < state.at) {
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
    setHTML(this.brand, `<span class="brand-english" lang="en" dir="ltr">Bais Medrash of<br>Lakewood Commons</span><span class="brand-hebrew" lang="he" dir="rtl">${esc(s.shulName)}</span>`);
    setHTML(this.date, `<b dir="rtl">${esc(s.hebrewDate)}</b><span>${dateLabel(s.date)}</span>`);
    const clock = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(instant));
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const dedication = this.choose('dedication', items.filter(i => i.kind === 'dedication'), now);
    this.stage.classList.toggle('sponsorship-available', !dedication);
    const dedicationHTML = dedication ? cardHTML(dedication) : availableDedicationHTML;
    if (setHTML(this.dedication, dedicationHTML) || this.dedicationKey !== dedicationHTML) {
      this.dedicationKey = dedicationHTML;
      this.fitDedicationSlot();
    }
    const data = quarterSchedule(s, instant);
    this.zmanimPanel.update(data, instant);
    this.prayerPanel.update(data, instant);
    setHTML(this.next, nextMinyanHTML(s.next, instant));
    const savedLabel = connection === 'cached' ? 'Using saved information' : stale ? 'Schedule update unavailable' : '';
    if (this.connection.textContent !== savedLabel) this.connection.textContent = savedLabel;
    this.connection.title = savedLabel && lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-US',{timeZone:'America/New_York'})} (New York)` : '';
    this.checkCapacity();
  }
  fitDedicationSlot() {
    const copy = this.dedication.querySelector('.dedication-copy');
    if (!copy) return;
    let size = 48;
    copy.style.fontSize = size + 'px';
    while (size > 24 && (this.dedication.scrollHeight > this.dedication.clientHeight + 1 || copy.scrollHeight > copy.clientHeight + 1)) {
      size -= 2;
      copy.style.fontSize = size + 'px';
    }
  }
  checkCapacity() {
    this.warning = [...this.stage.querySelectorAll('.board-dedication,.quarter-panel,.quarter-focus')]
      .filter(e => e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)
      .map(() => 'Screen content needs more space. Review the full preview before publishing.');
  }
  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    this.zmanimPanel.destroy();
    this.prayerPanel.destroy();
  }
}