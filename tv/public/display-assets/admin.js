import {previewCalendar} from './preview-calendar.js';
import { validateAppearance, appearanceSummary } from './appearance.js';
import { DisplayView, cardHTML, escapeHTML as esc, announcementPages } from "./renderer.js";
import { localStamp, localToISO, formatInstant, addDays, phase } from "./time.js";
const app = document.querySelector("#admin"), dialog = document.querySelector("#confirm");
let me, currentHebrewYear, items = [], filter = "showing", search = "", dirty = false, previewView = null, previewTimer = null;
const categories = ["Rav’s hours", "Simcha hall information", "Donation appeals", "Shiurim and events", "Simcha announcements", "Community services", "General reminders"];
const kindCap = { announcement: "announcements", dedication: "dedications", schedule: "schedules" };
const can = (kind) => me.capabilities.includes("full") || me.capabilities.includes(kindCap[kind] || kind);
async function api(path, method = "GET", data) {
  const r = await fetch("/api/display/admin/" + path, { method, headers: { "Content-Type": "application/json", "X-Display-Request": "1" }, body: data === void 0 ? void 0 : JSON.stringify(data) });
  if (!r.headers.get("Content-Type")?.includes("application/json")) throw Error("Please reload this admin page to sign in again. Your unsaved form is still here.");
  const value = await r.json();
  if (!r.ok) throw Error(value.error || "Could not save.");
  return value;
}
function toast(message) {
  document.querySelector("#toast").textContent = message;
  setTimeout(() => document.querySelector("#toast").textContent = "", 4e3);
}
function showError(e) {
  const el = document.querySelector("#error");
  if (el) {
    el.textContent = e.message;
    el.scrollIntoView({ block: "nearest" });
  } else toast(e.message);
}
function page(html) {
  previewView?.destroy();
  previewView = null;
  clearInterval(previewTimer);
  app.innerHTML = html;
  scrollTo(0, 0);
}
function confirm(title, text, yes = "Continue") {
  return new Promise((resolve) => {
    dialog.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button id="no">Cancel</button><button class="primary" id="yes">${esc(yes)}</button></div>`;
    dialog.oncancel = () => resolve(false);
    dialog.querySelector("#no").onclick = () => {
      dialog.close();
      resolve(false);
    };
    dialog.querySelector("#yes").onclick = () => {
      dialog.close();
      resolve(true);
    };
    dialog.showModal();
  });
}
async function leave(fn) {
  if (dirty && !await confirm("Discard unsaved changes?", "This draft has not been saved.", "Discard")) return;
  dirty = false;
  fn();
}
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function dashboard() {
  dirty = false;
  try {
    items = await api("items");
    page(`<h1>Manage Shul View</h1><p class="subtitle">Keep the shul informed. Set the dates once, and the screen takes care of the rest.</p>${me.local ? '<div class="notice">LOCAL DEVELOPMENT · Nothing here has been deployed to the public website.</div>' : ""}<div class="toolbar">${can("announcement") ? '<button class="primary" data-new="announcement">+ Add announcement</button>' : ""}${can("dedication") ? '<button class="primary" data-new="dedication">+ Add פרנס היום</button>' : ""}${can("schedule") ? '<button data-new="schedule">Manage display schedules</button>' : ""}<button id="preview-screen">Preview screen</button>${can("full") ? '<button id="appearance">Appearance</button><button id="permissions">Permissions</button>' : ""}</div><div class="toolbar">${[["showing", "Showing now"], ["scheduled", "Scheduled"], ["draft", "Drafts"], ["expired", "Expired"], ["hidden", "Hidden"], ["archived", "Archive"]].map(([k, v]) => `<button data-filter="${k}" aria-pressed="${filter === k}">${v} <span>${items.filter((i) => phase(i, (/* @__PURE__ */ new Date()).toISOString()) === k).length}</span></button>`).join("")}</div><label>Find an item<input id="search" type="search" placeholder="Search title, internal name or sponsor" value="${esc(search)}"></label><div id="error" class="error" role="alert"></div><div id="list"></div><p class="identity">${esc(me.email)} · All scheduling uses America/New_York · <a href="/cdn-cgi/access/logout">Sign out</a></p>`);
    document.querySelectorAll("[data-new]").forEach((b) => b.onclick = () => edit({ kind: b.dataset.new, status: "draft", data: {} }));
    document.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => {
      filter = b.dataset.filter;
      dashboard();
    });
    document.querySelector("#preview-screen").onclick = () => preview();
    document.querySelector("#appearance")?.addEventListener("click", appearance);
    document.querySelector("#permissions")?.addEventListener("click", permissions);
    document.querySelector("#search").oninput = (e) => {
      search = e.target.value;
      renderList();
    };
    renderList();
  } catch (e) {
    showError(e);
  }
}
function renderList() {
  const selected = items.filter((i) => phase(i, (/* @__PURE__ */ new Date()).toISOString()) === filter && [i.title, i.internalName, i.data.sponsor].join(" ").toLowerCase().includes(search.toLowerCase()));
  document.querySelector("#list").innerHTML = selected.length ? selected.map((i) => `<article class="item"><div><span class="tag">${esc(i.kind)}</span><h3 dir="auto">${esc(i.internalName || (i.kind === "dedication" ? i.data.dedicationName : i.title) || "Untitled draft")}</h3>${i.kind === "dedication" ? '<p dir="auto">' + esc(i.data.anonymous ? "Anonymous sponsor (private: " + i.data.sponsor + ")" : i.data.sponsor) + "</p>" : ""}<p>${formatInstant(i.startsAt)} → ${formatInstant(i.endsAt)}</p><p>Updated by ${esc(i.updatedBy)} · ${formatInstant(i.updatedAt)}</p></div><div class="actions"><button data-edit="${i.id}">Edit</button><button data-action="duplicate" data-id="${i.id}">Duplicate</button>${i.status === "published" ? `<button data-action="hide" data-id="${i.id}">Hide now</button>` : ""}${i.status !== "archived" ? `<button data-action="archive" data-id="${i.id}">Archive</button>` : ""}</div></article>`).join("") : '<div class="empty">No items in this section.</div>';
  document.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => edit(items.find((i) => i.id === b.dataset.edit)));
  document.querySelectorAll("[data-action]").forEach((b) => b.onclick = async () => {
    const i = items.find((i2) => i2.id === b.dataset.id);
    if (b.dataset.action === "archive" && !await confirm("Archive this item?", "It will stop appearing and remain saved in Archive.", "Archive")) return;
    try {
      const result = await api(`items/${i.id}/${b.dataset.action}`, "POST", { version: i.version });
      if (b.dataset.action === "duplicate") {
        toast("Unpublished draft created. Review its dates.");
        edit(result);
      } else dashboard();
    } catch (e) {
      showError(e);
    }
  });
}
function input(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(label, name, options, value) {
  return `<label>${label}<select name="${name}">${options.map((o) => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`;
  }).join("")}</select></label>`;
}
function area(label, name, value = "", max = 1200) {
  return `<label class="wide">${label}<textarea name="${name}" maxlength="${max}" dir="auto">${esc(value)}</textarea></label>`;
}
function check(label, name, value) {
  return `<label class="check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}>${label}</label>`;
}
const fold = (name, value = "") => select("If this time occurs twice (November DST change)", name, [["", "Choose only if needed"], ["earlier", "First occurrence (EDT)"], ["later", "Second occurrence (EST)"]], value);
const savedFold = (iso) => {
  if (!iso) return "";
  const local = localStamp(iso);
  try {
    localToISO(local);
    return "";
  } catch {
    return localToISO(local, "later") === iso ? "later" : "earlier";
  }
};
function timing(s) {
  return `<section class="panel"><h2>When it appears</h2><div class="timing-shortcuts"><button type="button" data-shortcut="now">Start now</button><button type="button" data-shortcut="today">Today only</button><button type="button" data-shortcut="friday">Through Friday</button><button type="button" data-shortcut="custom">Choose dates</button></div><div class="grid">${input(s.kind === "schedule" ? "Becomes main schedule" : "Start date and time", "startLocal", s.startsAt ? localStamp(s.startsAt) : "", "datetime-local")}${input(s.kind === "schedule" ? "Regular schedule resumes" : "End date and time", "endLocal", s.endsAt ? localStamp(s.endsAt) : "", "datetime-local")}${fold("startFold", savedFold(s.startsAt))}${fold("endFold", savedFold(s.endsAt))}${s.kind !== "schedule" ? check("Until I turn it off", "untilOff", !!s.startsAt && !s.endsAt) : ""}</div><p class="exact" id="exact-times">Choose dates to see the exact New York timestamps.</p></section>`;
}
async function edit(s, unsaved = false) {
  dirty = unsaved;
  const d = s.data, kind = s.kind;
  let fields = "";
  if (kind === "announcement") fields = `${select("Start with a template", "template", [["", "Choose a template"], ...categories], d.category || "")}${input("Internal name (private)", "internalName", s.internalName)}${input("Visible title", "title", s.title, "text", 'maxlength="200" dir="auto"')}${select("Category", "category", categories, d.category || categories[6])}${area("Message", "message", d.message)}${input("Contact name (optional)", "contact", d.contact, "text", 'dir="auto"')}${input("Phone number (optional)", "phone", d.phone, "tel", 'dir="ltr"')}${select("Placement", "placement", [["automatic", "Automatic"], ["left", "Left"], ["right", "Right"]], d.placement || "automatic")}${select("Priority", "priority", [["normal", "Normal"], ["important", "Important"], ["urgent", "Urgent"]], d.priority || "normal")}${select("Announcement area", "displayGroup", [["automatic", "Automatic"], ["hall", "Simcha Hall"], ["rav", "The Rav"], ["community", "Community"], ["support", "Support & services"], ["separate", "Separate area"]], d.displayGroup || "automatic")}<p class="muted wide">Related notices share one larger area. Each notice stays complete and remains editable separately.</p>`;
  if (kind === "dedication") fields = `${input("Internal name (private)", "internalName", s.internalName)}${input("Sponsor name / family (private if anonymous)", "sponsor", d.sponsor, "text", 'dir="auto"')}${check("Keep sponsor anonymous", "anonymous", d.anonymous)}${select("Dedication type", "dedicationType", ["לע״נ", "לרפואה שלמה", "לזכות", "Custom"], d.dedicationType || "לע״נ")}${input("Dedication name", "dedicationName", d.dedicationName, "text", 'dir="auto"')}${area("Dedication text", "dedicationText", d.dedicationText, 500)}${area("Additional message (optional)", "message", d.message, 600)}${input("Sponsorship date (English)", "sponsorshipDate", d.sponsorshipDate, "date")}<div><p class="muted">Or choose the Hebrew date:</p><div class="grid">${input("Day", "hebrewDay", "", "number", 'min="1" max="30"')}${select("Month", "hebrewMonth", [[7, "Tishrei"], [8, "Cheshvan"], [9, "Kislev"], [10, "Teves"], [11, "Shevat"], [12, "Adar"], [13, "Adar I"], [14, "Adar II"], [1, "Nissan"], [2, "Iyar"], [3, "Sivan"], [4, "Tammuz"], [5, "Av"], [6, "Elul"]], 7)}${input("Hebrew year", "hebrewYear", currentHebrewYear, "number", 'min="5700" max="5900"')}<button id="convert-date" type="button">Use Hebrew date</button></div></div>${select("Display window", "timing", [["evening", "Evening before through selected day"], ["civil", "Selected civil calendar day"], ["custom", "Custom start and end"]], d.timing || "evening")}<p class="muted wide">Evening: local sunset the preceding day until sunset on the selected date. Civil day: midnight to the next midnight in New York. The Hebrew date is the daytime date shown.</p><p id="date-equivalent" class="wide exact"></p>`;
  if (kind === "schedule") fields = `${input("Schedule name", "title", s.title)}${input("Internal name (private)", "internalName", s.internalName)}${input("Source Hebrew year", "sourceYear", d.source?.split(":")[1] || currentHebrewYear, "number", 'min="5700" max="5900"')}<label>Existing source schedule<select name="source" id="source"><option value="">Loading sources…</option></select></label>${input("Applies from (date)", "appliesFrom", d.appliesFrom, "date")}${input("Applies through (date)", "appliesTo", d.appliesTo, "date")}${input("Upcoming preview begins", "previewLocal", d.previewAt ? localStamp(d.previewAt) : "", "datetime-local")}${fold("previewFold", savedFold(d.previewAt))}${select("Portion replaced", "portion", [["all", "All portions provided by this source"], ["morning", "Shacharis / morning"], ["mincha", "Mincha"], ["maariv", "Maariv"]], d.portion || "all")}${input("Precedence (higher number wins)", "precedence", d.precedence || "", "number", 'min="1" max="999"')}${check("I reviewed overlaps and chose which schedule takes precedence", "overlapAcknowledged", false)}<div class="notice wide">Times come from the existing special schedule, not from this form. Applicable dates are separate from preview and activation dates. Built-in holiday rules still apply when this display rule ends.</div><p id="conflicts" class="warn wide"></p>`;
  page(`<button id="back">← Display dashboard</button><h1>${s.id ? "Edit" : "Add"} ${kind === "dedication" ? "פרנס היום" : kind === "schedule" ? "display schedule" : "announcement"}</h1><p class="subtitle">Only Publish makes an item eligible to appear. All times are America/New_York.</p><div id="error" class="error" role="alert"></div><div class="form-layout"><form id="editor"><section class="panel"><h2>${kind === "schedule" ? "Schedule source" : "Content"}</h2><div class="grid">${fields}</div></section>${timing(s)}<div class="form-footer"><button type="button" id="cancel">Cancel</button><button type="button" id="draft">Save draft</button><button type="button" id="preview">Preview</button><button type="submit" class="primary">Publish</button></div></form><aside class="card-preview"><h2>Card preview</h2><div id="card-preview"></div><p id="length-warning" class="warn"></p><p class="muted">Announcements stay visible in full. Use the screen preview to check the complete area with the other notices.</p></aside></div>`);
  const form = document.querySelector("#editor"), el = (n) => form.elements[n];
  let dateRequest = 0, syncedCivilDate = null;
  const value = () => {
    const fd = new FormData(form), data = {};
    for (const [key, val] of fd) data[key] = val;
    for (const c of form.querySelectorAll("[type=checkbox]")) data[c.name] = c.checked;
    return { id: s.id, version: s.version, kind, title: fd.get("title") || s.title || "", internalName: fd.get("internalName") || "", startLocal: fd.get("startLocal") || "", endLocal: fd.get("untilOff") ? "" : fd.get("endLocal") || "", startFold: fd.get("startFold"), endFold: fd.get("endFold"), data };
  };
  const update = async () => {
    const v = value();
    for (const [field, choice] of [["startLocal", "startFold"], ["endLocal", "endFold"], ["previewLocal", "previewFold"]]) {
      if (!el(choice)) continue;
      let ambiguous = false;
      try {
        if (el(field)?.value) localToISO(el(field).value);
      } catch (error) {
        ambiguous = error.message.includes("twice");
      }
      el(choice).closest("label").hidden = !ambiguous;
    }
    if (kind === "dedication" && el("untilOff")) el("untilOff").closest("label").hidden = el("timing").value !== "custom";
    el("endLocal").disabled = !!el("untilOff")?.checked;
    try {
      let start = v.startLocal ? localToISO(v.startLocal, v.startFold) : null, end = v.endLocal ? localToISO(v.endLocal, v.endFold) : null;
      if (kind === "dedication" && v.data.sponsorshipDate) {
        const request = ++dateRequest;
        const info = await api("date", "POST", { date: v.data.sponsorshipDate });
        if (request !== dateRequest) return;
        if (syncedCivilDate !== v.data.sponsorshipDate) {
          el("hebrewDay").value = info.hebrew.dayOfMonth;
          el("hebrewMonth").value = info.hebrew.month;
          el("hebrewYear").value = info.hebrew.year;
          syncedCivilDate = v.data.sponsorshipDate;
        }
        document.querySelector("#date-equivalent").textContent = info.label + " · " + info.date;
        v.data.hebrewLabel = info.label;
        if (v.data.timing !== "custom") {
          start = v.data.timing === "evening" ? info.previousSunset : info.civilStart;
          end = v.data.timing === "evening" ? info.sunset : info.civilEnd;
          el("startLocal").value = localStamp(start);
          el("endLocal").value = localStamp(end);
          el("startLocal").disabled = true;
          el("endLocal").disabled = true;
        } else {
          el("startLocal").disabled = false;
          el("endLocal").disabled = false;
        }
      }
      document.querySelector("#exact-times").textContent = `Starts: ${start ? formatInstant(start) : "Not set"} (New York) · Ends: ${end ? formatInstant(end) : "Until turned off"}`;
    } catch (e) {
      document.querySelector("#exact-times").textContent = e.message;
    }
    if (kind !== "schedule") {
      document.querySelector("#card-preview").innerHTML = cardHTML({ ...v, title: v.title || "Your title", data: v.data });
      document.querySelector("#length-warning").textContent = (v.data.message || "").length > 220 || (v.data.dedicationText || "").length > 180 || (v.title || "").length > 70 || (v.data.dedicationName || "").length > 70 || (v.data.sponsor || "").length > 70 ? "This is a longer notice. Preview the full screen to check that its area has enough room before publishing." : "";
    } else {
      document.querySelector("#card-preview").innerHTML = '<div class="notice">Use Preview to see this schedule with the actual Shul View layout and next minyan.</div>';
      document.querySelector("#conflicts").textContent = items.some((i) => i.id !== s.id && i.kind === "schedule" && i.status === "published" && i.data.appliesFrom <= v.data.appliesTo && v.data.appliesFrom <= i.data.appliesTo) ? "Another published display schedule covers these dates. Review the overlap and assign a distinct precedence." : "";
    }
  };
  form.oninput = () => {
    dirty = true;
    update();
  };
  form.onchange = () => {
    dirty = true;
    update();
  };
  document.querySelector("#back").onclick = () => leave(dashboard);
  document.querySelector("#cancel").onclick = () => leave(dashboard);
  form.querySelectorAll("[data-shortcut]").forEach((b) => b.onclick = () => {
    const now = localStamp(), date = now.slice(0, 10);
    if (b.dataset.shortcut === "custom") {
      el("startLocal").focus();
      return;
    }
    el("startLocal").value = now;
    let endDate = addDays(date, 1);
    if (b.dataset.shortcut === "friday") {
      const dow = (/* @__PURE__ */ new Date(date + "T12:00Z")).getUTCDay();
      endDate = addDays(date, (5 - dow + 7) % 7 + 1);
    }
    if (b.dataset.shortcut !== "now") {
      el("endLocal").value = endDate + "T00:00";
      if (el("untilOff")) el("untilOff").checked = false;
    }
    if (kind === "dedication") el("timing").value = "custom";
    dirty = true;
    update();
  });
  if (kind === "announcement") el("template").onchange = () => {
    if (el("template").value) {
      el("title").value = el("template").value;
      el("category").value = el("template").value;
      el("message").placeholder = { "Rav’s hours": "Enter availability, place and how to arrange a time.", "Simcha hall information": "Enter hall details and who to contact.", "Donation appeals": "Enter the purpose and how to contribute.", "Shiurim and events": "Enter topic, speaker, time and location.", "Simcha announcements": "Enter the celebration details approved for public display.", "Community services": "Enter the service, availability and contact.", "General reminders": "Enter a short, clear reminder." }[el("template").value];
      dirty = true;
      update();
    }
  };
  if (kind === "dedication") document.querySelector("#convert-date").onclick = async () => {
    try {
      const info = await api("date", "POST", { hebrew: { day: el("hebrewDay").value, month: el("hebrewMonth").value, year: el("hebrewYear").value } });
      el("sponsorshipDate").value = info.date;
      dirty = true;
      update();
    } catch (e) {
      showError(e);
    }
  };
  if (kind === "schedule") {
    let sources = [];
    const loadSources = async () => {
      try {
        sources = await api("catalog?year=" + el("sourceYear").value);
        el("source").innerHTML = '<option value="">Choose source</option>' + sources.map((x) => `<option value="${x.id}" ${d.source === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
      } catch (e) {
        showError(e);
      }
    };
    el("sourceYear").onchange = loadSources;
    el("source").onchange = () => {
      const x = sources.find((x2) => x2.id === el("source").value);
      if (x) {
        el("appliesFrom").value = x.from;
        el("appliesTo").value = x.to;
        if (!el("title").value) el("title").value = x.name;
        dirty = true;
        update();
      }
    };
    await loadSources();
  }
  async function save(status) {
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((b) => b.disabled = true);
    try {
      const v = value();
      v.status = status;
      if (status === "published") {
        const check2 = await api("preview", "POST", { at: v.startLocal ? localToISO(v.startLocal, v.startFold) : (/* @__PURE__ */ new Date()).toISOString(), item: v });
        if (!await confirm("Publish to Shul View?", document.querySelector("#exact-times").textContent + (check2.warnings.length ? " Review: " + check2.warnings.join(" ") : ""), "Publish")) return;
      }
      await api("items" + (s.id ? "/" + s.id : ""), s.id ? "PUT" : "POST", v);
      dirty = false;
      toast(status === "draft" ? "Draft saved" : "Published on its scheduled dates");
      await dashboard();
    } catch (e) {
      showError(e);
    } finally {
      buttons.forEach((b) => b.disabled = false);
    }
  }
  document.querySelector("#draft").onclick = () => save("draft");
  form.onsubmit = (e) => {
    e.preventDefault();
    save("published");
  };
  document.querySelector("#preview").onclick = () => preview(value(), () => edit({ ...s, ...value(), data: value().data, startsAt: value().startLocal ? localToISO(value().startLocal, value().startFold) : null, endsAt: value().endLocal ? localToISO(value().endLocal, value().endFold) : null }, true));
  update();
}
async function preview(item = null, back = dashboard) {
  dirty = !!item;
  page(`<button id="back">← ${item ? "Editor" : "Dashboard"}</button><h1>Preview calendar</h1><p class="subtitle">Private preview using the same components as Shul View. Nothing here is published.</p><section class="panel" id="preview-calendar"></section><div class="toolbar"><label>Preview date and time (New York)<input id="at" type="datetime-local" value="${localStamp()}"></label><label>DST occurrence<select id="fold"><option value="">Automatic</option><option value="earlier">First (EDT)</option><option value="later">Second (EST)</option></select></label><button class="primary" id="apply">Show this time</button></div><div id="error" class="error" role="alert"></div><div id="warnings" class="notice" hidden></div><div class="toolbar"><button id="preview-prev" type="button">← Previous day</button><span>Swipe the preview to change dates</span><button id="preview-next" type="button">Next day →</button></div><div class="preview-host" id="preview-host" tabindex="0" aria-label="Schedule preview. Swipe left for next day or right for previous day."></div><section class="panel"><h2>Content at this time</h2><div id="timeline"></div></section>`);
  document.querySelector("#back").onclick = back;
  previewView = new DisplayView(document.querySelector("#preview-host"));
  let result, previewRequest=0;
  const host=document.querySelector("#preview-host");
  const run = async () => {
    const token=++previewRequest;
    try {
      const loaded = await api("preview", "POST", { at: localToISO(document.querySelector("#at").value, document.querySelector("#fold").value), item });
      if(token!==previewRequest||!host.isConnected)return;
      result=loaded;
      previewView.update(result, { preview: true });
      const warnings = [...result.warnings, ...previewView.warning];
      document.querySelector("#warnings").hidden = !warnings.length;
      document.querySelector("#warnings").textContent = warnings.join(" ");
      document.querySelector("#timeline").innerHTML = result.timeline.map((i) => `<p><span class="tag">${esc(i.phase)}</span> ${esc(i.title)}</p>`).join("") || "<p>No saved content.</p>";
    } catch (e) {
      showError(e);
    }
  };
  const calendar=previewCalendar(document.querySelector('#preview-calendar'),api,date=>{
    const at=document.querySelector('#at');at.value=date+'T'+(at.value.split('T')[1]||'12:00');
    run();
  });
  document.querySelector('#at').onchange=()=>{calendar.select(document.querySelector('#at').value.slice(0,10));run();};
  const moveDay=delta=>{
    const at=document.querySelector('#at'),[date,time]=at.value.split('T');
    if(!date)return;
    const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);
    const next=d.toISOString().slice(0,10);if(next<'2000-01-01'||next>'2099-12-31')return;
    at.value=next+'T'+(time||'12:00');document.querySelector('#fold').value='';calendar.select(next);run();
  };
  document.querySelector('#preview-prev').onclick=()=>moveDay(-1);
  document.querySelector('#preview-next').onclick=()=>moveDay(1);
  host.style.touchAction='pan-y pinch-zoom';
  let gesture=null;
  host.addEventListener('pointerdown',e=>{if(!e.isPrimary){gesture=null;return;}gesture={id:e.pointerId,x:e.clientX,y:e.clientY};});
  host.addEventListener('pointercancel',()=>{gesture=null;});
  host.addEventListener('pointerup',e=>{const g=gesture;gesture=null;if(!g||g.id!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.5){host.dataset.swiped='true';setTimeout(()=>delete host.dataset.swiped,350);moveDay(dx<0?1:-1);}});
  host.addEventListener('click',e=>{if(host.dataset.swiped){e.preventDefault();e.stopPropagation();}},true);
  host.addEventListener('keydown',e=>{if(e.target!==host)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();moveDay(e.key==='ArrowRight'?1:-1);}});
  document.querySelector('#fold').onchange=run;
  document.querySelector("#apply").onclick = run;
  previewTimer = setInterval(() => {
    if (result) {
      previewView.update(result, { preview: true });
      const notices = [...result.warnings, ...previewView.warning];
      document.querySelector("#warnings").hidden = !notices.length;
      document.querySelector("#warnings").textContent = notices.join(" ");
    }
  }, 1e3);
  run();
}
async function permissions() {
  try {
    const rows = await api("permissions");
    page(`<button id="back">← Dashboard</button><h1>Display permissions</h1><p class="subtitle">Existing Cloudflare sign-in identifies the person. These capabilities decide what they may manage.</p><div id="error" class="error" role="alert"></div><form class="panel" id="permission-form">${input("Admin email", "email", "", "email", "required")}<div class="toolbar">${[["full", "Full display management"], ["announcements", "Announcements"], ["dedications", "פרנס היום"], ["schedules", "Schedules"]].map(([v, t]) => check(t, v, false)).join("")}</div><button class="primary">Save permissions</button><p class="muted">Saving with no capabilities removes access. Bootstrap administrators remain controlled by server configuration.</p></form><section class="panel">${rows.map((r) => `<div class="permission-row"><strong>${esc(r.email)}</strong><p>${esc(JSON.parse(r.capabilities_json).join(", ")) || "No access"}</p></div>`).join("") || "<p>No additional administrators yet.</p>"}</section>`);
    document.querySelector("#back").onclick = dashboard;
    document.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api("permissions", "POST", { email: f.get("email"), capabilities: ["full", "announcements", "dedications", "schedules"].filter((c) => f.has(c)) });
        toast("Permissions saved");
        permissions();
      } catch (err) {
        showError(err);
      }
    };
  } catch (e) {
    showError(e);
  }
}
try {
  me = await api("me");
  currentHebrewYear = (await api("date", "POST", { date: localStamp().slice(0, 10) })).hebrew.year;
  dashboard();
} catch (e) {
  page(`<h1>Manage Shul View</h1><div class="error">${esc(e.message)}</div><p>Display management requires server-verified sign-in. The main admin PIN does not grant these permissions.</p>`);
}

async function appearance() {
 try {
  let saved=await api('appearance'), snapshot, override=null;
  page(`<h1>Appearance</h1><p>Choose how Shul View looks. Changes take effect after saving.</p><div id="error" class="error" role="alert"></div><form id="appearance-form"><label>Theme<select id="appearance-mode"><option value="light">Light</option><option value="dark">Dark</option><option value="scheduled">Scheduled</option></select></label><div id="appearance-times" class="toolbar"><label>Dark begins<input id="dark-start" type="time" required></label><label>Light begins<input id="light-start" type="time" required></label></div><p id="appearance-summary" aria-live="polite"></p><p>Scheduled times use America/New_York. During a spring clock change, a skipped time starts when the clock resumes. A repeated fall time uses its first occurrence.</p><div class="actions"><button class="primary" type="submit">Save appearance</button><button type="button" id="appearance-cancel">Back</button></div></form><h2>Private preview</h2><p>Preview colors immediately without changing the live screen.</p><div class="toolbar"><button id="preview-light">Preview Light</button><button id="preview-dark">Preview Dark</button><button id="preview-setting">Use selected setting</button><label>Preview at (New York)<input id="appearance-at" type="datetime-local" value="${localStamp()}"></label><button id="appearance-load">Update preview time</button></div><p id="appearance-preview-label" aria-live="polite"></p><div class="preview-host" id="appearance-preview"></div>`);
  const mode=document.querySelector('#appearance-mode'), dark=document.querySelector('#dark-start'), light=document.querySelector('#light-start');
  mode.value=saved.mode;dark.value=saved.darkStart;light.value=saved.lightStart;
  previewView=new DisplayView(document.querySelector('#appearance-preview'));
  const draft=()=>validateAppearance({mode:mode.value,darkStart:dark.value,lightStart:light.value});
  const draw=()=>{if(snapshot)previewView.update({...snapshot,appearance:draft()},{preview:true,theme:override});document.querySelector('#appearance-preview-label').textContent=override?`${override==='dark'?'Dark':'Light'} preview only`: 'Preview follows your selected setting';};
  const change=()=>{document.querySelector('#appearance-times').hidden=mode.value!=='scheduled';try{document.querySelector('#appearance-summary').textContent=appearanceSummary(draft());document.querySelector('#error').textContent='';draw();}catch(e){showError(e);}};
  async function load(){try{snapshot=await api('preview','POST',{at:localToISO(document.querySelector('#appearance-at').value,'earlier')});draw();}catch(e){showError(e);}}
  document.querySelector('#appearance-form').oninput=()=>{dirty=true;override=null;change();};
  document.querySelector('#appearance-form').onsubmit=async e=>{e.preventDefault();try{saved=await api('appearance','PUT',{...draft(),version:saved.version});dirty=false;toast('Appearance saved. Open screens update automatically.');}catch(e){showError(e);}};
  document.querySelector('#appearance-cancel').onclick=()=>leave(dashboard);
  for(const color of ['light','dark'])document.querySelector('#preview-'+color).onclick=()=>{override=color;try{draw();}catch(e){showError(e);}};
  document.querySelector('#preview-setting').onclick=()=>{override=null;change();};
  document.querySelector('#appearance-load').onclick=load;
  change();await load();previewTimer=setInterval(()=>{try{draw();}catch{}},1000);
 } catch(e){showError(e);}
}
