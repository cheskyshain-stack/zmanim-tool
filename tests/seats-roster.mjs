import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreatePlan, seatsWriteName, seatsAddNames } from '../js/seats/model.js';
import { seatsSeatingRows, seatsSeatingCsv } from '../js/seats/roster.js';

test('the seated list sorts full names and keeps every occupied seat, including copies and the Rav', () => {
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
