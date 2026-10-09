import { WEEKDAY_SHACHARIS_SPECIAL } from '../settings.js';
import { parseTimes } from './slichos.js';
import { fixedTime } from '../zmanim/trace.js';

/** The seasonal chart's special morning list, retaining its room marks and traces. */
export function specialShacharisLines() {
  return WEEKDAY_SHACHARIS_SPECIAL.split('\n').map(line =>
    parseTimes(line.replace(/\s+/g, ',')).map(time => {
      let trace = fixedTime(time.text, { am: true, label: 'the seasonal chart\'s special Shacharis schedule' });
      if (time.underlined) trace = trace.underline();
      if (time.mark) trace = trace.mark(time.mark);
      return { text: trace.plain(), underlined: Boolean(trace.flags.underlined), mark: trace.flags.mark || '', trace };
    }));
}
