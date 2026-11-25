import { calendarEvent, calendarSerial, calendarEventDetails, CALENDAR_EVENT_DETAILS_MAX } from './model.js';
import { calendarMessageWording, simchaSourceWording, simchaWeddingMilestones, simchaWeddingTime } from './message-wording.js';
export function simchaEventWording(value) { return calendarMessageWording(value); }
import { calendarAnnouncementDate } from './announcement-model.js';

const types = [
  ['shalom-zachor', /\bsh[ao]l[oa]m\s+z[ao]ch[oa]r\b|שלום\s+זכ[ו]?ר/iu],
  ['kiddush', /\bkidd?ush\b|קידוש/iu],
  ['vort', /\bvort\b|ווארט|אירוסין/iu],
  ['aufruf', /\b[ao]ufruf\b|אויפרוף|עליה\s+לתורה/iu],
  ['wedding', /\b(?:wedding|chas[su]?na[h]?|ch[au]s[su]?neh)\b|חתונה/iu],
  ['bar-mitzva-dessert', /\bbar\s*mitzva[h]?\s+dessert\b/iu],
  ['bar-mitzva-shabbos', /\bbar\s*mitzva[h]?\s+shabb[oa][st]\b/iu],
  ['bar-mitzvah', /\bbar\s*mitzva[h]?\b|בר\s+מצוה|בר\s+מצווה/iu],
  ['custom', /\bbris\b|ברית|\bpidyon\s+haben\b|פדיון\s+הבן|\bbas\s*mitzva[h]?\b|בת\s+מצוה|בת\s+מצווה|\bsheva\s+brach[oa][st]\b|שבע\s+ברכות/iu],
];
const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const dateISO = value => new Date(value).toISOString().slice(0, 10);
const shifted = (date, days) => dateISO(Date.parse(date + 'T12:00:00Z') + days * 86400000);
const pad = n => String(n).padStart(2, '0');
export const simchaTextKey = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();

/** Conservative, local extraction. No message is sent to an external AI service.
 * Dates are civil New York dates, anchored to the original message timestamp. */
