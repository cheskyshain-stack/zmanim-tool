import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPesachPoster} from '../../js/posters/pesach.js';
import {buildSukkosPoster} from '../../js/posters/sukkos.js';
import {dateFromHebrew,excelWeekday} from '../../js/hebrew-calendar.js';
import {clockMins,placeOf} from '../../js/posters/minyanim.js';
import {resolveSettings,DEFAULT_SETTINGS} from '../../js/settings.js';
import published from '../../data/published.json' with {type:'json'};

const settings=resolveSettings({...DEFAULT_SETTINGS,...published.settings,timezoneId:'America/New_York'});
const family=name=>/שחרית/.test(name)?'shacharis':/מנחה/.test(name)?'mincha':/מעריב/.test(name)?'maariv':null;
const sorted=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function actual(poster,serial,wanted){
  return sorted(poster.minyanim.filter(e=>e.serial===serial&&wanted.includes(family(e.name)))
    .map(e=>[family(e.name),e.mins,e.place]));
}
function printed(lines,afternoon){
  return sorted(lines.flatMap(row=>{
    let previous=-1;
    const times=row.calc==='earlyMincha'?row.times.slice(0,1):row.times;
    return times.map(time=>{
      let mins=clockMins(time.text,afternoon);
      while(mins<=previous)mins+=720;
      previous=mins;
      return[family(row.label),mins,placeOf(time)];
    });
  }));
}
function erevRows(poster,heading){
  const block=poster.blocks.find(b=>b.heading.startsWith(heading));
  assert.ok(block,heading);
  return block.lines.filter(row=>['erevMincha','earlyMincha','candlesMincha','nightMaariv','maarivLmata'].includes(row.calc));
}

test('Pesach Friday April 14 2028 retains all three printed Chol Hamoed Shacharis options',()=>{
  const poster=buildPesachPoster(5788,settings),serial=dateFromHebrew(18,1,5788);
  assert.equal(excelWeekday(serial),6);
  assert.deepEqual(actual(poster,serial,['shacharis']),sorted([
    ['shacharis',420,'למטה'],['shacharis',480,''],['shacharis',520,'למטה'],
  ]));
});

test('Erev Shevii April 27 2027 uses its own afternoon and night without the full weekday run',()=>{
  const poster=buildPesachPoster(5787,settings),serial=dateFromHebrew(20,1,5787);
  assert.deepEqual(actual(poster,serial,['mincha','maariv']),printed(erevRows(poster,'שביעי של פסח'),true));
  assert.equal(poster.minyanim.some(e=>e.serial===serial&&e.name.includes('מעריב')&&e.mins>=21*60),false);
});

test('twenty Pesach seasons retain weekday and Friday mornings and dedicated Erev Shevii afternoons',()=>{
  for(let year=5787;year<5807;year++){
    const poster=buildPesachPoster(year,settings);
    const chm=poster.blocks.find(b=>b.heading==='חול המועד');
    assert.ok(chm);
    const mornings=printed(chm.lines.filter(r=>r.calc==='chmShacharis'),false);
    for(let day=17;day<=20;day++){
      const serial=dateFromHebrew(day,1,year),dow=excelWeekday(serial);
      if(dow!==7)assert.deepEqual(actual(poster,serial,['shacharis']),mornings,`${year} Nisan ${day} morning`);
      if(day<20&&dow!==6&&dow!==7){
        assert.deepEqual(actual(poster,serial,['mincha','maariv']),printed(chm.lines.filter(r=>['chmMincha','chmMaariv'].includes(r.calc)),true),`${year} Nisan ${day} ordinary afternoon`);
      }
    }
    const erev=dateFromHebrew(20,1,year);
    assert.deepEqual(actual(poster,erev,['mincha','maariv']),printed(erevRows(poster,'שביעי של פסח'),true),`${year} Erev Shevii`);
  }
});

test('Hoshana Rabba 5789 keeps its own morning and only the printed Erev Shemini afternoon and night',()=>{
  const poster=buildSukkosPoster(5789,settings),serial=dateFromHebrew(21,7,5789);
  const hoshana=poster.blocks.find(b=>b.heading==='הושענא רבה');
  assert.deepEqual(actual(poster,serial,['shacharis']),printed(hoshana.lines.filter(r=>r.calc==='hoshanaShacharis'),false));
  assert.deepEqual(actual(poster,serial,['mincha','maariv']),printed(erevRows(poster,'שמיני עצרת'),true));
  assert.equal(actual(poster,serial,['mincha','maariv']).length,7);
});

test('twenty Sukkos seasons use Hoshana Rabba ownership while retaining ordinary Chol Hamoed prayers',()=>{
  for(let year=5787;year<5807;year++){
    const poster=buildSukkosPoster(year,settings),serial=dateFromHebrew(21,7,year);
    const hoshana=poster.blocks.find(b=>b.heading==='הושענא רבה');
    assert.deepEqual(actual(poster,serial,['shacharis']),printed(hoshana.lines.filter(r=>r.calc==='hoshanaShacharis'),false),`${year} Hoshana morning`);
    assert.deepEqual(actual(poster,serial,['mincha','maariv']),printed(erevRows(poster,'שמיני עצרת'),true),`${year} Hoshana afternoon`);
    const chm=poster.blocks.find(b=>b.heading==='חול המועד');
    for(let day=17;day<21;day++){
      const on=dateFromHebrew(day,7,year),dow=excelWeekday(on);
      if(dow!==6&&dow!==7){
        assert.deepEqual(actual(poster,on,['mincha','maariv']),printed(chm.lines.filter(r=>['chmMincha','chmMaariv'].includes(r.calc)),true),`${year} Tishrei ${day} ordinary afternoon`);
      }
    }
  }
});
