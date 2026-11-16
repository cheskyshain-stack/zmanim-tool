import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot} from '../src/schedules.js';
import {quarterSchedule,PRAYER_HOLD_MS} from '../public/display-assets/quarter-schedules.js';
import {QuarterPanel} from '../public/display-assets/quarter-panels.js';
import {localToISO} from '../public/display-assets/time.js';

const viewAt = local => {
  const at=localToISO(local),schedule=scheduleSnapshot(at);
  return {at,schedule,view:quarterSchedule(schedule,at)};
};
const section = (view,key) => {
  const result=view.prayerSections.find(section=>section.key===key);
  assert.ok(result,'Missing section '+key);
  return result;
};
const group = (section,label,date) => {
  const result=section.groups.find(group=>group.label===label&&(!date||group.sourceDate===date));
  assert.ok(result,section.key+' must include '+label+' from '+date);
  return result;
};
const after = (at,ms) => new Date(Date.parse(at)+ms).toISOString();
const descriptors = view => QuarterPanel.prototype.descriptors.call({kind:'prayers'},view);

function assertPreserved(view) {
  const expected=view.prayerDays.flatMap(day=>day.groups.map(group=>({group,date:day.date})));
  const actual=view.prayerSections.flatMap(section=>section.groups);
  assert.equal(actual.length,expected.length,'Every visible prayer or informational row must survive grouping');
  for(let index=0;index<expected.length;index++) {
    const {sourceDate,...original}=actual[index];
    assert.equal(sourceDate,expected[index].date,'Fitting and retention must use the source date');
    assert.deepEqual(original,expected[index].group,'Do not change row order, prayer identity, times, marks or expiry');
  }
  const rows=descriptors(view);
  assert.equal(new Set(rows.map(row=>row.key)).size,rows.length,'Every mounted row and heading needs a unique stable key');
  for(const row of rows.filter(row=>row.type==='prayer')) {
    const original=actual.find(group=>'p:'+group.key===row.key);
    assert.equal(row.day,original.sourceDate,'A sacred tag must not move a row into a different full-day fitting quota');
  }
}

test('Friday Maariv begins one Shabbos section that continues with Shabbos morning',()=>{
  const {view}=viewAt('2026-11-20T15:10');
  const erev=section(view,'day:2026-11-20'),shabbos=section(view,'day:2026-11-21');
  assert.equal(erev.title,'ערב שבת');
  group(erev,'הדלקת נרות','2026-11-20');
  group(erev,'מנחה','2026-11-20');
  assert.ok(!erev.groups.some(group=>group.family==='maariv'));
  assert.equal(shabbos.title,'שבת');
  assert.equal(shabbos.groups[0].label,'מעריב');
  assert.equal(shabbos.groups[0].sourceDate,'2026-11-20');
  group(shabbos,'שחרית','2026-11-21');
  const closing=section(view,'motzai:2026-11-21');
  assert.equal(closing.title,'מוצאי שבת');
  assert.equal(closing.groups[0].label,'מעריב');
  assert.equal(view.prayerSections.filter(candidate=>candidate.key===shabbos.key).length,1);
  assertPreserved(view);
});

test('each Rosh Hashanah day starts at its opening Maariv and the final Maariv is Motzaei Yom Tov',()=>{
  const {view}=viewAt('2026-09-11T15:00');
  for(const [date,previous,title] of [
    ['2026-09-12','2026-09-11','שבת · יום א׳ ראש השנה'],
    ['2026-09-13','2026-09-12','יום ב׳ ראש השנה'],
  ]) {
    const sacred=section(view,'day:'+date);
    assert.equal(sacred.title,title);
    assert.equal(sacred.groups[0].label,'מעריב');
    assert.equal(sacred.groups[0].sourceDate,previous);
    group(sacred,'שחרית',date);
  }
  assert.ok(!view.prayerSections.some(candidate=>candidate.key==='motzai:2026-09-12'),'A continuing second Yom Tov is not Motzaei');
  const closing=section(view,'motzai:2026-09-13');
  assert.equal(closing.title,'מוצאי יום טוב');
  assert.deepEqual(group(closing,'מעריב').events.map(event=>event.time),['8:09','8:21']);
  assertPreserved(view);
});

