import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {dateInfo} from '../src/schedules.js';
import {nextYomTovWindows} from '../public/display-assets/notice-recurrence.js';
const {chromium}=createRequire(import.meta.url)('playwright');
// All writes are development fixtures in a local D1 database only.
const origin=process.env.DISPLAY_TEST_URL||'http://127.0.0.1:8795';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const out=process.env.RECURRENCE_SCREENSHOTS||'/tmp/tv-recurring-layout';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true});
const errors=[],saved=[];
async function api(path,method='GET',body){
  const response=await fetch(origin+'/api/display/admin/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Display-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
}
try{
 for(const width of [393,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/admin/display/');await page.locator('[data-new=announcement]').click();
  const title='DEVELOPMENT yearly appeal '+width+' '+Date.now();
  await page.locator('[name=title]').fill(title);await page.locator('[name=category]').selectOption('Donation appeals');
  await page.locator('[name=message]').fill('Donations for צרכי יום טוב are urgently needed. Give through the pushka next to the coffee, the kiosk in the lobby under צרכי יום טוב, or one of the Vaad members. Thank you. תזכו למצוות');
  await page.locator('[name=startLocal]').fill('2026-01-01T09:00');await page.locator('[name=endLocal]').fill('2026-01-01T10:00');
  await page.locator('[name=repeat]').selectOption('before-yom-tov');
  for(const id of ['pesach','sukkos','shavuos'])assert(await page.locator('[name=before-'+id+']').isChecked());
  assert(await page.locator('#one-time-timing').isHidden());
  await page.locator('#exact-times').getByText('Upcoming dates (New York)').waitFor();
  assert.equal(await page.locator('.recurrence-date').count(),3);
  const measure=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,checkboxes:[...document.querySelectorAll('.yom-tov-choices label')].map(e=>e.getBoundingClientRect().height)}));
  assert(!measure.overflow);assert(measure.checkboxes.every(h=>h>=44));
  await page.locator('#yearly-timing').screenshot({path:out+'/yearly-'+width+'.png'});
  // Empty selection gives a useful message and cannot publish.
  for(const id of ['pesach','sukkos','shavuos'])await page.locator('[name=before-'+id+']').uncheck();
  await page.locator('#exact-times').getByText('Select at least one Yom Tov.').waitFor();
  await page.locator('button[type=submit]').click();await page.locator('#error').getByText('Select at least one Yom Tov.').waitFor();
  for(const id of ['pesach','sukkos','shavuos'])await page.locator('[name=before-'+id+']').check();
  await page.locator('#draft').click();await page.locator('[data-new=announcement]').waitFor();
  let row=(await api('items')).find(i=>i.title===title);assert(row);saved.push(row.id);
  assert.equal(row.status,'draft');assert.equal(row.startsAt,null);assert.equal(row.endsAt,null);
  assert.deepEqual(row.data.recurrence.holidays,['pesach','sukkos','shavuos']);
  async function reopen(filter){
    if(await page.locator('#saved-items').count())await page.locator('#saved-items').click();
    await page.locator('[data-filter='+filter+']').click();await page.locator('[data-edit="'+row.id+'"]').click();
  }
  await reopen('draft');assert.equal(await page.locator('[name=repeat]').inputValue(),'before-yom-tov');
  assert(await page.locator('[name=before-shavuos]').isChecked());
  await page.locator('#preview').click();
  await page.locator('#timeline').getByText(title).waitFor();
  assert((await page.locator('#timeline').getByText(title).innerText()).includes('showing'));
  assert.equal((await page.locator('#at').inputValue()).slice(0,10),nextYomTovWindows(row.data.recurrence,new Date().toISOString(),dateInfo)[0].startsAt.slice(0,10));
  await page.locator('#back').click();assert.equal(await page.locator('[name=repeat]').inputValue(),'before-yom-tov');
  // One-time controls can be restored without losing the selected holidays.
  await page.locator('[name=repeat]').selectOption('once');assert(await page.locator('#one-time-timing').isVisible());
  await page.locator('[name=repeat]').selectOption('before-yom-tov');
  await page.locator('button[type=submit]').click();await page.locator('#confirm #yes').click();await page.locator('[data-new=announcement]').waitFor();
  row=(await api('items')).find(i=>i.id===row.id);assert.equal(row.status,'published');
  const window=nextYomTovWindows(row.data.recurrence,new Date().toISOString(),dateInfo)[0];
  for(const [at,visible] of [[new Date(Date.parse(window.startsAt)-1).toISOString(),false],[window.startsAt,true],[window.endsAt,false]]){
    const preview=await api('preview','POST',{at});assert.equal(preview.items.some(i=>i.id===row.id),visible);
  }
  // Reopen, change selected holidays, publish again, then hide it using the existing control.
  await reopen(row.phase);await page.locator('[name=before-shavuos]').uncheck();
  await page.locator('button[type=submit]').click();await page.locator('#confirm #yes').click();await page.locator('[data-new=announcement]').waitFor();
  row=(await api('items')).find(i=>i.id===row.id);assert.deepEqual(row.data.recurrence.holidays,['pesach','sukkos']);
  await api('items/'+row.id+'/hide','POST',{version:row.version});
  assert(!(await api('preview','POST',{at:window.startsAt})).items.some(i=>i.id===row.id));
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({widths:[393,1440],errors,screenshots:out,localFixtures:saved.length}));
}finally{
 for(const id of saved){const row=(await api('items')).find(i=>i.id===id);if(row&&row.status!=='archived')await api('items/'+id+'/archive','POST',{version:row.version});}
 await browser.close();
}
