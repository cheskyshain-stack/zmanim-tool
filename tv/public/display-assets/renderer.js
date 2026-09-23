import { fullSchedules, paginateSpecial } from './schedule-renderer.js';
import { themeAt } from './appearance.js';
import { localStamp } from "./time.js";
export const escapeHTML = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const esc = escapeHTML;
const dateLabel = (s) => (/* @__PURE__ */ new Date(s + "T12:00:00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
export function announcementPages(item, limit = 260) {
  const message = item.kind === "dedication" ? [item.data.dedicationText, item.data.message].filter(Boolean).join("\n") : item.data.message || "";
  const words = message.split(/\s+/), pages = [];
  let part = "";
  for (const word of words) {
    if ((part + " " + word).length > limit && part) {
      pages.push(part);
      part = "";
    }
    part += (part ? " " : "") + word;
  }
  pages.push(part);
  return pages.map((message2, i) => ({ ...item, page: i, pageCount: pages.length, pageMessage: message2 }));
}
export function cardHTML(item) {
  const d = item.data, page = item.pageCount > 1 ? `<p class="card-page">${item.page + 1} / ${item.pageCount}</p>` : "";
  if (item.kind === "dedication") return `<article class="tv-card dedication"><h2 lang="he" dir="rtl">פרנס היום</h2><p class="dedication-type" dir="auto">${esc(d.dedicationType === "Custom" ? "" : d.dedicationType)}</p><p class="dedication-name" dir="auto">${esc(d.dedicationName)}</p><p dir="auto">${esc(item.pageMessage ?? d.dedicationText)}</p><p class="sponsor" dir="auto">${d.anonymous ? "Sponsored anonymously" : esc(d.sponsor)}</p><p class="card-page" dir="auto">${esc(d.hebrewLabel || "")}</p>${page}</article>`;
  return `<article class="tv-card ${esc(d.priority)}"><p class="eyebrow">${esc(d.category || "Community")}</p><h2 dir="auto">${esc(item.title)}</h2><p dir="auto">${esc(item.pageMessage ?? d.message)}</p>${d.contact || d.phone ? `<p class="contact"><bdi dir="auto">${esc(d.contact)}</bdi><bdi dir="ltr">${esc(d.phone)}</bdi></p>` : ""}${page}</article>`;
}
const timeHTML = (e) => `<span class="tv-time" title="${esc(e.place)}">${/למטה/.test(e.place) ? "<u>" : ""}${esc(e.time)}${/למטה/.test(e.place) ? "</u>" : ""}${/אולם/.test(e.place) ? "<sup>**</sup>" : /בעזר/.test(e.place) ? "<sup>*</sup>" : ""}</span>`;
function dayRows(day, friday = false) {
  const groups = [];
  for (const e of day.events) {
    if (friday && e.mins < 720) continue;
    let g = groups.find((g2) => g2.name === e.name);
    if (!g) {
      g = { name: e.name, events: [] };
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups.map((g) => `<div class="tv-schedule-row"><h3 dir="rtl">${esc(g.name)}</h3><div class="tv-times">${g.events.map(timeHTML).join("")}</div></div>`).join("") + (day.note ? `<p class="tv-note">${esc(day.note)}</p>` : "");
}
export class DisplayView {
  constructor(host) {
    this.host = host;
    this.slots = /* @__PURE__ */ new Map();
    this.lastRender = "";
    this.warning = [];
    this.host.innerHTML = '<div class="tv-stage"></div>';
    this.stage = this.host.firstElementChild;
    this.resize = () => {
      const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      const scale = Math.min(w / 1920, h / 1080);
      this.stage.style.transform = `scale(${scale})`;
      this.stage.style.left = (w - 1920 * scale) / 2 + "px";
      this.stage.style.top = (h - 1080 * scale) / 2 + "px";
    };
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    if(document.fonts?.status!=="loaded") document.fonts?.ready.then(()=>{this.lastRender="";});
  }
  choose(key, items, now, limit = 260) {
    if (!items.length) {
      this.slots.delete(key);
      return null;
    }
    const all = items.flatMap((item) => announcementPages(item, limit));
    let state = this.slots.get(key);
    let selected = all.find((i) => i.id + ":" + i.page === state?.id);
    if (!selected || now - state.at >= (selected.data.duration || 25) * 1e3) {
      const index = selected ? (all.indexOf(selected) + 1) % all.length : 0;
      selected = all[index];
      state = { id: selected.id + ":" + selected.page, at: now };
      this.slots.set(key, state);
    }
    return selected;
  }
  update(snapshot, { now = Date.now(), stale = false, preview = false, theme = null } = {}) {
    this.snapshot = snapshot;
    const instant = preview ? snapshot.at : new Date(now).toISOString();
    this.stage.dataset.theme = theme || themeAt(snapshot.appearance, instant);
    const items = snapshot.items.filter((i) => i.startsAt <= instant && (!i.endsAt || instant < i.endsAt));
    const ranks = { urgent: 3, important: 2, normal: 1 };
    const announcements = items.filter((i) => i.kind === "announcement").sort((a, b) => (ranks[b.data.priority] || 1) - (ranks[a.data.priority] || 1) || a.id.localeCompare(b.id));
    const side = (name) => {
      const all = announcements.filter((i) => (i.data.placement === "automatic" ? "left" : i.data.placement) === name);
      const pin = all.find((i) => i.data.behavior === "pinned");
      const rotating = all.filter((i) => i !== pin);
      const limit = pin && rotating.length ? 80 : 220;
      return [pin ? this.choose(name + "-pin", [pin], now, limit) : null, this.choose(name, rotating, now, limit)].filter(Boolean).map(cardHTML).join("");
    };
    const left = side("left"), dedications = items.filter((i) => i.kind === "dedication"), rightItems = announcements.filter((i) => i.data.placement === "right");
    const dedication = this.choose("dedication", dedications, now, rightItems.length ? 70 : 220);
    const rightAnnouncement = dedication ? this.choose("right-shared", rightItems, now, 70) : null;
    const right = dedication ? cardHTML(dedication) + (rightAnnouncement ? cardHTML(rightAnnouncement) : "") : side("right");
    const s = snapshot.schedule;
    const next = s.next && s.next.at >= instant ? s.next : null;
    const upcoming = [this.choose("upcoming", snapshot.upcoming.filter((i) => i.startsAt > instant), now)].filter(Boolean).map((i) => `<div class="tv-upcoming"><strong>Upcoming: ${esc(i.title)}</strong><br>${dateLabel(i.data.appliesFrom)} to ${dateLabel(i.data.appliesTo)}</div>`).join("");
    const html = `${preview ? '<div class="tv-preview-label">PRIVATE PREVIEW · NOT THE LIVE SCREEN</div>' : ""}<header class="tv-head"><div class="tv-brand" lang="he" dir="rtl">${esc(s.shulName)}<small dir="ltr">LAKEWOOD COMMONS</small></div><div class="tv-date"><b dir="rtl">${esc(s.hebrewDate)}</b><br>${dateLabel(s.date)}${s.presentation ? ' · <bdi dir="rtl">' + esc(s.presentation.currentDay) + "</bdi>" : ""}</div><div class="tv-clock"></div></header>${stale ? '<div class="tv-stale">Connection lost · Schedule may be out of date. Please confirm times.</div>' : ""}<div class="tv-layout">${left ? `<aside class="tv-side">${left}</aside>` : ""}<main class="tv-center">${s.presentation ? fullSchedules(s.presentation,upcoming) : '<p>Schedule presentation unavailable</p>'}</main>${right ? `<aside class="tv-side">${right}</aside>` : ""}</div><footer class="tv-footer ${stale ? "stale-next" : ""}"><span class="next-label">Next minyan</span>${!stale && next ? `<strong dir="auto">${esc(next.name)} <bdi dir="ltr">${esc(next.time)}</bdi></strong><span class="next-place" dir="auto">${esc(next.place)}</span>` : `<strong>${stale ? "Confirm times while connection is unavailable" : "Checking the next minyan…"}</strong>`}<span class="key">Underlined: downstairs · * Ezras Nashim · ** Simcha hall<br>Times follow the shul’s published schedules</span></footer>`;
    if (html !== this.lastRender) {
      this.stage.innerHTML = html;
      this.lastRender = html;
      const center=this.stage.querySelector('.tv-center'),weekly=this.stage.querySelector('.weekly-body');
      if(center&&weekly){
        if(weekly.scrollHeight>weekly.clientHeight+2) weekly.parentElement.classList.add('weekly-compact');
        let width=weekly.parentElement.clientWidth;
        while(weekly.scrollHeight>weekly.clientHeight+2&&width<center.clientWidth-440){width+=40;center.style.gridTemplateColumns=`minmax(0,${width}px) minmax(0,1fr)`;}
      }
      const special=this.stage.querySelector('.complete-special');
      if(special) special._sections=[...special.querySelectorAll('.source-section')].map(e=>e.cloneNode(true));
      this.schedulePages=paginateSpecial(this.stage);
    }
    if(this.schedulePages?.pages.length){
      const id=s.presentation.special.id;
      if(this.scheduleGroup!==id){this.scheduleGroup=id;this.scheduleStarted=now;}
      const {pages,body,label}=this.schedulePages;
      const page=Math.floor(Math.max(0,now-this.scheduleStarted)/35000)%pages.length;
      if(body.dataset.page!==String(page)){body.innerHTML=pages[page];body.dataset.page=String(page);}
      label.textContent=pages.length>1?` · ${page+1} / ${pages.length}`:'';
    }
    this.stage.querySelector(".tv-clock").textContent = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(instant));
    this.warning = [...this.stage.querySelectorAll(".tv-panel,.tv-card")].filter((e) => e.scrollHeight > e.clientHeight + 2).map(() => "Screen content exceeds its panel. Shorten text or reduce pinned cards.");
  }
  destroy() {
    this.observer.disconnect();
  }
}
