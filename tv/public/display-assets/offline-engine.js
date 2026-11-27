import {scheduleCalendar} from '../../src/schedules.js';
import {validPublishedSchedule} from '../../src/published-calendar.js';
import {OFFLINE_ENGINE} from '../../src/offline-seed.js';
import {themeAt} from './appearance.js';
import {visible} from './time.js';
import {nextMinyanChangeAt} from './minyan-timing.js';
import {noticeBoundaries} from './notice-recurrence.js';

export {OFFLINE_ENGINE};
export function validSeed(seed){
  return seed?.schema===1&&seed.engine===OFFLINE_ENGINE&&Number.isFinite(Date.parse(seed.generatedAt))&&(seed.publishedSchedule===undefined||validPublishedSchedule(seed.publishedSchedule))&&Array.isArray(seed.items)&&seed.items.every(i=>i.status==='published');
}
export function offlineSnapshot(seed,now=Date.now()){
  if(!validSeed(seed))throw new Error('The cached calendar needs an update.');
  const at=new Date(now).toISOString(),controls=seed.items.filter(i=>i.kind==='schedule');
  const {scheduleSnapshot,dateInfo}=scheduleCalendar(seed.publishedSchedule);
  const schedule=scheduleSnapshot(at,controls),today=dateInfo(schedule.date);
  const boundaries=seed.items.flatMap(i=>[i.startsAt,i.endsAt,i.data.previewAt]).filter(x=>x&&x>at);
  boundaries.push(...noticeBoundaries(seed.items,at,dateInfo));
  boundaries.push(today.civilEnd);
  if(today.sunset>at)boundaries.push(today.sunset);
  // The congregation card keeps the current minyan through its five-minute hold.
  const minyanChangeAt=nextMinyanChangeAt(schedule.next);
  if(minyanChangeAt>at)boundaries.push(minyanChangeAt);
  if(schedule.nextChangeAt>at)boundaries.push(schedule.nextChangeAt);
  const publicItem=({status,...item})=>item;
  return {appearance:seed.appearance,theme:themeAt(seed.appearance,at),at,generatedAt:seed.generatedAt,nextChangeAt:boundaries.sort()[0]||null,
    preview:false,items:seed.items.filter(i=>i.kind!=='schedule'&&visible(i,at,dateInfo)).map(publicItem),
    upcoming:controls.filter(i=>i.data.previewAt&&i.data.previewAt<=at&&at<i.startsAt).map(publicItem),schedule,warnings:[]};
}
