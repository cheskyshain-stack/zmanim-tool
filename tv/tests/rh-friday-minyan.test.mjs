import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot,settings,category} from '../src/schedules.js';
import {validate} from '../src/model.js';
import {createOfflineSeed} from '../src/offline-seed.js';
import {offlineSnapshot} from '../public/display-assets/offline-engine.js';
import {localToISO} from '../public/display-assets/time.js';
import {buildRoshHashanaPoster} from '../../js/posters/roshhashana.js';
import {chartMinyanimForDay,minyanimForDay} from '../../js/upcoming.js';
import {buildAutomaticCharts,withoutRetiredDrasha} from '../../js/publish.js';
import {dateFromHebrew,excelWeekday} from '../../js/hebrew-calendar.js';
import {dateFromSerial} from '../../js/zmanim/solar.js';
import config from '../../data/published.json' with {type:'json'};
import parshaChutz from '../../data/parsha_chutz.json' with {type:'json'};
import parshaEY from '../../data/parsha_ey.json' with {type:'json'};
import parshaNames from '../../data/parsha_names.json' with {type:'json'};
import specialDays from '../../data/special_days.json' with {type:'json'};

const tables={parshaChutz,parshaEY,parshaNames,specialDays};
const civil=serial=>dateFromSerial(serial).toISOString().slice(0,10);
const at=(serial,time='12:00')=>localToISO(civil(serial)+'T'+time);
const identity=event=>({name:event.name,mins:event.mins,place:event.place||'בית מדרש'});
const identities=events=>events.map(identity).sort((a,b)=>a.mins-b.mins||a.name.localeCompare(b.name)||a.place.localeCompare(b.place));
const attachedYears=Array.from({length:20},(_,i)=>5787+i).filter(year=>excelWeekday(dateFromHebrew(2,7,year))===6);

test('all eight attached RH Fridays keep holiday daytime and use saved Shabbos evening events',()=>{
 assert.equal(attachedYears.length,8);
 for(const year of attachedYears){
  const friday=dateFromHebrew(2,7,year),instant=at(friday);
  const state=buildAutomaticCharts(withoutRetiredDrasha(config),tables,new Date(instant));
  const poster=buildRoshHashanaPoster(year,settings);
  const rh=poster.minyanim.filter(event=>event.serial===friday);
  const evening=chartMinyanimForDay(friday,state,settings,{onlyColumns:['F','G'],includeFridayMorning:false});
  assert.ok(evening.some(event=>category(event)==='mincha'),year+' has a saved Friday Mincha');
  assert.ok(evening.some(event=>category(event)==='maariv'),year+' has a saved Friday Maariv');
  assert.ok(evening.every(event=>event.mins>=720),'The appended chart cannot supply ordinary weekday mornings');
  const actual=scheduleSnapshot(instant).today.events.filter(event=>!event.auxiliary);
  assert.deepEqual(identities(actual),identities([...rh.filter(event=>category(event)!=='maariv'),...evening]),year+' has exactly the applicable source entries');
  for(const event of actual){
   const expected=at(friday,String(Math.floor(event.mins/60)).padStart(2,'0')+':'+String(event.mins%60).padStart(2,'0'));
   assert.equal(event.at,expected,'Each selected event belongs to its actual Friday civil date');
  }
  assert.deepEqual(identities(actual.filter(event=>event.mins<720)),identities(rh.filter(event=>event.mins<720)),'RH morning stays unchanged');
  assert.deepEqual(minyanimForDay(friday,state,settings),rh,'The shared public calendar still resolves its original special source');
  const thursday=friday-1;
  assert.deepEqual(identities(scheduleSnapshot(at(thursday)).today.events.filter(event=>!event.auxiliary)),identities(poster.minyanim.filter(event=>event.serial===thursday)),'The first RH day is unaffected');
 }
});

test('2028 Friday next-minyan uses 6:37 Mincha and downstairs 7:42 Maariv at exact dated boundaries',()=>{
 const friday=dateFromHebrew(2,7,5789),snapshot=scheduleSnapshot(at(friday));
 assert.equal(snapshot.date,'2028-09-22');
 assert.deepEqual(identities(snapshot.today.events.filter(event=>!event.auxiliary)),[
  {name:'שחרית',mins:450,place:'בית מדרש'},
  {name:'מנחה',mins:1070,place:'בית מדרש'},
  {name:'מנחה מעריב',mins:1117,place:'בית מדרש'},
  {name:'מעריב',mins:1182,place:'למטה'},
 ]);
 assert.ok(!snapshot.today.events.some(event=>['7:53','8:05'].includes(event.time)),'Standalone Motzei RH Maariv is not applicable on Friday');
 const cases=[
  ['2028-09-22T22:36:59.999Z','6:37','2028-09-22T22:37:00.000Z','בית מדרש'],
  ['2028-09-22T22:37:00.000Z','6:37','2028-09-22T22:37:00.000Z','בית מדרש'],
  ['2028-09-22T22:37:00.001Z','7:42','2028-09-22T23:42:00.000Z','למטה'],
  ['2028-09-22T23:41:59.999Z','7:42','2028-09-22T23:42:00.000Z','למטה'],
  ['2028-09-22T23:42:00.000Z','7:42','2028-09-22T23:42:00.000Z','למטה'],
  ['2028-09-22T23:42:00.001Z','7:30','2028-09-23T11:30:00.000Z','למטה'],
 ];
 const seed=createOfflineSeed([],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},at(friday));
 for(const [instant,time,eventAt,place] of cases){
  const next=scheduleSnapshot(instant).next;
  assert.deepEqual({time:next.time,at:next.at,place:next.place},{time,at:eventAt,place},instant);
  assert.deepEqual(offlineSnapshot(seed,instant).schedule.next,next,'Cached displays use the same boundary and location');
 }
});

test('an explicit published Maariv selection still overrides the connected Friday baseline',()=>{
 for(const year of attachedYears){
  const friday=dateFromHebrew(2,7,year),date=civil(friday),instant=at(friday,'19:40');
  const control=validate({kind:'schedule',status:'published',title:'Explicit RH Maariv selection',
   startLocal:date+'T00:00',endLocal:civil(friday+1)+'T00:00',
   data:{source:'rh:'+year,appliesFrom:date,appliesTo:date,portion:'maariv',precedence:90},
  });
  const baseline=scheduleSnapshot(instant),controlled=scheduleSnapshot(instant,[control]);
  const selected=buildRoshHashanaPoster(year,settings).minyanim.filter(event=>event.serial===friday&&category(event)==='maariv');
  assert.deepEqual(identities(controlled.today.events.filter(event=>category(event)==='maariv')),identities(selected),'Published control takes precedence: '+year);
  assert.deepEqual(identities(controlled.today.events.filter(event=>category(event)!=='maariv')),identities(baseline.today.events.filter(event=>category(event)!=='maariv')),'The control leaves RH daytime and saved Friday Mincha intact');
  assert.equal(controlled.today.title,control.title);
  assert.equal(controlled.specialSheet,null,'The existing explicit-control presentation remains authoritative');
  if(year===5789){
   assert.equal(controlled.next.time,'7:53');
   assert.equal(controlled.next.at,'2028-09-22T23:53:00.000Z');
   assert.equal(controlled.next.place,'בית מדרש');
   const second=scheduleSnapshot('2028-09-22T23:53:00.001Z',[control]).next;
   assert.deepEqual({time:second.time,at:second.at,place:second.place},{time:'8:05',at:'2028-09-23T00:05:00.000Z',place:'למטה'});
  }
 }
});