test('Shemini Atzeres on Shabbos transitions directly into Simchas Torah at Maariv',()=>{
  const {view}=viewAt('2026-10-03T15:00');
  const next=section(view,'day:2026-10-04');
  assert.equal(next.title,'שמחת תורה');
  assert.equal(next.groups[0].label,'מעריב');
  assert.equal(next.groups[0].sourceDate,'2026-10-03');
  group(next,'שחרית','2026-10-04');
  assert.ok(!view.prayerSections.some(candidate=>candidate.key==='motzai:2026-10-03'));
  assert.equal(section(view,'motzai:2026-10-04').title,'מוצאי יום טוב');
  assertPreserved(view);
});

test('Kol Nidrei opens Yom Kippur and subsequent night information stays under that heading',()=>{
  const {view}=viewAt('2026-09-20T15:00');
  const erev=section(view,'day:2026-09-20'),yk=section(view,'day:2026-09-21');
  group(erev,'הדלקת נרות','2026-09-20');
  assert.equal(yk.title,'יום כיפור');
  assert.equal(yk.groups[0].label,'כל נדרי');
  for(const label of ['שקיעה','דברי התעוררות מאת הרב שליט"א','מעריב']) group(yk,label,'2026-09-20');
  group(yk,'שחרית','2026-09-21');
  const closing=section(view,'motzai:2026-09-21');
  assert.equal(closing.title,'מוצאי יום כיפור');
  group(closing,'קידוש לבנה','2026-09-21');
  assertPreserved(view);
});

test('closing information retains its Motzaei heading after the opening Maariv row expires',()=>{
  const {view}=viewAt('2026-09-21T22:06');
  const closing=section(view,'motzai:2026-09-21');
  assert.equal(closing.title,'מוצאי יום כיפור');
  assert.ok(!closing.groups.some(group=>group.label==='מעריב'));
  assert.deepEqual(group(closing,'קידוש לבנה').events.map(event=>event.time),['אחר מעריב','10:30']);
  assertPreserved(view);
});

test('prayer-family grace and stable heading identities survive the evening-to-morning transition',()=>{
  const {schedule,view}=viewAt('2026-11-20T15:10');
  const shabbos=section(view,'day:2026-11-21'),maariv=group(shabbos,'מעריב','2026-11-20');
  const last=maariv.events.at(-1).at;
  const held=quarterSchedule(schedule,after(last,PRAYER_HOLD_MS));
  assert.deepEqual(group(section(held,shabbos.key),'מעריב','2026-11-20').events,maariv.events.map(event=>({...event,started:true})));
  const advanced=quarterSchedule(schedule,after(last,PRAYER_HOLD_MS+1));
  const morning=section(advanced,shabbos.key);
  assert.ok(!morning.groups.some(group=>group.sourceDate==='2026-11-20'));
  assert.equal(morning.groups[0].label,'שחרית');
  assert.equal(descriptors(held).find(row=>row.key===shabbos.key).html,descriptors(advanced).find(row=>row.key===shabbos.key).html,'The retained sacred heading must not flicker or change text');
  assertPreserved(held);
  assertPreserved(advanced);
});

test('a midnight weekday Maariv remains on its original source-day heading and expires with its family',()=>{
  const {view}=viewAt('2026-09-23T00:04');
  const carry=section(view,'day:2026-09-22'),maariv=group(carry,'מעריב','2026-09-22');
  assert.equal(carry.title,'יום ג׳');
  assert.equal(maariv.events.length,11);
  assert.equal(maariv.events.at(-1).time,'12:00');
  assert.equal(maariv.events.at(-1).at,localToISO('2026-09-23T00:00'));
  assert.ok(!viewAt('2026-09-23T00:06').view.prayerSections.some(candidate=>candidate.key===carry.key));
  assertPreserved(view);
});

test('a full year of display sections preserves all visible rows, source dates and unique mounting identities',()=>{
  let transitionDays=0;
  for(let offset=0;offset<365;offset++) {
    const date=new Date(Date.UTC(2026,8,1+offset)).toISOString().slice(0,10);
    const {view}=viewAt(date+'T00:00');
    assertPreserved(view);
    if(view.prayerSections.some(section=>section.key.startsWith('motzai:'))) transitionDays++;
  }
  assert.ok(transitionDays>100,'The audit must cover sacred transitions throughout the year');
});
