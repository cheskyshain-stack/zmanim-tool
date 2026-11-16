import test from 'node:test';
import assert from 'node:assert/strict';
import {prayerPanelHeadings,hebrewPanelDay,hebrewDay,civil} from '../src/presentation.js';
import {scheduleSnapshot,settings} from '../src/schedules.js';
import {agendaDayKind} from '../../js/ui/weekly-agenda.js';
import {dateFromHebrew,excelWeekday,jewishDateString} from '../../js/hebrew-calendar.js';
import {excelSerial} from '../../js/zmanim/solar.js';

const serial=date=>excelSerial(new Date(date+'T12:00:00Z'));
const headings=date=>prayerPanelHeadings(serial(date),settings);
const sacred=[[1,7],[2,7],[10,7],[15,7],[16,7],[22,7],[23,7],[15,1],[16,1],[21,1],[22,1],[6,3],[7,3]];

test('ordinary weekdays keep their label, Friday opens Shabbos, and Shabbos closes with Motzaei',()=>{
 assert.equal(headings('2026-11-18').evening,null);
 const friday=headings('2026-11-20'),shabbos=headings('2026-11-21');
 assert.equal(friday.day.title,'ערב שבת');
 assert.deepEqual(friday.evening,shabbos.day);
 assert.equal(shabbos.day.title,'שבת');
 assert.deepEqual(shabbos.evening,{...shabbos.day,key:'motzai:2026-11-21',title:'מוצאי שבת'});
});

test('holy daytime headings never include the eve of the following holy day',()=>{
 let shabbosBeforeFestival=false;
 for(let year=5787;year<=5806;year++)for(const [day,month] of sacred){
  const s=dateFromHebrew(day,month,year),current=prayerPanelHeadings(s,settings);
  assert.equal(current.day.title,hebrewDay(s,settings).replace(/^שבת קודש(?= · |$)/,'שבת'));
  assert.equal(current.day.key,'day:'+civil(s));
  assert.equal(current.day.hebrewDate,jewishDateString(s,false));
  assert.doesNotMatch(current.day.title,/ערב/);
  if(excelWeekday(s-1)===7){
   shabbosBeforeFestival=true;
   const before=prayerPanelHeadings(s-1,settings);
   assert.doesNotMatch(before.day.title,/ערב/);
   assert.deepEqual(before.evening,current.day);
  }
 }
 assert.ok(shabbosBeforeFestival,'Covers Shabbos daytime immediately before Yom Tov');
});

test('each second Yom Tov day and any connected Shabbos take priority over Motzaei',()=>{
 let ytIntoShabbos=false,shabbosIntoYt=false;
 for(let year=5787;year<=5806;year++)for(const [day,month] of sacred){
  const s=dateFromHebrew(day,month,year),before=prayerPanelHeadings(s-1,settings),current=prayerPanelHeadings(s,settings);
  assert.deepEqual(before.evening,current.day,'Opening evening targets the exact following holy day');
  const kind=agendaDayKind(s,settings),next=agendaDayKind(s+1,settings);
  if(next.holy){
   assert.deepEqual(current.evening,prayerPanelHeadings(s+1,settings).day);
   assert.doesNotMatch(current.evening.title,/מוצאי/);
   ytIntoShabbos ||= kind.holy!=='Shabbos'&&next.holy==='Shabbos';
   shabbosIntoYt ||= excelWeekday(s)===7&&excelWeekday(s+1)!==7;
  }
 }
 assert.ok(ytIntoShabbos,'Covers Friday Yom Tov continuing into Shabbos');
 assert.ok(shabbosIntoYt,'Covers Shabbos continuing into the next Yom Tov day');
 assert.equal(headings('2026-09-11').evening.title,'שבת · יום א׳ ראש השנה');
 assert.equal(headings('2026-09-12').evening.title,'יום ב׳ ראש השנה');
 assert.equal(headings('2026-10-03').evening.title,'שמחת תורה');
});

test('closing headings distinguish Yom Tov, Yom Kippur, combined Shabbos, and Shabbos Chol Hamoed',()=>{
 const found=new Set();
 for(let year=5787;year<=5806;year++)for(const [day,month] of [...sacred,[17,7],[18,7],[19,7],[20,7],[17,1],[18,1],[19,1],[20,1]]){
  const s=dateFromHebrew(day,month,year),kind=agendaDayKind(s,settings),next=agendaDayKind(s+1,settings);
  if(!kind.holy||next.holy)continue;
  const current=prayerPanelHeadings(s,settings),shabbos=excelWeekday(s)===7;
  const occasion=day===10&&month===7?'יום כיפור':kind.chol?'':'יום טוב';
  const expected='מוצאי '+(shabbos&&occasion?'שבת ו'+occasion:shabbos?'שבת':occasion);
  assert.equal(current.evening.title,expected);
  assert.equal(current.evening.key,'motzai:'+civil(s));
  assert.equal(current.evening.date,civil(s));
  found.add(expected);
 }
 for(const expected of ['מוצאי שבת','מוצאי יום טוב','מוצאי יום כיפור','מוצאי שבת ויום טוב','מוצאי שבת ויום כיפור'])assert.ok(found.has(expected),expected);
});

test('snapshot attaches prayer headings while retaining civil titles and midnight event ownership',()=>{
 const snapshot=scheduleSnapshot('2026-09-22T12:00:00-04:00');
 for(const day of snapshot.displayDays){
  const s=serial(day.date);
  assert.deepEqual(day.prayerHeadings,prayerPanelHeadings(s,settings));
  assert.equal(day.displayTitle,hebrewPanelDay(s,settings),'Left-side civil heading is unchanged');
 }
 const today=snapshot.displayDays.find(day=>day.date==='2026-09-22');
 const midnight=today.events.find(event=>event.mins===1440&&event.name==='מעריב');
 assert.ok(midnight,'The printed midnight Maariv is retained');
 assert.equal(midnight.at,'2026-09-23T04:00:00.000Z');
 assert.equal(today.prayerHeadings.day.date,'2026-09-22');
 assert.equal(today.prayerHeadings.evening,null);
});
