import test from 'node:test';
import assert from 'node:assert/strict';
import {groupWeekdayPresentation} from '../public/display-assets/weekday-groups.js';
import {scheduleSnapshot} from '../src/schedules.js';

const snapshot = date => scheduleSnapshot(date + 'T16:00:00Z');
const names = ['שחרית', 'מנחה', 'מעריב'];
const day = (date, label = date) => ({date, label});
const event = (name, time, extra = {}) => ({name, time, place:'למטה', ...extra});
const fixture = () => names.map((name, index) => ({name, groups:[
  {days:[day('2030-01-01'), day('2030-01-02'), day('2030-01-03')], events:[event(name, ['7:00','1:35','8:00'][index])]},
  {days:[day('2030-01-04', 'Specific saved date')], events:[event(name, ['6:40','1:20','7:45'][index])]},
  ...(index ? [{days:[day('2030-01-05', 'יום ו׳')], events:[]}] : []),
]}));
const byDate = services => {
  const result = {};
  for (const service of services) for (const group of service.groups) for (const date of group.days) {
    result[date.date] ||= {};
    if (group.events.length) result[date.date][service.name] = group.events;
  }
  return result;
};

test('real Gedalya week collects the entire fast below the weekday services', () => {
  const source = snapshot('2026-09-14');
  const before = structuredClone(source);
  const result = groupWeekdayPresentation(source.presentation.weekly.services);
  assert.equal(result.daySections.length, 1);
  const fast = result.daySections[0];
  assert.deepEqual(fast.days, [{date:'2026-09-14', label:'צום גדליה · יום ב׳', fastDay:true}]);
  assert.deepEqual(fast.services.map(service => [service.name, service.events.length]), [['סליחות',5],['מנחה',5],['מעריב',2]]);
  assert.ok(result.services.every(service => service.groups.every(group => group.days.every(day => day.date !== '2026-09-14'))));
  const early = result.services.find(service => service.name === 'סליחות').groups.find(group => group.days.some(day => day.date === '2026-09-17'));
  assert.equal(early.events[0].time, '6:20');
  assert.deepEqual(source, before, 'Grouping cannot mutate daily events or the next minyan');
  assert.deepEqual(source.next, before.next);
});

test('Rosh Chodesh and fast days with only a morning change stay with their prayer', () => {
  for (const date of ['2028-04-26','2026-12-20','2027-03-22','2027-07-22']) {
    const source = snapshot(date).presentation.weekly.services;
    const result = groupWeekdayPresentation(source);
    assert.deepEqual(result.services, source, date);
    assert.deepEqual(result.daySections, [], date);
  }
});

test('short Gedalya weeks use calendar metadata to resolve equally sized day groups', () => {
  for (const date of ['2029-09-12','2032-09-08']) {
    const source = snapshot(date).presentation.weekly.services;
    const before = structuredClone(source);
    const result = groupWeekdayPresentation(source);
    assert.equal(result.daySections.length, 1, date);
    assert.deepEqual(result.daySections[0].days.map(day => day.date), [date]);
    assert.deepEqual(result.daySections[0].services.map(service => service.name), ['סליחות','מנחה','מעריב']);
    assert.ok(result.services.every(service => service.groups[0].events.length && service.groups[0].days.every(day => !day.fastDay)));
    assert.deepEqual(source, before);
  }
});

test('a single earlier Selichos service stays inline', () => {
  const services = fixture();
  services[0].name = 'סליחות';
  for (const service of services.slice(1)) {
    service.groups[0].days.push(...service.groups[1].days);
    service.groups.splice(1, 1);
  }
  assert.deepEqual(groupWeekdayPresentation(services), {services, daySections:[]});
});

test('whole-date grouping preserves extra services, complete text, notes, and locations', () => {
  const services = fixture();
  services[1].groups[1].events[0] = event('מנחה','1:20',{place:'אולם צדדי', note:'Public instructions', sourceText:'\uE0001:20\uE001 / 1:35\nAfter the shiur', mark:'**'});
  services.push({name:'קריאת התורה',groups:[{days:[day('2030-01-04','Specific saved date')],events:[event('קריאת התורה','2:00',{note:'Saved auxiliary service'})]}]});
  const before = structuredClone(services), expected = byDate(before);
  const result = groupWeekdayPresentation(services);
  assert.equal(result.daySections.length, 1);
  const regrouped = byDate(result.services);
  for (const section of result.daySections) for (const date of section.days)
    regrouped[date.date] = Object.fromEntries(section.services.map(service => [service.name,service.events]));
  assert.deepEqual(regrouped, expected);
  assert.deepEqual(services, before);
  result.daySections[0].services[1].events[0].note = 'Mutated result';
  assert.deepEqual(services, before, 'Result objects do not share writable events with the input');
});

test('dates sharing their complete group membership share one full-day section', () => {
  const services = fixture();
  for (const service of services) service.groups[1].days.push(day('2030-01-06','Second date'));
  const result = groupWeekdayPresentation(services);
  assert.equal(result.daySections.length, 1);
  assert.deepEqual(result.daySections[0].days.map(day => day.date), ['2030-01-04','2030-01-06']);
  assert.equal(result.daySections[0].services.length, 3);
});

