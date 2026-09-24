import * as dailyZmanim from '../../js/zmanim/zmanim.js';
import { schedulePresentation, posterRows } from './presentation.js';
import config from "../../data/published.json" with { type: "json" };
import parshaChutz from "../../data/parsha_chutz.json" with { type: "json" };
import parshaEY from "../../data/parsha_ey.json" with { type: "json" };
import parshaNames from "../../data/parsha_names.json" with { type: "json" };
import specialDays from "../../data/special_days.json" with { type: "json" };
import { buildAutomaticCharts, withoutRetiredDrasha } from "../../js/publish.js";
import { resolveSettings, DEFAULT_SETTINGS } from "../../js/settings.js";
import { minyanimForDay, candleLightingForDay, clock } from "../../js/upcoming.js";
import { dateFromSerial, excelSerial, shulNow } from "../../js/zmanim/solar.js";
import { sunsetElev } from "../../js/zmanim/zmanim.js";
import { hebrewDateExtended, hebrewYear, dateFromHebrew, jewishDateString, hasParsha, excelWeekday, hasTaanis, hasYomTov, hasRoshChodesh } from "../../js/hebrew-calendar.js";
import { agendaDayKind } from "../../js/ui/weekly-agenda.js";
import { buildRoshHashanaPoster } from "../../js/posters/roshhashana.js";
import { buildYomKippurPoster } from "../../js/posters/yomkippur.js";
import { buildSukkosPoster } from "../../js/posters/sukkos.js";
import { buildPesachPoster } from "../../js/posters/pesach.js";
import { buildTzomGedaliaPoster } from "../../js/posters/tzomgedalia.js";
import { localToISO, localStamp, visible } from "../public/display-assets/time.js";
export const settings = resolveSettings({ ...DEFAULT_SETTINGS, ...config.settings, timezoneId: "America/New_York" });
const tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const builders = { rh: ["Rosh Hashana", buildRoshHashanaPoster], yk: ["Yom Kippur", buildYomKippurPoster], sukkos: ["Sukkos", buildSukkosPoster], pesach: ["Pesach", buildPesachPoster], gedalia: ["Tzom Gedalia", buildTzomGedaliaPoster] };
export const category = (e) => /מנחה/.test(e.name) ? "mincha" : /מעריב|כל נדרי/.test(e.name) ? "maariv" : e.mins < 720 ? "morning" : "other";
const civil = (s) => dateFromSerial(s).toISOString().slice(0, 10);
export function sunset(date) {
  const serial = excelSerial(/* @__PURE__ */ new Date(date + "T12:00:00Z"));
  const fraction = sunsetElev(dateFromSerial(serial), settings);
  const minutes = Math.round((fraction % 1 + 1) % 1 * 1440);
  return localToISO(`${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
}
export function dateInfo(date, hebrew) {
  let serial;
  if (hebrew) {
    if (![hebrew.day,hebrew.month,hebrew.year].every(v=>Number.isInteger(+v)) || +hebrew.day<1 || +hebrew.day>30 || +hebrew.month<1 || +hebrew.month>14 || +hebrew.year<5700 || +hebrew.year>5900) throw new RangeError("Choose a valid Hebrew date between 5700 and 5900.");
    serial = dateFromHebrew(+hebrew.day, +hebrew.month, +hebrew.year);
    const check = hebrewDateExtended(serial);
    if (check.year !== +hebrew.year || check.month !== +hebrew.month || check.dayOfMonth !== +hebrew.day) throw new RangeError("That Hebrew date is not valid.");
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || date<"1900-01-01" || date>"2150-12-31") throw new RangeError("Choose a valid date.");
    serial = excelSerial(/* @__PURE__ */ new Date(date + "T12:00:00Z"));
    if (civil(serial) !== date) throw new RangeError("Choose a valid date.");
  }
  const day = civil(serial);
  return { date: day, hebrew: hebrewDateExtended(serial), label: jewishDateString(serial, false), sunset: sunset(day), previousSunset: sunset(civil(serial - 1)), civilStart: localToISO(day + "T00:00"), civilEnd: localToISO(civil(serial + 1) + "T00:00") };
}
const catalogs = /* @__PURE__ */ new Map(), dayCache = /* @__PURE__ */ new Map();
let cachedYear, cachedState;
export function catalog(year) {
  if (catalogs.has(year)) return catalogs.get(year);
  const result = Object.entries(builders).map(([key, [name, build]]) => {
    const p = build(year, settings);
    const events = p.minyanim || [];
    return { id: `${key}:${year}`, name: `${name} ${year}`, from: civil(Math.min(...events.map((e) => e.serial))), to: civil(Math.max(...events.map((e) => e.serial))), events };
  });
  if (catalogs.size >= 4) catalogs.delete(catalogs.keys().next().value);
  catalogs.set(year, result);
  return result;
}
export function source(id) {
  const [key, y] = String(id).split(":");
  if (!builders[key] || !Number.isInteger(+y) || +y < 5700 || +y > 5900) throw new RangeError("Choose an existing special schedule.");
  return catalog(+y).find((p) => p.id === id);
}
export function scheduleSnapshot(instant, controls = []) {
  const now = new Date(instant), clockNow = shulNow(now, settings), serial = clockNow.serial;
  const h = hebrewDateExtended(serial), sat = serial + 7 - excelWeekday(serial);
  if (cachedYear !== h.year) {
    cachedState = buildAutomaticCharts(withoutRetiredDrasha(config), tables, now);
    cachedYear = h.year;
  }
  const state = cachedState;
  const active = controls.filter((c) => visible(c, instant)).sort((a, b) => b.data.precedence - a.data.precedence);
  const controlKey = JSON.stringify(active.map((c) => [c.title, c.data]));
  const day = (s) => {
    const cacheKey = s + "|" + controlKey;
    if (dayCache.has(cacheKey)) return dayCache.get(cacheKey);
    const d = civil(s), kind = agendaDayKind(s, settings);
    let events = minyanimForDay(s, state, settings);
    let note = "";
    const hd = hebrewDateExtended(s);
    if (hd.month === 1) {
      const ps = buildPesachPoster(hd.year, settings).minyanim.filter((e) => e.serial === s);
      if (ps.length) {
        const cats = new Set(ps.map(category));
        events = hd.dayOfMonth >= 14 && hd.dayOfMonth <= 22 ? ps : [...events.filter((e) => !cats.has(category(e))), ...ps];
      }
    }
    if (hd.month === 5 && hasTaanis(s, settings) || kind.holy.includes("Shavuos")) {
      events = [];
      note = "Special times are not available in the existing schedule source. Please confirm with the shul.";
    }
    let names = [];
    const won = /* @__PURE__ */ new Set();
    for (const c of active) {
      const x = c.data;
      if (d < x.appliesFrom || d > x.appliesTo) continue;
      const sourceEvents = source(x.source).events.filter((e) => e.serial === s);
      const cats = x.portion === "all" ? [...new Set(sourceEvents.map(category))] : [x.portion];
      const take = cats.filter((k) => !won.has(k));
      if (!take.length) continue;
      const replacement = sourceEvents.filter((e) => take.includes(category(e)));
      events = [...events.filter((e) => !take.includes(category(e))), ...replacement];
      take.forEach((k) => won.add(k));
      names.push(c.title);
    }
    const candles = candleLightingForDay(s, state, settings);
    if (candles) events.push({ ...candles, name: "הדלקת נרות", auxiliary: true });
    const unique = /* @__PURE__ */ new Set();
    events = events.filter((e) => {
      const key = [e.mins, e.name, e.place].join("|");
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    }).sort((a, b) => a.mins - b.mins);
    const result = { date: d, title: names.join(" / ") || kind.holyDay || kind.label || new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(dateFromSerial(s)), note, events: events.map((e) => ({ ...e, name: /^מעריב\s+ג/.test(e.name) ? "מעריב" : e.name, time: clock(e.mins), place: e.place || "בית מדרש", at: localToISO(`${civil(s + Math.floor(e.mins / 1440))}T${String(Math.floor(e.mins % 1440 / 60)).padStart(2, "0")}:${String(e.mins % 60).padStart(2, "0")}`) })) };
    if (dayCache.size >= 100) dayCache.delete(dayCache.keys().next().value);
    dayCache.set(cacheKey, result);
    return result;
  };
  const days = Array.from({ length: 9 }, (_, i) => day(serial + i));
  const next = days.flatMap((d) => d.events).filter((e) => !e.auxiliary && e.at >= instant).sort((a, b) => a.at.localeCompare(b.at))[0] || null;
  // Keep the full civil week and extend each sacred block across week boundaries.
  const weekStart = serial - (excelWeekday(serial) - 1);
  const week = Array.from({length:7}, (_,i)=>day(weekStart+i));
  const sacredGroups = [];
  for(let cursor=weekStart;cursor<=weekStart+6;cursor++) {
    if(!agendaDayKind(cursor,settings).holy) continue;
    let first=cursor,last=cursor;
    while(agendaDayKind(first-1,settings).holy) first--;
    while(agendaDayKind(last+1,settings).holy) last++;
    if(!sacredGroups.some(g=>g.from===civil(first))) sacredGroups.push({from:civil(first),to:civil(last),days:Array.from({length:last-first+2},(_,i)=>day(first-1+i))});
    cursor=last;
  }
  const eveningHebrew = instant >= sunset(civil(serial)) ? serial + 1 : serial;
  const presentation = schedulePresentation({serial,state,settings,tables,day,instant,sunset});
  // Show the complete approved Sukkos sheet while that season is the applicable
  // or upcoming display group. Explicit admin overrides retain the normal renderer.
  const sukkos = presentation.special?.sections.some(section=>section.rows.some(row=>row.id.startsWith('sk:'))) || presentation.weekly.posterSections.some(section=>section.rows.some(row=>row.id.startsWith('hoshana:') || row.id.startsWith('chm:'+h.year+':7')));
  const poster = sukkos ? buildSukkosPoster(h.year,settings) : null;
  const posterFrom = poster && civil(Math.min(...poster.minyanim.map(e=>e.serial)));
  const posterTo = poster && civil(Math.max(...poster.minyanim.map(e=>e.serial)));
  const overridesPoster = poster && active.some(c=>c.data.appliesFrom<=posterTo && c.data.appliesTo>=posterFrom);
  const fullSheet = poster && !overridesPoster ? {title:'סוכות',year:h.year,yearLabel:hebrewYear(h.year),blocks:poster.blocks.map((block,i)=>({heading:block.heading,rows:posterRows(block.lines,'full-sk:'+h.year+':'+i)}))} : null;
  const zmanim = [['זמן ציצית','misheyakir10_2'],['הנץ החמה','sunrise'],['סוף זמן ק״ש · מ״א','sofZmanShmaMGA72'],['סוף זמן ק״ש · גר״א','sofZmanShmaGRA'],['סוף זמן תפילה · גר״א','sofZmanTfilaGRA'],['חצות היום','solarNoon'],['מנחה גדולה','minchaGedola'],['פלג המנחה','plagHamincha'],['שקיעת החמה','sunset'],['צאת הכוכבים','tzaisGeonim8_5'],['לילה · 72 דקות','tzais72']].map(([label,key])=>{const f=dailyZmanim[key](dateFromSerial(serial),settings);const total=Math.round((((f%1)+1)%1)*86400);return {label,time:(Math.floor(total/3600)%12||12)+':'+String(Math.floor(total/60)%60).padStart(2,'0')+':'+String(total%60).padStart(2,'0')};});
  return { presentation, fullSheet, zmanim, week, sacredGroups, today: days[0], shabbos: [day(sat - 1), day(sat)], next, clock: localStamp(now).slice(11), date: civil(serial), hebrewDate: jewishDateString(eveningHebrew, false), parsha: hasParsha(sat, settings, tables) || agendaDayKind(sat, settings).holyDay, shulName: settings.shulName, sourcePublishedAt: config.publishedAt, year: h.year };
}


export function previewMonth(month) {
 if(!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month||''))throw new RangeError('Choose a month between 2000 and 2099.');
 const first=new Date(month+'-01T12:00:00Z'),offset=first.getUTCDay(),count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 const he={...settings,english:false};
 return {month,offset,days:Array.from({length:count},(_,i)=>{
  const date=month+'-'+String(i+1).padStart(2,'0'),serial=excelSerial(new Date(date+'T12:00:00Z'));
  return {date,day:i+1,hebrew:jewishDateString(serial,false),holidays:[...new Set([hasYomTov(serial,he,specialDays),hasTaanis(serial,he),hasRoshChodesh(serial,he)].filter(Boolean))]};
 })};
}
