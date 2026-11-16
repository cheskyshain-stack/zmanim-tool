import { dateFromHebrew, excelWeekday } from '../../js/hebrew-calendar.js';
import { EIRUV_LABEL } from '../../js/posters/eiruv.js';
import { clockMins } from '../../js/posters/minyanim.js';
import { SK_TEXT, sukkosAfterDays, sukkosChmAfternoonDays } from '../../js/posters/sukkos.js';
import { PS_TEXT, pesachChmMorningDays, pesachChmAfternoonDays } from '../../js/posters/pesach.js';

const MORNING = new Set(['erevShacharis','shacharis','shabbosShacharis','chmShacharis','afterShacharis','hoshanaShacharis','simchasShacharis','nextMorning','krias','hamelech','shofar','yizkor','achila','biur']);
const NIGHT_BEFORE = new Set(['candles','erevShkia','kolNidrei','nightMincha','candlesMincha','nightShkia','nightDrasha','drasha','nightMaariv','twoMaariv','shiur','shuava','maarivLmata','earlyMincha','shabbosCandles','shabbosShkia','shabbosMaariv','mishna','mishnaMaariv','mechiras','simchasMaariv']);
const PRAYER_FAMILY = {
  erevShacharis:'shacharis',shacharis:'shacharis',shabbosShacharis:'shacharis',chmShacharis:'shacharis',afterShacharis:'shacharis',hoshanaShacharis:'shacharis',simchasShacharis:'shacharis',nextMorning:'shacharis',
  erevMincha:'mincha',nightMincha:'mincha',candlesMincha:'mincha',dayMincha:'mincha',earlyMincha:'mincha',shabbosMincha:'mincha',chmMincha:'mincha',afterMincha:'mincha',shminiMincha:'mincha',simchasMincha:'mincha',mincha:'mincha',
  bedikaMaariv:'maariv',nightMaariv:'maariv',twoMaariv:'maariv',motzeiMaariv:'maariv',maarivLmata:'maariv',shabbosMaariv:'maariv',shabbosMotzei:'maariv',chmMaariv:'maariv',afterMaariv:'maariv',simchasMaariv:'maariv',maariv:'maariv',mishnaMaariv:'maariv',kolNidrei:'maariv',
};
const KNOWN = new Set([...MORNING,...NIGHT_BEFORE,...Object.keys(PRAYER_FAMILY),'erevChatzos','erevShkia','shkia','nineHours','drashaBeforeMusaf','drashaBeforeShofar','shofarWomen','drashaBeforeNeila','neila','kiddushLevana','chatzos','eiruv','shirHashirim']);
const digits = text => /^\d{1,2}:\d{2}$/.test(String(text));
const range = (start,count) => Array.from({length:count},(_,index)=>start+index);

/** Lossless printed holiday rows for the TV. No row changes minyan eligibility.
 * `serial` is the civil source day, and `mins` is present only for printed clocks.
 * `atMinutes`/`throughMinutes` are retention anchors, never invented display times.
 * Opening-night rows belong to the preceding civil day. Pesach chatzos is after
 * midnight and therefore belongs to the named day's civil date.
 */
