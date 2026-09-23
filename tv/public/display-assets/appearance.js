import { localStamp, localToISO, addDays } from './time.js';
export const DEFAULT_APPEARANCE = Object.freeze({mode:'light', darkStart:'19:00', lightStart:'07:00'});
export function validateAppearance(raw) {
  if (!raw || !['light','dark','scheduled'].includes(raw.mode)) throw new RangeError('Choose Light, Dark or Scheduled.');
  for (const key of ['darkStart','lightStart']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw[key])) throw new RangeError('Choose valid appearance start times.');
  if (raw.mode === 'scheduled' && raw.darkStart === raw.lightStart) throw new RangeError('Dark and light must begin at different times.');
  return {mode:raw.mode,darkStart:raw.darkStart,lightStart:raw.lightStart};
}
const transitions = new Map();
function transition(date, time) {
  const key = date+'T'+time;
  if (transitions.has(key)) return transitions.get(key);
  // Repeated hours switch on the first occurrence. Missing spring times
  // switch at the first real minute after the gap, without switching back.
  let value;
  for(let n=0;n<=180;n++) {
    const wall = new Date(Date.parse(key+'Z') + n*60000).toISOString().slice(0,16);
    try { value=localToISO(wall,'earlier'); break; } catch {}
  }
  if (!value) throw new RangeError('Invalid appearance transition.');
  if(transitions.size>64) transitions.clear();
  transitions.set(key,value);
  return value;
}
export function themeAt(config = DEFAULT_APPEARANCE, instant = new Date()) {
  if (config.mode !== 'scheduled') return config.mode === 'dark' ? 'dark' : 'light';
  const at = new Date(instant).toISOString(), date=localStamp(at).slice(0,10);
  const events=[addDays(date,-1),date].flatMap(day=>[['dark',config.darkStart],['light',config.lightStart]].map(([theme,time])=>({theme,time,at:transition(day,time)})));
  return events.filter(e=>e.at<=at).sort((a,b)=>a.at.localeCompare(b.at)||a.time.localeCompare(b.time)).at(-1).theme;
}
const clock = value => {const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
export function appearanceSummary(config) {
  return config.mode==='scheduled' ? `Dark from ${clock(config.darkStart)} until ${clock(config.lightStart)} · New York time` : `${config.mode==='dark'?'Dark':'Light'} all day`;
}
