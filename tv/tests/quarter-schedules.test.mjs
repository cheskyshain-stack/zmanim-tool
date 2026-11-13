import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot} from '../src/schedules.js';
import {createOfflineSeed} from '../src/offline-seed.js';
import {offlineSnapshot} from '../public/display-assets/offline-engine.js';
import {quarterSchedule,eventMarks,PRAYER_HOLD_MS,ZMAN_HOLD_MS} from '../public/display-assets/quarter-schedules.js';
import {localStamp,localToISO} from '../public/display-assets/time.js';

const atOffset=(at,offset)=>new Date(Date.parse(at)+offset).toISOString();
const viewAt=at=>quarterSchedule(scheduleSnapshot(at),at);
const flattened=view=>view.groups.flatMap(group=>group.events);
const times=group=>group.events.map(event=>event.time);

test('each of nine source dates has unchanged zmanim clocks with exact instants across winter, summer and DST transitions',()=>{
  for(const date of ['2026-11-15','2027-07-07','2027-03-14','2026-11-01']) {
    const schedule=scheduleSnapshot(localToISO(date+'T00:00'));
    assert.equal(schedule.displayDays.length,9);
    assert.equal(schedule.displayDays[1].date,date);
    for(const day of schedule.displayDays) {
      assert.ok(day.hebrewTitle);
      assert.ok(day.hebrewDate);
      assert.equal(day.zmanim.length,11);
      assert.equal(new Set(day.zmanim.map(zman=>zman.key)).size,11);
      for(const zman of day.zmanim) {
        assert.equal(localStamp(zman.at).slice(0,10),day.date);
        const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(zman.at)).replace(/\s[AP]M$/,'');
        assert.equal(clock,zman.time);
      }
      assert.ok(day.zmanim.every((zman,index)=>index===0 || zman.at>day.zmanim[index-1].at));
    }
    assert.deepEqual(schedule.zmanim,schedule.displayDays[1].zmanim);
  }
});

test('every zman stays for thirty minutes, then later dates remain in chronological order',()=>{
  const at=localToISO('2026-11-15T00:00'),schedule=scheduleSnapshot(at);
  const dawn=schedule.zmanim[0],noon=schedule.zmanim.find(zman=>zman.key==='solarNoon'),last=schedule.zmanim.at(-1);
  assert.equal(quarterSchedule(schedule,at).zmanim.length,11);
  for(const elapsed of [0,ZMAN_HOLD_MS-1,ZMAN_HOLD_MS])
    assert.ok(quarterSchedule(schedule,atOffset(dawn.at,elapsed)).zmanim.some(zman=>zman.sourceKey===dawn.key));
  const afterDawn=quarterSchedule(schedule,atOffset(dawn.at,ZMAN_HOLD_MS+1));
  assert.equal(afterDawn.zmanim.length,10);
  assert.ok(!afterDawn.zmanim.some(zman=>zman.sourceKey===dawn.key));
  const afterNoon=quarterSchedule(schedule,atOffset(noon.at,ZMAN_HOLD_MS+1));
  assert.deepEqual(afterNoon.zmanim.map(zman=>zman.sourceKey),['sunset','tzaisGeonim8_5','tzais72']);
  const late=quarterSchedule(schedule,atOffset(last.at,ZMAN_HOLD_MS+1));
  assert.equal(late.zmanimState,'finished');
  assert.equal(late.zmanDays[0].date,'2026-11-16');
  assert.equal(late.zmanDays[0].relativeLabel,'מחר');
  assert.equal(late.zmanDays[0].zmanim.length,11);
  assert.deepEqual(late.zmanDays.map(day=>day.date),[...late.zmanDays.map(day=>day.date)].sort());
});

test('all published prayer times and room marks remain until one hour after the last time of that prayer',()=>{
  const at=localToISO('2026-11-15T05:00'),schedule=scheduleSnapshot(at),view=quarterSchedule(schedule,at);
  assert.deepEqual(view.groups.map(group=>group.label),['שחרית','מנחה','מעריב']);
  assert.deepEqual(flattened(view).map(event=>[event.at,event.time,event.name,event.place]),schedule.today.events.map(event=>[event.at,event.time,event.name,event.place]));
  assert.deepEqual(view.groups[0].events.map(event=>event.mark),['','*','','','*','']);
  assert.deepEqual(view.groups[0].events.map(event=>event.underlined),[false,false,true,false,false,true]);
  for(const group of view.groups) {
    const last=group.events.at(-1);
    assert.equal(group.expiresAt,atOffset(last.at,PRAYER_HOLD_MS));
    for(const elapsed of [0,PRAYER_HOLD_MS-1,PRAYER_HOLD_MS]) {
      const held=quarterSchedule(schedule,atOffset(last.at,elapsed)).groups.find(candidate=>candidate.key===group.key);
      assert.deepEqual(times(held),times(group),'Earlier minyanim cannot disappear one by one');
    }
    const advanced=quarterSchedule(schedule,atOffset(last.at,PRAYER_HOLD_MS+1));
    assert.ok(!advanced.groups.some(candidate=>candidate.key===group.key));
  }
  assert.deepEqual(eventMarks({place:'באולם השמחות'}),{underlined:false,mark:'**'});
});

