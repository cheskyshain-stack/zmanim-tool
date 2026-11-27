import test from 'node:test';
import assert from 'node:assert/strict';
import {dateFromHebrew} from '../../js/hebrew-calendar.js';
import {dateFromSerial} from '../../js/zmanim/solar.js';
import {nextYomTovWindows,noticeBoundaries} from '../public/display-assets/notice-recurrence.js';
import {phase,localStamp} from '../public/display-assets/time.js';
import {dateInfo} from '../src/schedules.js';
import {validate,publicItems} from '../src/model.js';
import {createOfflineSeed} from '../src/offline-seed.js';
import {offlineSnapshot,validSeed} from '../public/display-assets/offline-engine.js';

const rule={type:'before-yom-tov',holidays:['pesach','sukkos','shavuos']};
const raw={kind:'announcement',status:'published',title:'DEVELOPMENT yearly appeal',data:{message:'DEVELOPMENT fixture only',recurrence:rule}};
const item={id:'development-recurring-appeal',...validate(raw)};
const civil=serial=>dateFromSerial(serial).toISOString().slice(0,10);
const offset=(at,ms)=>new Date(Date.parse(at)+ms).toISOString();

test('each selected Yom Tov starts fourteen Hebrew days before its eve and stops at its opening sunset for 51 years',()=>{
  for(let year=5787;year<=5837;year++)for(const [holiday,day,month] of [['pesach',15,1],['sukkos',15,7],['shavuos',6,3]]){
    const eve=dateFromHebrew(day,month,year)-1,start=dateInfo(civil(eve-14)).sunset,end=dateInfo(civil(eve)).sunset;
    const windows=nextYomTovWindows(rule,offset(start,-1),dateInfo),window=windows.find(w=>w.holiday===holiday);
    assert.equal(window.year,year);assert.equal(window.startsAt,start);assert.equal(window.endsAt,end);
    for(const [at,expected] of [[offset(start,-1),'scheduled'],[start,'showing'],[offset(end,-1),'showing'],[end,'scheduled']])assert.equal(phase(item,at,dateInfo),expected,holiday+' '+year+' '+at);
    assert(noticeBoundaries([item],offset(start,-1),dateInfo).includes(start));
    assert.equal(nextYomTovWindows(rule,end,dateInfo).find(w=>w.holiday===holiday).year,year+1);
  }
});

test('Sukkos can activate before the Hebrew year changes, including a DST change within other windows',()=>{
  const window=nextYomTovWindows(rule,'2026-09-01T12:00:00.000Z',dateInfo).find(w=>w.holiday==='sukkos');
  assert.equal(window.startsAt,dateInfo('2026-09-11').sunset);
  assert.equal(window.endsAt,dateInfo('2026-09-25').sunset);
  assert.equal(dateInfo(localStamp(window.startsAt).slice(0,10)).hebrew.year,5786);
  assert.equal(phase(item,window.startsAt,dateInfo),'showing');
});

test('rules are validated, sanitized, restricted to announcements and safely replace old one-time dates',()=>{
  assert.equal(item.startsAt,null);assert.equal(item.endsAt,null);
  const converted=validate({...raw,startLocal:'invalid stale date',endLocal:'invalid stale date',data:{...raw.data,recurrence:{...rule,holidays:['shavuos','pesach','pesach'],privateNotes:'DO NOT EXPOSE'}}});
  assert.deepEqual(converted.data.recurrence,{type:'before-yom-tov',holidays:['pesach','shavuos']});
  assert.throws(()=>validate({...raw,data:{...raw.data,recurrence:{type:'daily',holidays:rule.holidays}}}),/valid Yomim/);
  assert.throws(()=>validate({...raw,data:{...raw.data,recurrence:{...rule,holidays:['unknown']}}}),/valid Yomim/);
  assert.throws(()=>validate({...raw,data:{...raw.data,recurrence:{...rule,holidays:[]}}}),/at least one/);
  assert.throws(()=>validate({...raw,kind:'dedication'}),/only available/);
  assert.doesNotThrow(()=>validate({...raw,status:'draft',data:{...raw.data,recurrence:{...rule,holidays:[]}}}));
  for(const status of ['draft','hidden','archived'])assert.equal(phase({...item,status},'2026-09-24T12:00:00.000Z',dateInfo),status);
  const once=validate({...raw,startLocal:'2026-09-23T09:00',endLocal:'2026-09-23T10:00',data:{message:'DEVELOPMENT one-time fixture'}});
  assert.equal(phase(once,once.startsAt),'showing');assert.equal(phase(once,once.endsAt),'expired');assert.equal(once.data.recurrence,undefined);
});

test('selected holidays, future scheduling and published location govern visibility without exposing private fields',()=>{
  const selected={...item,data:{...item.data,recurrence:{...rule,holidays:['pesach']}}};
  assert.equal(phase(selected,'2026-09-24T12:00:00.000Z',dateInfo),'scheduled');
  const at='2027-04-15T12:00:00.000Z';assert.equal(phase(selected,at,dateInfo),'showing');
  const customDateInfo=date=>({...dateInfo(date),sunset:offset(dateInfo(date).sunset,90*60000)});
  const end=nextYomTovWindows(rule,at,dateInfo).find(w=>w.holiday==='pesach').endsAt,after=offset(end,60000);
  assert.equal(phase(selected,after,dateInfo),'scheduled');assert.equal(phase(selected,after,customDateInfo),'showing');
  const publicRows=publicItems([{...selected,internalName:'PRIVATE',updatedBy:'PRIVATE'}],after,customDateInfo);
  assert.equal(publicRows.length,1);assert(!JSON.stringify(publicRows).includes('PRIVATE'));
});

test('cached rules reactivate in later years offline, and earlier engines cannot mistake them for always-on notices',()=>{
  const seed=createOfflineSeed([{...item,internalName:'PRIVATE',createdBy:'PRIVATE'}],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},'2026-11-27T12:00:00.000Z');
  assert.deepEqual(seed.items[0].data.recurrence,rule);assert(!JSON.stringify(seed).includes('PRIVATE'));
  assert.equal(validSeed({...seed,engine:'shul-calendar-v10'}),false);
  for(const at of ['2026-11-27T12:00:00.000Z','2027-04-15T12:00:00.000Z','2028-05-20T12:00:00.000Z','2029-09-25T12:00:00.000Z']){
    const snapshot=offlineSnapshot(seed,Date.parse(at));
    assert.deepEqual(snapshot.items.map(i=>i.id),publicItems([item],at,dateInfo).map(i=>i.id),at);
  }
  const window=nextYomTovWindows(rule,'2027-04-01T12:00:00.000Z',dateInfo).find(w=>w.holiday==='pesach');
  const before=offlineSnapshot(seed,Date.parse(window.startsAt)-1);
  assert.equal(before.nextChangeAt,window.startsAt);assert.equal(before.items.length,0);
  assert.equal(offlineSnapshot(seed,Date.parse(window.startsAt)).items.length,1);
  assert.equal(offlineSnapshot(seed,Date.parse(window.endsAt)).items.length,0);
});
