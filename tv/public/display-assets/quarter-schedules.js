import { addDays, localStamp } from './time.js';

export const PRAYER_HOLD_MS = 60 * 60000;
export const ZMAN_HOLD_MS = 30 * 60000;

const eventKey = (date,event) => JSON.stringify([date,event.at,event.name,event.place || '',event.reckoning || '']);
const expiresAfter = (at,hold) => Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)+hold).toISOString() : null;
const prayerFamilies = event => {
  const result=[];
  if(/שחרית/.test(event.name))result.push('shacharis');
  if(/מנחה/.test(event.name))result.push('mincha');
  if(/מעריב|כל נדרי|קול נדרי/.test(event.name))result.push('maariv');
  return result.length?result:[String(event.name || '')];
};

/** Translate the existing room notation back to the chart's visual marks. */
export function eventMarks(event) {
  const place=String(event.place || '');
  return {
    underlined:Boolean(event.underlined || /למטה/.test(place)),
    mark:event.mark || (/אולם השמחות/.test(place) ? '**' : /בעזר|עזרת נשים/.test(place) ? '*' : ''),
  };
}

function dayMetadata(day,currentDate) {
  return {date:day.date,title:day.hebrewTitle || day.title || '',hebrewDate:day.hebrewDate || '',
    sourceTitle:day.title || '',relativeLabel:day.date===currentDate?'היום':day.date===addDays(currentDate,1)?'מחר':day.date===addDays(currentDate,-1)?'אתמול':'',
    note:day.note || ''};
}

function prayerDay(day,currentDate,now) {
  const source=[...(day.events || [])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const familyEnds=new Map();
  for(const event of source) {
    if(event.auxiliary)continue;
    const at=Date.parse(event.at);
    if(Number.isFinite(at))for(const family of prayerFamilies(event))familyEnds.set(family,Math.max(familyEnds.get(family) || -Infinity,at));
  }
  const allGroups=[],seen=new Set(),occurrences=new Map();
  for(const event of source) {
    const key=eventKey(day.date,event);
    if(seen.has(key))continue;
    seen.add(key);
    const auxiliary=Boolean(event.auxiliary),at=Date.parse(event.at);
    const label=event.plag&&event.plagName?event.plagName:event.name;
    const families=auxiliary?[]:prayerFamilies(event),family=families[0] || null;
    const familyEnd=Math.max(...families.filter(value=>familyEnds.has(value)).map(value=>familyEnds.get(value)));
    const expiresAt=auxiliary?expiresAfter(event.at,ZMAN_HOLD_MS):Number.isFinite(familyEnd)?new Date(familyEnd+PRAYER_HOLD_MS).toISOString():null;
    const expired=expiresAt!==null&&now>Date.parse(expiresAt);
    let group=allGroups.at(-1);
    if(!group || group.label!==label || group.auxiliary!==auxiliary) {
      const signature=JSON.stringify([label,auxiliary]);
      const occurrence=occurrences.get(signature) || 0;
      occurrences.set(signature,occurrence+1);
      group={key:JSON.stringify([day.date,label,auxiliary,occurrence]),label,auxiliary,family,families,events:[],expiresAt};
      allGroups.push(group);
    }
    if(expiresAt && (!group.expiresAt || expiresAt>group.expiresAt))group.expiresAt=expiresAt;
    group.events.push({...event,...eventMarks(event),key,started:Number.isFinite(at)&&at<=now,expired,expiresAt});
  }
  const groups=allGroups.map(group=>({...group,events:group.events.filter(event=>!event.expired)})).filter(group=>group.events.length);
  const eventCount=allGroups.reduce((count,group)=>count+group.events.length,0);
  const remainingCount=groups.reduce((count,group)=>count+group.events.length,0);
  return {...dayMetadata(day,currentDate),groups,allGroups,eventCount,remainingCount,expiredCount:eventCount-remainingCount,
    state:groups.length?'upcoming':eventCount?'finished':'unavailable'};
}

function zmanDay(day,currentDate,now) {
  const allZmanim=(day.zmanim || []).map((zman,index)=>{
    const expiresAt=expiresAfter(zman.at,ZMAN_HOLD_MS);
    // An older cached snapshot may lack absolute instants. Keep its printed
    // times rather than guess AM/PM or remove a row at an invented boundary.
    return {...zman,sourceKey:zman.key || '',key:JSON.stringify([day.date,zman.key || index]),expiresAt,
      expired:expiresAt!==null&&now>Date.parse(expiresAt)};
  });
  const zmanim=allZmanim.filter(zman=>!zman.expired);
  return {...dayMetadata(day,currentDate),zmanim,allZmanim,state:zmanim.length?'upcoming':allZmanim.length?'finished':'unavailable'};
}

/** Dated streams shared by the live screen and admin preview.
 * A prayer's full source-day list remains until one hour after its last minyan.
 * Daily zmanim and other timed information stay for thirty minutes. */
export function quarterSchedule(schedule, instant) {
  const now=new Date(instant).getTime();
  if(!Number.isFinite(now))throw new RangeError('Choose a valid display time.');
  const currentDate=localStamp(instant).slice(0,10),today=schedule.today || {date:schedule.date || currentDate};
  const rawDays=schedule.displayDays?.length?schedule.displayDays:[{...today,zmanim:schedule.zmanim || []}];
  const unique=new Map(rawDays.map(day=>[day.date,day]));
  const days=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const allPrayerDays=days.map(day=>prayerDay(day,currentDate,now));
  const allZmanDays=days.map(day=>zmanDay(day,currentDate,now));
  const prayerDays=allPrayerDays.filter(day=>day.groups.length || day.date>=currentDate&&day.note);
  const zmanDays=allZmanDays.filter(day=>day.zmanim.length);
  const primaryPrayer=allPrayerDays.find(day=>day.date===today.date) || prayerDay(today,currentDate,now);
  const primaryZman=allZmanDays.find(day=>day.date===today.date) || zmanDay({...today,zmanim:schedule.zmanim || []},currentDate,now);
  return {...primaryPrayer,zmanim:primaryZman.zmanim,allZmanim:primaryZman.allZmanim,zmanimState:primaryZman.state,
    prayerDays,zmanDays,allPrayerDays,allZmanDays};
}
