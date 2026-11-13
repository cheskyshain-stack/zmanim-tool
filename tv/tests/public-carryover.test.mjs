import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {offlineSnapshot} from '../public/display-assets/offline-engine.js';
import {quarterSchedule} from '../public/display-assets/quarter-schedules.js';
import {localToISO} from '../public/display-assets/time.js';

// Run the Worker queries against SQLite rather than a permissive mock that
// returns rows the production WHERE clause would have removed.
test('public routes retain yesterday schedule controls through midnight without exposing ended content or private fields',async t=>{
  const at=localToISO('2026-09-29T00:30');
  t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(`CREATE TABLE display_items(id TEXT,kind TEXT,status TEXT,internal_name TEXT,title TEXT,starts_at TEXT,ends_at TEXT,data_json TEXT,created_by TEXT);
    CREATE TABLE display_appearance(id INTEGER,mode TEXT,dark_start TEXT,light_start TEXT);
    INSERT INTO display_appearance VALUES(1,'dark','19:00','07:00');`);
  const control={source:'sukkos:5787',appliesFrom:'2026-09-28',appliesTo:'2026-09-28',portion:'maariv',precedence:50,privateNotes:'PRIVATE NOTES'};
  const insert=db.prepare('INSERT INTO display_items VALUES(?,?,?,?,?,?,?,?,?)');
  const starts=localToISO('2026-09-28T00:00'),ends=localToISO('2026-09-29T00:01');
  const row=(id,kind,status,data,title=id)=>insert.run(id,kind,status,'PRIVATE NAME',title,starts,ends,JSON.stringify(data),'PRIVATE EMAIL');
  row('carryover','schedule','published',control,'Approved Monday Maariv');
  row('older-control','schedule','published',{...control,appliesFrom:'2026-09-27',appliesTo:'2026-09-27'});
  for(const status of ['draft','hidden','archived'])row(status,'schedule',status,{...control,precedence:99});
  row('ended-notice','announcement','published',{message:'ENDED NOTICE'});
  row('ended-sponsor','dedication','published',{sponsor:'ENDED SPONSOR'});
  const selected=[];
  const env={DB:{prepare(sql){let args=[];return {
    bind(...values){args=values;return this;},
    async all(){const results=db.prepare(sql).all(...args);selected.push(results.map(row=>row.id));return {results};},
    async first(){return db.prepare(sql).get(...args);}
  };}}};
  const responses=[];
  for(const path of ['/api/display/public','/api/display/offline']){
    const response=await worker.fetch(new Request('https://shul.example'+path),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const raw=await response.text();
    assert.ok(!/PRIVATE|ENDED NOTICE|ENDED SPONSOR/.test(raw));
    responses.push(JSON.parse(raw));
  }
  assert.deepEqual(selected,[['carryover'],['carryover']],'SQL must retain only the relevant published source control');
  const [live,seed]=responses;
  assert.deepEqual(live.items,[],'Expired content is not active content');
  assert.deepEqual(seed.items.map(item=>item.id),['carryover']);
  const saved=offlineSnapshot(seed,at);
  for(const snapshot of [live,saved]){
    const yesterday=quarterSchedule(snapshot.schedule,at).prayerDays.find(day=>day.date==='2026-09-28');
    assert.equal(yesterday.sourceTitle,'Approved Monday Maariv');
    assert.equal(yesterday.groups[0].events.length,11);
    assert.equal(yesterday.groups[0].expiresAt,localToISO('2026-09-29T01:00'));
  }
  assert.deepEqual(saved.schedule.displayDays,live.schedule.displayDays);
});
