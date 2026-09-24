import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium} = createRequire(import.meta.url)('playwright');
const origin = process.env.DISPLAY_TEST_URL || 'http://127.0.0.1:8795';
const live = process.env.DISPLAY_PUBLIC_URL || 'https://baismedrashoflakewoodcommons.org/api/display/public';
const screenshots = process.env.BOARD_SCREENSHOT_DIR;
// Read-only production input. All rendering and future previews run locally;
// these records are never saved by this regression check.
let liveItems, contentSource='live';
try {
  if(process.env.BOARD_FIXTURE_ONLY==='1')throw new Error('Offline fixture selected');
  const liveResponse = await fetch(live, {signal:AbortSignal.timeout(15000)});
  assert.ok(liveResponse.ok, `Public content HTTP ${liveResponse.status}`);
  liveItems = (await liveResponse.json()).items.filter(item => item.kind === 'announcement');
} catch {
  contentSource='read-only public fixture captured 2026-09-24';
  liveItems=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
}
assert.ok(liveItems.length >= 10, 'Expected the ten current uploaded public notices');
const browser = await chromium.launch({channel:'chrome',headless:true});
const issues = [], results = [];
try {
  const context = await browser.newContext({viewport:{width:1920,height:1080}}), page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(origin+'/admin/display/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><title>Private browser regression</title><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>'}));
  await page.goto(origin+'/admin/display/');
  await page.evaluate(async () => {
    await document.fonts.ready;
    const {DisplayView} = await import('/display-assets/renderer.js');
    document.body.innerHTML = '<div id="stable-board-audit" style="width:100vw;height:100vh"></div>';
    window.stableBoardView = new DisplayView(document.querySelector('#stable-board-audit'));
  });
  if (screenshots) await mkdir(screenshots,{recursive:true});
  for (const date of ['2026-10-15','2026-09-24','2026-09-26']) {
    for (const theme of ['light','dark']) {
      const result = await page.evaluate(async ({date,theme,liveItems}) => {
        const response = await fetch('/api/display/admin/preview', {method:'POST',headers:{'Content-Type':'application/json','X-Display-Request':'1'},body:JSON.stringify({at:date+'T16:00:00Z'})});
        if (!response.ok) throw new Error(`Local preview HTTP ${response.status}`);
        const snapshot = await response.json();
        snapshot.items = liveItems;
        snapshot.appearance = {mode:theme};
        const view = window.stableBoardView;
        view.update(snapshot,{preview:true,now:Date.parse(snapshot.at)});
        const host = view.stage.querySelector('.original-sheet-host');
        if (host) await host.originalSheetReady;
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = element => {const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const outside = (a,b) => a.left < b.left-2 || a.right > b.right+2 || a.top < b.top-2 || a.bottom > b.bottom+2;
        const root=view.stage, stageRect=rect(root), overflow=[];
        for (const card of root.querySelectorAll('.announcement-group')) {
          if (card.scrollHeight>card.clientHeight+2 || card.scrollWidth>card.clientWidth+2) overflow.push({group:card.dataset.announcementGroup,scroll:{height:card.scrollHeight-card.clientHeight,width:card.scrollWidth-card.clientWidth}});
          const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
          while(walker.nextNode()) {
            const node=walker.currentNode;
            if(!node.textContent.trim())continue;
            const range=document.createRange();range.selectNodeContents(node);
            for(const r of range.getClientRects()) if(outside(r,rect(card))||outside(r,stageRect)) overflow.push({group:card.dataset.announcementGroup,text:node.textContent,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},card:rect(card)});
          }
        }
        const zmanimPanel=root.querySelector('.board-zmanim');
        for(const row of zmanimPanel.querySelectorAll(':scope>div'))for(const part of row.children){
          const range=document.createRange();range.selectNodeContents(part);
          for(const r of range.getClientRects())if(outside(r,rect(zmanimPanel))||outside(r,stageRect))overflow.push({area:'daily-zmanim',text:part.textContent,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},panel:rect(zmanimPanel)});
        }
        const sections=[...root.querySelectorAll('.announcement-section')].map(section=>({sourceId:section.dataset.sourceId,title:section.querySelector('h3')?.textContent||'',message:section.querySelector('.announcement-message')?.textContent||'',contact:section.querySelector('.announcement-contact bdi[dir="auto"]')?.textContent||'',phone:section.querySelector('.announcement-contact bdi[dir="ltr"]')?.textContent||'',visible:!!section.getClientRects().length}));
        const shadow=host?.shadowRoot;
        const panels=[...root.querySelectorAll('.board-weekly,.board-shabbos')].map(panel=>({className:panel.className,height:panel.clientHeight,scrollHeight:panel.scrollHeight,width:panel.clientWidth,scrollWidth:panel.scrollWidth}));
        return {date,theme,appliedTheme:root.dataset.theme,sections,groups:[...root.querySelectorAll('.announcement-group')].map(card=>({id:card.dataset.announcementGroup,height:card.clientHeight,width:card.clientWidth})),overflow,warning:view.warning,panels,zmanim:root.querySelectorAll('.board-zmanim>div').length,sheet:host?{placement:host.closest('.original-sheet-box').dataset.placement,columns:shadow.querySelectorAll('.onepage-col').length,background:getComputedStyle(shadow.querySelector('.poster')).backgroundColor,ink:getComputedStyle(shadow.querySelector('.onepage-times')).color,fitCount:host.originalSheetFitCount}:null};
      },{date,theme,liveItems});
      assert.equal(result.appliedTheme,theme);
      assert.equal(result.sections.length,liveItems.length,`${date} ${theme}: every notice is present at once`);
      for(const item of liveItems){
        const actual=result.sections.find(section=>section.sourceId===item.id);
        assert.ok(actual?.visible,`${date} ${theme}: ${item.id} visible`);
        assert.equal(actual.title,item.title);
        for(const key of ['message','contact','phone']) assert.equal(actual[key],item.data[key]||'',`${date} ${theme}: complete ${item.id} ${key}`);
      }
      assert.equal(result.zmanim,11);
      if(result.overflow.length||result.warning.length)issues.push({date,theme,overflow:result.overflow,warnings:result.warning,panels:result.panels});
      if(result.sheet)assert.equal(result.sheet.columns,2);
      if(screenshots)await page.screenshot({path:path.join(screenshots,`grouped-${date}-${theme}.png`)});
      results.push({date,theme,groups:result.groups,sheet:result.sheet,overflow:result.overflow.length,warnings:result.warning});
    }
  }
  const stability = await page.evaluate(async () => {
    const view=window.stableBoardView, host=view.stage.querySelector('.original-sheet-host');
    await host.originalSheetReady;
    const sheetNode=host.shadowRoot.querySelector('.poster'), initialFitCount=host.originalSheetFitCount;
    const content=host.shadowRoot.innerHTML, initialClock=view.clock.textContent;
    let removed=0;
    const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===host||node.contains?.(host))removed++;});
    observer.observe(view.schedules,{childList:true,subtree:true});
    // Poll responses are fresh objects with moving timestamps but identical
    // saved schedule rows. Neither they nor clock/theme updates refit the page.
    for(let minute=1;minute<=5;minute++){
      const at=new Date(Date.parse('2026-09-26T16:00:00Z')+minute*60000).toISOString();
      const response=await fetch('/api/display/admin/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Display-Request':'1'},body:JSON.stringify({at})});
      const snapshot=await response.json();
      snapshot.items=structuredClone(view.snapshot.items);
      snapshot.appearance={mode:minute%2?'light':'dark'};
      view.update(snapshot,{preview:true,now:Date.parse(at)});
      for(let second=1;second<=3;second++) view.update({...snapshot,at:new Date(Date.parse(at)+second*1000).toISOString()},{preview:true,now:Date.parse(at)+second*1000});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    observer.disconnect();
    return {sameHost:view.stage.querySelector('.original-sheet-host')===host,sameSheet:host.shadowRoot.querySelector('.poster')===sheetNode,connected:host.isConnected,removed,initialFitCount,fitCount:host.originalSheetFitCount,unchangedSheet:host.shadowRoot.innerHTML===content,initialClock,clock:view.clock.textContent,sections:view.stage.querySelectorAll('.announcement-section').length};
  });
  assert.ok(stability.sameHost&&stability.sameSheet&&stability.connected&&stability.unchangedSheet,'The fitted original page remains the same connected DOM');
  assert.equal(stability.removed,0,'No original page disconnection on clock or poll updates');
  assert.equal(stability.fitCount,stability.initialFitCount,'No repeated fit on clock, poll or theme changes');
  assert.notEqual(stability.clock,stability.initialClock);
  assert.equal(stability.sections,liveItems.length);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({contentSource,results,stability,issues},null,2));
  assert.deepEqual(issues,[],'Every complete announcement must fit simultaneously');
}finally{await browser.close();}
