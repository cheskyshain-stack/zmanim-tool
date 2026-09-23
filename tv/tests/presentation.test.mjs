import test from 'node:test';import assert from 'node:assert/strict';
import {scheduleSnapshot,settings} from '../src/schedules.js';
import {consolidateWeek,holySource,civil} from '../src/presentation.js';
import {dateFromHebrew,excelWeekday} from '../../js/hebrew-calendar.js';
const snapshot=date=>scheduleSnapshot(date+'T16:00:00Z');
const flatten=p=>p.special.sections.flatMap(s=>s.rows);
test('consolidation preserves scopes, exact times, notes, locations, and one-day Selichos differences',()=>{
 const days=Array.from({length:5},(_,i)=>({date:`2026-11-${String(8+i).padStart(2,'0')}`,label:['יום א׳','יום ב׳','יום ג׳','ר״ח יום ד׳','ר״ח יום ה׳'][i],events:[{name:'שחרית',mins:i>=3?430:420,time:i>=3?'7:10':'7:00',place:'למטה'},{name:'סליחות',mins:i===1?390:395,time:i===1?'6:30':'6:35',place:'בית מדרש',note:'Development fixture'}]}));
 const result=consolidateWeek(days);assert.equal(result[0].groups.length,2);assert.equal(result[0].groups[1].days.length,2);assert.equal(result[1].groups.length,2);assert.equal(result[1].groups[1].days[0].label,'יום ב׳');
 days[4].events[0].place='בעזר״נ';assert.equal(consolidateWeek(days)[0].groups.length,3);
});
test('ordinary Shabbos preserves complete chart entries including named Shema reckonings',()=>{
 const p=snapshot('2026-11-10').presentation;const rows=flatten(p);assert.ok(rows.some(r=>r.id.endsWith(':D')&&r.times.map(t=>t.name).join(',')==='מ״א,גר״א'));assert.ok(rows.some(r=>r.id.endsWith(':B')));assert.ok(p.special.sections.some(s=>s.heading==='מוצאי שבת'));assert.match(p.weekly.title,/פרשת/);
 const later=snapshot('2026-11-12').presentation.weekly;assert.deepEqual(p.weekly,later);
});
test('Yom Kippur is excluded from weekday services and includes every full poster row',()=>{
 const p=snapshot('2026-09-21').presentation;assert.match(p.special.title,/כיפור/);const rows=flatten(p);for(const key of ['kolNidrei','yizkor','neila','kiddushLevana'])assert.ok(rows.some(r=>r.calc===key),key);
 assert.ok(p.weekly.references.some(r=>r.date==='2026-09-21'));
 assert.ok(p.weekly.services.every(s=>s.groups.every(g=>g.days.every(d=>d.date!=='2026-09-21'))));
});
test('connected groups retain both days across Sunday and preserve every public poster entry',()=>{
 const a=snapshot('2026-09-26').presentation,b=snapshot('2026-09-27').presentation;assert.equal(a.special.id,b.special.id);assert.equal(b.special.to,'2026-09-27');assert.deepEqual(a.special.sections,b.special.sections);
 const expected=[15,16].flatMap(d=>holySource(dateFromHebrew(d,7,5787),settings).sections.flatMap(s=>s.rows));assert.deepEqual(flatten(b),expected);
 assert.match(b.currentDay,/יום ב׳ סוכות/);assert.doesNotMatch(b.currentDay,/שמיני/);
});
test('three-day groups retain first and middle days through the closing Shabbos',()=>{
 let chosen;for(let y=5784;y<5800;y++){const first=dateFromHebrew(15,7,y);if(excelWeekday(first)===5){chosen=first;break;}}
 assert.ok(chosen);const first=snapshot(civil(chosen)).presentation.special,last=snapshot(civil(chosen+2)).presentation.special;assert.equal(first.id,last.id);assert.equal(last.to,civil(chosen+2));assert.ok(last.sections.some(s=>/שבת חול המועד/.test(s.heading)));assert.ok(last.sections.some(s=>/יום א'/.test(s.heading)));assert.ok(last.sections.some(s=>/יום ב'/.test(s.heading)));
});
test('next minyan remains an actual dated event independent of presentation notes',()=>{
 const s=snapshot('2026-09-27');const expected=[s.today,...s.week,...s.shabbos].flatMap(d=>d.events).filter(e=>!e.auxiliary&&e.at>='2026-09-27T16:00:00Z').sort((a,b)=>a.at.localeCompare(b.at))[0];assert.equal(s.next.at,expected.at);assert.equal(s.next.place,expected.place);
 const retained=scheduleSnapshot('2026-09-22T01:00:00Z');assert.match(retained.presentation.special.title,/כיפור/);
});

test('Shabbos followed by two Pesach days is one group with full Shabbos and Pesach rows',()=>{
 const p=snapshot('2025-04-14').presentation;assert.equal(p.special.from,'2025-04-11');assert.equal(p.special.to,'2025-04-14');
 const rows=flatten(p);assert.ok(rows.some(r=>r.id.startsWith('chart:')&&r.id.endsWith(':D')));assert.ok(rows.some(r=>r.calc==='achila'));assert.ok(rows.some(r=>r.calc==='biur'));assert.ok(rows.some(r=>r.calc==='motzeiMaariv'));
 assert.equal(p.special.sections.filter(s=>s.heading.startsWith('מוצאי')).length,1);
 assert.match(p.special.sections.at(-1).heading,/פסח/);
});


test('Chol Hamoed uses full poster rows and Hoshana Rabbah retains untimed instructions',()=>{
 const p=snapshot('2026-09-30').presentation;
 const chm=p.weekly.posterSections.find(s=>s.heading==='חול המועד');
 assert.equal(chm.rows.length,3);assert.equal(chm.dates.length,5);
 const hos=p.weekly.posterSections.find(s=>s.heading==='הושענא רבה');
 assert.ok(hos.rows.some(r=>r.calc==='mishnaMaariv'&&!r.times.length));
 assert.ok(chm.morningExclusion);assert.equal(p.weekly.services.length,0);
 const rc=snapshot('2028-04-26').presentation.weekly.services.find(s=>s.name==='שחרית');
 assert.ok(rc.groups.some(g=>g.days.length===2&&g.days.every(d=>d.label.includes('ראש חדש אייר'))));
});


test('TV panel titles use concise seasonal and parsha names',()=>{
 const p=snapshot('2028-04-26').presentation;
 assert.match(p.weekly.title,/^חול פרשת /);assert.match(p.special.title,/^שבת פרשת /);
 assert.equal(snapshot('2026-09-27').presentation.special.title,'סוכות');
 const chm=snapshot('2026-09-30').presentation;
 assert.equal(chm.weekly.title,'חול המועד');assert.equal(chm.special.title,'שמיני עצרת / שמחת תורה');
});
