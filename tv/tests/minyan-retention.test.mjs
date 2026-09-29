import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot} from '../src/schedules.js';
import {createOfflineSeed} from '../src/offline-seed.js';
import {offlineSnapshot} from '../public/display-assets/offline-engine.js';
import worker from '../src/worker.js';

const appearance={mode:'dark',darkStart:'19:00',lightStart:'07:00'};
const retainedOffsets=[-1,0,1,299999,300000];
const atOffset=(at,offset)=>new Date(Date.parse(at)+offset).toISOString();
const regular=scheduleSnapshot('2027-07-07T16:00:00.000Z').next;
const midnight=scheduleSnapshot('2026-09-28T16:00:00.000Z').today.events.find(event=>!event.auxiliary&&event.mins===1440);

test('a regular minyan keeps its published time and location through five minutes after its start',()=>{
 assert.ok(regular?.at,'The regular weekday supplies an actual next minyan');
 const source=scheduleSnapshot(atOffset(regular.at,-1)).today.events;
 assert.ok(source.some(event=>event.at===regular.at&&event.name===regular.name&&event.place===regular.place));
 for(const offset of retainedOffsets){
  const at=atOffset(regular.at,offset),snapshot=scheduleSnapshot(at);
  assert.deepEqual(snapshot.next,regular,at);
  assert.deepEqual(snapshot.today.events,source,'Retention must not change the published daily schedule');
 }
 assert.ok(scheduleSnapshot(atOffset(regular.at,300001)).next.at>regular.at,'The next minyan advances immediately after the inclusive grace boundary');
});

test('midnight Maariv carries over from the preceding schedule through the same five-minute grace',()=>{
 assert.equal(midnight?.at,'2026-09-29T04:00:00.000Z');
 assert.equal(midnight.time,'12:00');
 assert.equal(midnight.place,'למטה');
 for(const offset of retainedOffsets){
  const at=atOffset(midnight.at,offset),snapshot=scheduleSnapshot(at);
  assert.deepEqual(snapshot.next,midnight,at);
  assert.equal(snapshot.date,offset<0?'2026-09-28':'2026-09-29','The civil day still advances on time');
 }
 const next=scheduleSnapshot(atOffset(midnight.at,300001)).next;
 assert.equal(next.name,'שחרית');
 assert.equal(next.at,'2026-09-29T11:00:00.000Z');
});

test('public Worker and offline snapshots share a future boundary throughout the retention window',async t=>{
 const env={DB:{prepare(){return {bind(){return this;},async all(){return {results:[]};},async first(){return {mode:'dark',dark_start:'19:00',light_start:'07:00'};}};}}};
 const seed=createOfflineSeed([],appearance,'2026-09-28T16:00:00.000Z');
 t.mock.timers.enable({apis:['Date'],now:Date.parse(regular.at)});
 for(const event of [regular,midnight]){
  for(const offset of [...retainedOffsets,300001]){
   const at=atOffset(event.at,offset);
   t.mock.timers.setTime(Date.parse(at));
   const response=await worker.fetch(new Request('https://example.com/api/display/public'),env);
   assert.equal(response.status,200);
   const online=await response.json(),offline=offlineSnapshot(seed,at);
   assert.equal(online.at,at);
   assert.deepEqual(online.schedule.next,offline.schedule.next,at);
   assert.equal(online.nextChangeAt,offline.nextChangeAt,at);
   assert.ok(online.nextChangeAt>at,'Both snapshots must schedule a future refresh');
   if(offset>=0&&offset<=300000)
    assert.equal(online.nextChangeAt,atOffset(event.at,300001),'Refresh immediately after the inclusive grace boundary');
  }
 }
});
