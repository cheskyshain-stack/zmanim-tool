const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../dist'),remote=process.env.SEATS_CHECK_ORIGIN,output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-print-'));
const server=http.createServer((request,response)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){response.statusCode=403;return response.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){response.statusCode=404;return response.end();}
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');response.end(fs.readFileSync(file));
});
const edgeNames=[['A1',0,'Front Left'],['D1',4,'Front Right'],['A8',0,'Back Left'],['D8',2,'Back Right'],['B9',4,'Middle Left'],['C9',4,'Middle Right']];
const inspectPdf=String.raw`
import json,sys,xml.etree.ElementTree as ET
import fitz
from PIL import Image,ImageChops
image=Image.open(sys.argv[1]).convert('L')
width,height=image.size
physical_width,physical_height,safe=map(float,sys.argv[3:6])
ink=image.point(lambda value: 0 if value<220 else 255)
box=ImageChops.invert(ink).getbbox()
assert box, 'Printed chart is missing'
left,top,right,bottom=box
margins=[left/width*physical_width,top/height*physical_height,(width-right)/width*physical_width,(height-bottom)/height*physical_height]
assert min(margins)>=safe, ('Ink outside the safe printable area',margins,safe)
data=ink.tobytes()
assert any(data[y*width:(y+1)*width].count(0)>(right-left)*.7 for y in range(max(top,bottom-6),bottom)), 'The full bottom cabinet edge must be visible'
page=ET.parse(sys.argv[2]).find('.//{*}page')
page_width,page_height=float(page.attrib['width']),float(page.attrib['height'])
words=page.findall('.//{*}word')
assert words, 'Printed text bounds are missing'
# Font boxes include unused ascender space; actual ink uses the full safe margin above.
text_safe=max(.2,safe-.15)
for word in words:
    x0,y0,x1,y1=(float(word.attrib[key]) for key in ['xMin','yMin','xMax','yMax'])
    assert min(x0,y0,page_width-x1,page_height-y1)>=text_safe*72-.8, ('A name or label extends outside the printable area',word.text,word.attrib)
front=next(word for word in words if word.text=='Front')
front_ratio=(float(front.attrib['xMax'])-float(front.attrib['xMin']))/(float(front.attrib['yMax'])-float(front.attrib['yMin']))
vertical=next(word for word in words if word.text=='Sefarim')
vertical_ratio=(float(vertical.attrib['yMax'])-float(vertical.attrib['yMin']))/(float(vertical.attrib['xMax'])-float(vertical.attrib['xMin']))
document=fitz.open(sys.argv[6]);pdf_page=document[0]
rectangles=[item[1] for drawing in pdf_page.get_drawings() if drawing['type'] in ('s','fs') for item in drawing['items'] if item[0]=='re']
# Locate the actual shtender around its Rav label, including native scaling and margins.
rav=next(word for word in words if word.text=='Rav')
center=fitz.Point((float(rav.attrib['xMin'])+float(rav.attrib['xMax']))/2,(float(rav.attrib['yMin'])+float(rav.attrib['yMax']))/2)
shtender=[rect for rect in rectangles if rect.contains(center) and 4<rect.width<35 and 4<rect.height<35]
assert len(shtender)==1, ('The printed shtender is missing',shtender)
assert abs(shtender[0].width-shtender[0].height)<.15, ('The printed shtender must stay square',shtender)
print(json.dumps({'marginsInches':[round(value,3) for value in margins],'frontWordRatio':front_ratio,'verticalWordRatio':vertical_ratio,'shtenderSquare':True,'bottomEdgeComplete':True,'textWithinPage':True}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=remote||'http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{
    const {seatsCreateState}=await import('../js/seats/model.js'),sample=seatsCreateState();
    sample.plans[0].objects.push({id:'test-case',type:'cabinet',label:'Test Sefarim',x:280,y:320,width:24,height:120});
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1050},isMobile:width===375,hasTouch:width===375});
      await context.addInitScript(state=>localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(state)),sample);
      if(remote)await context.route('**://static.cloudflareinsights.com/**',route=>route.abort());
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/seats/?verify=safe-print-'+Date.now()+'&count=off');
      await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.locator('.room-stage .table-item').first().waitFor();
      for(const [table,index,name] of edgeNames){
        await page.locator('.room-stage [data-table="'+table+'"][data-seat="'+index+'"]').click();
        await page.locator('#seat-name-input').fill(name);await page.locator('#seat-name-input').press('Enter');
      }
      let letteringRatio,verticalRatio;
      const cases=[{name:'letter',paper:'letter'},{name:'tabloid',paper:'tabloid'},...['Letter','Tabloid','Legal','A4','A5'].map(format=>({name:'auto-'+format.toLowerCase(),paper:'auto',format})),{name:'auto-letter-browser-zoom',paper:'auto',format:'Letter',zoom:1.25},{name:'auto-tabloid-browser-zoom',paper:'auto',format:'Tabloid',zoom:1.5}];
      if(width===1440)cases.push({name:'tabloid-on-letter',paper:'tabloid',nativeLetter:true},{name:'letter-larger-margins',paper:'letter',margin:.75,color:true},{name:'tabloid-larger-margins',paper:'tabloid',margin:.75},{name:'auto-tabloid-larger-margins',paper:'auto',format:'Tabloid',margin:.75});
      for(const testCase of cases){
        await page.locator('#paper-size').selectOption(testCase.paper);await page.locator('#print-color').selectOption(testCase.color?'color':'mono');
        let override=null;
        if(testCase.margin)override=await page.addStyleTag({content:'@page{margin:'+testCase.margin+'in!important}'});
        const zoomStyle=testCase.zoom?await page.addStyleTag({content:'@media print{html{zoom:'+testCase.zoom+'}}'}):null;
        await page.emulateMedia({media:'print'});
        const label=width+'-'+testCase.name,pdf=path.join(output,label+'.pdf');
        await page.pdf({path:pdf,printBackground:true,preferCSSPageSize:!testCase.nativeLetter,...(testCase.nativeLetter?{format:'Letter',landscape:true}:testCase.format?{format:testCase.format,landscape:true}:{})});
        const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}),text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
        assert.match(info,/Pages:\s+1\b/,label);
        const format=testCase.format||(testCase.paper==='letter'||testCase.nativeLetter?'Letter':'Tabloid');
        const dimensions=info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/).slice(1).map(Number),expected=({Letter:[792,612],Tabloid:[1224,792],Legal:[1008,612],A4:[841.89,595.28],A5:[595.28,419.53]})[format];
        assert.ok(dimensions.every((dimension,index)=>Math.abs(dimension-expected[index])<1.1),label+' '+dimensions);
        for(const [, ,name] of edgeNames)assert.ok(text.includes(name),name+' is missing in '+label);
        for(const column of ['A','B','C','D'])for(let row=1;row<=(['A','D'].includes(column)?8:9);row++)assert.match(text,new RegExp('\\b'+column+row+'\\b'),label);
        const imageBase=path.join(output,label),bbox=path.join(output,label+'.html');
        execFileSync('pdftoppm',['-scale-to','1600','-singlefile','-png',pdf,imageBase]);execFileSync('pdftotext',['-bbox',pdf,bbox]);
        const safe=testCase.margin ? .7 : testCase.paper==='tabloid'&&!testCase.nativeLetter ? .45 : .3;
        const metrics=JSON.parse(execFileSync('python',['-c',inspectPdf,imageBase+'.png',bbox,...dimensions.map(dimension=>String(dimension/72)),String(safe),pdf],{encoding:'utf8'}));
        assert.ok(metrics.marginsInches[0]<(testCase.margin?1.25:.65)&&metrics.marginsInches[2]<(testCase.margin?1.25:.65),'The chart should still fill the printable width: '+label+' '+JSON.stringify(metrics));
        if(testCase.name==='letter'){letteringRatio=metrics.frontWordRatio;verticalRatio=metrics.verticalWordRatio;}
        if(testCase.paper==='auto'){
          assert.ok(metrics.marginsInches.every(margin=>margin<(testCase.margin||.35)*(testCase.zoom||1)+.13),'Auto fit should fill both width and height: '+label+' '+JSON.stringify(metrics));
          assert.ok(Math.abs(metrics.frontWordRatio-letteringRatio)<.015,'Printed lettering must retain its proportions: '+label+' '+metrics.frontWordRatio);
          assert.ok(Math.abs(metrics.verticalWordRatio-verticalRatio)<.015,'Rotated lettering must retain its proportions: '+label+' '+metrics.verticalWordRatio);
          assert.match(await page.locator('#seats-print .room-landmark .seat-name').first().evaluate(node=>getComputedStyle(node).fontFamily),/Georgia/);
        }
        console.log(JSON.stringify({case:label,...metrics}));
        await page.emulateMedia({media:'screen'});if(zoomStyle)await zoomStyle.evaluate(node=>node.remove());if(override)await override.evaluate(node=>node.remove());
      }
      const people=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans[0].people);
      assert.deepEqual(people.map(person=>person.name).sort(),edgeNames.map(entry=>entry[2]).sort());assert.deepEqual(errors,[]);
      if(remote){
        const html=await(await context.request.get(origin+'/seats/?verify=safe-print-assets-'+Date.now())).text(),map=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports,css=html.match(/href="(\.\.\/css\/seats\.css\?v=[a-f0-9]+)"/)[1];
        for(const file of ['/js/seats-app.js','/js/seats/model.js','/js/seats/print.js'])assert.ok((await(await context.request.get(origin+map[file])).body()).equals(fs.readFileSync(root+file)),file);
        assert.ok((await(await context.request.get(new URL(css,origin+'/seats/').href)).body()).equals(fs.readFileSync(root+'/css/seats.css')));
      }
      await context.close();
    }
    console.log('PASS: full chart, corner names and bottom cabinets stay on one page. Auto fit fills native Letter, Tabloid, Legal, A4 and A5 without stretching lettering, including 125% and 150% browser zoom. Fixed-size PDFs and larger margins remain supported on phone and desktop.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
