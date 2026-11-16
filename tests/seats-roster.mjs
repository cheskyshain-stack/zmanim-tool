import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreatePlan, seatsWriteName, seatsAddNames } from '../js/seats/model.js';
import { seatsSeatingRows, seatsSeatingCsv, seatsRosterRows, seatsRosterCsv } from '../js/seats/roster.js';

test('detailed seat exports sort full names and keep every occupied seat, including copies and the Rav', () => {
  const plan=seatsCreatePlan();
  const a=seatsWriteName(plan,'A1',0,'Yosef Chuam Cohen').id;
  seatsWriteName(plan,'B1',1,'Aaron Weiss');seatsWriteName(plan,'rav-seat',0,'Rabbi Chaim Brown');
  seatsWriteName(plan,'B1',0,'Yosef Chuam Cohen',{duplicate:true});plan.tables.find(t=>t.id==='A2').seats[1]=a;
  seatsAddNames(plan,['Unassigned Person']);const before=structuredClone(plan);
  assert.deepEqual(seatsSeatingRows(plan,'last'),[
    {name:'Rabbi Chaim Brown',table:'Rav',seat:1},
    {name:'Yosef Chuam Cohen',table:'A1',seat:1},
    {name:'Yosef Chuam Cohen',table:'A2',seat:2},
    {name:'Yosef Chuam Cohen',table:'B1',seat:1},
    {name:'Aaron Weiss',table:'B1',seat:2},
  ]);
  assert.equal(seatsSeatingRows(plan,'first')[0].name,'Aaron Weiss');
  assert.equal(seatsSeatingRows(plan,'last',true).filter(row=>row.table==='Unassigned').length,1);
  assert.deepEqual(plan,before);
});

test('custom table labels, Hebrew names and natural table ordering are retained', () => {
  const plan=seatsCreatePlan();plan.tables.find(t=>t.id==='A1').label='Table 10';plan.tables.find(t=>t.id==='A2').label='Table 2';
  const id=seatsWriteName(plan,'A1',0,'משה דוד כהן').id;plan.tables.find(t=>t.id==='A2').seats[0]=id;
  assert.deepEqual(seatsSeatingRows(plan).map(row=>row.table),['Table 2','Table 10']);
  assert.ok(seatsSeatingRows(plan).every(row=>row.name==='משה דוד כהן'));
  assert.deepEqual(seatsSeatingRows(seatsCreatePlan()),[]);
});

test('CSV downloads keep full names and safely quote custom names and labels', () => {
  assert.equal(seatsSeatingCsv([{name:'Cohen, Yosef "Chuam"',table:'=Custom',seat:2}]),'\uFEFF"Name","Table","Seat"\r\n"Cohen, Yosef ""Chuam""","\'=Custom","2"');
});

test('the roster lists each full name once and combines its distinct table labels', () => {
  const plan=seatsCreatePlan();
  seatsWriteName(plan,'A1',0,'Yosef Chuam Cohen');seatsWriteName(plan,'A1',1,'Yosef Chuam Cohen',{duplicate:true});
  seatsWriteName(plan,'A2',0,'  YOSEF  CHUAM COHEN ',{duplicate:true});
  seatsWriteName(plan,'B1',0,'Aaron Weiss');seatsWriteName(plan,'rav-seat',0,'Rabbi Chaim Brown');
  seatsWriteName(plan,'B1',1,'Yosef Cohen');seatsAddNames(plan,['Never Seated Person']);const before=structuredClone(plan);
  assert.deepEqual(seatsRosterRows(plan,'last'),[
    {name:'Rabbi Chaim Brown',table:'Rav'},
    {name:'Yosef Chuam Cohen',table:'A1, A2'},
    {name:'Yosef Cohen',table:'B1'},
    {name:'Aaron Weiss',table:'B1'},
  ]);
  assert.equal(seatsRosterRows(plan,'first')[0].name,'Aaron Weiss');assert.deepEqual(plan,before);
});

test('the roster preserves Hebrew, custom table labels, numeric table order and two-column CSV', () => {
  const plan=seatsCreatePlan();plan.tables.find(table=>table.id==='A1').label='Table 10';plan.tables.find(table=>table.id==='A2').label='Table 2';
  seatsWriteName(plan,'A1',0,'משה דוד כהן');seatsWriteName(plan,'A2',0,'משה דוד כהן',{duplicate:true});
  assert.deepEqual(seatsRosterRows(plan),[{name:'משה דוד כהן',table:'Table 2, Table 10'}]);assert.deepEqual(seatsRosterRows(seatsCreatePlan()),[]);
  assert.equal(seatsRosterCsv([{name:'Cohen, Yosef "Chuam"',table:'=Custom'}]),'\uFEFF"Name","Table"\r\n"Cohen, Yosef ""Chuam""","\'=Custom"');
});
