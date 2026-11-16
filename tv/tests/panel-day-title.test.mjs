import test from 'node:test';
import assert from 'node:assert/strict';
import {hebrewPanelDay,hebrewDay} from '../src/presentation.js';
import {settings} from '../src/schedules.js';
import {dateFromHebrew,excelWeekday} from '../../js/hebrew-calendar.js';
import {excelSerial} from '../../js/zmanim/solar.js';

const civilSerial=date=>excelSerial(new Date(date+'T12:00:00Z'));
const panel=(day,month,year=5787)=>hebrewPanelDay(dateFromHebrew(day,month,year),settings);

test('ordinary panel headings name the weekday, Erev Shabbos, or Shabbos without a date',()=>{
 const start=civilSerial('2026-11-15');
 const expected=['יום א׳','יום ב׳','יום ג׳','יום ד׳','יום ה׳','ערב שבת','שבת'];
 assert.deepEqual(expected.map((_,index)=>hebrewPanelDay(start+index,settings)),expected);
 assert.equal(hebrewDay(start+6,settings),'שבת קודש','Existing non-panel headings stay unchanged');
});

test('named festival days retain their own identity before the next Yom Tov day',()=>{
 for(let year=5787;year<=5806;year++)for(const [day,month] of [[1,7],[2,7],[10,7],[15,7],[16,7],[22,7],[23,7],[15,1],[16,1],[21,1],[22,1],[6,3],[7,3]]){
  const serial=dateFromHebrew(day,month,year),name=hebrewPanelDay(serial,settings);
  assert.equal(name,hebrewDay(serial,settings).replace(/^שבת קודש(?= · |$)/,'שבת'));
  assert.doesNotMatch(name,/ערב/,'A festival day is not relabeled as the eve of another');
  if(excelWeekday(serial)===7)assert.match(name,/^שבת · /);
 }
 assert.equal(panel(10,7),'יום כיפור');
 assert.match(panel(15,1),/יום א׳ פסח/);
});

test('Erev Yom Tov headings distinguish RH and YK and keep simultaneous Shabbos',()=>{
 let shabbosErevFound=false,fridayErevFound=false;
 for(let year=5787;year<=5806;year++)for(const [day,month,erev] of [[29,6,'ערב ראש השנה'],[9,7,'ערב יום כיפור'],[14,7,'ערב יום טוב'],[14,1,'ערב יום טוב'],[5,3,'ערב יום טוב']]){
  const serial=dateFromHebrew(day,month,year),weekday=excelWeekday(serial),name=hebrewPanelDay(serial,settings);
  assert.equal(name,weekday===7?'שבת · '+erev:weekday===6?'ערב שבת · '+erev:erev);
  shabbosErevFound ||= weekday===7;
  fridayErevFound ||= weekday===6;
 }
 assert.ok(shabbosErevFound,'Covers Shabbos immediately before Sunday Yom Tov');
 assert.ok(fridayErevFound,'Covers Erev Shabbos and Erev Yom Tov together');
});

test('Chol Hamoed and Hoshana Rabba keep their names through the final Erev Yom Tov',()=>{
 for(let year=5787;year<=5806;year++)for(const [day,month] of [[17,7],[18,7],[19,7],[20,7],[21,7],[17,1],[18,1],[19,1],[20,1]]){
  const serial=dateFromHebrew(day,month,year);
  assert.equal(hebrewPanelDay(serial,settings),hebrewDay(serial,settings).replace(/^שבת קודש(?= · |$)/,'שבת'));
 }
 assert.equal(panel(21,7),'הושענא רבה');
 assert.match(panel(20,1),/חול המועד פסח/);
});

test('weekday fast-day names remain visible in panel headings',()=>{
 assert.match(panel(3,7),/צום גדליה/);
 const fridayFast=Array.from({length:20},(_,i)=>dateFromHebrew(10,10,5787+i)).find(serial=>excelWeekday(serial)===6);
 assert.ok(fridayFast);
 assert.equal(hebrewPanelDay(fridayFast,settings),'עשרה בטבת · ערב שבת');
});
