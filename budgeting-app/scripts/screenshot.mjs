import { chromium } from 'playwright-core';
import fs from 'node:fs';
const exe = fs.existsSync('/opt/pw-browsers/chromium/chrome-linux/chrome')
  ? '/opt/pw-browsers/chromium/chrome-linux/chrome'
  : fs.readdirSync('/opt/pw-browsers').filter(d=>d.startsWith('chromium-')).map(d=>`/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p=>fs.existsSync(p));
const b = await chromium.launch({ executablePath: exe, args:['--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:1000} });
const out='/tmp/claude-0/-home-user-zmanim-tool/9a39ff63-9658-59eb-932f-6a7fb4a1d464/scratchpad/shots';
fs.mkdirSync(out,{recursive:true});
await p.goto('http://localhost:3412/login');
await p.screenshot({path:`${out}/1-login.png`});
await p.fill('input[name=password]','changeme');
await p.click('button:has-text("Sign in")');
await p.waitForURL('**/');
await p.waitForTimeout(800);
await p.screenshot({path:`${out}/2-dashboard.png`, fullPage:true});
console.log('dashboard title:', await p.textContent('h1'));
await p.goto('http://localhost:3412/review'); await p.waitForTimeout(600);
await p.screenshot({path:`${out}/3-review.png`});
console.log('review title:', await p.textContent('h1'));
await p.goto('http://localhost:3412/transactions'); await p.waitForTimeout(600);
await p.screenshot({path:`${out}/4-transactions.png`});
console.log('rows:', await p.locator('tbody tr').count());
await b.close();