test('all saved morning services must differ, and every main service must exist', () => {
  const services = fixture();
  services.push({name:'סליחות',groups:[{days:[day('2030-01-01'),day('2030-01-04')],events:[event('סליחות','6:00')]}]});
  assert.equal(groupWeekdayPresentation(services).daySections.length, 0);
  assert.equal(groupWeekdayPresentation(fixture().slice(0,2)).daySections.length, 0);
  const incomplete = fixture();
  incomplete[2].groups[1].events = [];
  assert.equal(groupWeekdayPresentation(incomplete).daySections.length, 0);
});

test('empty Friday groups do not become baselines and tied first groups stay authoritative', () => {
  const services = fixture();
  for (const service of services.slice(1)) service.groups.unshift({days:Array.from({length:6},(_,i)=>day('2030-02-0'+(i+1))),events:[]});
  assert.equal(groupWeekdayPresentation(services).daySections.length, 1);
  const tied = fixture();
  for (const service of tied) service.groups[0].days = [day('2030-01-01')];
  const result = groupWeekdayPresentation(tied);
  assert.deepEqual(result.daySections[0].days.map(day=>day.date), ['2030-01-04']);
});

test('real Selichos week puts an earlier one-day change before a later two-day change', () => {
  const services = snapshot('2026-09-06').presentation.weekly.services;
  const before = structuredClone(services);
  const result = groupWeekdayPresentation(services);
  const selichos = result.services.find(service => service.name === 'סליחות');
  assert.deepEqual(selichos.groups.slice(1).map(group => group.days.map(day => day.date)), [
    ['2026-09-06'], ['2026-09-08', '2026-09-09'],
  ]);
  assert.deepEqual(byDate(result.services), byDate(services));
  assert.deepEqual(services, before);
});

const unorderedService = name => ({name, groups:[
  {days:[day('2030-01-06'), day('2030-01-05')], events:[event(name, '6:30')]},
  {days:[day('2030-01-07'), day('2030-01-03'), day('2030-01-01'), day('2030-01-02')], events:[event(name, '7:00')]},
  {days:[day('2030-01-04')], events:[event(name, '6:15')]},
]});
const orderedDates = [
  ['2030-01-01', '2030-01-02', '2030-01-03', '2030-01-07'],
  ['2030-01-04'],
  ['2030-01-05', '2030-01-06'],
];
const groupDates = service => service.groups.map(group => group.days.map(day => day.date));

test('baseline stays first while inline exceptions and their dates use chronological order', () => {
  const services = [unorderedService('שחרית'), ...names.slice(1).map(name => ({name, groups:[{
    days:Array.from({length:7}, (_, index) => day(`2030-01-0${7-index}`)),
    events:[event(name, '7:00')],
  }]}))];
  const before = structuredClone(services);
  const result = groupWeekdayPresentation(services);
  assert.deepEqual(groupDates(result.services[0]), orderedDates);
  assert.deepEqual(groupDates(result.services[1]), [Array.from({length:7}, (_, index) => `2030-01-0${index+1}`)]);
  assert.deepEqual(result.daySections, []);
  assert.deepEqual(byDate(result.services), byDate(services));
  assert.deepEqual(services, before);
});

test('chronological presentation also applies when a main prayer is absent', () => {
  for (const missing of names) {
    const services = names.filter(name => name !== missing).map(unorderedService);
    const before = structuredClone(services);
    const result = groupWeekdayPresentation(services);
    assert.deepEqual(result.services.map(groupDates), services.map(() => orderedDates), missing);
    assert.deepEqual(result.daySections, [], missing);
    assert.deepEqual(services, before, missing);
  }
});

test('chronological presentation also applies when a main prayer has no nonempty baseline', () => {
  const services = names.map(unorderedService);
  for (const group of services[2].groups) group.events = [];
  const before = structuredClone(services);
  const result = groupWeekdayPresentation(services);
  assert.deepEqual(result.services.slice(0, 2).map(groupDates), [orderedDates, orderedDates]);
  assert.deepEqual(groupDates(result.services[2]), [orderedDates[0], orderedDates[1], orderedDates[2]]);
  assert.deepEqual(result.daySections, []);
  assert.deepEqual(services, before);
});

test('inline exceptions are sorted by dates remaining after a full-day section is removed', () => {
  const baseline = ['2030-01-10', '2030-01-11', '2030-01-12', '2030-01-13'];
  const services = names.map((name, index) => ({name, groups:[
    {days:baseline.concat(index ? ['2030-01-04', '2030-01-09'] : []).map(date => day(date)), events:[event(name, '7:00')]},
    {days:(index ? ['2030-01-01'] : ['2030-01-01', '2030-01-09']).map(date => day(date)), events:[event(name, '6:30')]},
    ...(index ? [] : [{days:[day('2030-01-04')], events:[event(name, '6:15')]}]),
  ]}));
  const result = groupWeekdayPresentation(services);
  assert.deepEqual(result.daySections.map(section => section.days.map(day => day.date)), [['2030-01-01']]);
  assert.deepEqual(groupDates(result.services[0]), [baseline, ['2030-01-04'], ['2030-01-09']]);
});

test('full-day sections and dates within a shared section are chronological', () => {
  const services = names.map(unorderedService);
  const result = groupWeekdayPresentation(services);
  assert.deepEqual(result.services.map(groupDates), services.map(() => [orderedDates[0]]));
  assert.deepEqual(result.daySections.map(section => section.days.map(day => day.date)), [
    ['2030-01-04'], ['2030-01-05', '2030-01-06'],
  ]);
});
