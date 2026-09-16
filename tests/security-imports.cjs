// Run after building: NODE_PATH must contain Playwright if it is not installed locally.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', process.argv.includes('--dist') ? 'dist' : '.');
const server = http.createServer((req, res) => {
  if (req.url === '/security-test') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><div id="host"></div>'); }
  let file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) {res.statusCode = 403; return res.end();}
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {res.statusCode = 404; return res.end();}
  const types = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'};
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const context = await browser.newContext();
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', r => r.request().url().startsWith(origin + '/') || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/security-test');
    const results = await page.evaluate(async () => {
      localStorage.setItem('zmanim-publish-token','fake-test-key');
      sessionStorage.setItem('zmanim-publish-token','fake-test-key');
      const {importStateFromText, importSheetFromText, loadState} = await import('/js/storage.js');
      const {sanitizeRichText, safeHeaderImage} = await import('/js/security.js');
      const {renderRules} = await import('/js/ui/rules-view.js');
      const {renderOwnEditor} = await import('/js/ui/own-view.js');
      const {renderSavedSheets} = await import('/js/ui/saved-sheets-view.js');
      const {buildSheetPages} = await import('/js/ui/sheet-view.js');
      const {buildAutomaticCharts,getPublishToken,publishToSite,unpublishFromSite} = await import('/js/publish.js');
      const {renderSettings} = await import('/js/ui/settings-view.js');
      const {renderChartBrowser} = await import('/js/ui/chart-view.js');
      const {loadTables} = await import('/js/data-loader.js');
      const {mergeRow} = await import('/js/overrides.js');
      const check = (ok, message) => {if (!ok) throw Error(message);};
      check(localStorage.getItem('zmanim-publish-token')===null && sessionStorage.getItem('zmanim-publish-token')===null,'legacy key remains');
      check(getPublishToken()==='','browser publishing credential exposed');
      const originalFetch=window.fetch;
      let requests=0;
      window.fetch=()=>{requests++;throw Error('Unexpected network request');};
      for (const action of [publishToSite,unpublishFromSite]) {
        let blocked=false;try {await action({},'fake-test-key');}catch {blocked=true;}
        check(blocked,'legacy publishing still enabled');
      }
      window.fetch=originalFetch;
      check(requests===0,'legacy publishing sent a request');
      const host = document.getElementById('host');
      const attack = '<img src="data:image/png;base64,AA==" onerror="document.documentElement.dataset.pwned=1">';
      const attr = '\" onpointerover=\"document.documentElement.dataset.pwned=1\" data-test=\"';
      const base = {settings:{}, sheets:[], rules:[{id:attr,name:attr,enabled:true,condition:{parsha:[attack]},columnKeys:['kayitz:B'],mode:'append',value:'7:30'}]};
      const state = importStateFromText(JSON.stringify(base));
      renderSettings(host,state,()=>{},()=>{});
      check(!host.querySelector('#publish-token,#save-token-btn'),'credential form remains');
      renderRules(host,state,()=>{});
      check(!host.querySelector('img,[onpointerover]'), 'rule injection');
      check(host.textContent.includes(attack),'rule text was lost');
      renderRules(host,state,()=>{},attr);
      check(host.querySelector('[name=name]').value===attr,'quoted rule name lost');
      check(!host.querySelector('[onpointerover]'),'rule attribute injection');
      const payloads = [attack,'<svg onload="alert(1)"></svg>','<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">', '<a href="javascript:alert(1)">time</a>', '<form id="x"><input name="innerHTML"></form>', '<span style="background:url(https://example.com);position:fixed" class="big hidden" onclick="alert(1)">7:00</span>'];
      for (const payload of payloads) {
        host.innerHTML=sanitizeRichText(payload);
        check(!host.querySelector('img,svg,math,script,iframe,form,input,a,[style],[onclick],[onerror],[onload]'),'rich text injection');
      }
      const formatted='<span class="big"><u>7:35</u></span><br><bdi dir="rtl">שחרית</bdi>';
      check(sanitizeRichText(formatted)===formatted,'formatting lost');
      check(safeHeaderImage(attr)==='/assets/logo-building-icon.png','unsafe image URL');
      const photo='data:image/png;base64,iVBORw0KGgo=';
      check(safeHeaderImage(photo)===photo,'raster photo lost');
      for (const bad of [null,{}, {settings:{latitude:attr},sheets:[]},{settings:{},sheets:'bad'}, {settings:{},sheets:[],rules:[{id:'x',name:'x',value:'',condition:{parsha:attack}}]}, JSON.parse('{"settings":{},"sheets":[],"__proto__":{}}')]) {
        let rejected=false;try {importStateFromText(JSON.stringify(bad));}catch {rejected=true;}
        check(rejected,'malformed backup accepted');
      }
      const own={id:'poster',name:attr,blocks:[]};
      const withOwn=importStateFromText(JSON.stringify({...base,own:[own]}));
      check(withOwn.own.length===1,'custom posters lost on restore');
      renderOwnEditor(host,own,[],{onChange(){},onDelete(){}});
      check(!host.querySelector('[onpointerover]'),'poster attribute injection');
      const sheet={id:attr,season:attack,hebrewYear:attack,createdAt:'2026-01-01',weeks:[],overrides:{'46000':{B:attack+formatted}},columnWidths:{B:100}};
      const single=importSheetFromText(JSON.stringify({type:'zmanim-sheet',sheet}));
      check(single.id!==sheet.id && single.overrides['46000'].B===formatted,'single sheet not cleaned');
      check(mergeRow({},sheet,46000).row.B===formatted,'render defense failed');
      renderSavedSheets(host,{...state,sheets:[sheet]},()=>{},()=>{},()=>{});
      check(!host.querySelector('img,[onpointerover]'),'saved list injection');
      localStorage.setItem('zmanim-app-state-v1',JSON.stringify({...base,sheets:[sheet]}));
      check(loadState().sheets[0].overrides['46000'].B===formatted,'existing backup not cleaned');
      host.replaceChildren();
      const charts = buildAutomaticCharts({settings:state.settings,rules:[],sheets:[]},await loadTables(),new Date('2026-09-16T12:00:00Z'));
      const years=[...new Set(charts.sheets.map(s=>s.hebrewYear))].sort();
      check(years.length===7 && years[0]===5784 && years[6]===5790,'seven-year range incorrect');
      check(charts.sheets.length===28 && charts.sheets.every(s=>s.weeks.length>0),'seasons missing');
      renderChartBrowser(host,charts,{confine:false});
      const currentLabel=host.querySelector('.week-nav-when').textContent;
      let steps=0;
      while (!host.querySelector('.chart-prev').disabled && steps++<50) host.querySelector('.chart-prev').click();
      check(host.querySelector('.chart-prev').disabled,'past boundary missing');
      const firstLabel=host.querySelector('.week-nav-when').textContent.trim();
      steps=0;
      while (!host.querySelector('.chart-next').disabled && steps++<50) host.querySelector('.chart-next').click();
      check(steps===41 && host.querySelector('.chart-next').disabled,'chart navigation incomplete');
      const lastLabel=host.querySelector('.week-nav-when').textContent.trim();
      host.querySelector('.chart-today').click();
      check(host.querySelector('.week-nav-when').textContent===currentLabel,'Today did not return to current chart');
      host.replaceChildren();
      const pair = charts.sheets.slice(2,4);
      const restored = importStateFromText(JSON.stringify({...charts,sheets:pair}));
      check(restored.sheets.length===2,'generated charts lost on restore');
      const pages = restored.sheets.flatMap(s => buildSheetPages(s,restored));
      check(pages.length===6,'automatic three-page layouts changed');
      host.append(...pages);
      check(host.querySelectorAll('tbody tr').length>20,'chart rows missing');
      check(host.querySelectorAll('u').length>10,'chart underlines missing');
      check(host.querySelectorAll('.header-icon').length===6,'chart photos missing');
      check(!host.querySelector('[onerror],[onpointerover]'),'chart injected handlers');
      const css=document.createElement('link');css.rel='stylesheet';css.href='/css/app.css';document.head.append(css);
      await new Promise(resolve=>{css.onload=resolve;css.onerror=resolve;});
      await document.fonts.ready;
      const dimensions=pages.map(p=>({width:p.getBoundingClientRect().width,height:p.getBoundingClientRect().height}));
      check(dimensions.every(d=>d.width>0&&d.height>0),'charts not visible');
      return {checks:'import security, retired browser publishing, seven-year chart navigation, six-page printing',years,firstLabel,lastLabel,pages:pages.length,dimensions,marker:document.documentElement.dataset.pwned||null};
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.pwned||null),null);
    assert.deepEqual(errors,[]);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.page').count(),6);
    console.log(JSON.stringify({root, ...results, errors}));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
