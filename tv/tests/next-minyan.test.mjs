import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMinyanHTML} from '../public/display-assets/renderer.js';
import {minyanKey,nextMinyanKey} from '../public/display-assets/minyan-timing.js';

const next = {name:'מעריב',place:'למטה',time:'11:00',at:'2026-09-29T03:00:00.000Z'};
test('next minyan preserves schedule time and location with a New York period and countdown',()=>{
  const html=nextMinyanHTML(next,'2026-09-29T02:44:00.000Z');
  for(const text of ['מעריב','למטה','11:00','PM','in 16 minutes'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/<svg|<img|⏳/);
  assert.ok(nextMinyanHTML(next,'2026-09-29T01:59:00Z').includes('in 1 hour 1 minute'));
  assert.ok(nextMinyanHTML(next,'2026-09-29T02:59:01Z').includes('in 1 minute'));
  assert.ok(nextMinyanHTML(next,next.at).includes('>now</p>'));
});
test('a just-started minyan retains its name, location and time through five minutes',()=>{
  for(const elapsed of [1,60000,299999,300000]){
    const html=nextMinyanHTML(next,new Date(Date.parse(next.at)+elapsed).toISOString());
    for(const text of ['מעריב','למטה','11:00','PM','>now</p>'])assert.ok(html.includes(text),`${elapsed}: ${text}`);
    assert.doesNotMatch(html,/in -|No further minyan/);
  }
});
test('midnight, noon and daylight saving use the actual instant for AM/PM',()=>{
  for(const [at,period] of [['2026-09-29T04:00:00Z','AM'],['2026-09-29T16:00:00Z','PM'],['2026-11-01T06:30:00Z','AM']]) {
    assert.ok(nextMinyanHTML({...next,at},at).includes(`next-period">${period}</span>`));
  }
});
test('missing and expired minyan times do not display a stale countdown',()=>{
  for(const value of [null,{...next,at:'invalid'},next]){
    const html=nextMinyanHTML(value,'2026-09-29T03:05:00.001Z');
    assert.match(html,/No further minyan/);
    assert.doesNotMatch(html,/next-countdown|NaN/);
  }
});
test('saved labels are escaped as text',()=>{
  const html=nextMinyanHTML({...next,name:'<img src=x>',place:'<script>'},next.at);
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.doesNotMatch(html,/<img|<script/);
});

test('the large next-minyan card puts prayer, time, location and hours/minutes in order',()=>{
  const html=nextMinyanHTML(next,'2026-09-29T01:00:00Z');
  const order=['next-service','next-time','next-location','next-countdown'].map(name=>html.indexOf(`class="${name}"`));
  assert.ok(order.every((position,index)=>position>=0&&(!index||position>order[index-1])));
  assert.match(html,/in 2 hours/);
  assert.match(nextMinyanHTML(next,'2026-09-29T02:00:00Z'),/in 1 hour/);
});
test('countdown omits zero hours and zero minutes',()=>{
  for (const at of ['2026-09-29T02:44:00Z','2026-09-29T02:00:00Z','2026-09-29T01:00:00Z']) {
    const html = nextMinyanHTML(next,at);
    assert.doesNotMatch(html,/\b0 (?:hours|minutes)\b/);
  }
});

test('schedule highlight follows the center card through its hold and distinguishes rooms and prayers',()=>{
  for (const offset of [-60000,0,299999,300000])
    assert.equal(nextMinyanKey(next,new Date(Date.parse(next.at)+offset).toISOString()),minyanKey(next));
  assert.equal(nextMinyanKey(next,'2026-09-29T03:05:00.001Z'),'');
  assert.equal(nextMinyanKey(null,next.at),'');
  assert.equal(nextMinyanKey({...next,at:'invalid'},next.at),'');
  assert.equal(minyanKey({...next,auxiliary:true}),'');
  assert.notEqual(minyanKey({...next,place:'בית מדרש'}),minyanKey(next));
  assert.notEqual(minyanKey({...next,name:'מנחה'}),minyanKey(next));
  assert.equal(minyanKey({...next,at:'2026-09-28T23:00:00-04:00'}),minyanKey(next));
});