test('Mincha groups separated by a drasha share their source-day last-Mincha boundary',()=>{
  const at=localToISO('2027-04-17T05:00'),schedule=scheduleSnapshot(at),view=quarterSchedule(schedule,at);
  const minchas=view.groups.filter(group=>group.family==='mincha');
  assert.equal(minchas.length,2);
  assert.deepEqual(minchas.map(times),[['1:40','5:25'],['6:53','7:08']]);
  assert.equal(new Set(minchas.map(group=>group.expiresAt)).size,1);
  assert.equal(minchas[0].expiresAt,localToISO('2027-04-17T20:08'));
  const held=quarterSchedule(schedule,minchas[0].expiresAt);
  assert.deepEqual(held.groups.filter(group=>group.family==='mincha').map(times),minchas.map(times));
  assert.ok(!quarterSchedule(schedule,atOffset(minchas[0].expiresAt,1)).groups.some(group=>group.family==='mincha'));
});

test('special-day early Mincha and later Mincha keep their original labels and one prayer-family expiry',()=>{
  const at=localToISO('2026-10-02T04:00'),schedule=scheduleSnapshot(at),view=quarterSchedule(schedule,at);
  assert.equal(view.title,'הושענא רבה');
  assert.equal(view.sourceTitle,'Hoshana Rabbah');
  assert.deepEqual(view.groups.map(group=>group.label),['שחרית','מנחה עיו"ט','הדלקת נרות','מנחה','מעריב']);
  assert.equal(view.groups[0].events.at(-1).mark,'**');
  const minchas=view.groups.filter(group=>group.family==='mincha');
  assert.equal(new Set(minchas.map(group=>group.expiresAt)).size,1);
  assert.equal(minchas[0].expiresAt,localToISO('2026-10-02T19:22'));
  const candles=flattened(view).find(event=>event.auxiliary);
  assert.ok(flattened(quarterSchedule(schedule,atOffset(candles.at,ZMAN_HOLD_MS))).some(event=>event.key===candles.key));
  assert.ok(!flattened(quarterSchedule(schedule,atOffset(candles.at,ZMAN_HOLD_MS+1))).some(event=>event.key===candles.key));
});

test('yesterday retains its full midnight Maariv for one hour with stable source-day identity',()=>{
  const midnight='2026-09-29T04:00:00.000Z';
  const before=viewAt(atOffset(midnight,-1)).prayerDays.find(day=>day.date==='2026-09-28');
  const full=before.groups.find(group=>group.family==='maariv');
  const held=viewAt(atOffset(midnight,PRAYER_HOLD_MS));
  const yesterday=held.prayerDays.find(day=>day.date==='2026-09-28');
  assert.equal(held.date,'2026-09-29');
  assert.equal(yesterday.relativeLabel,'אתמול');
  assert.equal(yesterday.groups[0].key,full.key);
  assert.deepEqual(times(yesterday.groups[0]),times(full));
  assert.equal(times(full).length,11);
  const later=viewAt(atOffset(midnight,PRAYER_HOLD_MS+1));
  assert.equal(later.prayerDays[0].date,'2026-09-29');
  assert.ok(!later.prayerDays.some(day=>day.date==='2026-09-28'));
  assert.equal(later.prayerDays[0].groups[0].label,'שחרית');
});

test('next-minyan selection still advances after five minutes, independently of one-hour prayer visibility',()=>{
  const at=localToISO('2026-11-15T06:59'),schedule=scheduleSnapshot(at),first=schedule.next;
  assert.equal(scheduleSnapshot(atOffset(first.at,300000)).next.at,first.at);
  assert.notEqual(scheduleSnapshot(atOffset(first.at,300001)).next.at,first.at);
  const held=viewAt(atOffset(first.at,300001)).groups.find(group=>group.family==='shacharis');
  assert.deepEqual(times(held),['7:00','7:20','7:35','8:00','8:20','8:40']);
});

