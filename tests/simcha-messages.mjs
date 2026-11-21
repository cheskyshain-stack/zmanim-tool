import test from 'node:test';
import assert from 'node:assert/strict';
import {simchaFromMessage} from '../js/calendar/simcha-message.js';
import {syncSimchaMessage,reviewSimchaMessage} from '../worker/calendar/simcha-import.js';
const at='2026-11-20T18:00:00.000Z';
const message=(text,fields={})=>({id:'synthetic-message-123',text,createdAt:at,revision:1,...fields});
class Storage {
 rows=new Map();
 async get(key){return structuredClone(this.rows.get(key));}
 async put(key,value){if(typeof key==='string')this.rows.set(key,structuredClone(value));else for(const [k,v]of Object.entries(key))this.rows.set(k,structuredClone(v));}
 async list({prefix='',limit=Infinity}={}){return new Map([...this.rows].filter(([key])=>key.startsWith(prefix)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)]));}
}

test('all named simcha kinds and common extra simchos can become normal calendar events',()=>{
 for(const [name,type]of [['Shalom Zachor','shalom-zachor'],['Kiddush','kiddush'],['Vort','vort'],['Aufruf','aufruf'],['Wedding','wedding'],['Bar Mitzvah Shabbos','bar-mitzva-shabbos'],['Bar Mitzvah dessert','bar-mitzva-dessert'],['Bar Mitzvah','bar-mitzvah'],['Bris','custom'],['Pidyon Haben','custom'],['Sheva Brachos','custom'],['Bas Mitzvah','custom']]){
  const parsed=simchaFromMessage(message(name+' for the Example family on 2026-11-22 at 9am'));
  assert.equal(parsed.reason,'',name);assert.equal(parsed.event.type,type);assert.equal(parsed.event.time,'09:00');assert.equal(parsed.event.date,'2026-11-22');assert.equal(parsed.event.visibility,'everyone');
 }
});
test('relative days use original New York message date, including late UTC and edited dates',()=>{
 assert.equal(simchaFromMessage(message('Kiddush this Shabbos')).event.date,'2026-11-21');
 assert.equal(simchaFromMessage(message('Shalom Zachor Friday night at 9pm')).event.date,'2026-11-20');
 assert.equal(simchaFromMessage(message('Bris tomorrow',{createdAt:'2026-11-21T02:00:00.000Z'})).event.date,'2026-11-21');
 assert.equal(simchaFromMessage(message('Vort tonight',{addedAt:'2026-11-23T02:00:00.000Z'})).event.date,'2026-11-22');
 assert.equal(simchaFromMessage(message('Vort Motzai Shabbos 9pm')).event.date,'2026-11-21');
 assert.equal(simchaFromMessage(message('Kiddush on 11/21/2026')).event.date,'2026-11-21');
});
test('unclear dates, conflicting occasions, time ranges, corrections and lengthy SMS wait for review',()=>{
 for(const text of ['Kiddush for Example','Vort 11/22','Bris 2026-02-30','Kiddush Shabbos 8:30','Vort tomorrow 8-9pm','Shalom Zachor Friday and Kiddush Shabbos','Vort tonight cancelled','Kiddush Friday and Shabbos','Bris tomorrow after Shacharis','Kiddush tomorrow '+ 'x'.repeat(4364),'No Kiddush this Shabbos','Kiddush this Shabbos?','Maybe a Bris tomorrow','Bris tonight at 12am'])assert.ok(simchaFromMessage(message(text)).reason,text.slice(0,60));
 for(const text of ['Shiur Sunday at 8pm','Hespedim Motzai Shabbos 9pm','Kiddush Levana Sunday','General shul update'])assert.equal(simchaFromMessage(message(text)),null);
});
test('safe plain text and original details are preserved',()=>{
 const text='Kiddush Shabbos\n<script>alert(1)</script>\nFamily address and contact';
 const parsed=simchaFromMessage(message(text));assert.equal(parsed.event.details,text);assert.equal(parsed.event.allDay,true);assert.ok(!parsed.event.reminder);
});
test('new imports are retry safe, duplicate announcements do not create duplicate events',async()=>{
 const db=new Storage(),first=message('Kiddush Shabbos for Example');
 const one=await syncSimchaMessage(db,first);assert.equal(one.status,'added');
 await syncSimchaMessage(db,first);assert.equal((await db.list({prefix:'event:'})).size,1);
 const duplicate=await syncSimchaMessage(db,{...first,id:'synthetic-duplicate-123'});assert.equal(duplicate.status,'duplicate');assert.equal((await db.list({prefix:'event:'})).size,1);
 const other=await syncSimchaMessage(db,message('Kiddush Shabbos for Other',{id:'synthetic-other-123'}));assert.equal(other.status,'review');assert.match(other.reason,/already exists/);
});
test('message corrections update only unchanged imported events and never resurrect deleted events',async()=>{
 const db=new Storage(),first=message('Kiddush Shabbos for Example');const record=await syncSimchaMessage(db,first);
 const updated=await syncSimchaMessage(db,{...first,text:'Kiddush 2026-11-28 for Example',revision:2});assert.equal(updated.status,'added');assert.equal((await db.get('event:'+record.eventId)).date,'2026-11-28');
 const old=await db.get('event:'+record.eventId);await db.put('event:'+old.id,{...old,revision:3,updatedBy:'owner'});
 const review=await syncSimchaMessage(db,{...first,revision:3});assert.equal(review.status,'review');assert.equal((await db.get('event:'+old.id)).date,'2026-11-28');
 const second=new Storage();const r=await syncSimchaMessage(second,first);second.rows.delete('event:'+r.eventId);await second.put('deleted-event:'+r.eventId,{revision:2});
 assert.equal((await syncSimchaMessage(second,{...first,revision:2})).status,'review');assert.equal((await second.list({prefix:'event:'})).size,0);
});
test('owner review supports uncertain dates, multiple simchos and retry-safe saves',async()=>{
 const db=new Storage(),source=message('Vort and Kiddush for Example');await db.put('announcement:'+source.id,source);await syncSimchaMessage(db,source);
 const fields={title:'Example Vort',type:'vort',date:'2026-11-22',details:'Example Vort'};
 const first=await reviewSimchaMessage(db,source.id,'add',fields,'owner',1,{operationId:'review-operation-123',keepReview:true});
 const retried=await reviewSimchaMessage(db,source.id,'add',fields,'owner',1,{operationId:'review-operation-123',keepReview:true});assert.equal(retried.id,first.id);assert.equal((await db.list({prefix:'event:'})).size,1);
 await reviewSimchaMessage(db,source.id,'add',{...fields,type:'kiddush',title:'Example Kiddush'},'owner',1,{operationId:'review-operation-456'});assert.equal((await db.list({prefix:'event:'})).size,2);
 await assert.rejects(()=>reviewSimchaMessage(db,source.id,'add',fields,'owner',1,{operationId:'review-operation-789'}),/changed/);
});
test('skipped and stale reviews cannot overwrite a decision or create events',async()=>{
 const db=new Storage(),source=message('Bris for Example');await db.put('announcement:'+source.id,source);await syncSimchaMessage(db,source);
 await assert.rejects(()=>reviewSimchaMessage(db,source.id,'skip',null,'owner',2),/changed/);
 await reviewSimchaMessage(db,source.id,'skip',null,'owner',1);assert.equal((await syncSimchaMessage(db,source)).status,'skipped');assert.equal((await db.list({prefix:'event:'})).size,0);
});
