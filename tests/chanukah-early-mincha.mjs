import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSettings } from '../js/settings.js';
import { dateFromHebrew, excelWeekday, chanukahYearFor } from '../js/hebrew-calendar.js';
import { dateFromSerial, excelSerial } from '../js/zmanim/solar.js';
import { minchaGedolaLechumra } from '../js/zmanim/zmanim.js';
import { chanukahEarlyMincha, chanukahMinchaFollowing } from '../js/chanukah-mincha.js';
import { fridayMainMinchaParts } from '../js/sheets/common.js';
import { chanukahSundayMinchaTimes, buildChanukahPoster } from '../js/posters/chanukah.js';
import { clockTime } from '../js/zmanim/trace.js';
const settings=resolveSettings(JSON.parse(fs.readFileSync(new URL('../data/published.json',import.meta.url))).settings);

test('5787 starts safely at 12:20 and moves the following minyan to 12:35, both downstairs',()=>{
 for(const date of ['2026-12-04','2026-12-06','2026-12-11']){
  const serial=excelSerial(new Date(date+'T12:00:00Z')),early=chanukahEarlyMincha(serial,settings);
  assert.equal(early.plain(),'12:20');assert(early.flags.underlined);
  const limit=minchaGedolaLechumra(dateFromSerial(serial),settings);assert(limit>735/1440&&limit<740/1440);
  const pair=excelWeekday(serial)===6?fridayMainMinchaParts(dateFromSerial(serial),settings,serial+1).times.slice(0,2):chanukahSundayMinchaTimes(serial,settings);
  assert.deepEqual(pair.map(time=>time.plain()),['12:20','12:35']);assert(pair.every(time=>time.flags.underlined));
 }
});

test('51 years use exact daily limits and fifteen-minute gaps only on eligible Fridays and Sundays',()=>{
 const slots=new Set();let checked=0,twoSundays=0;
 for(let year=5784;year<=5834;year++){
  const start=dateFromHebrew(25,9,year),poster=buildChanukahPoster(year,settings);
  twoSundays+=poster.sundayMincha.length===2;
  for(let serial=start-7;serial<=start+14;serial++){
   const weekday=excelWeekday(serial),covered=!!chanukahYearFor(serial,settings)||weekday===6&&serial+1===start;
   const early=chanukahEarlyMincha(serial,settings);
   if(year<5787||!covered||![1,6].includes(weekday)){assert.equal(early,null);continue;}
   const limit=minchaGedolaLechumra(dateFromSerial(serial),settings),minutes=Math.round(early.value*1440);
   assert(minutes>=735&&minutes%5===0);assert(early.value+1e-10>=limit,'Never before the exact zman');
   assert(minutes===735||minutes-5<limit*1440,'Use the earliest permitted five-minute slot');
   const times=weekday===6?fridayMainMinchaParts(dateFromSerial(serial),settings,serial+1).times:chanukahSundayMinchaTimes(serial,settings);
   assert.equal(times[0].value,early.value);assert(times[1].value-times[0].value>=15/1440-1e-10);
   assert(times.slice(0,2).every(time=>time.flags.underlined));
   const printed=weekday===6?poster.erevShabbosList.find(day=>day.serial===serial)?.times:poster.sundayMincha.find(day=>day.serial===serial)?.times;
   assert.deepEqual(printed.slice(0,2).map(time=>time.plain()),times.slice(0,2).map(time=>time.plain()));
   slots.add(minutes);checked++;
  }
 }
 assert(checked>95);assert(twoSundays>0);assert(slots.has(735)&&slots.has(755),'Actual years exercise both 12:15 and 12:35 early starts');
});

test('a full fifteen-minute interval stays put, and a shorter gap moves the following minyan',()=>{
 for(const [early,expected]of [[735,'12:30'],[740,'12:35'],[745,'12:40'],[750,'12:45'],[755,'12:50']]){
  const result=chanukahMinchaFollowing(clockTime(12,30).underline(),clockTime(12,early-720).underline());
  assert.equal(result.plain(),expected);assert(result.flags.underlined);
 }
});