test('successive dates use their own Hebrew titles and dates with an explicit tomorrow label',()=>{
  const at=localToISO('2026-09-25T19:00'),schedule=scheduleSnapshot(at),view=quarterSchedule(schedule,at);
  const today=view.prayerDays.find(day=>day.date==='2026-09-25'),tomorrow=view.prayerDays.find(day=>day.date==='2026-09-26');
  assert.equal(today.title,'יום ו׳');
  assert.equal(today.relativeLabel,'היום');
  assert.equal(tomorrow.title,'שבת קודש · יום א׳ סוכות');
  assert.equal(tomorrow.relativeLabel,'מחר');
  assert.notEqual(today.hebrewDate,tomorrow.hebrewDate);
  assert.equal(schedule.hebrewDate,tomorrow.hebrewDate,'The current evening header has advanced while the source date heading stays fixed');
  assert.notEqual(today.hebrewDate,schedule.hebrewDate);
  assert.equal(view.zmanDays.find(day=>day.date===tomorrow.date).hebrewDate,tomorrow.hebrewDate);
  assert.deepEqual(view.prayerDays.map(day=>day.date),[...view.prayerDays.map(day=>day.date)].sort());
});

test('Shabbos drashas and Plag details keep their correct names and cannot become the Next Minyan',()=>{
  for(const [date,time] of [['2027-04-17','5:55'],['2026-09-19','5:15']]) {
    const at=localToISO(date+'T05:00'),view=viewAt(at);
    const drasha=flattened(view).find(event=>event.name==='דרשה');
    assert.equal(drasha.time,time);
    assert.equal(drasha.auxiliary,true);
    assert.ok(!flattened(view).some(event=>event.name==='מנחה'&&event.at===drasha.at));
    assert.notEqual(scheduleSnapshot(atOffset(drasha.at,-60000)).next.at,drasha.at);
  }
  const friday=viewAt(localToISO('2027-04-16T05:00'));
  const plags=friday.groups.filter(group=>group.events.some(event=>event.plag));
  assert.deepEqual(plags.map(group=>group.label),['פלג גר"א','פלג מ"א','פלג מ"א 72']);
  assert.deepEqual(plags.map(group=>group.events[0].time),['6:14','6:49','7:09']);
  const shema=flattened(viewAt(localToISO('2027-04-17T05:00'))).filter(event=>event.reckoning);
  assert.deepEqual(shema.map(event=>[event.reckoning,event.time]),[['מ״א','9:00'],['גר״א','9:36']]);
});

test('finished source dates drop out while unavailable special sources remain explicit without invented times',()=>{
  const at=localToISO('2026-11-15T05:00'),schedule=scheduleSnapshot(at);
  const late=quarterSchedule(schedule,localToISO('2026-11-16T00:01'));
  assert.equal(late.state,'finished');
  assert.equal(late.zmanimState,'finished');
  assert.equal(late.expiredCount,late.eventCount);
  assert.equal(late.prayerDays[0].date,'2026-11-16');
  const unavailable=quarterSchedule({date:'2027-06-11',today:{date:'2027-06-11',hebrewTitle:'יום א׳ שבועות',hebrewDate:'ו׳ סיון, תשפ״ז',events:[],note:'Please confirm special times with the shul.'},zmanim:[]},'2027-06-11T16:00:00Z');
  assert.equal(unavailable.state,'unavailable');
  assert.equal(unavailable.prayerDays[0].title,'יום א׳ שבועות');
  assert.equal(unavailable.prayerDays[0].note,'Please confirm special times with the shul.');
  assert.equal(unavailable.prayerDays[0].groups.length,0);
});

test('older cached zmanim stay visible when no absolute instant exists',()=>{
  const zmanim=[{label:'נץ',time:'6:50:17'},{label:'שקיעה',time:'6:43:54'}];
  const view=quarterSchedule({date:'2026-11-15',zmanim},'2026-11-16T04:59:00Z');
  assert.deepEqual(view.zmanim.map(zman=>zman.time),zmanim.map(zman=>zman.time));
  assert.notEqual(view.zmanim[0].key,view.zmanim[1].key);
});

test('upcoming source dates use a published future override and match that date when it becomes live',()=>{
  const control={id:'future-control',kind:'schedule',status:'published',title:'Approved Erev Yom Kippur',startsAt:localToISO('2026-09-20T00:00'),endsAt:localToISO('2026-09-21T00:00'),data:{source:'yk:5787',appliesFrom:'2026-09-20',appliesTo:'2026-09-20',portion:'all',precedence:50}};
  const before=localToISO('2026-09-19T12:00'),future=scheduleSnapshot(before,[control]);
  assert.deepEqual(future.today,scheduleSnapshot(before).today,'Tomorrow cannot change today before activation');
  const tomorrow=future.displayDays.find(day=>day.date==='2026-09-20');
  assert.equal(tomorrow.title,control.title);
  const live=scheduleSnapshot(localToISO('2026-09-20T12:00'),[control]).today;
  const {zmanim,...dated}=tomorrow;
  assert.deepEqual(dated,live);
  const late=scheduleSnapshot(localToISO('2026-09-19T23:59'),[control]);
  const upcoming=late.displayDays.find(day=>day.date==='2026-09-20');
  assert.deepEqual(late.next,upcoming.events.find(event=>!event.auxiliary),'Next Minyan and the upcoming daily panel use the same controlled source');
  for(const status of ['draft','hidden','archived'])assert.notEqual(scheduleSnapshot(before,[{...control,status}]).displayDays.find(day=>day.date==='2026-09-20').title,control.title);
  assert.equal(scheduleSnapshot(before,[control]).displayDays.find(day=>day.date==='2026-09-20').title,control.title,'Live and future cache entries cannot contaminate each other');
});