export function simchaFromMessage(message) {
  const text = String(message.text || '').trim();
  if (/kidd?ush\s+lev[ao]n[ao]h?|קידוש\s+לבנה/iu.test(text)) return null;
  const matches = types.filter(([, pattern]) => pattern.test(text));
  if (!matches.length) return null;
  let type = matches.some(([id]) => id.startsWith('bar-mitzva-'))
    ? matches.find(([id]) => id.startsWith('bar-mitzva-'))[0] : matches[0][0];
  const bar = matches.some(([id]) => id.startsWith('bar-mitzva'));
  if (bar && /dessert|reception/iu.test(text)) type = 'bar-mitzva-dessert';
  else if (bar && /kidd?ush|shabb[oa][st]/iu.test(text)) type = 'bar-mitzva-shabbos';
  const distinct = matches.filter(([id]) => !(bar && (id.startsWith('bar-mitzva') || id === 'kiddush')));
  if (bar) distinct.push([type]);
  const result = { text, type, reason: '', event: null };
  if (distinct.length > 1) return { ...result, reason: 'This message mentions multiple simchos. Review each event separately.' };
  if (/\b(?:cancelled|canceled|postponed|correction|rescheduled|not|no|maybe|possibly|tentative)\b|נדחה|בוטל/iu.test(text))
    return { ...result, reason: 'Cancellation or correction. Check the existing calendar event before changing it.' };
  if (/details to follow|date to follow|time to follow/iu.test(text)) return {...result, reason:'Details are still to follow. Confirm the event before adding it.'};
  if (text.includes('?')) return {...result,reason:'This message asks a question. Confirm that the simcha is scheduled.'};
  if (text.length > 4364) return { ...result, reason: 'The message is too long for one calendar event. Review the complete original text.' };
  const received = calendarAnnouncementDate(message);
  if (!Number.isFinite(Date.parse(received))) return { ...result, reason: 'The original message date is unavailable.' };
  const base = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(received));
  const day = new Date(base + 'T12:00:00Z').getUTCDay();
  const dates = new Set();
  if (/\b(?:every|weekly|monthly)\b|כל\s+(?:שבוע|שבת)/iu.test(text)) return {...result,reason:'Recurring simcha. Confirm its individual dates.'};
  if (/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d/iu.test(text)) return {...result,reason:'Confirm the written month and day before adding this simcha.'};
  for (const match of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    if (!Number.isFinite(calendarSerial(match[1]))) return { ...result, reason: 'Invalid calendar date.' };
    dates.add(match[1]);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/g)) {
    if (!match[3]) return { ...result, reason: 'Confirm the year for the numeric date.' };
    const date = `${match[3]}-${pad(match[1])}-${pad(match[2])}`;
    if (!Number.isFinite(calendarSerial(date))) return { ...result, reason: 'Invalid calendar date.' };
    dates.add(date);
  }
  // An explicit numeric date takes precedence over supporting weekday wording.
  if (!dates.size) {
    if (/\btoday\b|\btonight\b|היום|הערב/iu.test(text)) dates.add(base);
    if (/\btomorrow\b|מחר/iu.test(text)) dates.add(shifted(base, 1));
    const normalized = text.toLowerCase().replace(/motz[aei' ]*\s*shabb[oa][st]/g,'saturday night').replace(/shabb[oa][st]/g,'saturday');
    for (const [index, name] of days.entries()) {
      if (!new RegExp('\\b'+name+'\\b','i').test(normalized)) continue;
      let offset = (index-day+7)%7;
      if (new RegExp('\\bnext\\s+'+name+'\\b','i').test(normalized) && offset === 0) offset=7;
      dates.add(shifted(base, offset));
    }
  }
  if (!dates.size) {
    const target = ['kiddush','aufruf','bar-mitzva-shabbos'].includes(type) ? 6 : type === 'shalom-zachor' ? 5 : day;
    dates.add(shifted(base, (target-day+7)%7));
  }
  if (dates.size !== 1) return { ...result, reason: dates.size ? 'Multiple possible event dates. Confirm the date.' : 'No clear event date. Choose the date before adding this simcha.' };
  const date = [...dates][0];
  // Do not invent a clock time from an ambiguous bare 8:30 or a relative prayer time.
  let time = '', endTime = '';
  const clocks = [...text.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?\b/gi)];
  if (/\d\s*[-–]\s*\d/.test(text.replace(/20\d{2}-\d{2}-\d{2}/g,''))) return { ...result, reason: 'Confirm the time range before adding this simcha.' };
  const milestones = type === 'wedding' ? simchaWeddingMilestones(text) : [];
  const chuppah = milestones.filter(item => item.kind === 'chuppah');
  if (type === 'wedding' && /\bchup(?:p)?a[h]?\b/iu.test(text) && !chuppah.length) return { ...result, reason: 'Confirm the chuppah time before adding this simcha.' };
  if (chuppah.length) {
    time = simchaWeddingTime(text);
    if (!time) return { ...result, reason: 'Confirm the separately labelled wedding times before adding this simcha.' };
  } else if (clocks.length > 1) return { ...result, reason: 'Confirm the time range before adding this simcha.' };
  else if (clocks.length) {
    const [, hour, minute = '00', period] = clocks[0];
    if (+hour < 1 || +hour > 12) return { ...result, reason:'Invalid event time.' };
    time = pad((+hour%12)+(period.toLowerCase()==='p'?12:0))+':'+minute;
  } else if (/\b\d{1,2}:[0-5]\d\b/u.test(text)) {
    const bare = [...text.matchAll(/\b(\d{1,2}):([0-5]\d)\b/gu)];
    if (bare.length !== 1 || +bare[0][1] < 1 || +bare[0][1] > 12) return {...result,reason:'Confirm the event time.'};
    const morning = /shacharis|שחרית/iu.test(text) && !/tonight|evening/iu.test(text);
    const evening = /tonight|evening|night|dessert|chupah/iu.test(text) || type === 'bar-mitzva-dessert';
    if (+bare[0][1] === 12) return { ...result, reason: 'Confirm AM or PM and the calendar date for this time.' };
    if (!morning && !evening) return {...result,reason:'The clock time is unclear. Confirm it before adding this simcha.'};
    time = pad((+bare[0][1]%12)+(evening?12:0))+':'+bare[0][2];
  } else if (/(?:\bat\s+|@)\d|\b\d{1,2}:[0-5]\d\b|\b(?:after|before)\b.*(?:maariv|shacharis|mincha|davening)|אחרי|לאחר/iu.test(text))
    return { ...result, reason: 'The clock time is unclear. Confirm it before adding this simcha.' };
  if(time && +time.slice(0,2)<6 && /\b(?:tonight|night|motzai)\b/iu.test(text)) return {...result,reason:'After midnight wording. Confirm the civil calendar date.'};
  const customCategory = type === 'custom' ? (/\bbris\b|ברית/iu.test(text)?'Bris':/pidyon|פדיון/iu.test(text)?'Pidyon Haben':/sheva|שבע/iu.test(text)?'Sheva Brachos':'Bas Mitzvah') : '';
  const wording=simchaEventWording(text);
  if (wording.length > CALENDAR_EVENT_DETAILS_MAX) return { ...result, reason: 'Review this message before adding its complete calendar wording.' };
  const fields = {title:wording.split('\n').find(line=>line.trim()).slice(0,160),type,customCategory,date,endDate:date,time,endTime,allDay:!time,visibility:'everyone',details:wording,description:'',location:/\bshacharis\s+NS\b/iu.test(text)?'NS':/\bSimcha Hall\b/iu.test(text)?'Simcha Hall':/\bTiferes Hall\b/iu.test(text)?'Tiferes Hall':''};
  return { ...result, event: calendarEvent(fields) };
}

