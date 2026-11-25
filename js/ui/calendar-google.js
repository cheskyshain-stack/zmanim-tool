import { calendarRequest } from '../calendar/api.js';
import { escText } from '../util.js';

export async function openCalendarGoogle(dialog, returnedState='') {
  const view=dialog('<div data-google-content><p role="status">Checking Google Calendar…</p></div>');
  view.title('Google Calendar');
  const content=view.el.querySelector('[data-google-content]');
  const escape=value=>escText(String(value||''));
  let closed=false;
  view.el.addEventListener('close',()=>{closed=true;},{once:true});
  try {
    const info=await calendarRequest('/api/info');
    if(!info.googleCalendar) {content.innerHTML='<p>Google Calendar will be available after the shul admin updates the calendar service.</p>';return;}
    let state;
    if(returnedState && returnedState!=='cancelled') state=await calendarRequest('/api/google-calendar/complete',{method:'POST',body:{state:returnedState}});
    else state=await calendarRequest('/api/google-calendar');
    if(closed)return;
    function paint(message='') {
      content.innerHTML=`<p>Keep shul events in a separate <strong>Lakewood Commons</strong> calendar in your Google account. Event titles start with LC ·. You can choose the calendar's color in Google.</p>
        <p>New events, changes and deletions sync automatically, usually within a few minutes. Your personal appointments stay untouched. Changes made in Google do not update this website.</p>
        <p>Only saved congregation events sync. Message previews and private admin notes are excluded.</p>
        <p><a href="/privacy/google-calendar/" target="_blank" rel="noopener">Google Calendar privacy</a></p>
        ${!state.available?'<p>The shul admin still needs to finish Google setup.</p>':state.connected?`<p><strong>${state.disconnecting?'Turning off sync and removing the shul calendar…':'Google Calendar sync is on'}</strong></p>
        ${state.lastSyncedAt?`<p>Last synced: ${escape(new Date(state.lastSyncedAt).toLocaleString())}</p>`:''}
        ${state.disconnecting?'':`<label>Event reminders<select data-google-reminders><option value="0">No reminders</option><option value="10">10 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label><p>Google delivers reminders according to your phone and Google settings.</p><button type="button" data-google-save>Save reminders</button><button type="button" data-google-off>Turn off and remove shul calendar</button>`}`:'<p>Google Calendar sync is off.</p><button type="button" class="cal-primary" data-google-connect>Connect Google Calendar</button>'}
        ${state.disconnecting && state.error.includes('Reconnect')?'<p>Google permission has expired. Remove the Lakewood Commons calendar in Google to stop its existing reminders, then forget this connection here.</p><button type="button" data-google-forget>I removed it in Google. Forget connection.</button>':''}
        ${state.connected?'<button type="button" data-google-refresh>Refresh connection status</button>':''}
        <p role="status" aria-live="polite">${escape(message||state.error||(returnedState==='cancelled'?'Google connection cancelled.':''))}</p>`;
      const select=content.querySelector('[data-google-reminders]');if(select)select.value=String(state.reminders);
      const action=(selector,work)=>content.querySelector(selector)?.addEventListener('click',async()=>{
        const buttons=content.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
        try {await work();}catch(e){if(!closed)paint(e.message);}
        finally{buttons.forEach(b=>b.disabled=false);}
      });
      action('[data-google-connect]',async()=>{
        const result=await calendarRequest('/api/google-calendar/connect',{method:'POST',body:{}});
        const target=new URL(result.url);
        if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')throw Error('Google returned an invalid connection link.');
        location.assign(target.href);
      });
      action('[data-google-save]',async()=>{state=await calendarRequest('/api/google-calendar',{method:'PUT',body:{reminders:Number(select.value)}});if(!closed)paint('Reminder preference saved.');});
      action('[data-google-off]',async()=>{
        if(!confirm('Turn off sync and remove the Lakewood Commons calendar and its reminders from Google? Your personal appointments stay untouched.'))return;
        state=await calendarRequest('/api/google-calendar',{method:'DELETE',body:{}});if(!closed)paint();
      });
      action('[data-google-forget]',async()=>{state=await calendarRequest('/api/google-calendar/forget',{method:'POST',body:{}});if(!closed)paint('Connection forgotten.');});
      action('[data-google-refresh]',async()=>{state=await calendarRequest('/api/google-calendar');if(!closed)paint();});
    }
    paint();
  } catch(e) {if(!closed)content.innerHTML=`<p role="status">${escape(e.message)}</p><p>If Google authorization has been revoked, remove the Lakewood Commons calendar in Google to stop its existing reminders.</p>`;}
}
