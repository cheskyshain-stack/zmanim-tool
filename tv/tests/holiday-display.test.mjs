import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayDisplayRows } from '../src/holiday-display.js';
import { settings } from '../src/schedules.js';
import { dateFromHebrew, excelWeekday } from '../../js/hebrew-calendar.js';
import { buildRoshHashanaPoster } from '../../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../../js/posters/yomkippur.js';
import { buildSukkosPoster } from '../../js/posters/sukkos.js';
import { buildPesachPoster } from '../../js/posters/pesach.js';
import { buildTzomGedaliaPoster } from '../../js/posters/tzomgedalia.js';

const builders={rh:buildRoshHashanaPoster,yk:buildYomKippurPoster,sukkos:buildSukkosPoster,pesach:buildPesachPoster,gedalia:buildTzomGedaliaPoster};
const rows=(key,year=5787)=>holidayDisplayRows(key,builders[key](year,settings),year,settings);
const byCalc=(list,calc)=>list.filter(row=>row.sourceCalc===calc);

test('twenty years of printed holiday prayer clocks retain the original civil day and instant',()=>{
  let checked=0;
  for(let year=5787;year<5807;year++)for(const [key,build] of Object.entries(builders)){
    const poster=build(year,settings),output=holidayDisplayRows(key,poster,year,settings);
    for(const row of output){
      assert.ok(Number.isInteger(row.serial),row.id);
      assert.ok(Number.isFinite(row.atMinutes),row.id);
      assert.ok(Number.isFinite(row.throughMinutes),row.id);
      for(const time of row.times){
        assert.equal('trace' in time,false);
        if(!/^\d{1,2}:\d{2}$/.test(time.text)){assert.equal(time.mins,undefined);continue;}
        assert.ok(Number.isInteger(time.mins));
        if(time.role!=='prayer'||row.sourceCalc.startsWith('after'))continue;
        assert.ok(poster.minyanim.some(event=>event.serial===row.serial&&event.mins===time.mins),`${key}:${year} ${row.sourceCalc} ${row.serial} ${time.text}`);
        checked++;
      }
    }
  }
  assert.ok(checked>5000);
});

test('Rosh Hashana retains Hamelech, shofar and untimed drashas without offering them as prayers',()=>{
  const list=rows('rh'),first=dateFromHebrew(1,7,5787);
  assert.deepEqual(byCalc(list,'hamelech').map(row=>[row.serial,row.times[0].text,row.role]),[[first,'8:30','information'],[first+1,'8:30','information']]);
  const night=byCalc(list,'nightDrasha')[0];
  assert.equal(night.serial,first-1);assert.equal(night.times[0].text,'7:40');
  const before=byCalc(list,'drashaBeforeMusaf')[0];
  assert.equal(before.times.length,0);assert.ok(before.anchorId);
  assert.equal(byCalc(list,'shofar')[0].times[0].mins,700);
  assert.equal(byCalc(list,'shofarWomen')[0].times[0].mins,905);
});

test('Yom Kippur opening night is the preceding civil date and textual Kiddush Levana is preserved',()=>{
  const list=rows('yk'),day=dateFromHebrew(10,7,5787);
  for(const calc of ['candles','erevShkia','kolNidrei','nightDrasha','nightMaariv'])assert.equal(byCalc(list,calc)[0].serial,day-1,calc);
  assert.equal(byCalc(list,'neila')[0].role,'prayer');
  assert.equal(byCalc(list,'yizkor')[0].times[0].text,'11:50');
  assert.deepEqual(byCalc(list,'kiddushLevana')[0].times.map(time=>[time.text,time.mins]),[['אחר מעריב',undefined],['10:30',1350]]);
});

test('Sukkos retains Hoshana Rabba night, following Maariv, sunrise note and relative Mincha',()=>{
  const list=rows('sukkos'),hoshana=dateFromHebrew(21,7,5787);
  const mishna=byCalc(list,'mishna')[0],maariv=byCalc(list,'mishnaMaariv')[0];
  assert.equal(mishna.serial,hoshana-1);assert.equal(mishna.times[0].mins,1200);assert.equal(mishna.times[0].mark,'*');
  assert.equal(maariv.serial,hoshana-1);assert.equal(maariv.times.length,0);assert.equal(maariv.anchorId,mishna.id);
  assert.equal(byCalc(list,'hoshanaShacharis')[0].note,'(נץ 6:54)');
  assert.deepEqual(byCalc(list,'simchasMincha')[0].times.map(time=>time.text),['מיד אחר מוסף','6:14']);
  assert.equal(byCalc(list,'simchasShacharis')[0].times[0].mins,495);
  assert.equal(byCalc(list,'simchasShacharis')[0].family,'shacharis');
  assert.deepEqual(byCalc(list,'yizkor')[0].times.map(time=>time.text),['9:40','11:05']);
});

test('Pesach keeps the chametz deadlines, midnight, and the distinction between Mincha and Plag',()=>{
  const list=rows('pesach'),erev=dateFromHebrew(14,1,5787);
  assert.equal(byCalc(list,'achila')[0].serial,erev);assert.equal(byCalc(list,'achila')[0].times[0].mins,617);
  assert.equal(byCalc(list,'biur')[0].times[0].mins,696);
  assert.equal(byCalc(list,'chatzos')[0].serial,erev+1);assert.equal(byCalc(list,'chatzos')[0].times[0].mins,56);
  assert.deepEqual(byCalc(list,'earlyMincha')[0].times.map(time=>time.role),['prayer','information']);
  assert.deepEqual(byCalc(list,'earlyMincha')[0].times.map(time=>time.reckoning),['מנחה','פלג']);
  assert.equal(byCalc(list,'neila')[0].role,'information');
});

