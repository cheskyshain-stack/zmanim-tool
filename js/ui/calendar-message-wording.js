import { calendarMessageWording } from '../calendar/message-wording.js';
import { escText } from '../util.js';

/** Known emphasis only. Source HTML and Markdown are always treated as plain text. */
export function calendarMessageHtml(value) {
  return calendarMessageWording(value).split('\n').map(line => {
    const opening = /^(Mazel tov to )(.+?)( on .+)$/u.exec(line);
    if (opening) return escText(opening[1]) + '<strong>' + escText(opening[2]) + '</strong>' + escText(opening[3]);
    const label = /^(Date|Chuppah|Simchas Chosson V’Kallah|Shacharis|Mincha|Maariv|Time):(?= )/u.exec(line);
    return label ? '<strong>' + escText(label[0]) + '</strong>' + escText(line.slice(label[0].length)) : escText(line);
  }).join('\n');
}