test('dated controls must overlap the actual event, not merely some time on its civil date',()=>{
  const control={id:'off-window',kind:'schedule',status:'published',title:'Not active at Maariv',startsAt:localToISO('2026-09-28T12:01'),endsAt:localToISO('2026-09-28T12:02'),data:{source:'sukkos:5787',appliesFrom:'2026-09-28',appliesTo:'2026-09-28',portion:'maariv',precedence:90}};
  const before=localToISO('2026-09-27T12:00');
  const actual=scheduleSnapshot(before,[control]).displayDays.find(day=>day.date==='2026-09-28');
  const ordinary=scheduleSnapshot(before).displayDays.find(day=>day.date==='2026-09-28');
  assert.deepEqual(actual,ordinary);
});

test('yesterday keeps its published source control through the retained midnight Maariv',()=>{
  const control={id:'overnight-control',kind:'schedule',status:'published',title:'Approved Monday Maariv',startsAt:localToISO('2026-09-28T00:00'),endsAt:localToISO('2026-09-29T00:01'),data:{source:'sukkos:5787',appliesFrom:'2026-09-28',appliesTo:'2026-09-28',portion:'maariv',precedence:50}};
  const at=localToISO('2026-09-29T00:30'),view=quarterSchedule(scheduleSnapshot(at,[control]),at);
  const yesterday=view.prayerDays.find(day=>day.date==='2026-09-28');
  assert.equal(yesterday.sourceTitle,control.title);
  assert.equal(yesterday.groups[0].events.length,11);
  assert.equal(yesterday.groups[0].expiresAt,localToISO('2026-09-29T01:00'));
});

test('combined Mincha and Maariv remains through the later expiry of both prayer families',()=>{
  const at=localToISO('2026-11-13T05:00'),schedule=scheduleSnapshot(at),view=quarterSchedule(schedule,at);
  const combined=view.groups.find(group=>/מנחה/.test(group.label)&&/מעריב/.test(group.label));
  assert.ok(combined);
  assert.deepEqual(combined.families,['mincha','maariv']);
  const maarivEnd=Math.max(...schedule.today.events.filter(event=>!event.auxiliary&&/מעריב/.test(event.name)).map(event=>Date.parse(event.at)))+PRAYER_HOLD_MS;
  assert.equal(Date.parse(combined.expiresAt),maarivEnd);
  assert.ok(quarterSchedule(schedule,new Date(maarivEnd).toISOString()).groups.some(group=>group.key===combined.key));
  assert.ok(!quarterSchedule(schedule,new Date(maarivEnd+1).toISOString()).groups.some(group=>group.key===combined.key));
});

test('offline seed retains only recent ended schedule controls needed for source-day carryover',()=>{
  const at=localToISO('2026-09-29T00:30');
  const schedule={id:'recent-control',kind:'schedule',status:'published',title:'Approved Monday Maariv',startsAt:localToISO('2026-09-28T00:00'),endsAt:localToISO('2026-09-29T00:01'),data:{source:'sukkos:5787',appliesFrom:'2026-09-28',appliesTo:'2026-09-28',portion:'maariv',precedence:50}};
  const notice={id:'old-notice',kind:'announcement',status:'published',title:'Ended notice',startsAt:schedule.startsAt,endsAt:schedule.endsAt,data:{message:'Do not show early or after expiry.'}};
  const sponsor={...notice,id:'old-sponsor',kind:'dedication',data:{sponsor:'Ended sponsor'}};
  const older={...schedule,id:'older-control',data:{...schedule.data,appliesFrom:'2026-09-27',appliesTo:'2026-09-27'}};
  const seed=createOfflineSeed([schedule,notice,sponsor,older],{mode:'dark',darkStart:'19:00',lightStart:'07:00'},at);
  assert.deepEqual(seed.items.map(item=>item.id),['recent-control']);
  const view=quarterSchedule(offlineSnapshot(seed,at).schedule,at);
  assert.equal(view.prayerDays[0].sourceTitle,schedule.title);
});
