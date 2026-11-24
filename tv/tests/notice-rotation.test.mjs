import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayView, cardHTML } from '../public/display-assets/renderer.js';

const dedication = {id:'dedication',kind:'dedication',data:{duration:120}};
const first = {id:'first',kind:'announcement',data:{duration:25}};
const second = {id:'second',kind:'announcement',data:{duration:35}};

test('Parnas Hayom shows for 15 seconds before announcements use their saved durations', () => {
  const view = {slots:new Map(),choose:DisplayView.prototype.choose};
  const cards = [dedication,first,second];
  const timeline = [
    [100000,'dedication'],[114999,'dedication'],[115000,'first'],
    [130000,'first'],[139999,'first'],[140000,'second'],
    [174999,'second'],[175000,'dedication'],
  ];
  for (const [now,id] of timeline) {
    assert.equal(view.choose('dedication',cards,now).id,id);
  }
});

test('poll responses and item edits keep the current card and its elapsed time', () => {
  const view = {slots:new Map(),choose:DisplayView.prototype.choose};
  view.choose('dedication',[dedication,first],0);
  const latest = () => structuredClone([dedication,first]);
  assert.equal(view.choose('dedication',latest(),15000).id,'first');
  const state = {...view.slots.get('dedication')};
  const edited = latest();
  edited[1].data.message = 'An updated announcement';
  assert.equal(view.choose('dedication',edited,30000).data.message,'An updated announcement');
  assert.deepEqual(view.slots.get('dedication'),state);
  assert.equal(view.choose('dedication',latest(),40000).id,'dedication');
});

test('every active dedication rotates and an expired card leaves the sequence immediately', () => {
  const view = {slots:new Map(),choose:DisplayView.prototype.choose};
  const other = {...dedication,id:'other-dedication'};
  const cards = [dedication,other,first];
  assert.equal(view.choose('dedication',cards,0).id,'dedication');
  assert.equal(view.choose('dedication',cards,15000).id,'other-dedication');
  assert.equal(view.choose('dedication',cards,30000).id,'first');
  assert.equal(view.choose('dedication',[dedication,other],31000).id,'dedication');
  assert.equal(view.choose('dedication',[],32000),null);
  assert.equal(view.slots.has('dedication'),false);
});

test('announcement cards preserve complete text, line breaks and contact information', () => {
  const item = {
    id:'complete-announcement',kind:'announcement',title:'Community <update>',
    data:{message:'First line\nשורה שניה\nFinal line',contact:'Community contact',phone:'732-555-0100',priority:'normal'},
  };
  const original = structuredClone(item);
  const html = cardHTML(item);
  assert.match(html,/class="tv-card announcement normal"/);
  assert.ok(html.includes('Community &lt;update&gt;'));
  assert.ok(html.includes(item.data.message));
  assert.ok(html.includes(item.data.contact));
  assert.ok(html.includes(item.data.phone));
  assert.deepEqual(item,original);
});
