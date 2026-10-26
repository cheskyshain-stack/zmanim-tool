import { seatsCreatePlan } from './model.js';
import { seatsIsRoomChartName } from './chart-names.js';

const seatsContentIgnored = new Set(['id', 'name', 'people', 'layoutVersion', 'paper', 'monochrome']);
const seatsContentMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let seatsContentBaseline = null;

export function seatsIsAutomaticChartName(name) {
  if (seatsIsRoomChartName(name)) return true;
  if (typeof name !== 'string') return false;
  const match = /^Seating plan - (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01]), ([1-9]\d{0,5})(?: \((?:[2-9]|[1-9]\d+)\))?$/i.exec(name.trim().replace(/\s+/gu, ' '));
  if (!match) return false;
  const month = seatsContentMonths.findIndex(value => value.toLowerCase() === match[1].toLowerCase());
  const day = Number(match[2]), year = Number(match[3]), date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
}

function seatsContentShape(plan) {
  const shape = Object.fromEntries(Object.entries(plan).filter(([key]) => !seatsContentIgnored.has(key)));
  if (Array.isArray(plan.tables)) shape.tables = [...plan.tables].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  if (Array.isArray(plan.objects)) shape.objects = plan.objects.map(object => {
    if (object?.type !== 'bimah') return object;
    const { id, ...fields } = object;
    return fields;
  }).sort((a, b) => String(a?.id || a?.type).localeCompare(String(b?.id || b?.type)));
  return shape;
}

function seatsContentEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= .001 + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const left = Object.keys(a).sort(), right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] && seatsContentEqual(a[key], b[key]));
}

export function seatsHasContent(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!seatsIsAutomaticChartName(plan.name) || plan.people?.length) return true;
  if (!seatsContentBaseline) seatsContentBaseline = seatsContentShape(seatsCreatePlan());
  return !seatsContentEqual(seatsContentShape(plan), seatsContentBaseline);
}