test('Tzom Gedalia retains its source sunset between Mincha and Maariv',()=>{
  const list=rows('gedalia');
  assert.deepEqual(list.map(row=>row.label),['סליחות','מנחה','שקיעה','מעריב']);
  assert.equal(byCalc(list,'shkia')[0].times[0].text,'7:07');
  assert.equal(byCalc(list,'shkia')[0].role,'information');
});

test('every source row retains its full visible text, notes, and room marks without markup leakage',()=>{
  const normalized=time=>({text:String(time.text??''),underlined:Boolean(time.underlined),mark:String(time.mark||''),...(time.name?{reckoning:String(time.name)}:{})});
  for(let year=5787;year<5807;year++)for(const [key,build] of Object.entries(builders)){
    const poster=build(year,settings),output=holidayDisplayRows(key,poster,year,settings);
    const original=[...poster.erevLines||[],...poster.dayLines||[],...(poster.blocks||[]).flatMap(block=>block.lines),...(poster.sets||[]).map(value=>value.note?{label:value.note.label,times:[{text:value.note.text}]}:{label:value.head,times:value.lines.flat()})];
    for(const row of [...original,...original.map(row=>row.extra).filter(Boolean)]){
      const match=output.find(candidate=>candidate.label===row.label&&JSON.stringify(candidate.times.map(({text,underlined,mark,reckoning})=>({text,underlined,mark,...(reckoning?{reckoning}:{})})))===JSON.stringify((row.times||[]).map((time,index)=>({...normalized(time),...(row.calc==='earlyMincha'?{reckoning:index===0?'מנחה':'פלג'}:{})}))));
      assert.ok(match,`${key}:${year} omitted printed row ${row.label}`);
      for(const field of ['note','sub','sep'])if(row[field]!=null)assert.equal(match[field],String(row[field]));
    }
    for(const row of output)for(const text of [row.label,row.note,row.sub,...row.times.map(time=>time.text)].filter(Boolean))assert.doesNotMatch(text,/[\uE000-\uF8FF]|<[^>]+>|&(?:[a-z]+|#\d+);/i);
  }
});


test('Pesach Friday and Erev Shevii keep their CHM morning without inheriting the weekday afternoon',()=>{
  let fridayCount=0;
  for(let year=5787;year<5807;year++){
    const list=rows('pesach',year);
    for(let hebrewDay=17;hebrewDay<=20;hebrewDay++){
      const serial=dateFromHebrew(hebrewDay,1,year),weekday=excelWeekday(serial);
      if(weekday===7)continue;
      const morning=byCalc(list,'chmShacharis').filter(row=>row.serial===serial);
      assert.equal(morning.length,1,`${year} Nisan ${hebrewDay} morning`);
      if(weekday===6||hebrewDay===20){
        assert.equal(byCalc(list,'chmMincha').filter(row=>row.serial===serial).length,0);
        assert.equal(byCalc(list,'chmMaariv').filter(row=>row.serial===serial).length,0);
      }
      if(weekday===6)fridayCount++;
    }
  }
  assert.ok(fridayCount>0);
});

test('heading-only Eiruv reminders stay on the Erev date until its source candles, with no invented clock',()=>{
  const cases=[['rh',5789,[[29,6,5788]]],['sukkos',5789,[[14,7,5789],[21,7,5789]]],['pesach',5787,[[14,1,5787]]],['pesach',5789,[[20,1,5789]]]];
  for(const [key,year,dates] of cases){
    const list=rows(key,year),reminders=byCalc(list,'eiruv');
    assert.deepEqual(reminders.map(row=>row.serial),dates.map(parts=>dateFromHebrew(...parts)),`${key}:${year}`);
    for(const reminder of reminders){
      assert.equal(reminder.label,'עירוב תבשילין');assert.equal(reminder.role,'information');assert.deepEqual(reminder.times,[]);
      const anchor=list.find(row=>row.id===reminder.anchorId);
      assert.equal(anchor.sourceCalc,'candles');assert.equal(anchor.serial,reminder.serial);
      assert.equal(reminder.throughMinutes,anchor.throughMinutes);
    }
  }
  assert.equal(byCalc(rows('rh',5787),'eiruv').length,0);
});

test('Shir Hashirim reminder belongs to Shabbos Chol Hamoed morning and follows the printed heading',()=>{
  const list=rows('pesach',5787),reminder=byCalc(list,'shirHashirim')[0];
  assert.equal(reminder.serial,dateFromHebrew(17,1,5787));assert.equal(reminder.label,'שיר השירים');assert.deepEqual(reminder.times,[]);
  const anchor=list.find(row=>row.id===reminder.anchorId);
  assert.equal(anchor.sourceCalc,'shabbosShacharis');assert.equal(anchor.serial,reminder.serial);
  assert.equal(byCalc(rows('pesach',5789),'shirHashirim').length,0);
});

test('Hoshana Rabba uses its own morning and Erev Shemini Atzeres afternoon',()=>{
  const list=rows('sukkos',5789),serial=dateFromHebrew(21,7,5789);
  assert.equal(byCalc(list,'hoshanaShacharis').filter(row=>row.serial===serial).length,1);
  assert.equal(byCalc(list,'chmShacharis').filter(row=>row.serial===serial).length,0);
  assert.equal(byCalc(list,'chmMincha').filter(row=>row.serial===serial).length,0);
  assert.equal(byCalc(list,'chmMaariv').filter(row=>row.serial===serial).length,0);
  assert.equal(byCalc(list,'erevMincha').filter(row=>row.serial===serial).length,1);
});
