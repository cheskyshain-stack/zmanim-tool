import { calendarRequest } from '../calendar/api.js';
import { CALENDAR_TYPES, CALENDAR_LEGACY_TYPES } from '../calendar/model.js';
import { escText, escAttr } from '../util.js';

export async function openCalendarSimchaImport({dialog,onSaved}) {
  let busy=false;
  const view=dialog('<p>New simcha messages with clear dates become calendar events automatically. Dates use the original message time in New York. Unclear information and possible duplicates appear here for review.</p><button type="button" data-simcha-scan>Process existing messages</button><p role="status" aria-live="polite"></p><div data-simcha-reviews></div>',{onClose:()=>!busy});
  view.title('Simchos from messages');
  const status=view.el.querySelector('[role=status]'),host=view.el.querySelector('[data-simcha-reviews]'),scan=view.el.querySelector('[data-simcha-scan]');
  const active=()=>view.el.isConnected;
  async function load(){
    const data=await calendarRequest('/api/simcha-import');if(!active())return;
    status.textContent=`${data.added} messages added to the calendar. ${data.duplicates} duplicates avoided. ${data.reviewCount ?? data.review.length} to review.`;
    host.innerHTML=data.review.map(record=>{
      const proposed=record.proposal||{},type=proposed.type||record.type;
      return `<section class="cal-announcement-message" data-simcha-source="${escAttr(record.messageId)}"><p><strong>Needs review</strong>: ${escText(record.reason)}</p><p dir="auto" style="white-space:pre-wrap">${escText(record.text)}</p>${record.eventId?'<p>This message is linked to an existing event. Correct that event on the calendar, then mark this review done.</p>':`<form class="cal-form"><label>Event title<input name="title" required maxlength="160" value="${escAttr(proposed.title||record.text.split('\n')[0].slice(0,160))}"></label><label>Type<select name="type">${[...CALENDAR_TYPES,...CALENDAR_LEGACY_TYPES].map(item=>`<option value="${item.id}" ${type===item.id?'selected':''}>${escText(item.label)}</option>`).join('')}</select></label><label>Custom category<input name="customCategory" maxlength="60" value="${escAttr(proposed.customCategory||'')}"></label><label>Date<input name="date" type="date" required value="${escAttr(proposed.date||'')}"></label><label>Time, if known<input name="time" type="time" value="${escAttr(proposed.time||'')}"></label><label>Details<textarea name="details" rows="5" maxlength="4364" required>${escText(proposed.details||record.text)}</textarea></label><label><input type="checkbox" name="keepReview">This message has more simchos to add</label><button class="cal-primary" type="submit">Add event</button></form>`}<button type="button" data-simcha-skip>Mark reviewed without adding</button><p role="status" data-simcha-status></p></section>`;
    }).join('')||'<p>No simcha messages need review.</p>';
    for(const record of data.review){
      const row=[...host.querySelectorAll('[data-simcha-source]')].find(el=>el.dataset.simchaSource===record.messageId);
      let operationId=crypto.randomUUID();
      const save=async(decision,event,keepReview=false)=>{
        if(busy)return;busy=true;
        row.querySelectorAll('button').forEach(button=>button.disabled=true);
        try{
          await calendarRequest('/api/simcha-import/'+encodeURIComponent(record.messageId),{method:'POST',body:{decision,event,revision:record.revision,operationId,keepReview}});
          operationId=crypto.randomUUID();await onSaved?.();await load();
        }catch(error){if(active())row.querySelector('[data-simcha-status]').textContent=error.message;}
        finally{busy=false;if(active())row.querySelectorAll('button').forEach(button=>button.disabled=false);}
      };
      row.querySelector('[data-simcha-skip]').addEventListener('click',()=>save('skip'));
      row.querySelector('form')?.addEventListener('submit',e=>{
        e.preventDefault();const form=e.currentTarget,f=new FormData(form);
        save('add',{title:f.get('title'),type:f.get('type'),customCategory:f.get('customCategory'),date:f.get('date'),time:f.get('time'),details:f.get('details')},f.get('keepReview')==='on');
      });
    }
  }
  scan.addEventListener('click',async()=>{
    if(busy)return;busy=true;scan.disabled=true;
    try{
      let after=null,total=0;
      do{
        const result=await calendarRequest('/api/simcha-import/scan',{method:'POST',body:{after}});total+=result.processed;after=result.next;
        if(!active())return;status.textContent=`Checked ${total} messages…`;
      }while(after);
      await onSaved?.();await load();
    }catch(error){if(active())status.textContent=error.message;}
    finally{busy=false;scan.disabled=false;}
  });
  try{
    const info=await calendarRequest('/api/info');if(!active())return;
    if(!info.simchaImport){scan.disabled=true;status.textContent='Automatic simcha events need a calendar service update before they can be activated.';return;}
    await load();
  }catch(error){if(active())status.textContent=error.message;}
}