/** Presentation only: never replace an editor's wording or write back from the browser. */
export function simchaEventPresentation(event) {
  if (!event.simchaPreview && event.updatedBy !== 'simcha-message-import') return event;
  const source = calendarEventDetails(event), wording = simchaEventWording(source);
  if (!wording || wording.length > CALENDAR_EVENT_DETAILS_MAX) return event;
  const time = event.type === 'wedding' ? simchaWeddingTime(source) || event.time : event.time;
  return { ...event, details: wording, title: wording.split('\n')[0].slice(0, 160), time, allDay: !time && !event.endTime };
}

// Compare people rather than treating every simcha of one type as a duplicate.
export function simchaRelation(a, b) {
  const kind = e => ['bar-mitzvah','bar-mitzva-shabbos'].includes(e.type) ? 'bar-mitzvah' : e.type;
  if (a.date !== b.date || kind(a) !== kind(b) || (a.customCategory||'') !== (b.customCategory||'')) return 'different';
  const text = e => e.details || e.title || '';
  if (simchaTextKey(simchaSourceWording(text(a))) === simchaTextKey(simchaSourceWording(text(b)))) return 'same';
  const identity = e => {
    const t = simchaSourceWording(text(e));
    const parent = t.match(/(?:r\s*&\s*m|rabbi\s*&\s*mrs|mr\s*&\s*mrs)\.?\s+(.+?)(?=\s+(?:on|are|upon|would)\b|[.!,\n]|$)/iu)?.[1] || '';
    const child = t.match(/\b(?:son|daughter)['’]?s?\s+(.+?)(?=\s+(?:bar|bas|to|dessert|vort|chasuna)\b|[.!,\n]|$)/iu)?.[1] || '';
    return {p:simchaTextKey(parent).split(' ').filter(Boolean),c:simchaTextKey(child)};
  };
  const x=identity(a),y=identity(b);
  if (x.p.length && y.p.length) {
    if (x.p[0]!==y.p[0]) return 'different';
    if (x.p.length>1 && y.p.length>1 && x.p.at(-1)!==y.p.at(-1)) return 'different';
    if (x.p[0]===y.p[0] && (x.p.join(' ')===y.p.join(' ') || x.c && x.c===y.c)) return 'same';
  }
  return 'unclear';
}
export function mergeSimchaFollowup(old, incoming) {
  // A NOW reminder preserves the original scheduled time and complete invitation.
  if (/\bnow\b/iu.test(incoming.details || '') && old.time) return {...old};
  return {...incoming,time:incoming.time||old.time,endTime:incoming.endTime||old.endTime,
    allDay:!(incoming.time||old.time),location:incoming.location||old.location};
}

/** Device preview built only from messages this account may already read. */
export function simchaMessagePreview(messages, existing = []) {
  const events = [], review = [];
  for (const message of [...messages].sort((a,b)=>calendarAnnouncementDate(a).localeCompare(calendarAnnouncementDate(b)) || a.id.localeCompare(b.id))) {
    const parsed = simchaFromMessage(message);
    if (!parsed) continue;
    if (!parsed.event) { review.push({id:message.id,text:message.text,reason:parsed.reason}); continue; }
    const all=[...existing,...events], same=all.find(event=>simchaRelation(event,parsed.event)==='same');
    if (same) {
      const index=events.indexOf(same);
      if(index>=0) events[index]={...mergeSimchaFollowup(same,parsed.event),id:same.id,simchaPreview:true,revision:0};
      continue;
    }
    if (all.some(event=>simchaRelation(event,parsed.event)==='unclear')) { review.push({id:message.id,text:message.text,reason:'Possible duplicate. Check the existing event.'}); continue; }
    events.push({...parsed.event,id:'message-preview-'+message.id,simchaPreview:true,revision:0});
  }
  return {events,review};
}
