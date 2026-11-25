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
 for(const text of ['Vort 11/22','Bris 2026-02-30','Kiddush Shabbos 8:30','Vort tomorrow 8-9pm','Shalom Zachor Friday and Kiddush Shabbos','Vort tonight cancelled','Kiddush Friday and Shabbos','Bris tomorrow after Shacharis','Kiddush tomorrow '+ 'x'.repeat(4364),'No Kiddush this Shabbos','Kiddush this Shabbos?','Maybe a Bris tomorrow','Bris tonight at 12am'])assert.ok(simchaFromMessage(message(text)).reason,text.slice(0,60));
 for(const text of ['Shiur Sunday at 8pm','Hespedim Motzai Shabbos 9pm','Kiddush Levana Sunday','General shul update'])assert.equal(simchaFromMessage(message(text)),null);
});
test('safe plain text and original details are preserved',()=>{
 const text='Kiddush Shabbos\n<script>alert(1)</script>\nFamily address and contact';
 const parsed=simchaFromMessage(message(text));assert.equal(parsed.text,text);assert.match(parsed.event.details,/<script>alert\(1\)<\/script>\nFamily address and contact/);assert.equal(parsed.event.allDay,true);assert.ok(!parsed.event.reminder);
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
 const decided=await db.get('simcha-source:'+source.id);await db.put('simcha-source:'+source.id,{...decided,parserVersion:2});
 const rescan=await syncSimchaMessage(db,source);assert.equal(rescan.status,'added');assert.deepEqual(rescan.operations,decided.operations,'Parser updates retain completed owner review decisions');
 await assert.rejects(()=>reviewSimchaMessage(db,source.id,'add',fields,'owner',1,{operationId:'review-operation-789'}),/changed/);
});
test('skipped and stale reviews cannot overwrite a decision or create events',async()=>{
 const db=new Storage(),source=message('Bris for Example, details to follow');await db.put('announcement:'+source.id,source);await syncSimchaMessage(db,source);
 await assert.rejects(()=>reviewSimchaMessage(db,source.id,'skip',null,'owner',2),/changed/);
 await reviewSimchaMessage(db,source.id,'skip',null,'owner',1);assert.equal((await syncSimchaMessage(db,source)).status,'skipped');assert.equal((await db.list({prefix:'event:'})).size,0);
});

test('private browser preview derives events without changing saved events or source messages',async()=>{
 const {simchaMessagePreview}=await import('../js/calendar/simcha-message.js');
 const source=message('Shalom Zachor Friday night at 9pm');
 const unknown=message('Bris for Example, details to follow',{id:'unknown-preview'});
 const before=JSON.stringify([source,unknown]);
 const preview=simchaMessagePreview([source,source,unknown]);
 assert.equal(preview.events.length,1);assert.equal(preview.review.length,1);assert.equal(preview.events[0].simchaPreview,true);assert.equal(preview.events[0].date,'2026-11-20');
 assert.equal(JSON.stringify([source,unknown]),before);
 assert.equal(simchaMessagePreview([source],[{...preview.events[0],id:'saved-original'}]).events.length,0);
});

