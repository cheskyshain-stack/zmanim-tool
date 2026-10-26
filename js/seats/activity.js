export function seatsDescribeChanges(before, after, changes) {
  const details = [], layout = new Set();
  const person = (plan, id) => plan.people.find(person => person.id === id)?.name || 'Empty';
  const count = kind => changes.filter(change => change.group === 'people' && !change.key && (kind === 'added' ? !change.before : !change.after)).length;
  for (const [kind, word] of [['added', 'Added'], ['removed', 'Removed']]) {
    const total = count(kind); if (total) details.push(word + ' ' + total + (total === 1 ? ' name' : ' names'));
  }
  for (const change of changes) {
    if (change.group === 'plan') {
      if (change.key === 'name') details.push('Renamed chart from “' + change.before + '” to “' + change.after + '”');
      else if (['paper', 'monochrome'].includes(change.key)) layout.add('print settings');
      else layout.add('room layout');
    } else if (change.group === 'people') {
      if (change.key === 'name') details.push('Changed name from “' + change.before + '” to “' + change.after + '”');
    } else if (change.key === 'seats' && change.index !== undefined) {
      const table = [...after.tables, ...after.objects].find(item => item.id === change.id);
      details.push((table?.label || change.id) + ', seat ' + (change.index + 1) + ': ' + person(before, change.before) + ' → ' + person(after, change.after));
    } else {
      const table = [...after.tables, ...after.objects, ...before.tables, ...before.objects].find(item => item.id === change.id);
      layout.add(table?.label || change.id);
    }
  }
  if (layout.size) details.push('Changed ' + [...layout].slice(0, 12).join(', ') + (layout.size > 12 ? ' and ' + (layout.size - 12) + ' more items' : ''));
  if (details.length > 30) return [...details.slice(0, 30), (details.length - 30) + ' more changes'];
  return details.length ? details : ['Saved chart'];
}

export function seatsRecordMetadata(record) {
  return { createdAt: record.createdAt || (record.revision === 1 ? record.updatedAt : null) || null,
    createdBy: record.createdBy || (record.revision === 1 ? record.updatedBy : null) || null,
    updatedAt: record.updatedAt || null, updatedBy: record.updatedBy || null };
}
