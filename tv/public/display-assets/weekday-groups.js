/** Rearrange weekly reference text without changing any actual daily schedule.
 * A separate day section is justified only when every saved morning service,
 * Mincha, and Maariv has a complete exception for that date. Single-prayer
 * exceptions, such as Rosh Chodesh or earlier Selichos, stay by that prayer.
 */
export function groupWeekdayPresentation(services = []) {
  const copy = structuredClone(services);
  const morning = copy.flatMap((service, index) =>
    ['שחרית', 'סליחות'].includes(service.name) && service.groups.some(group => group.events.length)
      ? [index] : []);
  const mincha = copy.findIndex(service => service.name === 'מנחה');
  const maariv = copy.findIndex(service => service.name === 'מעריב');
  if (!morning.length || mincha < 0 || maariv < 0) return {services:copy, daySections:[]};

  // Empty Friday groups record that the Shabbos chart owns those hours; they
  // cannot become a baseline or qualify a day as having a complete schedule.
  // Explicit calendar metadata breaks short-week ties in favor of the ordinary
  // days. Older cached snapshots without that field retain their first-largest
  // nonempty group; no Hebrew heading is parsed to infer a fast day.
  const bases = copy.map(service => {
    const hasMetadata = service.groups.some(group => group.days.some(day => typeof day.fastDay === 'boolean'));
    const ordinaryCount = group => group.days.filter(day => day.fastDay === false).length;
    return service.groups.reduce((best, group, index) => {
      if (!group.events.length || !group.days.length) return best;
      if (best < 0) return index;
      const previous = service.groups[best];
      if (hasMetadata && ordinaryCount(group) !== ordinaryCount(previous))
        return ordinaryCount(group) > ordinaryCount(previous) ? index : best;
      return group.days.length > previous.days.length ? index : best;
    }, -1);
  });
  const required = [...morning, mincha, maariv];
  if (required.some(index => bases[index] < 0)) return {services:copy, daySections:[]};

  const dates = new Map();
  for (const service of copy) for (const group of service.groups) for (const day of group.days)
    if (!dates.has(day.date)) dates.set(day.date, day);
  const moved = new Set(), sections = new Map();
  for (const [date, day] of [...dates].sort(([a], [b]) => a.localeCompare(b))) {
    const membership = copy.map(service => service.groups.flatMap((group, index) =>
      group.days.some(day => day.date === date) ? [index] : []));
    // Ambiguous group membership is left untouched instead of choosing a time.
    if (membership.some(groups => groups.length > 1) || required.some(index => {
      const groupIndex = membership[index][0];
      return groupIndex === undefined || groupIndex === bases[index] || !copy[index].groups[groupIndex].events.length;
    })) continue;
    const signature = JSON.stringify(membership);
    let section = sections.get(signature);
    if (!section) {
      section = {days:[], services:copy.flatMap((service, index) => {
        const group = service.groups[membership[index][0]];
        return group?.events.length ? [{name:service.name, events:structuredClone(group.events)}] : [];
      })};
      sections.set(signature, section);
    }
    section.days.push({...day});
    moved.add(date);
  }

  return {
    services:copy.map((service, index) => ({...service, groups:service.groups
      .map((group, groupIndex) => ({group, groupIndex}))
      .sort((a, b) => Number(b.groupIndex === bases[index]) - Number(a.groupIndex === bases[index]))
      .map(({group}) => group)
      .map(group => ({...group, days:group.days.filter(day => !moved.has(day.date))}))
      .filter(group => group.days.length)})),
    daySections:[...sections.values()],
  };
}
