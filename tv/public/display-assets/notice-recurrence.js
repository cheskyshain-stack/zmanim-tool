import { dateFromHebrew, hebrewDateExtended } from '../../../js/hebrew-calendar.js';
import { dateFromSerial, excelSerial } from '../../../js/zmanim/solar.js';
import { sunsetElev } from '../../../js/zmanim/zmanim.js';
import { DEFAULT_SETTINGS, resolveSettings } from '../../../js/settings.js';
import { localStamp, localToISO } from './date-time.js';

export const YOM_TOV_CHOICES = [['pesach', 'Pesach'], ['sukkos', 'Sukkos'], ['shavuos', 'Shavuos']];
const dates = {pesach:[15,1], sukkos:[15,7], shavuos:[6,3]};
const settings = resolveSettings(DEFAULT_SETTINGS);
const civil = serial => dateFromSerial(serial).toISOString().slice(0,10);
// Standalone admin helpers use the shul defaults. Live and offline snapshots
// supply dateInfo from their published calendar, including its saved location.
function defaultDateInfo(date) {
  const minutes = Math.round(((sunsetElev(new Date(date+'T00:00Z'), settings)%1+1)%1)*1440);
  return {sunset:localToISO(date+'T'+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'))};
}
const caches = new WeakMap();
function windowsForYear(year, dateInfo) {
  if (!caches.has(dateInfo)) caches.set(dateInfo,new Map());
  const cache = caches.get(dateInfo);
  if (!cache.has(year)) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(year,YOM_TOV_CHOICES.map(([holiday,label]) => {
      const [day,month] = dates[holiday], eve = dateFromHebrew(day,month,year)-1;
      return {holiday,label,year,startsAt:dateInfo(civil(eve-14)).sunset,endsAt:dateInfo(civil(eve)).sunset};
    }));
  }
  return cache.get(year);
}
/** One current or next window for each selected Yom Tov, calculated every year. */
export function nextYomTovWindows(rule, instant, dateInfo = defaultDateInfo) {
  if (rule?.type !== 'before-yom-tov' || !Array.isArray(rule.holidays) || !Number.isFinite(Date.parse(instant))) return [];
  const year = hebrewDateExtended(excelSerial(new Date(localStamp(instant).slice(0,10)+'T12:00Z'))).year;
  const windows = [...windowsForYear(year,dateInfo),...windowsForYear(year+1,dateInfo)];
  return YOM_TOV_CHOICES.filter(([id])=>rule.holidays.includes(id)).map(([id])=>windows.find(w=>w.holiday===id&&w.endsAt>instant))
    .filter(Boolean).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
}
export function noticeBoundaries(items, instant, dateInfo) {
  return items.filter(i=>i.kind==='announcement'&&i.status==='published'&&i.data?.recurrence)
    .flatMap(i=>nextYomTovWindows(i.data.recurrence,instant,dateInfo).flatMap(w=>[w.startsAt,w.endsAt])).filter(at=>at>instant);
}
