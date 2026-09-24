import * as dailyZmanim from '../../js/zmanim/zmanim.js';
import { schedulePresentation } from './presentation.js';
import { publicPosterSections } from '../../js/ui/posters-view.js';
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
const sheetCatalogs = /* @__PURE__ */ new Map();
const sheetTimelines = /* @__PURE__ */ new Map();
const sheetTitles = {rh:'ראש השנה',yk:'יום כיפור',sukkos:'סוכות',pesach:'פסח',gedalia:'צום גדליה'};
const RETAIN_MS = 5 * 60000;
let cachedYear, cachedState;

// Calendar dates and resolved minyan events are the source of display boundaries.
// In particular, neither an English heading nor a printed time is parsed here.
const eventInstant = e => localToISO(`${civil(e.serial + Math.floor(e.mins / 1440))}T${String(Math.floor(e.mins % 1440 / 60)).padStart(2,'0')}:${String(e.mins % 60).padStart(2,'0')}`);
function sheetCatalog(year) {
  if (sheetCatalogs.has(year)) return sheetCatalogs.get(year);
  // Gedalya's complete dated changes belong in the weekly panel. Keep its
  // builder available for daily times and admin controls, without a large sheet.
  const result = Object.entries(builders).filter(([key])=>key!=='gedalia').map(([key,[,build]]) => {
    const poster = build(year,settings);
    const {from,to} = poster.span;
    // Printed sheets may finish with next week's regular times. They remain
    // printed in the chart, but do not extend its screen takeover past the last
    // holy day it covers (including an attached Shabbos on the source sheet).
    let displayTo = to;
    while(displayTo>=from&&!agendaDayKind(displayTo,settings).holy)displayTo--;
    if(displayTo<from)return null;
    const events = (poster.minyanim || []).filter(e=>e.serial>=from&&e.serial<=displayTo);
    return {key,sourceId:`${key}:${year}`,title:sheetTitles[key],year,yearLabel:hebrewYear(year),from,to,displayTo,events,sections:publicPosterSections(key,poster)};
  }).filter(sheet=>sheet?.events.length&&sheet.sections.length);
  if(sheetCatalogs.size>=4)sheetCatalogs.delete(sheetCatalogs.keys().next().value);
  sheetCatalogs.set(year,result);
  return result;
}

/** The original page first replaces the Shabbos box, then the weekday box as well.
 * Publication controls still take precedence. This metadata changes presentation only;
 * live minyan selection continues to use the actual daily schedule below. */
