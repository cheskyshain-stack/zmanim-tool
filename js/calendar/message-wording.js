const messageClockSource = String.raw`(\d{1,2})(?::([0-5]\d))?(?:\s*([ap])\.?m\.?)?`;
const messageMilestoneNames = String.raw`chup(?:p)?a[h]?|s\.?c\.?v\.?k\.?|simchas\s+chosson\s+(?:v[’']?kallah|vekallah|and\s+kallah)`;
const wordingPad = value => String(value).padStart(2, '0');

/** Only explicit AM/PM or an unambiguous evening context supplies a period. */
function messageClockValue(hour, minute = '00', period = '', evening = false) {
  if (+hour < 1 || +hour > 12) return null;
  const suffix = period ? period.toUpperCase() + 'M' : evening && +hour !== 12 ? 'PM' : '';
  return { text: `${+hour}:${minute || '00'}${suffix ? ' ' + suffix : ''}`,
    time: suffix ? wordingPad((+hour % 12) + (suffix === 'PM' ? 12 : 0)) + ':' + (minute || '00') : '' };
}

/** Keep named wedding milestones separate. Simchas chosson v'kallah is not an end time. */
export function simchaWeddingMilestones(value) {
  const text = String(value || ''), evening = /\b(?:tonight|evening|night|motzai)\b/iu.test(text);
  const pattern = new RegExp(`\\b(${messageMilestoneNames})\\s*:?\\s*${messageClockSource}(?=\\s|[.,;!?]|$)`, 'giu');
  return [...text.matchAll(pattern)].map(match => {
    const clock = messageClockValue(match[2], match[3], match[4], evening);
    return { kind: /^chup/iu.test(match[1]) ? 'chuppah' : 'simchas', label: /^chup/iu.test(match[1]) ? 'Chuppah' : 'Simchas Chosson V’Kallah',
      text: clock?.text || match[0], time: clock?.time || '', valid: !!clock, start: match.index, end: match.index + match[0].length };
  });
}

/** An unambiguous labelled chuppah is the wedding start, never the later dancing time. */
export function simchaWeddingTime(value) {
  const text = String(value || ''), milestones = simchaWeddingMilestones(text);
  const chuppah = milestones.filter(item => item.kind === 'chuppah');
  const clocks = [...text.matchAll(/\b\d{1,2}(?::[0-5]\d)?\s*[ap]\.?m\.?\b/giu), ...text.matchAll(/\b\d{1,2}:[0-5]\d\b/gu)];
  if (chuppah.length !== 1 || milestones.filter(item => item.kind === 'simchas').length > 1
    || milestones.some(item => !item.valid || !item.time)
    || clocks.some(clock => !milestones.some(item => clock.index >= item.start && clock.index < item.end))) return '';
  return chuppah[0].time;
}

