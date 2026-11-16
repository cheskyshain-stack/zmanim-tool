import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildScheduleFeed } from './schedule-feed.mjs';

if (process.argv.length > 2) throw new Error('The public feed always uses the current ten-day window; arguments are not accepted.');
const root = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async name => JSON.parse(await readFile(path.join(root, 'data', name), 'utf8'));
const [config, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json', 'special_days.json',
].map(readJSON));
const feed = buildScheduleFeed(config, { parshaChutz, parshaEY, parshaNames, specialDays });
const output = path.join(root, 'dist', 'api');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'schedule.json'), JSON.stringify(feed, null, 2) + '\n');
console.log(`Built ten-day schedule API: ${feed.range.startDate} through ${feed.range.endDate}, without locations`);
