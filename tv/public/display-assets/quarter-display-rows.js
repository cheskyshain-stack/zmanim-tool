import {addDays,localToISO} from './time.js';
const INFO_HOLD=30*60000;
const instantAt=(date,mins)=>Number.isFinite(mins)?localToISO(`${addDays(date,Math.floor(mins/1440))}T${String(Math.floor(mins%1440/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`):null;
const room=time=>time.mark==='**'?'באולם השמחות':time.mark==='*'?'בעזר״נ':time.underlined?'למטה':'בית מדרש';
const bare=value=>String(value||'').replace(/["״׳'\s]/g,'');

/** The printed schedule is richer than the list of countable minyanim.
 * Keep each source row, while borrowing identity/retention only from a real
 * matching minyan. Informational rows never create a new countdown target. */
export function printedPrayerGroups(day,baseGroups,now) {
  if(!day.displayRows?.length)return baseGroups;
  const originals=baseGroups.flatMap(group=>group.events.map(event=>({event,group})));
  const used=new Set(),groups=[];
  for(const row of day.displayRows) {
    const anchor=instantAt(day.date,row.throughMinutes);
    const rowExpiry=anchor?new Date(Date.parse(anchor)+INFO_HOLD).toISOString():null;
    const events=(row.times||[]).map((time,index)=>{
      const role=time.role||row.role,family=time.family||row.family;
      const candidates=originals.filter(({event})=>!used.has(event.key)&&event.mins===time.mins);
      const match=candidates.find(({event,group})=>role==='prayer'&&!event.auxiliary&&(group.families.includes(family)||family==='selichos'&&/סליחות/.test(event.name)||bare(event.name)===bare(row.label))&&event.place===room(time))
        ||candidates.find(({event})=>bare(event.name)===bare(row.label)&&(!event.place||event.place===room(time)));
      if(match)used.add(match.event.key);
      const at=instantAt(day.date,time.mins),expiresAt=match?.event.expiresAt||(at?new Date(Date.parse(at)+INFO_HOLD).toISOString():rowExpiry);
      return {...(match?.event||{}),key:JSON.stringify([row.id,index]),at:at||'',time:time.text,
        name:match?.event.name||row.label,place:match?.event.place||'',auxiliary:match?match.event.auxiliary:true,
        underlined:Boolean(time.underlined),mark:time.mark||'',reckoning:time.reckoning||'',
        isText:!Number.isFinite(time.mins),mins:time.mins,expiresAt,expired:expiresAt!==null&&now>Date.parse(expiresAt)};
    });
    const note=[row.note,row.sub].filter(Boolean).join('\n');
    const latest=[...(events.length?[]:[rowExpiry]),...events.map(event=>event.expiresAt)].filter(Boolean).sort().at(-1)||null;
    groups.push({key:row.id,label:row.label,events,note,family:row.family,families:row.family?[row.family]:[],
      auxiliary:events.every(event=>event.auxiliary),expiresAt:latest,
      rowExpired:latest!==null&&now>Date.parse(latest),printed:true,untimed:events.length===0,
      sortAt:Date.parse(instantAt(day.date,row.atMinutes)||anchor)||0,sourceOrder:row.sourceOrder});
  }
  for(const group of baseGroups) {
    const events=group.events.filter(event=>!used.has(event.key));
    if(events.length)groups.push({...group,events,sortAt:Date.parse(events[0].at),sourceOrder:-1});
  }
  return groups.sort((a,b)=>a.sortAt-b.sortAt||a.sourceOrder-b.sourceOrder);
}
