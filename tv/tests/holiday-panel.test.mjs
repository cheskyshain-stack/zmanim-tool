import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSnapshot,settings} from '../src/schedules.js';
import {buildSukkosPoster} from '../../js/posters/sukkos.js';
import {buildYomKippurPoster} from '../../js/posters/yomkippur.js';
import {quarterSchedule,ZMAN_HOLD_MS} from '../public/display-assets/quarter-schedules.js';
import {localToISO} from '../public/display-assets/time.js';
import {minyanKey} from '../public/display-assets/minyan-timing.js';

const viewAt=local=>{
  const at=localToISO(local),schedule=scheduleSnapshot(at);
  return {at,schedule,view:quarterSchedule(schedule,at)};
};
const items=view=>view.allGroups.flatMap(group=>group.events);
const after=(at,ms)=>new Date(Date.parse(at)+ms).toISOString();

test('a full year of holiday panels preserves every actual minyan identity exactly once',()=>{
  let holidayDays=0;
  for(let offset=0;offset<365;offset++) {
    const date=new Date(Date.UTC(2026,10,15+offset)).toISOString().slice(0,10);
    const {schedule,view}=viewAt(date+'T00:00');
    if(!schedule.today.displayRows?.length)continue;
    holidayDays++;
    const actual=schedule.today.events.filter(event=>!event.auxiliary).map(minyanKey).sort();
    const shown=items(view).filter(event=>!event.auxiliary).map(minyanKey).sort();
    assert.deepEqual(shown,actual,date+' must neither lose nor invent a real minyan');
    assert.equal(new Set(shown).size,shown.length,date+' must not duplicate a real minyan');
    for(const group of view.allGroups) {
      const text=[group.label,group.note,...group.events.flatMap(event=>[event.time,event.reckoning])].filter(Boolean).join('\n');
      assert.doesNotMatch(text,/<\/?[a-z][^>]*>|&(?:nbsp|amp|quot|#\d+);|[\uE000-\uF8FF]/i,date+' leaks no source formatting');
    }
  }
  assert.ok(holidayDays>=25,'The sweep must actually cover both holiday seasons');
});

test('Yizkor, Hamelech and timed drashas are shown but never become countdown targets',()=>{
  for(const [date,label,clocks] of [
    ['2026-10-03','יזכור בערך',['9:40','11:05']],
    ['2026-09-21','יזכור בערך',['11:50']],
    ['2026-09-12','המלך',['8:30']],
    ['2026-09-20','דברי התעוררות מאת הרב שליט"א',['7:40']],
  ]) {
    const {view}=viewAt(date+'T00:00');
    const row=view.allGroups.find(group=>group.label===label);
    assert.ok(row,date+' retains '+label);
    assert.deepEqual(row.events.map(event=>event.time),clocks);
    if(label==='יזכור בערך') {
      const printed=date==='2026-10-03'
        ? buildSukkosPoster(5787,settings).blocks.flatMap(block=>block.lines).find(line=>line.calc==='yizkor')
        : buildYomKippurPoster(5787,settings).dayLines.find(line=>line.calc==='yizkor');
      assert.deepEqual(row.events.map(event=>event.time),printed.times.map(time=>time.text),date+' agrees with the current authoritative printed chart');
    }
    for(const event of row.events) {
      assert.equal(event.auxiliary,true);
      assert.equal(minyanKey(event),'');
      const next=scheduleSnapshot(after(event.at,-60000)).next;
      assert.notEqual(next?.name,event.name,date+' must not announce an informational row as a minyan');
    }
  }
});

test('source notes and relative times remain complete without invented clocks',()=>{
  const hoshana=viewAt('2026-10-02T00:00').view;
  assert.match(hoshana.allGroups.find(group=>group.label==='שחרית').note,/נץ 6:54/);
  const simchas=viewAt('2026-10-04T00:00').view;
  const relative=items(simchas).find(event=>event.time==='מיד אחר מוסף');
  assert.ok(relative);
  assert.equal(relative.isText,true);
  assert.equal(relative.at,'');
  assert.equal(relative.auxiliary,true);
  const yk=viewAt('2026-09-21T00:00').view;
  const levana=yk.allGroups.find(group=>group.label==='קידוש לבנה');
  assert.deepEqual(levana.events.map(event=>event.time),['אחר מעריב','10:30']);
  assert.equal(levana.events[0].at,'');
  assert.equal(levana.events[0].auxiliary,true);
  assert.equal(Boolean(levana.events[1].auxiliary),false,'The existing source explicitly permits its actual 10:30 gathering');
  const drasha=yk.allGroups.find(group=>/קודם נעילה/.test(group.label));
  assert.ok(drasha);
  assert.equal(drasha.events.length,0,'The printed untimed drasha must not receive a guessed clock');
});

test('restored informational clocks expire after thirty minutes without changing the prayer-family hold',()=>{
  const {at,schedule,view}=viewAt('2026-10-03T00:00');
  const yizkor=view.allGroups.find(group=>group.label==='יזכור בערך').events[0];
  const atBoundary=quarterSchedule(schedule,after(yizkor.at,ZMAN_HOLD_MS));
  assert.ok(atBoundary.groups.some(group=>group.events.some(event=>event.key===yizkor.key)));
  const afterBoundary=quarterSchedule(schedule,after(yizkor.at,ZMAN_HOLD_MS+1));
  assert.ok(!afterBoundary.groups.some(group=>group.events.some(event=>event.key===yizkor.key)));
  assert.ok(afterBoundary.groups.find(group=>group.label==='יזכור בערך').events.some(event=>event.time==='11:05'));
  const shacharis=view.allGroups.find(group=>group.label==='שחרית');
  const last=shacharis.events.at(-1);
  const held=quarterSchedule(schedule,after(last.at,5*60000));
  assert.deepEqual(held.groups.find(group=>group.label==='שחרית').events.map(event=>event.time),['7:30','8:15']);
  assert.ok(!quarterSchedule(schedule,after(last.at,5*60000+1)).groups.some(group=>group.label==='שחרית'));
});

test('a future published holiday override carries the same printed details when its date becomes live',()=>{
  const control={id:'holiday-detail-control',kind:'schedule',status:'published',title:'Approved Erev Yom Kippur',
    startsAt:localToISO('2026-09-20T00:00'),endsAt:localToISO('2026-09-21T00:00'),
    data:{source:'yk:5787',appliesFrom:'2026-09-20',appliesTo:'2026-09-20',portion:'all',precedence:50}};
  const before=scheduleSnapshot(localToISO('2026-09-19T12:00'),[control]);
  const upcoming=before.displayDays.find(day=>day.date==='2026-09-20');
  const live=scheduleSnapshot(localToISO('2026-09-20T12:00'),[control]).today;
  assert.equal(upcoming.title,control.title);
  assert.deepEqual(upcoming.displayRows,live.displayRows);
  assert.ok(upcoming.displayRows.some(row=>row.sourceCalc==='nightDrasha'));
  const at=localToISO('2026-09-19T12:00');
  const upcomingView=quarterSchedule(before,at).allPrayerDays.find(day=>day.date===upcoming.date);
  assert.ok(upcomingView.allGroups.some(group=>group.label==='דברי התעוררות מאת הרב שליט"א'));
});
