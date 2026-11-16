import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeShabbosDisplayEvents} from '../src/shabbos-display.js';
import {buildKayitzRow,KAYITZ_COLUMNS} from '../../js/sheets/kayitz.js';
import {buildChorefRow,CHOREF_COLUMNS} from '../../js/sheets/choref.js';
import {weeklyAgenda} from '../../js/ui/weekly-agenda.js';
import {settings} from '../src/schedules.js';
import {excelSerial} from '../../js/zmanim/solar.js';

function sourceEvents(date, season) {
  const showing = excelSerial(new Date(date+'T12:00:00Z'));
  const week = {serial: showing, date: new Date(date+'T12:00:00Z'), parsha:'',specialParsha:''};
  const built = season === 'kayitz' ? buildKayitzRow(week,settings) : buildChorefRow(week,settings);
  const columns = season === 'kayitz' ? KAYITZ_COLUMNS : CHOREF_COLUMNS;
  const friday = new Set(season === 'kayitz' ? ['L','K','J','I','H','G','F'] : ['I','H','G','F']);
  const rows=columns.map(column=>({key:column.key,title:column.header.replace(/\n/g,' '),header:column.header,value:built[column.key],friday:friday.has(column.key)}));
  const agenda=weeklyAgenda({regular:[],special:[],shabbos:rows},showing,{},settings,new Date(Date.parse(date+'T00:00:00Z')-2*86400000));
  return {showing,rows,events:agenda.sections.flatMap(section=>section.events)};
}

test('winter and both Chanukah Fridays name their only G-column service Mincha',()=>{
  for(const date of ['2026-11-21','2026-12-05','2026-12-12']){
    const {showing,rows,events}=sourceEvents(date,'choref');
    const friday=events.filter(event=>event.serial===showing-1);
    const result=normalizeShabbosDisplayEvents(rows,showing,showing-1,friday);
    const main=result.filter(event=>event.cell==='G');
    assert.equal(main.length,1,date);
    assert.equal(main[0].name,'מנחה',date);
    assert.equal(main[0].auxiliary,false);
    assert.deepEqual(result.map(({name,auxiliary,...event})=>event),friday.map(({name,auxiliary,...event})=>event),'Every clock and room is preserved');
    assert.equal(result.filter(event=>event.cell==='F')[0].name,'מעריב');
  }
});

test('summer G-column explicit Maariv line is distinct from its earlier Mincha',()=>{
  const {showing,rows,events}=sourceEvents('2027-05-15','kayitz');
  assert.match(String(rows.find(row=>row.key==='G').value),/מעריב/);
  const friday=events.filter(event=>event.serial===showing-1);
  const result=normalizeShabbosDisplayEvents(rows,showing,showing-1,friday);
  const main=result.filter(event=>event.cell==='G');
  assert.deepEqual(main.map(event=>event.name),['מנחה','מעריב']);
  assert.ok(main[0].mins<main[1].mins);
  assert.deepEqual(main.map(event=>event.mins),friday.filter(event=>event.cell==='G').map(event=>event.mins));
  assert.ok(main.every(event=>!event.auxiliary));
});

test('Shabbos July21 2029 retains the printed 72-minute deadline as a zman, not Maariv',()=>{
  const {showing,rows,events}=sourceEvents('2029-07-21','kayitz');
  const shabbos=events.filter(event=>event.serial===showing);
  const result=normalizeShabbosDisplayEvents(rows,showing,showing,shabbos);
  const closing=result.filter(event=>event.cell==='B');
  assert.deepEqual(closing.map(event=>event.name),['דרשה','זמן 72','מעריב']);
  assert.deepEqual(closing.map(event=>event.auxiliary),[true,true,false]);
  assert.deepEqual(closing.map(event=>event.mins),shabbos.filter(event=>event.cell==='B').map(event=>event.mins));
});

test('edited prose and other source dates are not guessed into prayer labels',()=>{
  const event={cell:'G',mins:960,name:'מנחה מעריב',place:'למטה',auxiliary:false};
  const rows=[{key:'G',header:'מנחה\nמעריב',friday:true,value:'אירוע מיוחד 4:00'}];
  assert.deepEqual(normalizeShabbosDisplayEvents(rows,50000,49999,[event]),[event]);
  rows[0].value='4:00\nמעריב 5:00';
  assert.deepEqual(normalizeShabbosDisplayEvents(rows,50000,50000,[event]),[event]);
  rows[0].value='4:00\nמעריב 4:00';
  assert.deepEqual(normalizeShabbosDisplayEvents(rows,50000,49999,[event]),[event]);
});

