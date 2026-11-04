const LEGACY_KEY = 'lakewood-commons-seats-room-design';
const CHART_PREFIX = LEGACY_KEY + '-chart:';
const MIGRATED_KEY = LEGACY_KEY + '-chart-migration';

// A display choice belongs to one chart on this device, outside shared chart data.
export function seatsCreateChartDisplayChoice({ storageKey, getStorage = () => localStorage }) {
  const prefix = storageKey + '-chart:';
  const remembered = new Map(), unsaved = new Map();
  const set = (id, enabled) => {
    remembered.set(id, Boolean(enabled));
    try { getStorage().setItem(prefix + id, enabled ? '1' : '0'); unsaved.delete(id); }
    catch { unsaved.set(id, Boolean(enabled)); }
  };
  return {
    get(id) {
      if (unsaved.has(id)) return unsaved.get(id);
      try { const enabled = getStorage().getItem(prefix + id) === '1'; remembered.set(id, enabled); return enabled; }
      catch { return remembered.get(id) === true; }
    },
    set,
  };
}

export function seatsCreateRoomDesignChoice({ legacyChartId = null, getStorage = () => localStorage } = {}) {
  const choice = seatsCreateChartDisplayChoice({ storageKey: LEGACY_KEY, getStorage });
  try {
    const storage = getStorage();
    if (storage.getItem(MIGRATED_KEY) !== '1') {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacyChartId && ['0', '1'].includes(legacy) && storage.getItem(CHART_PREFIX + legacyChartId) === null) choice.set(legacyChartId, legacy === '1');
      storage.setItem(MIGRATED_KEY, '1');
    }
  } catch { /* Unavailable preferences do not affect chart data. */ }
  return choice;
}
