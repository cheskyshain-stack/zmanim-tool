import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {scheduleSnapshot} from '../src/schedules.js';
import {validate,publicItems} from '../src/model.js';

// Development-only fixtures exercise the actual screen editor without API writes.
const fixture={kind:'announcement',title:'DEVELOPMENT Chol Hamoed notice',status:'published',startLocal:'2026-09-28T00:00',endLocal:'2026-09-29T00:00',data:{placement:'chol-hamoed',message:'Private test fixture only; never published.',displayGroup:'separate'}};
const first={...validate(fixture),id:'development-chm-one',version:7,internalName:'private record one'};
const second={...first,id:'development-chm-two',version:9,internalName:'private record two'};
const regular={...first,id:'development-bottom',title:'DEVELOPMENT bottom notice',data:{message:'A normal bottom announcement.',displayGroup:'community',placement:'automatic'}};
assert.equal(first.data.placement,'chol-hamoed');
assert.throws(()=>validate({...fixture,data:{...fixture.data,placement:'unrecognized'}}),/valid option/);
assert.deepEqual(publicItems([first],first.endsAt),[]);
assert.deepEqual(publicItems([{...first,status:'draft'}],first.startsAt),[]);

const {chromium}=createRequire(import.meta.url)('playwright');
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/') {
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><link rel="stylesheet" href="/display-assets/display.css"><link rel="stylesheet" href="/display-assets/admin.css"><main id="test"></main>');return;
    }
    const file=path.resolve(dist,'.'+pathname);
    if(!file.startsWith(path.resolve(dist)+path.sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const origin=`http://127.0.0.1:${server.address().port}`;
async function mount(at,items=[],allowed=true){
  await page.goto(origin);
  // Dates of these private fixtures are adjusted only within this test.
  const records=items.map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
  const snapshot={at,items:publicItems(records,at),schedule:scheduleSnapshot(at),appearance:{mode:'dark'},warnings:[]};
  await page.evaluate(async({snapshot,records,allowed})=>{
    const {mountScreenEditor}=await import('/display-assets/admin.screen.js');
    window.actions=[];
    window.editor=mountScreenEditor(document.querySelector('#test'),{snapshot,items:records,can:kind=>allowed&&kind==='announcement',onAdd:item=>actions.push({kind:'add',item}),onEdit:item=>actions.push({kind:'edit',item})});
  },{snapshot,records,allowed});
}
try {
  for(const at of ['2026-09-28T16:00:00.000Z','2027-04-25T16:00:00.000Z']) {
    await mount(at,[regular]);
    const slot=page.locator('.board-chol-hamoed-announcements');
    assert.equal(await slot.count(),1);
    assert.equal((await slot.textContent()).trim(),'','public area remains truly empty');
    await slot.click();
    let action=await page.evaluate(()=>actions.at(-1));
    assert.equal(action.kind,'add');assert.equal(action.item.status,'draft');assert.equal(action.item.data.placement,'chol-hamoed');
    await slot.focus();await page.keyboard.press('Enter');
    action=await page.evaluate(()=>actions.at(-1));assert.equal(action.item.data.placement,'chol-hamoed');
    assert.equal(await page.locator('.board-notices [data-source-id="development-bottom"]').count(),1);
  }
  await mount('2026-09-28T16:00:00.000Z',[first,second,regular]);
  const selected=page.locator('.board-chol-hamoed-announcements [data-source-id="development-chm-two"]');
  await selected.click();
  const edit=await page.evaluate(()=>actions.at(-1));
  assert.equal(edit.kind,'edit');assert.equal(edit.item.id,second.id);assert.equal(edit.item.version,second.version);
  assert.equal(edit.item.internalName,second.internalName,'editor receives protected original record');
  assert.equal(await page.locator('[data-screen-area="chol-hamoed"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.board-notices [data-source-id^="development-chm-"]').count(),0);
  await page.locator('#screen-add-announcement').click();
  assert.equal((await page.evaluate(()=>actions.at(-1))).item.data.placement,'chol-hamoed');
  await mount('2026-11-03T18:00:00.000Z',[first,regular]);
  assert.equal(await page.locator('.board-chol-hamoed-announcements,[data-screen-area="chol-hamoed"]').count(),0);
  assert.equal(await page.locator('[data-source-id="development-chm-one"]').count(),0);
  await mount('2026-09-28T16:00:00.000Z',[first],false);
  assert.equal(await page.locator('[data-screen-area="chol-hamoed"],.board-chol-hamoed-announcements.screen-edit-target').count(),0);
  await page.locator('[data-source-id="development-chm-one"]').click();
  assert.deepEqual(await page.evaluate(()=>actions),[],'no announcement capability means no editor action');
  assert.deepEqual(errors,[]);
  console.log('Chol Hamoed admin checks passed: empty add, keyboard add, exact-record editing, dedicated placement, ordinary-date hiding, publication dates, and permission gating.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
