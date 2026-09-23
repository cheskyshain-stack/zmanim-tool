import {escapeHTML as esc} from './renderer.js';
import {localStamp} from './time.js';
export function previewCalendar(host,api,onSelect){
 let selected=localStamp().slice(0,10),month=selected.slice(0,7),request=0;
 async function render(){
  const token=++request;
  host.setAttribute('aria-busy','true');
  try{
   const data=await api('calendar?month='+encodeURIComponent(month));
   if(token!==request||!host.isConnected)return;
   const heading=new Date(month+'-01T12:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
   host.innerHTML=`<div class="calendar-toolbar"><button type="button" id="month-prev" aria-label="Previous month">←</button><h2>${esc(heading)}</h2><button type="button" id="month-next" aria-label="Next month">→</button><label>Jump to month<input id="calendar-month" type="month" min="2000-01" max="2099-12" value="${month}"></label><button type="button" id="calendar-today">Today</button></div><p class="muted">Select a day to see the TV screen. Hebrew dates below are for daytime; the evening preview uses the Hebrew date after sunset.</p><div class="month-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${'<span class="calendar-empty"></span>'.repeat(data.offset)}${data.days.map(d=>`<button type="button" class="calendar-day" data-date="${d.date}" aria-pressed="${d.date===selected}" ${d.date===localStamp().slice(0,10)?'aria-current="date"':''} aria-label="${esc(d.date+' '+d.hebrew+' '+d.holidays.join(', '))}"><strong>${d.day}</strong><span class="hebrew-date" dir="rtl">${esc(d.hebrew)}</span>${d.holidays.map(h=>`<span class="calendar-holiday" dir="rtl">${esc(h)}</span>`).join('')}</button>`).join('')}</div>`;
   const move=delta=>{const d=new Date(month+'-01T12:00Z');d.setUTCMonth(d.getUTCMonth()+delta);const next=d.toISOString().slice(0,7);if(next<'2000-01'||next>'2099-12')return;month=next;render();};
   host.querySelector('#month-prev').onclick=()=>move(-1);host.querySelector('#month-next').onclick=()=>move(1);
   host.querySelector('#calendar-month').onchange=e=>{if(/^(20\d{2})-(0[1-9]|1[0-2])$/.test(e.target.value)){month=e.target.value;render();}};
   host.querySelector('#calendar-today').onclick=()=>{selected=localStamp().slice(0,10);month=selected.slice(0,7);render();onSelect(selected);};
   host.querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{selected=button.dataset.date;host.querySelectorAll('[data-date]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));onSelect(selected);});
  }catch(e){if(token===request&&host.isConnected)host.textContent=e.message;}
  finally{if(token===request)host.removeAttribute('aria-busy');}
 }
 render();
 return {select(date){selected=date;month=date.slice(0,7);render();}};
}
