import { calendarIsLechaim } from '../../js/calendar/model.js';
import { simchaEventPresentation } from '../../js/calendar/simcha-message.js';
import { shiftDate } from '../traffic-calendar.js';
const scope = 'https://www.googleapis.com/auth/calendar.app.created';
const apiRoot = 'https://www.googleapis.com/calendar/v3';
const prefix = 'google-connection:';
const enc = new TextEncoder();
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const error = (message,status=400) => Object.assign(new Error(message),{status});
const json = data => Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
export function googleReady(env) {
  return !!(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && /^[a-f0-9]{64}$/i.test(env.GOOGLE_CALENDAR_TOKEN_KEY || '') && /^https:\/\/[^/?#]+\/api\/google-calendar\/callback$/.test(env.GOOGLE_CALENDAR_REDIRECT_URI || ''));
}
async function crypt(env,user,value,decrypt=false) {
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.GOOGLE_CALENDAR_TOKEN_KEY.match(/../g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt','decrypt']);
  if(decrypt) {
    const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:enc.encode(user)},key,bytes.slice(12)));
  }
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(user)},key,enc.encode(value)));
  return btoa(String.fromCharCode(...iv,...bytes));
}
async function tokenRequest(env,fields,send) {
  const response=await send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CALENDAR_CLIENT_ID,client_secret:env.GOOGLE_CALENDAR_CLIENT_SECRET,...fields}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok) throw error(data.error==='invalid_grant'?'Reconnect Google Calendar to resume syncing.':'Google authorization is temporarily unavailable.',data.error==='invalid_grant'?401:503);
  if(!data.access_token) throw error('Google did not complete authorization.',503);
  return data;
}
async function accessToken(env,user,connection,send) {
  return (await tokenRequest(env,{grant_type:'refresh_token',refresh_token:await crypt(env,user,connection.refresh,true)},send)).access_token;
}
async function google(token,path,method,body,send,allowed=[]) {
  const response=await send(apiRoot+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  if(allowed.includes(response.status)) {await response.body?.cancel();return {missing:response.status};}
  if(!response.ok) {await response.body?.cancel();throw error(response.status===401?'Reconnect Google Calendar to resume syncing.':'Google Calendar could not complete this request. Try again.',response.status===401?401:503);}
  return response.status===204?{}:response.json();
}
export async function googleEvent(event,reminders=0,generation='') {
  event=simchaEventPresentation(event);
  const endDate=event.endDate||event.date;
  let start,end;
  if(!event.time) {start={date:event.date};end={date:shiftDate(endDate,1)};}
  else {
    start={dateTime:event.date+'T'+event.time+':00',timeZone:'America/New_York'};
    if(event.endTime) end={dateTime:endDate+'T'+event.endTime+':00',timeZone:'America/New_York'};
    else {
      // Google requires an end. A missing source duration gets one hour, labelled below.
      const clock=new Date(endDate+'T'+event.time+':00Z');clock.setUTCHours(clock.getUTCHours()+1);
      end={dateTime:clock.toISOString().slice(0,19),timeZone:'America/New_York'};
    }
  }
  return {id:'lc'+await digest(generation+':'+event.id),summary:'LC · '+event.title,
    description:(event.details||event.description||'')+'\n\nLakewood Commons\nhttps://baismedrashoflakewoodcommons.org/calendar/'+(event.time&&!event.endTime?'\nEnd time is an estimated one hour after the start.':''),
    location:event.location||'',start,end,visibility:'private',
    reminders:{useDefault:false,overrides:reminders?[{method:'popup',minutes:reminders}]:[]}};
}
const publicStatus = (env,c) => ({available:googleReady(env),connected:!!c?.refresh,enabled:!!c?.refresh&&!c.disabling,
  disconnecting:!!c?.disabling,reminders:c?.reminders||0,lastSyncedAt:c?.lastSyncedAt||null,error:c?.error||'',name:'Lakewood Commons'});

// Called only after a normal signed-in account check. No Google tokens leave the service.
export async function manageGoogle(storage,env,request,user,body,send=fetch) {
  const path=new URL(request.url).pathname,method=request.method,key=prefix+user.id;
  let connection=await storage.get(key);
  if(path==='/api/google-calendar'&&method==='GET') return json(publicStatus(env,connection));
  if(path==='/api/google-calendar/forget'&&method==='POST') {
    if(!connection?.disabling || !connection.error?.includes('Reconnect')) throw error('Turn off sync first. Only an expired connection can be forgotten.',409);
    for(const [k]of await storage.list({prefix:'google-entry:'+user.id+':'}))await storage.delete(k);
    await storage.delete(key);return json(publicStatus(env,null));
  }
  if(!googleReady(env) && method !== 'DELETE') throw error('Google Calendar setup has not been completed by the shul admin.',503);
  if(path==='/api/google-calendar/connect'&&method==='POST') {
    if(connection) throw error('Turn off the existing Google connection before connecting again.',409);
    const state=random(),verifier=random();
    await storage.put('google-state:'+await digest(state),{userId:user.id,version:user.version,verifier,expires:Date.now()+10*60000});
    const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:env.GOOGLE_CALENDAR_CLIENT_ID,redirect_uri:env.GOOGLE_CALENDAR_REDIRECT_URI,response_type:'code',scope,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
    return json({url:url.href});
  }
  if(path==='/api/google-calendar/complete'&&method==='POST') {
    if(connection) throw error('This account already has a Google connection.',409);
    const stateKey='google-state:'+await digest(String(body.state||'')),pending=await storage.get(stateKey);
    if(!pending || pending.userId!==user.id || pending.version!==user.version || pending.expires<=Date.now() || !pending.code) throw error('The Google connection expired. Try connecting again.');
    await storage.delete(stateKey);
    const tokens=await tokenRequest(env,{grant_type:'authorization_code',code:await crypt(env,user.id,pending.code,true),code_verifier:pending.verifier,redirect_uri:env.GOOGLE_CALENDAR_REDIRECT_URI},send);
    if(!tokens.refresh_token || tokens.scope && !tokens.scope.split(' ').includes(scope)) throw error('Google Calendar permission was not granted. Try connecting again.');
    connection={userId:user.id,refresh:await crypt(env,user.id,tokens.refresh_token),generation:random(),reminders:0,nextAt:Date.now()};
    await storage.put(key,connection);await schedule(storage,Date.now()+1000);
    return json(publicStatus(env,connection));
  }
  if(path==='/api/google-calendar'&&method==='PUT') {
    if(!connection||connection.disabling) throw error('Connect Google Calendar first.',409);
    if(![0,10,30,60,1440].includes(body.reminders)) throw error('Choose a supported reminder time.');
    connection={...connection,reminders:body.reminders,nextAt:Date.now(),error:''};
    await storage.put(key,connection);await schedule(storage,Date.now()+1000);
    return json(publicStatus(env,connection));
  }
  if(path==='/api/google-calendar'&&method==='DELETE') {
    // Disable before any network request. Retain encrypted authorization only until cleanup succeeds.
    const states=await storage.list({prefix:'google-state:'});
    for(const [k,v]of states) if(v.userId===user.id) await storage.delete(k);
    if(connection) {connection={...connection,disabling:true,nextAt:Date.now(),error:''};await storage.put(key,connection);await schedule(storage,Date.now()+1000);}
    return json(publicStatus(env,connection));
  }
  throw error('Google Calendar setting not found.',404);
}
export async function googleCallback(storage,env,url) {
  if(!googleReady(env)) throw error('Google Calendar setup is incomplete.',503);
  const state=url.searchParams.get('state')||'';
  if(!/^[a-f0-9]{64}$/.test(state)) throw error('The Google connection expired.');
  const key='google-state:'+await digest(state),pending=await storage.get(key);
  const user=pending&&await storage.get('user:'+pending.userId);
  if(!pending||pending.expires<=Date.now()||pending.code||!user?.active||user.version!==pending.version) throw error('The Google connection expired.');
  const code=url.searchParams.get('code');
  if(url.searchParams.has('error')||!code||code.length>4096) {
    await storage.delete(key);
    return new Response(null,{status:303,headers:{Location:env.ALLOWED_ORIGIN+'/calendar/#google-calendar=cancelled','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  await storage.put(key,{...pending,code:await crypt(env,user.id,code)});
  return new Response(null,{status:303,headers:{Location:env.ALLOWED_ORIGIN+'/calendar/#google-calendar='+state,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
async function schedule(storage,at) {const old=await storage.getAlarm();if(!old||old>at)await storage.setAlarm(at);}

// Bounded batches run through the existing alarm. Each successful write is checkpointed.
// Deterministic event IDs make retries safe after a lost Google response.
export async function runGoogleSync(storage,env,now=Date.now(),send=fetch) {
  if(!googleReady(env)) return Infinity;
  const deadline=Date.now()+12000,transport=send;
  send=(url,options)=>transport(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});
  const connections=await storage.list({prefix});
  let next=Infinity,processed=false;
  for(const [key,c] of connections) {
    if(c.nextAt>now) {next=Math.min(next,c.nextAt);continue;}
    if(processed) {next=Math.min(next,now+1000);continue;} processed=true;
    const entryPrefix='google-entry:'+c.userId+':';
    c.entries=Object.fromEntries([...(await storage.list({prefix:entryPrefix}))].map(([k,v])=>[k.slice(entryPrefix.length),v]));
    const save=()=>{const {entries,...record}=c;return storage.put(key,record);};
    try {
      const user=await storage.get('user:'+c.userId);
      if(!user?.active) c.disabling=true;
      const token=await accessToken(env,c.userId,c,send);
      if(c.disabling) {
        if(c.calendarId) await google(token,'/calendars/'+encodeURIComponent(c.calendarId),'DELETE',null,send,[404,410]);
        // Do not revoke the app grant: the same Google account may connect another site account.
        const entryKeys=Object.keys(c.entries).map(id=>entryPrefix+id);
        for(let i=0;i<entryKeys.length;i+=100)await storage.delete(entryKeys.slice(i,i+100));
        await storage.delete(key);continue;
      }
      if(!c.calendarId) {
        // Mark provisioning before the non-idempotent calendar insert. A lost response must not create another calendar.
        if(c.provisioning) throw error('Google calendar creation was interrupted. Turn off sync, remove any empty Lakewood Commons calendar in Google, then reconnect.',409);
        c.provisioning=true;await save();
        const calendar=await google(token,'/calendars','POST',{summary:'Lakewood Commons',timeZone:'America/New_York',description:'Community events from Bais Medrash of Lakewood Commons. Managed from the shul website.'},send);
        if(!calendar.id || calendar.id==='primary') throw error('Google did not return the new shul calendar.',503);
        c.calendarId=calendar.id;c.provisioning=false;await save();
      }
      if(!c.styled && (!c.styleRetryAt || c.styleRetryAt<=now)) {
        try {
          await google(token,'/users/me/calendarList/'+encodeURIComponent(c.calendarId)+'?colorRgbFormat=true','PATCH',{backgroundColor:'#1b3654',foregroundColor:'#ffffff',selected:true,defaultReminders:[]},send);
          c.styled=true;delete c.styleRetryAt;
        } catch {
          // Google can reject calendar-list styling while permitting this app's event writes.
          // Optional appearance must not block sync or require another member authorization.
          c.styleRetryAt=now+60*60000;
        }
        await save();
      }
      const all=await storage.list({prefix:'event:'});
      // Only congregation-visible source events are ever copied, including for the owner.
      const events=[...all.values()].filter(e=>!e.deletedAt&&!calendarIsLechaim(e)&&e.visibility!=='admins');
      const wanted=new Set(events.map(e=>e.id));
      let writes=0,pending=false;
      for(const event of events) {
        const payload=await googleEvent(event,c.reminders,c.generation);
        const old=c.entries[event.id];if(old?.id)payload.id=old.id;
        let fingerprint=await digest(JSON.stringify(payload));if(old?.fingerprint===fingerprint)continue;
        if(writes>=20 || Date.now()>deadline-2000){pending=true;break;}writes++;
        const base='/calendars/'+encodeURIComponent(c.calendarId)+'/events';
        for(let attempt=0;attempt<3;attempt++) {
          let result=await google(token,base+'/'+payload.id,'PUT',payload,send,[404,410]);
          if(result.missing===404) {
            result=await google(token,base,'POST',payload,send,[409]);
            if(result.missing===409) result=await google(token,base+'/'+payload.id,'PUT',payload,send,[410]);
          }
          if(result.missing!==410) break;
          if(attempt===2) throw error('Google Calendar could not restore the event.',503);
          payload.id='lc'+random();fingerprint=await digest(JSON.stringify(payload));
          c.entries[event.id]={id:payload.id,fingerprint:''};await storage.put(entryPrefix+event.id,c.entries[event.id]);await save();
        }
        c.entries[event.id]={id:payload.id,fingerprint};await storage.put(entryPrefix+event.id,c.entries[event.id]);await save();
      }
      for(const [id,old]of Object.entries(c.entries)) {
        if(wanted.has(id))continue;
        if(writes>=20 || Date.now()>deadline-2000){pending=true;break;}writes++;
        await google(token,'/calendars/'+encodeURIComponent(c.calendarId)+'/events/'+old.id,'DELETE',null,send,[404,410]);
        delete c.entries[id];await storage.delete(entryPrefix+id);await save();
      }
      c.error='';c.lastSyncedAt=new Date(now).toISOString();c.nextAt=now+(pending?1000:60000);await save();
    } catch(e) {
      c.error=e.status===401?'Reconnect Google Calendar to resume syncing.':e.status===409?e.message:'Google Calendar is temporarily unavailable. Sync will retry.';
      c.nextAt=now+5*60000;await save();
    }
    next=Math.min(next,c.nextAt);
  }
  return next;
}
