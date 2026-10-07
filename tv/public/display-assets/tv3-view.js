import { themeAt } from './appearance.js';
import { MINYAN_HOLD_MS } from './minyan-timing.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clockFormat = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'});
const dateFormat = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric'});
const services = [['שחרית','SHACHARIS'],['מנחה','MINCHA'],['מעריב','MAARIV']];
const placeLabel = place => /בעזר|עזרת/.test(place) ? 'עזרת נשים' : /למטה/.test(place) ? 'למטה' : /אולם|שמחות/.test(place) ? 'אולם השמחות' : place;
const eventKey = e => [e.at,e.name,e.place].join('|');
const setHTML = (node, html) => { if (node._html !== html) { node.innerHTML = html; node._html = html; } };

export function serviceIndex(event) {
  if (/שחרית|ותיקין|סליחות/.test(event.name)) return 0;
  if (/מנחה|כל נדרי/.test(event.name)) return 1;
  return 2;
}
function nextHTML(event, now, stale) {
  const difference = Date.parse(event?.at) - now;
  const label = '<div class="tv3-next-label">NEXT MINYAN</div>';
  if (stale) return '<div class="tv3-next-service">' + label + '<p class="tv3-next-empty">Reconnecting to confirm the schedule</p></div>';
  if (!Number.isFinite(difference) || difference < -MINYAN_HOLD_MS)
    return '<div class="tv3-next-service">' + label + '<p class="tv3-next-empty">No further minyan in the loaded schedule</p></div>';
  const minutes = Math.ceil(difference / 60000), hours = Math.floor(minutes / 60), rest = minutes % 60;
  const formatted = clockFormat.format(new Date(event.at));
  const period = formatted.split(' ').at(-1);
  const today = dateFormat.format(new Date(now)), eventDay = dateFormat.format(new Date(event.at));
  const relative = difference <= 0 ? 'Starting now' : hours ? `${hours}h${rest ? ' ' + rest + 'm' : ''}` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `<div class="tv3-next-service">${label}<h2 lang="he" dir="rtl">${esc(event.name)}</h2><p lang="he" dir="rtl">${esc(event.place)}</p></div>
    <div class="tv3-next-time" dir="ltr">${esc(event.time)} <small>${esc(period)}</small></div>
    <div class="tv3-countdown">${difference > 0 ? 'In ' : ''}<strong>${relative}</strong>${eventDay !== today ? `<span>${esc(eventDay.split(',')[0])}</span>` : ''}</div>`;
}
function eventHTML(event, next, now) {
  const selected = next && eventKey(event) === eventKey(next);
  const past = Date.parse(event.at) < now - MINYAN_HOLD_MS;
  const specialName = event.name !== services[serviceIndex(event)][0] ? event.name : '';
  return `<div class="tv3-time${past ? ' past' : ''}${selected ? ' upcoming' : ''}" data-event="${esc(eventKey(event))}" data-at="${esc(event.at)}">
    <bdi class="tv3-time-value" dir="ltr">${esc(event.time)}</bdi>
    <span class="tv3-room" lang="he" dir="rtl">${esc(placeLabel(event.place))}</span>
    ${specialName ? `<span class="tv3-event-note" lang="he" dir="rtl">${esc(specialName)}</span>` : ''}</div>`;
}
function noticeData(item) {
  const d = item.data || {};
  if (item.kind === 'dedication') return {id:item.id,title:'פרנס היום',message:[d.dedicationType === 'Custom' ? '' : d.dedicationType,d.dedicationName,d.dedicationText,d.message].filter(Boolean).join('\n'),contact:d.anonymous ? '' : d.sponsor,phone:'',duration:Math.max(25,d.duration || 35),label:'פרנס היום'};
  return {id:item.id,title:item.title,message:d.message || '',contact:d.contact || '',phone:d.phone || '',duration:Math.max(20,d.duration || 25),label:d.priority === 'urgent' ? 'הודעה חשובה' : 'הודעות'};
}
function noticeHTML(notice) {
  return `<h2 class="tv3-notice-title" dir="auto">${esc(notice.title)}</h2><p class="tv3-notice-body" dir="auto">${esc(notice.message)}</p>
    ${notice.contact || notice.phone ? `<p class="tv3-notice-contact"><bdi dir="auto">${esc(notice.contact)}</bdi>${notice.contact && notice.phone ? ' · ' : ''}<bdi dir="ltr">${esc(notice.phone)}</bdi></p>` : ''}`;
}

