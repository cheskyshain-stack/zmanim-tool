import { simchaFromMessage, simchaTextKey } from '../../js/calendar/simcha-message.js';
import { calendarAnnouncementDate } from '../../js/calendar/announcement-model.js';
import { calendarEvent } from '../../js/calendar/model.js';

/** Called inside the announcement transaction, so retries cannot split a message
 * from its event. Review records and links stay private to calendar managers. */
export async function syncSimchaMessage(storage, message, now = new Date().toISOString()) {
  const key = 'simcha-source:' + message.id, previous = await storage.get(key);
  if (previous?.revision === (message.revision || 1) && previous.addedAt === calendarAnnouncementDate(message)) return previous;
  const parsed = simchaFromMessage(message);
  if (!parsed && !previous) return null;
  const record = { messageId:message.id, revision:message.revision||1, addedAt:calendarAnnouncementDate(message), text:message.text,
    status:'review', type:parsed?.type||'simcha', reason:parsed?.reason || 'The corrected message no longer describes a simcha. Check its linked calendar event.',
    ...(previous?.eventId?{eventId:previous.eventId,eventRevision:previous.eventRevision}:{}), ...(parsed?.event?{proposal:parsed.event}:{}) };
  const review = async reason => { record.reason=reason||record.reason; await storage.put(key,record); return record; };
  if (!parsed?.event) return review();
  const id = previous?.eventId || 'simcha-' + message.id;
  if (await storage.get('deleted-event:' + id)) return review('The calendar event was removed. Review before restoring anything.');
  const old = await storage.get('event:' + id);
  if (old && (old.revision !== previous?.eventRevision || old.updatedBy !== 'simcha-message-import'))
    return review('Someone edited this event. Review the message without overwriting their changes.');
  const events = await storage.list({prefix:'event:',limit:2000});
  const similar = [...events.values()].filter(event => event.id!==id && event.date===parsed.event.date && event.type===parsed.event.type && (event.type!=='custom'||event.customCategory===parsed.event.customCategory));
  const same = similar.find(event => simchaTextKey(event.details || event.title) === simchaTextKey(parsed.text));
  if (same) {
    record.status='duplicate';record.reason='This simcha already appears on the calendar.';record.eventId=same.id;
    await storage.put(key,record);return record;
  }
  if (similar.length) return review('A simcha of this type already exists on that date. Check whether this is a follow up or a separate family.');
  if (!old && events.size>=2000) return review('The calendar event limit has been reached.');
  const event = {...parsed.event,id,revision:(old?.revision||0)+1,createdAt:old?.createdAt||now,createdBy:old?.createdBy||'simcha-message-import',updatedAt:now,updatedBy:'simcha-message-import'};
  record.status='added';record.reason='';record.eventId=id;record.eventRevision=event.revision;
  await storage.put({['event:'+id]:event,[key]:record,['activity:'+now+':'+crypto.randomUUID()]:{at:now,types:[old?'eventsEdited':'eventsCreated']}});
  return record;
}

export async function reviewSimchaMessage(storage, messageId, decision, fields, actor, revision, options = {}, now = new Date().toISOString()) {
  const key='simcha-source:'+messageId, record=await storage.get(key);
  const message=await storage.get('announcement:'+messageId);
  if (!record || !message || message.deletedAt) throw Object.assign(new Error('This message is unavailable.'),{status:404});
  if(options.operationId && Object.hasOwn(record.operations||{},options.operationId)) {
    const saved=await storage.get('event:'+record.operations[options.operationId]);
    if(!saved||decision!=='add'||JSON.stringify(calendarEvent({...fields,visibility:'everyone',adminDetails:'',reminder:'',revision:0}))!==JSON.stringify(calendarEvent({...saved,revision:0})))throw Object.assign(new Error('This review was already saved with different details.'),{status:409});
    return saved;
  }
  if(record.revision!==revision || (message.revision||1)!==revision || record.status!=='review') throw Object.assign(new Error('This message changed. Refresh the review list.'),{status:409});
  if(decision==='skip'){await storage.put(key,{...record,status:'skipped',reviewedBy:actor,reviewedAt:now});return null;}
  if(decision!=='add') throw Object.assign(new Error('Choose Add event or Skip.'),{status:400});
  if(record.eventId)throw Object.assign(new Error('Edit the linked event on the calendar, then skip this review.'),{status:409});
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(options.operationId||''))throw Object.assign(new Error('Reload the review before saving.'),{status:400});
  if(Object.keys(record.operations||{}).length>=50)throw Object.assign(new Error('Finish this review before creating more events.'),{status:409});
  const validated=calendarEvent({...fields,visibility:'everyone',adminDetails:'',reminder:''});
  if((await storage.list({prefix:'event:',limit:2000})).size>=2000)throw Object.assign(new Error('The calendar event limit has been reached.'),{status:409});
  const id='simcha-reviewed-'+options.operationId;
  if(await storage.get('deleted-event:'+id)||await storage.get('event:'+id))throw Object.assign(new Error('This reviewed event was already saved or removed.'),{status:409});
  const event={...validated,id,revision:1,createdAt:now,createdBy:actor,updatedAt:now,updatedBy:actor};
  await storage.put({['event:'+id]:event,[key]:{...record,status:options.keepReview?'review':'added',...(options.keepReview?{}:{eventId:id,eventRevision:1}),operations:{...record.operations,[options.operationId]:id},reviewedBy:actor,reviewedAt:now},['activity:'+now+':'+crypto.randomUUID()]:{at:now,types:['eventsCreated']}});
  return event;
}
