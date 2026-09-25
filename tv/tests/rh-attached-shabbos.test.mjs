import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot,settings} from '../src/schedules.js';
import {buildRoshHashanaPoster} from '../../js/posters/roshhashana.js';
import {publicPosterSections} from '../../js/ui/posters-view.js';
import {dateFromHebrew,excelWeekday} from '../../js/hebrew-calendar.js';
import {dateFromSerial} from '../../js/zmanim/solar.js';
import {localToISO} from '../public/display-assets/time.js';
import {createOfflineSeed} from '../src/offline-seed.js';
import {offlineSnapshot} from '../public/display-assets/offline-engine.js';

const civil=serial=>dateFromSerial(serial).toISOString().slice(0,10);
const atNoon=serial=>localToISO(civil(serial)+'T12:00');
const windowId=sheet=>sheet?.windowSourceId||sheet?.sourceId;

test('the combined occasion page retains the connected RH and Shabbos window through closing for twenty years',()=>{
 let attached=0;
 for(let year=5787;year<5807;year++){
  const lastRH=dateFromHebrew(2,7,year);
  if(excelWeekday(lastRH+1)!==7)continue;
  attached++;
  const shabbos=lastRH+1,snapshot=scheduleSnapshot(atNoon(shabbos)),sheet=snapshot.specialSheet;
  assert.equal(sheet?.sourceId,'high-holidays:'+year);
  assert.equal(windowId(sheet),'rh:'+year);
  assert.equal(sheet.displayThrough,civil(shabbos));
  assert.ok(sheet.to>civil(shabbos),'The complete original page also covers Yom Kippur');
  assert.equal(sheet.placement,'both');
  assert.equal(sheet.endsAt,snapshot.presentation.special.endsAt);
  const poster=buildRoshHashanaPoster(year,settings);
  const original=publicPosterSections('rh',poster);
  assert.equal(Object.hasOwn(sheet,'columnBreakAt'),false,'The original combined page chooses its own column break');
  for(const section of original)assert.deepEqual(sheet.sections.find(saved=>saved.title===section.title),section,'Every original RH entry and mark remains unchanged');
  assert.ok(sheet.sections.some(section=>/^יום כיפור(?:\s|$)/.test(section.title)),'Yom Kippur belongs on the same complete page');
  assert.ok(snapshot.presentation.special.sections.some(section=>section.groupDay===civil(shabbos)),'The actual connected Shabbos data remains available independently');
  const preview=scheduleSnapshot(sheet.previewStartsAt).specialSheet;
  assert.deepEqual(preview.sections,sheet.sections,'The full connected source is stable from its first preview');
  for(const at of [atNoon(lastRH-1),atNoon(lastRH),new Date(Date.parse(sheet.endsAt)-1).toISOString()])assert.deepEqual(scheduleSnapshot(at).specialSheet.sections,sheet.sections);
  const after=scheduleSnapshot(sheet.endsAt);
  assert.notEqual(windowId(after.specialSheet),windowId(sheet),'The RH window expires exactly at Shabbos closing');
  assert.notEqual(windowId(scheduleSnapshot(atNoon(shabbos+1)).specialSheet),windowId(sheet),'Postponed Gedalya keeps its weekday panel');
  for(let offset=1;offset<=7;offset++)assert.notEqual(windowId(scheduleSnapshot(atNoon(shabbos+offset)).specialSheet),windowId(sheet),'The old RH window cannot return in the following week');
 }
 assert.equal(attached,8,'Exercise every RH-attached Shabbos in this twenty-year range');
 assert.equal(Object.hasOwn(scheduleSnapshot('2026-09-12T16:00:00.000Z').specialSheet,'columnBreakAt'),false,'The combined occasion retains original page layout');
});

test('offline and server snapshots agree across the attached Shabbos retention boundary',()=>{
 const at='2028-09-23T16:00:00.000Z',seed=createOfflineSeed([],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},at);
 assert.match(seed.engine,/^shul-calendar-v6-/);
 const sheet=scheduleSnapshot(at).specialSheet;
 for(const instant of [sheet.previewStartsAt,at,new Date(Date.parse(sheet.endsAt)-1).toISOString(),sheet.endsAt])
  assert.deepEqual(offlineSnapshot(seed,instant).schedule,scheduleSnapshot(instant));
});
