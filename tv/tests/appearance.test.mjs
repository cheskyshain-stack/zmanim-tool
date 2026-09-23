import test from 'node:test';
import assert from 'node:assert/strict';
import {themeAt,validateAppearance,DEFAULT_APPEARANCE} from '../public/display-assets/appearance.js';
test('appearance boundaries, midnight and DST',()=>{
 const a={mode:'scheduled',darkStart:'19:00',lightStart:'07:00'};
 for(const [at,want] of [['2026-09-24T00:00:00Z','dark'],['2026-09-24T10:59:59Z','dark'],['2026-09-24T11:00:00Z','light'],['2026-01-24T12:00:00Z','light']])assert.equal(themeAt(a,at),want);
 assert.equal(themeAt(DEFAULT_APPEARANCE),'light');
 assert.throws(()=>validateAppearance({...a,lightStart:'19:00'}));
 assert.throws(()=>validateAppearance({...a,darkStart:'24:00'}));
 const spring={...a,lightStart:'02:30'};
 assert.equal(themeAt(spring,'2026-03-08T06:59:59Z'),'dark');
 assert.equal(themeAt(spring,'2026-03-08T07:00:00Z'),'light');
 const fall={...a,lightStart:'01:30'};
 assert.equal(themeAt(fall,'2026-11-01T05:29:59Z'),'dark');
 assert.equal(themeAt(fall,'2026-11-01T05:30:00Z'),'light');
 assert.equal(themeAt(fall,'2026-11-01T06:00:00Z'),'light');
 const daytime={...a,darkStart:'07:00',lightStart:'19:00'};
 assert.equal(themeAt(daytime,'2026-09-24T16:00:00Z'),'dark');
 assert.equal(themeAt(daytime,'2026-09-24T04:00:00Z'),'light');
});
test('persistent settings, validation, version conflicts and public privacy',async()=>{
 const base=process.env.DISPLAY_TEST_URL||'http://127.0.0.1:8797';
 const api=async(method,body)=>{const r=await fetch(base+'/api/display/admin/appearance',{method,headers:{'Content-Type':'application/json',Origin:base,'X-Display-Request':'1'},body:body?JSON.stringify(body):undefined});return {status:r.status,value:await r.json()}};
 const original=(await api('GET')).value;
 try {
  const next=await api('PUT',{...original,mode:'dark'});assert.equal(next.status,200);
  assert.equal((await api('GET')).value.mode,'dark');
  assert.equal((await api('PUT',{...original,mode:'light'})).status,409);
  assert.equal((await api('PUT',{...next.value,mode:'scheduled',darkStart:'07:00',lightStart:'07:00'})).status,422);
  const pub=await (await fetch(base+'/api/display/public')).json();assert.equal(pub.appearance.mode,'dark');assert.equal(pub.appearance.updatedBy,undefined);
 } finally {const current=(await api('GET')).value;await api('PUT',{...original,version:current.version});}
});

test('dark palette text contrast exceeds 4.5:1 on every card surface',()=>{
 const lum=hex=>{const c=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 for(const bg of ['0B1423','142238','1C2B40','202738'])for(const fg of ['F5F2EA','D8B76A','C5CEDB'])assert.ok((lum(fg)+.05)/(lum(bg)+.05)>=4.5,`${fg} on ${bg}`);
});
