/** Correct display names from the exact printed line inside a Shabbos cell.
 * The shared agenda flattens the G column's two-line heading into one name,
 * and does not recognize the explicit 72-minute nightfall line in column B.
 * Read those labels back from their own source lines without moving any time. */
export function normalizeShabbosDisplayEvents(rows, showing, serial, events) {
  const labels = new Map();
  for (const row of rows || []) {
    const sourceDay = row.eventSerial ?? showing - (row.friday ? 1 : 0);
    if (sourceDay !== serial || !['G', 'B'].includes(String(row.key))) continue;
    const header = String(row.header || row.title || '');
    if (row.key === 'G' && !(/מנחה/.test(header) && /מעריב/.test(header))) continue;
    const plain = String(row.value ?? '')
      .replace(/<br\s*\/?>|<\/(?:div|p)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[\uE000\uE001\u2066-\u2069\u200E\u200F]/g, '');
    for (const raw of plain.split('\n')) {
      const line = raw.trim();
      let correction;
      if (row.key === 'G') {
        // A bare time is the first, Mincha line. The optional later Maariv
        // carries its own word on the paper. Unknown edited prose stays intact.
        if (/^מעריב\s+/.test(line)) correction = {name: 'מעריב', auxiliary: false};
        else if (/^(?:מנחה\s+)?\d{1,2}:\d{2}/.test(line)) correction = {name: 'מנחה', auxiliary: false};
      } else if (/^זמן\s+72\s+/.test(line)) {
        correction = {name: 'זמן 72', auxiliary: true};
      }
      if (!correction) continue;
      for (const match of line.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
        const hour = Number(match[1]), minute = Number(match[2]);
        if (hour < 1 || hour > 12 || minute > 59) continue;
        const key = `${row.key}|${(hour % 12 + 12) * 60 + minute}`;
        const prior = labels.get(key);
        // Do not guess between two edited source lines sharing the same clock.
        labels.set(key, prior && prior.name !== correction.name ? {ambiguous: true} : prior?.ambiguous ? prior : correction);
      }
    }
  }
  return events.map(event => {
    const correction = labels.get(`${event.cell}|${event.mins}`);
    return correction && !correction.ambiguous ? {...event, ...correction} : event;
  });
}
