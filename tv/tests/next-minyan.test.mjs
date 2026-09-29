import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMinyanHTML} from '../public/display-assets/renderer.js';

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
