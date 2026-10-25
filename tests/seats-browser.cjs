const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict'), os = require('node:os');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../dist');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'seats-browser-'));
const storageKey = 'lakewood-commons-seats-v1';
const server = http.createServer((req,res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) {res.statusCode = 403; return res.end();}
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {res.statusCode=404; return res.end();}
  res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_BIN || '/usr/bin/chromium', args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1050}, acceptDownloads:true});
    const page = await context.newPage(), errors = [], badResponses = [], posts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if(response.status() >= 400) badResponses.push(response.url());});
    page.on('request', request => {if(request.method() !== 'GET') posts.push(request.url());});
    await page.goto(origin + '/seats/');
    assert.equal(await page.title(), 'Seats | Bais Medrash of Lakewood Commons');
    assert.equal(await page.locator('.room-diagram').count(), 0);
    await page.locator('#seats-pin').fill('1111'); await page.getByRole('button', {name:'Open Seats'}).click();
    await page.getByText('That PIN did not match. Try again.').waitFor();
    await page.locator('#seats-pin').fill('4444'); await page.getByRole('button', {name:'Open Seats'}).click();
    await page.locator('#seat-count').waitFor();
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    await page.getByRole('button',{name:'Save plan',exact:true}).click();
    const starting = await state(), originalPlan = starting.activeId;
    assert.equal(starting.plans[0].tables.length, 34);
    assert.deepEqual(['A','B','C','D'].map(col => starting.plans[0].tables.filter(table => table.column === col).length), [8,9,9,8]);
    assert.equal(await page.locator('.room-stage .table-item').count(), 34);
    assert.equal(await page.locator('#seat-count').inputValue(), '');
    assert.ok(starting.plans[0].tables.find(t=>t.id==='B9').y > starting.plans[0].tables.find(t=>t.id==='A8').y);
    await page.locator('#bulk-settings summary').click();
    await page.locator('#bulk-count').fill('4'); await page.getByRole('button',{name:'Apply seat count',exact:true}).click();
    assert.ok((await state()).plans[0].tables.every(table => table.count === 4));
    const csv = '\uFEFFName\r\nYosef Cohen\r\nMoshe Levi\r\nדוד כהן\r\nRabbi Shmuel Alexander Friedman\r\nYosef Cohen\r\n';
    await page.locator('#names-file').setInputFiles({name:'names.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.getByText('4 names added; 1 duplicates skipped.').waitFor();
    assert.equal((await state()).plans[0].people.length, 4);
    await page.locator('[data-person]').filter({hasText:'Yosef Cohen'}).click();
    await page.locator('.room-stage [data-table="A1"][data-seat="0"]').click();
    await page.locator('#show-assigned').check();
    await page.locator('[data-person]').filter({hasText:'Yosef Cohen'}).click();
    await page.locator('.room-stage [data-table="A2"][data-seat="1"]').click();
    let current = (await state()).plans[0];
    assert.equal(current.tables.find(t=>t.id==='A1').seats[0], null);
    assert.equal(current.tables.find(t=>t.id==='A2').seats[1], current.people.find(p=>p.name==='Yosef Cohen').id);
    for (const [index,name] of [[0,'Moshe Levi'],[1,'דוד כהן'],[2,'Rabbi Shmuel Alexander Friedman']]) {
      await page.locator('.room-stage [data-table="A1"][data-seat="' + index + '"]').click();
      await page.locator('#seat-dialog').waitFor({state:'visible'});
      const person = (await state()).plans[0].people.find(p=>p.name===name);
      await page.locator('#assignment-person').selectOption(person.id);
      await page.getByRole('button',{name:'Save seat',exact:true}).click();
    }
    assert.equal(await page.locator('.fit-warning').count(),1,'Long names should trigger a visible fit warning');
    await page.getByRole('button',{name:'Edit layout',exact:true}).click();
    await page.locator('#selected-item').selectOption('A1');
    await page.locator('#item-height').fill('60'); await page.locator('#item-height').blur();
    const boxes = await page.locator('.room-stage .seat-name').evaluateAll(nodes => nodes.map(node => {
      const a=node.getBoundingClientRect(), b=node.closest('.table-item').querySelector('.table-surface').getBoundingClientRect();
      return {name:node.textContent, fits:a.left>=b.left-.5&&a.right<=b.right+.5&&a.top>=b.top-.5&&a.bottom<=b.bottom+.5};
    }));
    assert.equal(boxes.length,4);
    assert.ok(boxes.every(box=>box.fits), JSON.stringify(boxes));
    assert.equal(await page.locator('.fit-warning').count(), 0);
    await page.reload(); await page.locator('#seat-count').waitFor();
    assert.equal((await state()).plans[0].tables.find(t=>t.id==='A2').seats.filter(Boolean).length, 1);
    // Real Excel file through the same upload path, with a quoted Hebrew text name as well.
    const xlsxPath = path.resolve(__dirname,'../vendor/xlsx-0.20.3.min.js');
    const vm = require('node:vm'), sandbox = {console}; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(xlsxPath,'utf8'),sandbox);
    const XLSX=sandbox.XLSX, book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['First name','Last name'],['Yaakov','Miller']]),'Names');
    const buffer=Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx'}));
    await page.locator('#names-file').setInputFiles({name:'names.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
    await page.getByText('1 names added; 0 duplicates skipped.').waitFor();
    await page.locator('#names-file').setInputFiles({name:'names.txt',mimeType:'text/plain',buffer:Buffer.from('רבי משה שליט"א\n')});
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).plans[0].people.length === 6,storageKey);
    await page.getByRole('button',{name:'Edit layout',exact:true}).click();
    await page.getByRole('button',{name:'+ Pillar',exact:true}).click();
    await page.getByRole('button',{name:'+ Sefarim cabinet',exact:true}).click();
    current = (await state()).plans[0]; assert.deepEqual(current.objects.map(o=>o.type), ['pillar','cabinet']);
    const cabinetId = current.objects[1].id, cabinetX=current.objects[1].x;
    await page.locator('[data-item="'+cabinetId+'"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal((await state()).plans[0].objects[1].x, cabinetX+8);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal((await state()).plans[0].objects[1].x, cabinetX);
    // A real pointer drag, not just the numeric controls.
    const table=page.locator('.room-stage [data-item="A1"] .table-label'), box=await table.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+16,box.y+box.height/2+8,{steps:5}); await page.mouse.up();
    assert.ok((await state()).plans[0].tables.find(t=>t.id==='A1').x > 60);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.locator('#selected-item').selectOption('A1');
    await page.locator('#seat-count').fill('1'); await page.locator('#seat-count').blur();
    assert.equal((await state()).plans[0].tables[0].seats.filter(Boolean).length,1);
    assert.equal((await state()).plans[0].people.length,6);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal((await state()).plans[0].tables[0].seats.filter(Boolean).length,3);
    await page.locator('#plan-files summary').click();
    let downloading=page.waitForEvent('download'); await page.getByRole('button',{name:'Download backup',exact:true}).click();
    const backup=await downloading; const backupPath=path.join(output,'backup.json'); await backup.saveAs(backupPath);
    page.once('dialog',dialog=>dialog.accept('Yomim Noraim'));
    await page.getByRole('button',{name:'New plan from this layout',exact:true}).click();
    assert.equal((await state()).plans.length,2); assert.equal((await state()).plans[1].people.length,0);
    await page.locator('#backup-file').setInputFiles(backupPath);
    await page.getByText('Backup restored as additional plans. Your existing plans were kept.').waitFor();
    assert.equal((await state()).plans.length,3);
    await page.locator('#plan-select').selectOption(originalPlan);
    const saved=await state();
    for (const width of [1440,760,375]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow at '+width);
      await page.screenshot({path:path.join(output,'seats-'+width+'.png'),fullPage:true});
      if(width===375) {
        await page.getByRole('button',{name:'Assign names',exact:true}).click();
        await page.locator('#seat-list summary').click();
        await page.locator('#selected-item').selectOption('A1');
        assert.equal(await page.locator('.seat-list button').count(),4);
        await page.getByRole('button',{name:'Edit layout',exact:true}).click();
      }
    }
    await page.setViewportSize({width:1440,height:1050});
    for (const paper of ['letter','tabloid']) {
      await page.locator('#paper-size').selectOption(paper);
      const pdf=path.join(output,'seats-'+paper+'.pdf');
      await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:false});
      const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}), text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});
      assert.match(info,/Pages:\s+1\b/); assert.match(info,paper==='letter'?/Page size:\s+792 x 612 pts/:/Page size:\s+1224 x 792 pts/);
      assert.match(text.replace(/\s+/g,' '),/Yosef Cohen/); assert.match(text.replace(/\s+/g,' '),/Moshe Levi/);
      assert.match(text.replace(/\s+/g,' '),/Shmuel/); assert.match(text,/[א-ת]/);
      assert.doesNotMatch(text,/Upload names|Save plan|Set seats for a column|Saved in this browser/);
      for(const label of ['A8','B9','C9','D8']) assert.ok(text.includes(label),label+' missing from '+paper);
      execFileSync('pdftoppm',['-scale-to','1600','-singlefile','-png',pdf,path.join(output,'print-'+paper)]);
      execFileSync('python',['-c', 'from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGB"); data=im.tobytes(); assert all(max(data[i:i+3])-min(data[i:i+3])<=2 for i in range(0,len(data),3)), "Color pixels in black-and-white print"',path.join(output,'print-'+paper+'.png')]);
    }
    // The organizer link exists in admin, and is absent from the public homepage.
    await page.goto(origin+'/'); assert.equal(await page.locator('a[href="/seats/"]').count(),0);
    await page.addInitScript(()=>localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.now()})));
    await page.goto(origin+'/admin/'); await page.locator('a.admin-home-task[href="/seats/"]').waitFor();
    await page.locator('a.admin-home-task[href="/seats/"]').click(); await page.locator('#seat-count').waitFor();
    await page.getByRole('button',{name:'Lock',exact:true}).click(); await page.locator('#seats-pin').waitFor();
    assert.equal(await page.locator('.room-diagram').count(),0);
    const blocked=await browser.newContext();
    await blocked.addInitScript(()=>{sessionStorage.setItem('lakewood-commons-seats-unlock','open'); Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage disabled');}});});
    const blockedPage=await blocked.newPage(); await blockedPage.goto(origin+'/seats/');
    await blockedPage.locator('.storage-warning').waitFor();
    await blockedPage.locator('#plan-files summary').click();
    const blockedDownload=blockedPage.waitForEvent('download'); await blockedPage.getByRole('button',{name:'Download backup',exact:true}).click();
    assert.equal((await blockedDownload).suggestedFilename(),'seats-backup.json'); await blocked.close();
    assert.deepEqual(posts,[]); assert.deepEqual(errors,[]); assert.deepEqual(badResponses,[]);
    console.log('PASS: PIN, exact 34-table layout, counts, CSV/Excel/text imports, assignments, persistence, room objects, pointer/keyboard movement, undo, backups, mobile, admin link, and actual Letter/Tabloid PDFs.');
    console.log('Artifacts: '+output);
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
