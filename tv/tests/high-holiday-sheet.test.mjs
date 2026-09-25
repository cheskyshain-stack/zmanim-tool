import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot,settings} from '../src/schedules.js';
import {validate} from '../src/model.js';
import {localToISO} from '../public/display-assets/time.js';
import {publicOccasionSheet} from '../../js/ui/posters-view.js';
import {buildAutomaticCharts,withoutRetiredDrasha} from '../../js/publish.js';
import {dateFromSerial} from '../../js/zmanim/solar.js';
import config from '../../data/published.json' with {type:'json'};
import parshaChutz from '../../data/parsha_chutz.json' with {type:'json'};
import parshaEY from '../../data/parsha_ey.json' with {type:'json'};
import parshaNames from '../../data/parsha_names.json' with {type:'json'};
import specialDays from '../../data/special_days.json' with {type:'json'};

const tables={parshaChutz,parshaEY,parshaNames,specialDays};
const civil=serial=>dateFromSerial(serial).toISOString().slice(0,10);
const on=local=>scheduleSnapshot(localToISO(local));

test('RH and YK show the exact same complete original admin occasion sheet',()=>{
 const instant=localToISO('2026-09-08T12:00');
 const state=buildAutomaticCharts(withoutRetiredDrasha(config),tables,new Date(instant));
 const original=publicOccasionSheet(state,settings,5787);
 assert.equal(original.title,'ימים נוראים');
 assert.ok(original.sections.some(section=>section.title==='סליחות'));
 assert.ok(original.sections.some(section=>section.title==='יום כיפור'));
 for(const [local,window] of [
  ['2026-09-08T12:00','rh:5787'],['2026-09-12T12:00','rh:5787'],
  ['2026-09-19T22:00','yk:5787'],['2026-09-21T12:00','yk:5787'],
 ]){
  const sheet=on(local).specialSheet;
  assert.equal(sheet.sourceId,'high-holidays:5787',local);
  assert.equal(sheet.windowSourceId,window,local);
  assert.equal(sheet.title,original.title);
  assert.equal(sheet.from,civil(original.span.from));
  assert.equal(sheet.to,civil(original.span.to));
  assert.equal(Object.hasOwn(sheet,'columnBreakAt'),false);
  assert.deepEqual(sheet.sections,original.sections,'All original sections, labels, times, notes and marks: '+local);
 }
});

test('the complete page does not bridge RH and YK visibility windows',()=>{
 const rh=on('2026-09-12T12:00').specialSheet;
 const yk=on('2026-09-21T12:00').specialSheet;
 assert.ok(rh.to>rh.displayThrough,'Printed later sections do not extend RH display timing');
 assert.ok(rh.endsAt<yk.previewStartsAt,'There is an ordinary weekday interval between the windows');
 assert.equal(scheduleSnapshot(rh.endsAt).specialSheet,null);
 for(const date of ['2026-09-14','2026-09-16','2026-09-18']){
  const snapshot=on(date+'T12:00');
  assert.equal(snapshot.specialSheet,null,date+' keeps the regular weekday schedule');
  assert.ok(snapshot.presentation.weekly.services.some(service=>service.groups.some(group=>group.events.length)));
 }
 assert.equal(scheduleSnapshot(yk.previewStartsAt).specialSheet.placement,'shabbos');
 assert.equal(scheduleSnapshot(yk.coversBothAt).specialSheet.placement,'both');
 assert.equal(scheduleSnapshot(yk.endsAt).specialSheet.sourceId,'sukkos:5787');
});

test('publication overrides apply to the relevant holy-day window, not every date printed on the combined page',()=>{
 const control=validate({kind:'schedule',status:'published',title:'Development YK override',
  startLocal:'2026-09-01T00:00',endLocal:'2026-09-22T00:00',
  data:{source:'yk:5787',appliesFrom:'2026-09-21',appliesTo:'2026-09-21',portion:'all',precedence:90},
 });
 const rh=scheduleSnapshot(localToISO('2026-09-08T12:00'),[control]);
 assert.equal(rh.specialSheet.sourceId,'high-holidays:5787','Future YK control does not suppress RH');
 assert.equal(rh.specialSheet.windowSourceId,'rh:5787');
 assert.equal(scheduleSnapshot(localToISO('2026-09-21T12:00'),[control]).specialSheet,null);
 for(const status of ['draft','hidden','archived'])
  assert.equal(scheduleSnapshot(localToISO('2026-09-21T12:00'),[{...control,status}]).specialSheet.windowSourceId,'yk:5787');
});

test('combined occasion data exposes public printed fields only',()=>{
 const sheet=on('2026-09-08T12:00').specialSheet;
 const inspect=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,nested] of Object.entries(value)){
   assert.doesNotMatch(key,/^(trace|calc|internalName|createdBy|updatedBy|sponsor|privateNotes)$/i);
   inspect(nested);
  }
 };
 inspect(sheet);
});