test('implicit sent dates, Shabbos compounds, contextual clocks and location abbreviations',()=>{
 const friday=message("M'T to R&M Example Smith on their son's Shmuel Aryeh Bar Mitzvah. Shacharis NS followed by Kiddush for MEN");
 const parsed=simchaFromMessage(friday);assert.equal(parsed.event.date,'2026-11-21');assert.equal(parsed.event.type,'bar-mitzva-shabbos');assert.equal(parsed.event.time,'');assert.equal(parsed.event.location,'NS');assert.match(parsed.event.details,/Rabbi and Mrs\. Example Smith/);assert.doesNotMatch(parsed.event.details,/^M'T/);
 const morning=simchaFromMessage(message("Mazel Tov to R&M Example Smith on their son's Bar Mitzvah. Shacharis 8:30 in the Simcha Hall followed by Kiddush"));assert.equal(morning.event.time,'08:30');assert.equal(morning.event.date,'2026-11-21');
 const dessert=simchaFromMessage(message('Rabbi & Mrs Example are making a Bar Mitzva for their son Shmuel Aryeh. Dessert reception 9:45 Tiferes Hall',{createdAt:'2026-11-18T01:27:00Z'}));assert.equal(dessert.event.date,'2026-11-17');assert.equal(dessert.event.time,'21:45');assert.equal(dessert.event.type,'bar-mitzva-dessert');
 assert.equal(simchaFromMessage(message('Kiddush for Example')).event.date,'2026-11-21');
 assert.equal(simchaFromMessage(message('Vort NOW at Example Hall')).event.date,'2026-11-20');
 assert.equal(simchaFromMessage(message('Chasuna TONIGHT Example Hall. Chupah 7:30')).event.time,'19:30');
});
test('followups match family and child while distinct families remain separate',async()=>{
 const {simchaMessagePreview}=await import('../js/calendar/simcha-message.js');
 const a=message('Rabbi & Mrs Example are making a Bar Mitzva for their son Shmuel Aryeh. Dessert reception 9:45 Tiferes Hall',{id:'dessert-1'});
 const b=message(a.text.replace('Example are','Example Smith are'),{id:'dessert-2',createdAt:'2026-11-20T18:05:00Z'});
 const other=message(b.text.replace('Example Smith','Other Jones'),{id:'dessert-3'});
 const preview=simchaMessagePreview([b,other,a]);assert.equal(preview.events.length,2);assert.equal(preview.review.length,0);assert.ok(preview.events.some(e=>e.details.includes('Example Smith')));
 const db=new Storage();await syncSimchaMessage(db,a);await syncSimchaMessage(db,b);await syncSimchaMessage(db,other);assert.equal((await db.list({prefix:'event:'})).size,2);assert.ok([...(await db.list({prefix:'event:'})).values()].some(e=>e.details.includes('Example Smith')));
 const original=message('Mazel tov R&M Example Smith on the engagement of their SON Yosef to Sarah Jones. Vort MONDAY 7:30pm Example Hall',{id:'vort-original',createdAt:'2026-11-14T18:00:00Z'});
 const reminder=message(original.text.replace('MONDAY 7:30pm','NOW'),{id:'vort-reminder',createdAt:'2026-11-17T01:12:00Z'});
 const vort=simchaMessagePreview([reminder,original]);assert.equal(vort.events.length,1);assert.equal(vort.events[0].time,'19:30');
});

test('generated event wording trims wishes without changing the original source or event facts',async()=>{
 const {simchaEventWording,simchaMessagePreview}=await import('../js/calendar/simcha-message.js');
 const source=message('Mazel Tov to Rabbi & Mrs Example Smith on the engagement of their SON Yosef to Sarah Jones. Vort TONIGHT 7:30pm Example Hall A May the Zivug Oleh Yafe');
 const parsed=simchaFromMessage(source);assert.equal(parsed.text,source.text);assert.match(parsed.event.details,/The vort will take place tonight at Example Hall/);assert.match(parsed.event.details,/Time: 7:30 PM/);assert.doesNotMatch(parsed.event.details,/May the/);assert.match(parsed.event.details,/^Mazel tov to Rabbi and Mrs\. Example Smith/);assert.match(parsed.event.details,/Yosef to Sarah Jones/);assert.equal(parsed.event.time,'19:30');
 assert.equal(simchaEventWording('Vort tonight Example Hall A. MTZOY'),'The vort will take place tonight at Example Hall A.');
 assert.equal(simchaEventWording('Vort tonight. May the Zivug Oleh Yafe. Entrance at 120 Park Ave'),'The vort will take place tonight.\nEntrance at 120 Park Ave');
 const preview=simchaMessagePreview([source],[{...parsed.event,details:source.text,id:'saved-event'}]);assert.equal(preview.events.length,0);assert.equal(preview.review.length,0);
 assert.equal(simchaEventWording('Bris tomorrow at 8:30am. May they be Zoche Legadlo Ltorah Lchupa Ulmassim Tovim'),'The bris will take place tomorrow.\n\nTime: 8:30 AM');
});

test('Rabbi and Mrs wording is consistent and saved short entries match original invitation text',async()=>{
 const {simchaEventWording,simchaRelation}=await import('../js/calendar/simcha-message.js');
 for(const text of ['R&M Example Smith','R & M Example Smith','Rabbi and Mrs Example Smith','Rabbi & Mrs. Example Smith']) assert.equal(simchaEventWording(text),'Rabbi and Mrs. Example Smith');
 const source=simchaFromMessage(message('Mazel Tov! Rabbi & Mrs Example Smith would like to be moidea the oilam that they are making a Bris TOMORROW Shacharis 7:10 NS')).event;
 const saved={...source,details:'Rabbi & Mrs Example Smith\nBris. Shacharis 7:10 AM, NS.'};assert.equal(simchaRelation(source,saved),'same');
});

const weddingSource = 'Rabbi & Mrs Example Smith on the marriage of their DAUGHTER. Chasuna TONIGHT Fountain Ballroom Chupa 7:30 SCVK 10pm';
const weddingWording = 'Mazel tov to Rabbi and Mrs. Example Smith on the marriage of their daughter!\n\nThe chasuna will take place tonight at Fountain Ballroom.\n\nChuppah: 7:30 PM\nSimchas Chosson V’Kallah: 10:00 PM';

test('the approved wedding wording keeps both milestones and uses the chuppah as the event start', async () => {
 const {calendarMessageWording}=await import('../js/calendar/message-wording.js');
 const original=message(weddingSource),before=JSON.stringify(original),parsed=simchaFromMessage(original);
 assert.equal(parsed.reason,'');assert.equal(parsed.event.details,weddingWording);
 assert.equal(parsed.event.time,'19:30');assert.equal(parsed.event.endTime,'');
 assert.equal(parsed.event.date,'2026-11-20');assert.equal(parsed.text,weddingSource);assert.equal(JSON.stringify(original),before);
 assert.equal(calendarMessageWording(weddingWording),weddingWording);
 const db=new Storage();await syncSimchaMessage(db,original);
 const duplicate=await syncSimchaMessage(db,message(weddingWording,{id:'polished-wedding-duplicate'}));
 assert.equal(duplicate.status,'duplicate');assert.equal((await db.list({prefix:'event:'})).size,1);
});

test('unknown wedding clocks remain for review, explicit periods win and SCVK is never an end time',()=>{
 for(const text of [
  'Chasuna tonight Chuppah 7:30 SCVK 10pm and dinner 8:30pm',
  'Chasuna today Chuppah 7:30 SCVK 10pm',
  'Chasuna tonight Chuppah 7:30pm Chuppah 8pm',
  'Chasuna tonight Chuppah 7:30pm SCVK 10pm SCVK 11pm',
  'Chasuna tonight Chuppah 7-8pm SCVK 10pm',
  'Chasuna tonight Chupa 7:3pm SCVK 10pm',
  'Chasuna tonight Chuppah time to follow SCVK 10pm',
  'Chasuna tonight Chuppah 12:30 SCVK 1am',
  'Vort tonight 12:30',
 ])assert(simchaFromMessage(message(text)).reason,text);
 const explicit=simchaFromMessage(message('Wedding today Chuppah 11:30am SCVK 2pm')).event;
 assert.equal(explicit.time,'11:30');assert.equal(explicit.endTime,'');assert.match(explicit.details,/Chuppah: 11:30 AM/);assert.match(explicit.details,/Simchas Chosson V’Kallah: 2:00 PM/);
});

test('message formatting handles common announcements, preserves unknown instructions and is stable', async()=>{
 const {calendarMessageWording}=await import('../js/calendar/message-wording.js');
 const fixtures=[
  ['Shalom Zachor for the Example family on 2026-11-27 at 9pm','Shalom Zachor for the Example family\n\nDate: Friday, November 27, 2026\nTime: 9:00 PM'],
  ['Shiur TONIGHT 8pm Main Shul','The shiur will take place tonight at Main Shul.\n\nTime: 8:00 PM'],
  ['Mazel tov to the Example family on their simcha!','Mazel tov to the Example family on their simcha!'],
  ['Mazel Tov!','Mazel tov!'],
  ['Chasuna TONIGHT CANCELLED','Chasuna TONIGHT CANCELLED'],
  ['Vort Monday November 30 at 8pm','Vort Monday November 30 at 8pm'],
  ['Please use the side entrance.\n\nContact the office at 848-555-0123.','Please use the side entrance.\n\nContact the office at 848-555-0123.'],
  ['Rabbi & Mrs Example Smith on the marriage of their daughter S. Jones. Chasuna tonight Hall A', 'Mazel tov to Rabbi and Mrs. Example Smith on the marriage of their daughter S. Jones!\n\nThe chasuna will take place tonight at Hall A.'],
 ];
 for(const [source,expected]of fixtures){assert.equal(calendarMessageWording(source),expected);assert.equal(calendarMessageWording(expected),expected);}
});

test('saved imported entries polish in presentation without modifying hand-edited or original events', async()=>{
 const {simchaEventPresentation}=await import('../js/calendar/simcha-message.js');
 const source={...simchaFromMessage(message(weddingSource)).event,details:weddingSource,time:'22:00',updatedBy:'simcha-message-import'};
 const before=JSON.stringify(source),view=simchaEventPresentation(source);
 assert.equal(view.details,weddingWording);assert.equal(view.time,'19:30');assert.equal(JSON.stringify(source),before);
 const manual={...source,updatedBy:'calendar-owner',details:'My own invitation wording'};
 assert.equal(simchaEventPresentation(manual),manual);
});

test('a previous parser revision can refresh an untouched import but never overwrite an owner edit',async()=>{
 const db=new Storage(),source=message(weddingSource),record=await syncSimchaMessage(db,source);
 const key='simcha-source:'+source.id,old=await db.get('event:'+record.eventId);
 await db.put(key,{...record,parserVersion:2});await db.put('event:'+old.id,{...old,details:weddingSource,time:'22:00'});
 const refreshed=await syncSimchaMessage(db,source);assert.equal(refreshed.parserVersion,3);assert.equal((await db.get('event:'+old.id)).details,weddingWording);
 const edited={...(await db.get('event:'+old.id)),details:'Owner wording',revision:3,updatedBy:'calendar-owner'};
 await db.put('event:'+old.id,edited);await db.put(key,{...refreshed,parserVersion:2});
 assert.equal((await syncSimchaMessage(db,source)).status,'review');assert.equal((await db.get('event:'+old.id)).details,'Owner wording');
});