/** Canonical source wording is also used for duplicate matching. */
export function simchaSourceWording(value) {
  return String(value || '')
    .replace(/\br\s*&\s*m\b\.?/giu, 'Rabbi & Mrs')
    .replace(/\brabbi\s*(?:&|and)\s*mrs\.?\s+/giu, 'Rabbi & Mrs ')
    .replace(/\bmr\.?\s*(?:&|and)\s*mrs\.?\s+/giu, 'Mr & Mrs ')
    .replace(/(?:\bA\s+)?May\s+the\s+Zivug\s+Oleh\s+Yaf[ae]h?\b[.!]?/giu, '')
    .replace(/\bMTZOY\b[.!]?/giu, '')
    .replace(/May\s+they\s+be\s+Zoche\s+Legadlo\s+Ltorah\s+Lchupa\s+Ulmassim\s+Tovim[.!]?/giu, '')
    .replace(/שיזכו\s+לבנות\s+בית\s+נאמן\s+בישראל[.!]?/gu, '')
    .replace(/^\s*(?:maz[ae]l\s*tov|m["'״’]?t)[!.:,]?\s*(?:to\s+)?/iu, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function messagePeopleWording(value) {
  return value.replace(/\bRabbi & Mrs\b/gu, 'Rabbi and Mrs.')
    .replace(/\bMr & Mrs\b/gu, 'Mr. and Mrs.')
    .replace(/\b(their|our|his|her)\s+(son|daughter)\b/giu, (_, pronoun, child) => pronoun.toLowerCase() + ' ' + child.toLowerCase())
    .replace(/\bon (their|our) (son|daughter)['’]s ([^.!?\n]+?) (bar|bas)\s*mitzva[h]?\b/giu, (_, whose, child, name, kind) => 'on the ' + kind.toLowerCase() + ' mitzvah of ' + whose.toLowerCase() + ' ' + child.toLowerCase() + ' ' + name)
    .replace(/\bbar\s*mitzva[h]?\b/giu, 'bar mitzvah')
    .replace(/\bbas\s*mitzva[h]?\b/giu, 'bas mitzvah');
}

function messageDatedOccasion(value) {
  const pattern = new RegExp(String.raw`^((?:shalom zachor|kiddush|vort|chas[su]?na[h]?|wedding|bris|aufruf|bar mitzva[h]?|shiur|hespedim|tehillim)\b.+?)\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+` + messageClockSource + String.raw`)?[.!]?$`, 'iu');
  const match = pattern.exec(value);
  if (!match) return value;
  const date = new Date(match[2] + 'T12:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== match[2]) return value;
  const clock = match[3] ? messageClockValue(match[3], match[4], match[5]) : null;
  const label = new Intl.DateTimeFormat('en-US', { timeZone:'UTC', weekday:'long', year:'numeric', month:'long', day:'numeric' }).format(date);
  return match[1] + '\n\nDate: ' + label + (clock ? '\nTime: ' + clock.text : '');
}

function messageOccasionLine(value) {
  const match = /^(?:the\s+)?(chas[su]?na[h]?|wedding|vort|bris|kiddush|shalom\s+zachor|shiur|hespedim|tehillim|asifa)\s+(.+)$/iu.exec(value.replace(/[.!]+$/u, '').trim());
  if (!match) return value;
  const name = /^(?:chas[su]?na[h]?|wedding)$/iu.test(match[1]) ? 'chasuna' : match[1].toLowerCase();
  let rest = match[2].trim();
  const when = /^(tonight|tomorrow(?:\s+night)?|today|now|(?:this\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|shabbos)(?:\s+night)?)\b/iu.exec(rest);
  if (!when) return value;
  let timing = when[1].toLowerCase().replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|shabbos)\b/gu, word => word[0].toUpperCase() + word.slice(1));
  if (/^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Shabbos)\b/u.test(timing)) timing = 'on ' + timing;
  rest = rest.slice(when[0].length).trim();
  if (/^(?:for|in honou?r of|celebrating|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|January|February|March|April|May|June|July|August|September|October|November|December)\b/iu.test(rest)) return value;
  let clock = '';
  const leadingClock = new RegExp(`^(?:at\\s+)?${messageClockSource}(?=\\s|$)`, 'iu').exec(rest);
  if (leadingClock) {
    const parsed = messageClockValue(leadingClock[1], leadingClock[2], leadingClock[3], /night|evening/iu.test(timing));
    if (!parsed) return value;
    clock = parsed.text; rest = rest.slice(leadingClock[0].length).trim();
  }
  // A venue with its own sentence, address or instructions is kept verbatim.
  const sentence = /[.!](?:\s|$)|\n/u.exec(rest);
  const venue = (sentence ? rest.slice(0, sentence.index) : rest).replace(/^(?:at|in)\s+/iu, '').replace(/[,.]$/u, '').trim();
  const tail = sentence ? rest.slice(sentence.index + 1).trim() : '';
  if (venue && !/^(?:at|in)\s+/iu.test(rest) && !/\b(?:hall|ballroom|shul|home|house|hotel|restaurant|room|street|st|avenue|ave|road|rd|way|lane|ln)\b/iu.test(venue)) return value;
  const main = `The ${name} ${timing === 'now' ? 'is taking place' : 'will take place'} ${timing}${venue ? ' at ' + venue : ''}.`;
  return main + (clock ? '\nTime: ' + clock : '') + (tail ? '\n' + tail : '');
}

/** Polish only recognizable announcement language. Preserve names, addresses and unknown instructions. */
export function calendarMessageWording(value) {
  const hadGreeting = /^\s*(?:maz[ae]l\s*tov|m["'״’]?t)\b/iu.test(String(value || ''));
  let text = simchaSourceWording(value);
  if (!text) return hadGreeting ? 'Mazel tov!' : String(value || '').trim();
  if (/\b(?:cancelled|canceled|postponed|rescheduled|correction|not|no|maybe|possibly|tentative)\b|נדחה|בוטל/iu.test(text)) return String(value || '').trim();
  // Reformatting a generated entry must not duplicate its greeting or time labels.
  text = text.replace(/^((?:Rabbi & Mrs|Mr & Mrs)\s+.+?)\s+are making a\s+(bar\s*mitzva[h]?|bas\s*mitzva[h]?|chas[su]?na[h]?)\s+for their\s+(son|daughter)\s+([\p{L}\p{M}'’ -]{1,100})([.!])(?=\s|$)/iu, (_, family, occasion, child, name, stop) => family + ' on the ' + occasion.toLowerCase() + ' of their ' + child.toLowerCase() + ' ' + name + stop);
  const boundary = String.raw`(?=!(?:\s|$)|\.(?:\s+(?:chas[su]?na[h]?|wedding|vort|shacharis|mincha|maariv|mariv|dessert|kiddush|shalom|bris|the|please|at|location|reception|time|entrance)\b|$)|\n|$)`;
  const familyOpening = new RegExp(String.raw`^((?:Rabbi & Mrs|Mr & Mrs)\s+.+?\s+(?:on|upon)\s+.+?)` + boundary, 'iu');
  const greetingOpening = new RegExp(String.raw`^(.+?\s+(?:on|upon)\s+.+?)` + boundary, 'iu');
  const opening = (hadGreeting ? greetingOpening : familyOpening).exec(text);
  let greeting = '';
  if (opening) {
    greeting = 'Mazel tov to ' + messagePeopleWording(opening[1]).replace(/[.!]+$/u, '') + '!';
    text = text.slice(opening[0].length).replace(/^[.!\s]+/u, '');
  }
  if (!opening && hadGreeting) text = 'Mazel tov to ' + text;
  text = messagePeopleWording(text).replace(/\bfor (MEN|WOMEN)\b/gu, (_, audience) => 'for ' + audience.toLowerCase());
  const milestones = simchaWeddingMilestones(text);
  for (const item of [...milestones].reverse()) text = text.slice(0, item.start).trimEnd().replace(/\s+(?:and|&)$/iu, '') + '\n' + item.label + ': ' + item.text + text.slice(item.end);
  text = text.replace(/\b(TONIGHT|TODAY|TOMORROW|NOW)\b/gu, word => word.toLowerCase());
  // Put prayer times on their own labelled line without supplying a missing period.
  text = text.replace(new RegExp(`\\b(Shacharis|Mincha|Maariv|Mariv)\\s*:?\\s*${messageClockSource}(?=\\s|[.,;!?]|$)`, 'giu'), (all, label, hour, minute, period) => {
    const clock = messageClockValue(hour, minute, period || (/^shacharis$/iu.test(label) && +hour < 12 ? 'a' : ''), false);
    return clock ? '\n' + (/mariv|maariv/iu.test(label) ? 'Maariv' : label[0].toUpperCase() + label.slice(1).toLowerCase()) + ': ' + clock.text : all;
  });
  let lines = text.trim().split('\n').map(line => line.trim());
  if (lines.length) lines[0] = messageOccasionLine(messageDatedOccasion(lines[0]));
  lines = lines.join('\n').split('\n');
  const timingLine = lines.findIndex(line => /^(?:Date|Chuppah|Simchas Chosson V’Kallah|Shacharis|Mincha|Maariv|Time): /u.test(line));
  text = lines.map((line, index) => (index === timingLine && index > 0 && lines[index - 1] ? '\n' : '') + line).join('\n');
  return [greeting, text].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n');
}