export function holidayDisplayRows(sourceKey, poster, year, settings) {
  if (!poster) return [];
  const out=[],anchorRequests=new Map();
  const add=(row,serial,calc,context='day')=>{
    if(!KNOWN.has(calc))throw new RangeError(`Unmapped ${sourceKey} display calculation: ${calc}`);
    let family=PRAYER_FAMILY[calc] || null;
    if(calc==='neila'&&sourceKey==='yk')family='neila';
    if(calc==='erevShacharis'&&sourceKey==='rh'||calc==='shacharis'&&sourceKey==='gedalia'||calc==='erevShacharis'&&sourceKey==='yk')family='selichos';
    const role=family?'prayer':'information';
    let previous=-1;
    const times=(row.times || []).map((value,index)=>{
      const text=String(value.text ?? '');
      const time={text,underlined:Boolean(value.underlined),mark:String(value.mark || ''),...(value.name?{reckoning:String(value.name)}:{})};
      if(digits(text)) {
        let mins=clockMins(text,!MORNING.has(calc)&&calc!=='chatzos');
        while(mins<=previous)mins+=720;
        previous=mins;
        time.mins=mins;
      }
      // The paired source row is Mincha followed by its Plag boundary, not two minyan options.
      if(calc==='earlyMincha')time.reckoning=index===0?'מנחה':'פלג';
      time.role=calc==='earlyMincha'&&index>0?'information':role;
      if(time.role==='prayer')time.family=family;
      return time;
    });
    const mins=times.filter(time=>Number.isFinite(time.mins)).map(time=>time.mins);
    const result={id:`${sourceKey}:${year}:${serial}:${out.length}`,serial,label:String(row.label || ''),times,
      role,family,auxiliary:true,sourceKey,sourceCalc:calc,sourceOrder:out.length,context,
      ...(mins.length?{atMinutes:Math.min(...mins),throughMinutes:Math.max(...mins)}:{})};
    for(const name of ['note','sub','sep'])if(row[name]!=null)result[name]=String(row[name]);
    if(row.keepUp)result.keepUp=true;
    out.push(result);
    if(row.extra)add({...row.extra},serial,calc==='shacharis'?'hamelech':calc,context);
    return result;
  };
  const headingNotes=(heading,serial,context)=>{
    if(String(heading||'').includes(EIRUV_LABEL)) {
      const row=add({label:EIRUV_LABEL,times:[]},serial-(context==='festival'?1:0),'eiruv',context);
      anchorRequests.set(row.id,'candles');
    }
    if(sourceKey==='pesach'&&String(heading||'').includes(PS_TEXT.shirHashirim)) {
      const row=add({label:PS_TEXT.shirHashirim,times:[]},serial,'shirHashirim','day');
      anchorRequests.set(row.id,'shabbosShacharis');
    }
  };
  const block=(lines,serial,context='festival',heading='')=>{
    headingNotes(heading,serial,context);
    for(const row of lines) {
      const calc=row.calc;
      const previous=context==='festival'&&(NIGHT_BEFORE.has(calc)||calc==='erevMincha');
      add(row,serial-(previous?1:0),calc,context);
    }
  };
  if(sourceKey==='rh') {
    const first=dateFromHebrew(1,7,year);
    headingNotes(poster.erevHeading,first-1,'erev');
    poster.erevLines.forEach((row,index)=>add(row,first-1,['erevShacharis','erevChatzos','erevMincha'][index],'erev'));
    poster.blocks.forEach((value,index)=>block(value.lines,first+index));
  } else if(sourceKey==='yk') {
    const day=dateFromHebrew(10,7,year);
    block(poster.erevLines,day-1,'erev');
    block(poster.dayLines,day,'festival');
    add({...poster.nextMorning,label:'שחרית'},day+1,'nextMorning');
    for(const [calc,label] of [['afterMincha','מנחה'],['afterMaariv','מעריב']])add({label,times:poster.after[calc==='afterMincha'?'mincha':'maariv']},day+1,calc);
  } else if(sourceKey==='gedalia') {
    for(const value of poster.sets)add(value.note?{label:value.note.label,times:[{text:value.note.text}]}:{label:value.head,times:value.lines.flat()},poster.span.from,value.calc);
  } else if(sourceKey==='sukkos') {
    const first=dateFromHebrew(1,7,year),on=day=>first+day-1;
    const chm=range(on(17),5),chmShabbos=chm.find(serial=>excelWeekday(serial)===7);
    poster.blocks.forEach((value,index)=>{
      const calcs=new Set(value.lines.map(row=>row.calc));
      if(calcs.has('afterShacharis')) {
        for(const serial of sukkosAfterDays(first,settings))block(value.lines,serial,'day');
      } else if(calcs.has('chmShacharis')) {
        for(const row of value.lines) {
          const dates=row.calc==='chmShacharis'?chm.filter(serial=>excelWeekday(serial)!==7&&serial!==on(21)):sukkosChmAfternoonDays(first);
          for(const serial of dates)add(row,serial,row.calc,'day');
        }
      } else if(calcs.has('hoshanaShacharis'))block(value.lines,on(21),'festival',value.heading);
      else if(calcs.has('simchasShacharis'))block(value.lines,on(23),'festival',value.heading);
      else if(calcs.has('shminiMincha'))block(value.lines,on(22),'festival',value.heading);
      else if(calcs.has('shabbosShacharis'))block(value.lines,value.heading===SK_TEXT.shabbosBereishis?on(24):chmShabbos,'festival',value.heading);
      else if(index===0)block(value.lines,on(15),'festival',value.heading);
      else if(index===1)block(value.lines,on(16),'festival',value.heading);
      else throw new RangeError(`Unmapped Sukkos block: ${value.heading}`);
    });
  } else if(sourceKey==='pesach') {
    const first=dateFromHebrew(1,1,year);
    for(const value of poster.blocks) {
      if(value.lines.some(row=>row.calc==='chmShacharis')) {
        for(const row of value.lines) {
          const dates=row.calc==='chmShacharis'?pesachChmMorningDays(first):pesachChmAfternoonDays(first);
          for(const serial of dates)add(row,serial,row.calc,'day');
        }
      } else {
        const context=value.lines.some(row=>row.calc==='erevShacharis'||row.calc==='bedikaMaariv')?'day':'festival';
        block(value.lines,value.serial,context,value.heading);
      }
    }
  } else throw new RangeError(`Unknown holiday display source: ${sourceKey}`);

  // A relative announcement has no clock. Keep it with a real neighboring row
  // from the same source day, so expiry can move it with that source event.
  for(let index=0;index<out.length;index++) {
    const row=out[index];
    if(Number.isFinite(row.atMinutes))continue;
    const later=out.slice(index+1).find(next=>next.serial===row.serial&&Number.isFinite(next.atMinutes));
    const earlier=out.slice(0,index).reverse().find(prior=>prior.serial===row.serial&&Number.isFinite(prior.throughMinutes));
    const requested=anchorRequests.get(row.id);
    const explicit=requested&&out.find(candidate=>candidate.serial===row.serial&&candidate.sourceCalc===requested&&Number.isFinite(candidate.atMinutes));
    const anchor=explicit || (row.keepUp?earlier:later) || earlier || later;
    if(anchor) {
      row.atMinutes=anchor.atMinutes;
      row.throughMinutes=anchor.throughMinutes;
      row.anchorId=anchor.id;
    }
  }
  return out;
}

