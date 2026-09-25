import {escapeHTML as esc} from './renderer.js';
import {localStamp} from './time.js';
const validDate=date=>/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(date||'')&&!Number.isNaN(Date.parse(date+'T12:00Z'))&&new Date(date+'T12:00Z').toISOString().slice(0,10)===date;
export function previewCalendar(host,api,onSelect,options={}){
 const today=()=>localStamp().slice(0,10);
 const initial=Object.hasOwn(options,'initialDate')?options.initialDate:today();
 let selected=validDate(initial)?initial:'',month=(selected||today()).slice(0,7),request=0,disposed=false;
 const description=options.description??'Select a day to see Shul View. Hebrew dates below are for daytime; the evening preview uses the Hebrew date after sunset.';
 function syncSelection(){host.querySelectorAll('[data-date]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.date===selected)));}
 function choose(date){selected=date;syncSelection();onSelect(date);}
 function toolbar(){
  const heading=new Date(month+'-01T12:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  host.innerHTML=`<div class="calendar-toolbar"><button type="button" id="month-prev" aria-label="Previous month" ${month==='2000-01'?'disabled':''}>←</button><h2 aria-live="polite">${esc(heading)}</h2><button type="button" id="month-next" aria-label="Next month" ${month==='2099-12'?'disabled':''}>→</button><label>Jump to month<input id="calendar-month" type="month" min="2000-01" max="2099-12" value="${month}"></label><button type="button" id="calendar-today">Today</button></div><p class="muted">${esc(description)}</p><div class="calendar-feedback" role="status">Loading Hebrew dates and holidays…</div><div class="month-grid"></div>`;
  const move=delta=>{const d=new Date(month+'-01T12:00Z');d.setUTCMonth(d.getUTCMonth()+delta);const next=d.toISOString().slice(0,7);if(next<'2000-01'||next>'2099-12')return;month=next;render();};
  host.querySelector('#month-prev').onclick=()=>move(-1);host.querySelector('#month-next').onclick=()=>move(1);
  host.querySelector('#calendar-month').onchange=e=>{if(/^(20\d{2})-(0[1-9]|1[0-2])$/.test(e.target.value)){month=e.target.value;render();}};
  host.querySelector('#calendar-today').onclick=()=>{month=today().slice(0,7);choose(today());render();};
 }
 async function render(){
  const token=++request;
  const requestedMonth=month;
  toolbar();
  host.setAttribute('aria-busy','true');
  try{
   const data=await api('calendar?month='+encodeURIComponent(requestedMonth));
   if(token!==request||disposed||!host.isConnected)return;
   host.querySelector('.calendar-feedback').textContent='';
   host.querySelector('.month-grid').innerHTML=`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${'<span class="calendar-empty"></span>'.repeat(data.offset)}${data.days.map(d=>`<button type="button" class="calendar-day" data-date="${esc(d.date)}" aria-pressed="${d.date===selected}" ${d.date===today()?'aria-current="date"':''} aria-label="${esc(d.date+' '+d.hebrew+' '+d.holidays.join(', '))}"><strong>${esc(d.day)}</strong><span class="hebrew-date" dir="rtl">${esc(d.hebrew)}</span>${d.holidays.map(h=>`<span class="calendar-holiday" dir="rtl">${esc(h)}</span>`).join('')}</button>`).join('')}`;
   host.querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>choose(button.dataset.date));
  }catch(e){
   if(token===request&&!disposed&&host.isConnected){
    host.querySelector('.calendar-feedback').innerHTML=`<span>${esc(e.message||'Unable to load the calendar.')}</span> <button type="button" class="calendar-retry">Try again</button>`;
    host.querySelector('.calendar-retry').onclick=render;
    options.onError?.(e);
   }
  }
  finally{if(token===request)host.removeAttribute('aria-busy');}
 }
 render();
 return {
  select(date){
   if(date!==''&&!validDate(date))return false;
   selected=date;
   if(date&&month!==date.slice(0,7)){month=date.slice(0,7);render();}else syncSelection();
   return true;
  },
  destroy(){disposed=true;request++;host.removeAttribute('aria-busy');}
 };
}
