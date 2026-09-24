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
const normalize=text=>String(text||'').replace(/[\s\uE000\uE001/]+/g,'');

test('RH retains every applicable original row and the connected saved Shabbos through closing for twenty years',()=>{
 let attached=0;
 for(let year=5787;year<5807;year++){
  const lastRH=dateFromHebrew(2,7,year);
  if(excelWeekday(lastRH+1)!==7)continue;
  attached++;
  const shabbos=lastRH+1,snapshot=scheduleSnapshot(atNoon(shabbos)),sheet=snapshot.specialSheet;
  assert.equal(sheet?.sourceId,'rh:'+year);
  assert.equal(sheet.displayThrough,civil(shabbos));
  assert.equal(sheet.to,civil(shabbos));
  assert.equal(sheet.placement,'both');
  assert.equal(sheet.endsAt,snapshot.presentation.special.endsAt);
  const poster=buildRoshHashanaPoster(year,settings);
  const closingRows=poster.blocks.flatMap(block=>block.lines).filter(row=>row.calc==='motzeiMaariv');
  assert.equal(closingRows.length,1,'The standalone Friday closing row is explicitly identified in source metadata');
  const original=publicPosterSections('rh',{...poster,blocks:poster.blocks.map(block=>({...block,lines:block.lines.filter(row=>row.calc!=='motzeiMaariv')}))});
  assert.equal(sheet.columnBreakAt,original.length,'Only the appended Shabbos starts the second column');
  assert.deepEqual(sheet.sections.slice(0,original.length),original,'All applicable RH entries remain unchanged; Shabbos supplies the connected Friday night');
  assert.equal(sheet.sections[original.length-1].rows.at(-1).label,'מנחה','The inapplicable standalone closing Maariv is omitted');
  const appended=sheet.sections.slice(original.length);
  const expected=snapshot.presentation.special.sections.filter(section=>section.groupDay===civil(shabbos));
  assert.deepEqual(appended.map(section=>section.title),expected.map(section=>section.heading));
  assert.equal(appended.flatMap(section=>section.rows).length,expected.flatMap(section=>section.rows).length);
  for(let section=0;section<expected.length;section++)for(let index=0;index<expected[section].rows.length;index++){
   const source=expected[section].rows[index],row=appended[section].rows[index];
   assert.equal(row.label,source.label);
   assert.equal(row.note||'',source.note||'');
   assert.equal(normalize(row.times.map(time=>time.text+(time.mark||'')).join('')),normalize(source.times.map(time=>time.text+(time.mark||'')).join('')),source.label);
   assert.deepEqual(row.times.map(time=>time.name).filter(Boolean),source.times.map(time=>time.name).filter(Boolean));
   const sourceUnderlines=source.times.flatMap(time=>[...String(time.text).matchAll(/\uE000([\s\S]*?)\uE001/g)].map(match=>normalize(match[1])));
   assert.deepEqual(row.times.filter(time=>time.underlined).map(time=>normalize(time.text)),sourceUnderlines,'Every saved underline survives: '+source.label);
   assert.ok(Object.keys(row).every(key=>['label','times','note'].includes(key)),'Public rows exclude calculation/private fields');
  }
  const preview=scheduleSnapshot(sheet.previewStartsAt).specialSheet;
  assert.deepEqual(preview.sections,sheet.sections,'The full connected source is stable from its first preview');
  for(const at of [atNoon(lastRH-1),atNoon(lastRH),new Date(Date.parse(sheet.endsAt)-1).toISOString()])assert.deepEqual(scheduleSnapshot(at).specialSheet.sections,sheet.sections);
  const after=scheduleSnapshot(sheet.endsAt);
  assert.notEqual(after.specialSheet?.sourceId,sheet.sourceId,'The page expires exactly at Shabbos closing');
  assert.notEqual(scheduleSnapshot(atNoon(shabbos+1)).specialSheet?.sourceId,sheet.sourceId,'Postponed Gedalya keeps its weekday panel');
  for(let offset=1;offset<=7;offset++)assert.notEqual(scheduleSnapshot(atNoon(shabbos+offset)).specialSheet?.sourceId,sheet.sourceId,'The old RH page cannot return in the following week');
 }
 assert.equal(attached,8,'Exercise every RH-attached Shabbos in this twenty-year range');
 assert.equal(Object.hasOwn(scheduleSnapshot('2026-09-12T16:00:00.000Z').specialSheet,'columnBreakAt'),false,'An RH page without an appended Shabbos keeps its original continuous column');
});

test('offline and server snapshots agree across the attached Shabbos retention boundary',()=>{
 const at='2028-09-23T16:00:00.000Z',seed=createOfflineSeed([],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},at);
 assert.match(seed.engine,/^shul-calendar-v5-/);
 const sheet=scheduleSnapshot(at).specialSheet;
 for(const instant of [sheet.previewStartsAt,at,new Date(Date.parse(sheet.endsAt)-1).toISOString(),sheet.endsAt])
  assert.deepEqual(offlineSnapshot(seed,instant).schedule,scheduleSnapshot(instant));
});