function originalSheetState(instant,year,day,controls,controlKey) {
  const instantMs=Date.parse(instant);
  const closing=s=>{
    const actual=day(s).events.map(e=>Date.parse(e.at));
    // Use the existing holy-day closing boundary, including its final saved minyan.
    const night=Date.parse(sunset(civil(s)))+(agendaDayKind(s,settings).holy?72*60000:0);
    return Math.max(night,...actual)+RETAIN_MS;
  };
  const timelineKey=year+'|'+controlKey;
  let candidates=sheetTimelines.get(timelineKey);
  if(!candidates){
    candidates=[...sheetCatalog(year),...sheetCatalog(year+1)].map(sheet=>{
      // The Sukkos builder also supplies the ordinary erev morning to the daily
      // minyan API, but the original page opens with erev Mincha. That morning
      // must remain in the weekday box until its final Shacharis is finished.
      const covered=sheet.events.filter(e=>sheet.key!=='sukkos'||e.serial!==sheet.from||e.mins>=720);
      const firstEvent=Math.min(...covered.map(e=>Date.parse(eventInstant(e))));
      // Strictly preceding Shabbos: a sheet's erev entries belong to the new schedule.
      const previousShabbos=sheet.from-(excelWeekday(sheet.from)%7||7);
      const preview=closing(previousShabbos);
      const earliest=covered.reduce((a,b)=>Date.parse(eventInstant(a))<=Date.parse(eventInstant(b))?a:b);
      const preceding=[];
      for(let s=previousShabbos+1;s<=earliest.serial;s++){
        if(agendaDayKind(s,settings).holy)continue;
        for(const event of day(s).events){
          const at=Date.parse(event.at);
          if(!event.auxiliary&&at<firstEvent)preceding.push({serial:s,at});
        }
      }
      // An afternoon-only erev source can omit that morning's ordinary schedule.
      // If it does, do not guess its end: retain weekdays until the first saved event.
      const hasSameDay=preceding.some(e=>e.serial===earliest.serial);
      const ordinaryEnd=preceding.length&&(earliest.mins<720||hasSameDay)
        ? Math.max(...preceding.map(e=>e.at))+RETAIN_MS : firstEvent;
      const both=Math.max(preview,Math.min(firstEvent,ordinaryEnd));
      const finalSource=Math.max(...sheet.events.map(e=>Date.parse(eventInstant(e))))+RETAIN_MS;
      const end=Math.max(closing(sheet.displayTo),finalSource);
      return {...sheet,preview,both,end,firstEvent,previousShabbos};
    }).sort((a,b)=>a.firstEvent-b.firstEvent);
    if(sheetTimelines.size>=8)sheetTimelines.delete(sheetTimelines.keys().next().value);
    sheetTimelines.set(timelineKey,candidates);
  }
  // Keep an earlier active source until its closing events finish; advertising the
  // next holiday must not take an active holy-day page off the screen.
  const selected=candidates.find(s=>instantMs>=s.preview&&instantMs<s.end);
  const future=candidates.flatMap(s=>[s.preview,s.both,s.end]).filter(t=>t>instantMs);
  for(const c of controls)if(c.status==='published')for(const at of [c.startsAt,c.endsAt,c.data.previewAt])if(at&&Date.parse(at)>instantMs)future.push(Date.parse(at));
  const nextChangeAt=future.length?new Date(Math.min(...future)).toISOString():null;
  const overridden=selected&&controls.some(c=>visible(c,instant)&&c.data.appliesFrom<=civil(selected.to)&&c.data.appliesTo>=civil(selected.from));
  if(!selected||overridden)return {specialSheet:null,nextChangeAt};
  const s=selected;
  return {specialSheet:{sourceId:s.sourceId,title:s.title,year:s.year,yearLabel:s.yearLabel,
    from:civil(s.from),to:civil(s.to),displayThrough:civil(s.displayTo),previousShabbos:civil(s.previousShabbos),
    placement:instantMs<s.both?'shabbos':'both',
    previewStartsAt:new Date(s.preview).toISOString(),coversBothAt:new Date(s.both).toISOString(),
    endsAt:new Date(s.end).toISOString(),nextChangeAt,sections:s.sections},nextChangeAt};
}
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
  const {specialSheet,nextChangeAt} = originalSheetState(instant,h.year,day,controls,controlKey);
  const zmanim = [['זמן ציצית','misheyakir10_2'],['הנץ החמה','sunrise'],['סוף זמן ק״ש · מ״א','sofZmanShmaMGA72'],['סוף זמן ק״ש · גר״א','sofZmanShmaGRA'],['סוף זמן תפילה · גר״א','sofZmanTfilaGRA'],['חצות היום','solarNoon'],['מנחה גדולה','minchaGedola'],['פלג המנחה','plagHamincha'],['שקיעת החמה','sunset'],['צאת הכוכבים','tzaisGeonim8_5'],['לילה · 72 דקות','tzais72']].map(([label,key])=>{const f=dailyZmanim[key](dateFromSerial(serial),settings);const total=Math.round((((f%1)+1)%1)*86400);return {label,time:(Math.floor(total/3600)%12||12)+':'+String(Math.floor(total/60)%60).padStart(2,'0')+':'+String(total%60).padStart(2,'0')};});
  return { presentation, specialSheet, nextChangeAt, zmanim, week, sacredGroups, today: days[0], shabbos: [day(sat - 1), day(sat)], next, clock: localStamp(now).slice(11), date: civil(serial), hebrewDate: jewishDateString(eveningHebrew, false), parsha: hasParsha(sat, settings, tables) || agendaDayKind(sat, settings).holyDay, shulName: settings.shulName, sourcePublishedAt: config.publishedAt, year: h.year };
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