export class TV3View {
  constructor(host) {
    this.host = host;
    host.innerHTML = `<div class="tv3" data-theme="light">
      <header class="tv3-head"><div class="tv3-brand"><h1 lang="he" dir="rtl">קהל לב מנחם</h1><p>Bais Medrash of<br>Lakewood Commons</p></div><div class="tv3-current"><div class="tv3-clock"></div><div class="tv3-date"></div></div></header>
      <main class="tv3-main"><div class="tv3-primary"><section class="tv3-next" aria-label="Next minyan"></section><div class="tv3-subhead"><h2>Today's minyanim</h2><span class="tv3-occasion" lang="he" dir="rtl"></span><span class="tv3-connection" role="status"></span></div><div class="tv3-services"></div></div>
      <aside class="tv3-zmanim"><h2 lang="he" dir="rtl">זמני היום</h2><div class="tv3-zman-list"></div></aside></main>
      <section class="tv3-notices" aria-label="Announcements"><div class="tv3-notice-label"><b lang="he" dir="rtl">הודעות</b>ANNOUNCEMENTS</div><article class="tv3-notice-copy"></article><div class="tv3-notice-pager"></div></section>
    </div>`;
    this.stage = host.firstElementChild;
    for (const name of ['clock','date','next','occasion','connection','services','zman-list','notice-label','notice-copy','notice-pager']) this[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = this.stage.querySelector('.tv3-' + name);
    this.pages = []; this.pageIndex = 0; this.pageStarted = null; this.servicePages = new Map();
    this.resize = () => {
      const width = host.clientWidth || innerWidth, height = host.clientHeight || innerHeight;
      const scale = Math.min(width / 1920,height / 1080);
      Object.assign(this.stage.style,{transform:`scale(${scale})`,left:(width - scale * 1920) / 2 + 'px',top:(height - scale * 1080) / 2 + 'px'});
    };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host); this.resize();
    document.fonts.ready.then(() => { if (!this.destroyed && this.snapshot) { this.noticeKey = null; this.update(this.snapshot,this.options); } });
  }
  update(snapshot, {now = Date.now(), stale = false, connection = 'live'} = {}) {
    this.snapshot = snapshot; this.options = {now,stale,connection};
    this.stage.dataset.theme = themeAt(snapshot.appearance,new Date(now));
    this.stage.classList.toggle('is-stale',stale);
    const schedule = snapshot.schedule;
    const clock = clockFormat.format(new Date(now));
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    setHTML(this.date,`${esc(dateFormat.format(new Date(now)))}<b lang="he" dir="rtl">${esc(schedule.hebrewDate)}</b>`);
    setHTML(this.next,nextHTML(schedule.next,now,stale));
    const dayLabel = schedule.presentation?.currentDay || schedule.today.title;
    this.occasion.textContent = dayLabel;
    this.connection.textContent = stale ? 'Schedule needs confirmation' : connection === 'cached' ? 'Using saved calendar' : '';
    const events = schedule.today.events.filter(e=>!e.auxiliary);
    const groups = services.map((_service,index) => {
      const entries = events.filter(e=>serviceIndex(e) === index);
      const hasNotes = entries.some(e=>e.name !== services[index][0]);
      const size = hasNotes ? 8 : 12, count = Math.max(1,Math.ceil(entries.length / size));
      const key = JSON.stringify([schedule.date,entries]);
      let state = this.servicePages.get(index);
      if (state?.key !== key || now < state.at) state = {key,page:0,at:now,next:null};
      const next = schedule.next && eventKey(schedule.next);
      const selected = entries.findIndex(e=>eventKey(e) === next);
      if (state.next !== next && selected >= 0) { state.page = Math.floor(selected / size); state.at = now; }
      else if (count > 1 && now - state.at >= 25000) { state.page = (state.page + 1) % count; state.at = now; }
      state.next = next; this.servicePages.set(index,state);
      return {entries:entries.slice(state.page * size,(state.page + 1) * size),count,page:state.page,total:entries.length};
    });
    const eventSignature = JSON.stringify([schedule.today,groups,schedule.next && eventKey(schedule.next),stale,Math.floor(now/60000)]);
    if (this.eventSignature !== eventSignature) {
      const cards = services.map(([name,english],index) => {
        const {entries,count,page,total} = groups[index];
        const rows = Math.max(1,Math.ceil(entries.length / 2));
        return `<section class="tv3-service" data-total-events="${total}"><header class="tv3-service-head"><h3 lang="he" dir="rtl">${name}</h3><p>${english}</p></header>
          ${entries.length ? `<div class="tv3-times" style="grid-template-rows:repeat(${rows},minmax(0,1fr))">${entries.map(e=>eventHTML(e,stale ? null : schedule.next,now)).join('')}</div>` : '<p class="tv3-empty-service">No minyan listed today</p>'}
          ${count > 1 ? `<p class="tv3-service-pager">Times ${page + 1} / ${count}</p>` : ''}</section>`;
      }).join('');
      setHTML(this.services,schedule.today.note ? `<p class="tv3-day-note">${esc(schedule.today.note)}</p>` : cards); this.eventSignature = eventSignature;
    }
    const auxiliaries = schedule.today.events.filter(e=>e.auxiliary);
    const context = auxiliaries.map(e=>`${e.name} ${e.time}`).join(' · ');
    if (context) this.occasion.textContent = `${dayLabel} · ${context}`;
    // Keep explicit source gaps visible rather than displaying a normal-day guess.
    if (schedule.today.note) this.connection.textContent = 'Please confirm with the shul';
    setHTML(this.zmanList,schedule.zmanim.map(z => {
      const parts = String(z.time).match(/^(\d{1,2}:\d{2})(:\d{2})?$/);
      return `<div class="tv3-zman"><bdi class="tv3-zman-value" dir="ltr">${esc(parts?.[1] || z.time)}${parts?.[2] ? '<small>' + esc(parts[2]) + '</small>' : ''}</bdi><span class="tv3-zman-label" lang="he" dir="rtl">${esc(z.label)}</span></div>`;
    }).join(''));
    const instant = new Date(now).toISOString();
    const visible = (snapshot.items || []).filter(item=>['announcement','dedication'].includes(item.kind) && item.startsAt <= instant && (!item.endsAt || instant < item.endsAt));
    const noticeKey = JSON.stringify(visible);
    if (noticeKey !== this.noticeKey) {
      const previous = this.pages[this.pageIndex];
      this.pages = this.paginate(visible.map(noticeData));
      const retained = this.pages.findIndex(p=>p.id === previous?.id && p.part === previous?.part && p.message === previous?.message);
      this.pageIndex = Math.max(0,retained);
      if (retained < 0) this.pageStarted = now;
      this.noticeKey = noticeKey;
    }
    const current = this.pages[this.pageIndex];
    if (now < this.pageStarted) this.pageStarted = now;
    if (current && now - this.pageStarted >= current.duration * 1000) {
      this.pageIndex = (this.pageIndex + 1) % this.pages.length; this.pageStarted = now;
    }
    const selected = this.pages[this.pageIndex];
    setHTML(this.noticeCopy,selected ? noticeHTML(selected) : '<h2 class="tv3-notice-title" lang="he" dir="rtl">ברוכים הבאים</h2><p class="tv3-notice-body">Bais Medrash of Lakewood Commons</p>');
    setHTML(this.noticeLabel,`<b lang="he" dir="rtl">${esc(selected?.label || 'הודעות')}</b>${selected?.label === 'פרנס היום' ? 'PARNAS HAYOM' : 'ANNOUNCEMENTS'}`);
    const dots = Math.min(5,this.pages.length);
    setHTML(this.noticePager,this.pages.length > 1 ? `<div class="tv3-notice-dots">${Array.from({length:dots},(_,i)=>`<span class="tv3-notice-dot${i === this.pageIndex % dots ? ' active' : ''}"></span>`).join('')}</div>${this.pageIndex + 1} / ${this.pages.length}${selected?.totalParts > 1 ? `<br>Part ${selected.part + 1}/${selected.totalParts}` : ''}` : '');
  }
  paginate(notices) {
    const measure = document.createElement('article'); measure.className = 'tv3-notice-copy tv3-notice-measure';
    measure.style.width = this.noticeCopy.clientWidth + 'px'; this.stage.append(measure);
    const available = this.stage.querySelector('.tv3-notices').clientHeight - 32;
    const fits = notice => { measure.innerHTML = noticeHTML(notice); return measure.scrollHeight <= available; };
    const pages = [];
    for (let notice of notices) {
      if (!fits({...notice,message:'A'})) {
        const contact = [notice.contact,notice.phone].filter(Boolean).join(' · ');
        notice = {...notice,message:[notice.message,contact].filter(Boolean).join('\n'),contact:'',phone:''};
      }
      if (!fits({...notice,message:'A'}))
        notice = {...notice,title:notice.label,message:notice.title + '\n\n' + notice.message};
      const parts = []; let remaining = notice.message;
      while (remaining) {
        if (fits({...notice,message:remaining})) { parts.push(remaining); break; }
        // Split only at whitespace, preserve all text and repeat the contact on each part.
        const boundaries = [...remaining.matchAll(/\s+/g)].map(m=>m.index + m[0].length);
        let low = 0, high = boundaries.length - 1, best = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), end = boundaries[middle];
          if (fits({...notice,message:remaining.slice(0,end)})) { best = end; low = middle + 1; } else high = middle - 1;
        }
        // A single long word can wrap; use character boundaries if none fit.
        if (!best) { best = 1; for (let end = 2; end <= remaining.length && fits({...notice,message:remaining.slice(0,end)}); end++) best = end; }
        parts.push(remaining.slice(0,best)); remaining = remaining.slice(best);
      }
      if (!parts.length) parts.push('');
      parts.forEach((message,part)=>pages.push({...notice,message,part,totalParts:parts.length}));
    }
    measure.remove(); return pages;
  }
  destroy() { this.destroyed = true; this.observer.disconnect(); }
}
