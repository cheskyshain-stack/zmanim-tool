const startsEvening = group => !group.auxiliary && (
  group.families?.includes('maariv') || group.family === 'maariv' ||
  /מעריב|כל נדרי|קול נדרי/.test(group.label)
);

/** Display-only sections. Keep the original source date and prayer identity so
 * family expiry, next-minyan selection and full-day sizing do not move with a tag.
 * Classify against all rows, including expired ones, so later notes cannot jump
 * back to an Erev heading after the first evening service leaves the screen. */
export function prayerSections(days) {
  const sections = [];
  for (const day of days) {
    const headings = day.prayerHeadings;
    const daytime = headings?.day || {key:'day:'+day.date,date:day.date,
      title:day.displayTitle || day.title,hebrewDate:day.hebrewDate};
    const evening = headings?.evening;
    const all = day.allGroups || day.groups;
    const boundary = evening ? all.findIndex(startsEvening) : -1;
    const visible = new Map(day.groups.map(group => [group.key,group]));
    const append = (heading,group) => {
      let section = sections.at(-1);
      if (!section || section.key !== heading.key) {
        section = {...heading,sourceDate:day.date,groups:[],note:''};
        sections.push(section);
      }
      if (group) section.groups.push({...group,sourceDate:day.date});
      else section.note = day.note;
    };
    for (let index=0;index<all.length;index++) {
      const group = visible.get(all[index].key);
      if (group) append(boundary >= 0 && index >= boundary ? evening : daytime,group);
    }
    if (!day.groups.length && day.note) append(daytime,null);
  }
  return sections;
}
