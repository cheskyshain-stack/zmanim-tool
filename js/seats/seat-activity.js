// The deployed history API records seat assignments in its change descriptions.
// Reading that history keeps this display compatible with the existing service.
export function seatsLastSeatAssignment(entries = []) {
  for (const entry of entries) {
    if (!entry.by || !Number.isFinite(Date.parse(entry.at))) continue;
    if (entry.details?.some(detail => {
      const seat = /^.+, seat [1-9]\d*: .+ → (.+)$/.exec(detail);
      return seat && seat[1] !== 'Empty';
    })) return { by: entry.by, at: entry.at };
  }
  return null;
}

export function seatsCreateSeatActivity({ request, onChange }) {
  const cache = new Map();
  async function find(id, revision, previous) {
    let before = null;
    while (true) {
      const page = await request('/api/plans/' + encodeURIComponent(id) + '/history' + (before === null ? '' : '?before=' + before));
      const entries = page.entries.filter(entry => entry.revision <= revision);
      const assignment = seatsLastSeatAssignment(entries);
      if (assignment) return assignment;
      if (previous?.status === 'ready' && entries.some(entry => entry.revision <= previous.revision)) return previous.assignment;
      if (page.nextBefore === null) return null;
      if (!Number.isSafeInteger(page.nextBefore) || page.nextBefore < 1 || before !== null && page.nextBefore >= before) throw new Error('Invalid chart history page.');
      before = page.nextBefore;
    }
  }
  function load(id, revision) {
    const previous = cache.get(id);
    if (previous?.revision >= revision && previous.status !== 'error') return previous.pending;
    const record = { revision, status: 'loading', assignment: previous?.assignment || null };
    cache.set(id, record);
    record.pending = find(id, revision, previous).then(assignment => { record.assignment = assignment; record.status = 'ready'; }, () => { record.status = 'error'; })
      .then(() => { if (cache.get(id) === record) onChange(id); });
    return record.pending;
  }
  return { load, read: id => cache.get(id), clear: () => cache.clear() };
}
