import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineSeed,OFFLINE_ENGINE} from '../src/offline-seed.js';
import {offlineSnapshot,validSeed} from '../public/display-assets/offline-engine.js';
import {scheduleSnapshot} from '../src/schedules.js';
import {localToISO} from '../public/display-assets/time.js';
import worker from '../src/worker.js';
const appearance={mode:'scheduled',darkStart:'19:00',lightStart:'07:00'};
const entry=(status='published',data={message:'DEVELOPMENT SAMPLE complete message'})=>({id:'fixture-'+status,kind:'announcement',status,title:'DEVELOPMENT SAMPLE',internalName:'PRIVATE NAME',createdBy:'PRIVATE EMAIL',startsAt:'2026-09-25T12:00:00.000Z',endsAt:'2026-09-26T12:00:00.000Z',data:{...data,privateNotes:'PRIVATE NOTES'}});
test('offline seed includes only explicit public fields from published items',()=>{
 const items=[entry(),entry('draft'),entry('hidden'),entry('archived'),{...entry(),id:'anonymous',kind:'dedication',data:{anonymous:true,sponsor:'PRIVATE SPONSOR',dedicationName:'DEVELOPMENT SAMPLE'}}];
 items[0].data.displayGroup='hall';
 const seed=createOfflineSeed(items,appearance,'2026-09-24T12:00:00.000Z');
 assert.equal(seed.items.length,2);assert.ok(validSeed(seed));assert.equal(seed.engine,OFFLINE_ENGINE);
 assert.ok(!JSON.stringify(seed).includes('PRIVATE'));assert.ok(seed.items.every(i=>i.status==='published'));
 assert.equal(createOfflineSeed(items,appearance,'2026-09-27T12:00:00.000Z').items.length,0);
 assert.equal(seed.items[0].data.displayGroup,'hall');
 assert.equal(validSeed({...seed,engine:'old-engine'}),false);
});
test('cached published content appears and expires offline with scheduled NY theme',()=>{
 const seed=createOfflineSeed([entry()],appearance,'2026-09-24T12:00:00.000Z');
 assert.equal(offlineSnapshot(seed,'2026-09-25T11:59:59.999Z').items.length,0);
 assert.equal(offlineSnapshot(seed,'2026-09-25T12:00:00.000Z').items.length,1);
 assert.equal(offlineSnapshot(seed,'2026-09-26T12:00:00.000Z').items.length,0);
 assert.equal(offlineSnapshot(seed,'2026-09-25T22:59:59.000Z').theme,'light');
 assert.equal(offlineSnapshot(seed,'2026-09-25T23:00:00.000Z').theme,'dark');
 assert.equal(offlineSnapshot(seed,'2026-11-01T06:30:00.000Z').theme,'dark');
 assert.equal(offlineSnapshot(seed,'2026-11-01T12:00:00.000Z').theme,'light');
});
test('offline calendar matches authoritative next minyan, midnight and sheet placement for twenty years',()=>{
 const seed=createOfflineSeed([],appearance,'2026-09-24T12:00:00.000Z');
 const points=['2026-09-25T08:44','2026-09-25T08:45','2026-09-25T23:59','2026-09-26T00:00','2027-03-14T03:01','2026-11-01T02:01',...Array.from({length:20},(_,i)=>`${2027+i}-07-07T12:00`)];
 for(const date of points){const at=localToISO(date),actual=offlineSnapshot(seed,at).schedule,expected=scheduleSnapshot(at);assert.deepEqual(actual,expected,date);assert.ok(actual.next?.at,date);}
 assert.equal(offlineSnapshot(seed,localToISO('2026-09-25T08:44')).schedule.specialSheet.placement,'shabbos');
 assert.equal(offlineSnapshot(seed,localToISO('2026-09-25T08:45')).schedule.specialSheet.placement,'both');
 assert.equal(offlineSnapshot(seed,localToISO('2026-09-26T00:00')).schedule.date,'2026-09-26');
 const at=offlineSnapshot(seed,localToISO('2026-09-25T08:00')).schedule.next.at;
 const onBoundary=offlineSnapshot(seed,at);
 assert.equal(onBoundary.nextChangeAt,new Date(Date.parse(at)+1).toISOString());
 assert.notEqual(offlineSnapshot(seed,Date.parse(at)+1000).schedule.next.at,at);
});
test('offline seed endpoint remains public but never exposes drafts or credentials',async()=>{
 const at=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
 const rows=[{id:'fixture',kind:'dedication',status:'published',internal_name:'PRIVATE NAME',title:'פרנס היום',starts_at:at,ends_at:future,data_json:JSON.stringify({anonymous:true,sponsor:'PRIVATE SPONSOR',dedicationName:'DEVELOPMENT SAMPLE',privateNotes:'PRIVATE NOTES'}),updated_by:'PRIVATE EMAIL'}];
 const env={DB:{prepare(sql){return {bind(){return this;},async all(){return {results:rows};},async first(){return {mode:'light',dark_start:'19:00',light_start:'07:00'};}}}}};
 const response=await worker.fetch(new Request('https://example.com/api/display/offline'),env);
 assert.equal(response.status,200);const raw=await response.text();assert.ok(!raw.includes('PRIVATE'));assert.ok(JSON.parse(raw).items.length===1);
 assert.equal(response.headers.get('cache-control'),'no-store');
});

