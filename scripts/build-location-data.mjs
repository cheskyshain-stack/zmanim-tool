// Rebuild the checked-in, first-party location snapshot from GeoNames postal
// archives and geo-tz 8.1.10. Dependencies are build tools, never runtime APIs.
// Usage: node scripts/build-location-data.mjs <archive-dir> <npm-tools-dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sources = path.resolve(process.argv[2]);
const tools = path.resolve(process.argv[3]);
const requireTool = createRequire(path.join(tools, 'package.json'));
const { find } = requireTool('geo-tz/all');
const geoRoot = path.dirname(path.dirname(requireTool.resolve('geo-tz/all')));
if (JSON.parse(fs.readFileSync(path.join(geoRoot, 'package.json'))).version !== '8.1.10') throw new Error('Use geo-tz 8.1.10 for this versioned snapshot.');
const esbuild = requireTool('esbuild');
const destination = path.join(root, 'assets/location-data/v1');
const chunkSize = 262144;
const archives = ['US', 'PR', 'GU', 'VI', 'AS', 'MP'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rows = JSON.parse(execFileSync('python', ['-c', `
import sys,json,zipfile
from pathlib import Path
rows=[]
for cc in ${JSON.stringify(archives)}:
 with zipfile.ZipFile(Path(sys.argv[1])/(cc+'.zip')) as book:
  rows.extend([line.split('\\t') for line in book.read(cc+'.txt').decode('utf8').splitlines()])
print(json.dumps(rows))
`, sources], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
const shards = new Map(), skipped = [], seen = new Set();
for (const row of rows) {
  const [country, zip, city, , admin] = row;
  const latitude = Number(row[9]), longitude = Number(row[10]);
  if (!/^\d{5}$/.test(zip) || seen.has(zip)) continue;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (!latitude && !longitude)) { skipped.push(zip); continue; }
  const zones = [...new Set(find(latitude, longitude))];
  if (zones.length !== 1 || zones[0].startsWith('Etc/')) { skipped.push(zip); continue; }
  const state = country === 'US' ? admin : country;
  const prefix = zip.slice(0, 2);
  if (!shards.has(prefix)) shards.set(prefix, {});
  shards.get(prefix)[zip] = [city, state, latitude, longitude, zones[0]];
  seen.add(zip);
}
fs.mkdirSync(destination, { recursive: true });
for (const directory of ['zips', 'timezone-chunks']) fs.mkdirSync(path.join(destination, directory), { recursive: true });
// Include empty prefixes so a valid-looking unknown ZIP still has a local answer.
for (let i = 0; i < 100; i++) {
  const prefix = String(i).padStart(2, '0');
  fs.writeFileSync(path.join(destination, 'zips', prefix + '.json'), JSON.stringify({ version: 1, locations: shards.get(prefix) || {} }) + '\n');
}
const indexBytes = fs.readFileSync(path.join(geoRoot, 'data/timezones.geojson.index.json'));
const boundaryBytes = fs.readFileSync(path.join(geoRoot, 'data/timezones.geojson.geo.dat'));
const index = JSON.parse(indexBytes);
fs.writeFileSync(path.join(destination, 'timezone-index.json'), JSON.stringify({ ...index, chunkSize, byteLength: boundaryBytes.length }) + '\n');
const chunks = [];
for (let offset = 0; offset < boundaryBytes.length; offset += chunkSize) {
  const name = String(offset / chunkSize).padStart(3, '0') + '.bin';
  const bytes = boundaryBytes.subarray(offset, offset + chunkSize);
  fs.writeFileSync(path.join(destination, 'timezone-chunks', name), bytes);
  chunks.push({ file: name, bytes: bytes.length, sha256: hash(bytes) });
}
await esbuild.build({ entryPoints: [path.join(root, 'scripts/location-decode-entry.mjs')],
  nodePaths: [path.join(tools, 'node_modules')], bundle: true, format: 'iife', globalName: 'CandleGeoDecode',
  minify: true, legalComments: 'inline', outfile: path.join(root, 'vendor/location-decode-v1.js'),
  banner: { js: '/*! Location decoder: geobuf, pbf and Turf. MIT/BSD/ISC license notices: /assets/location-data/v1/NOTICE.txt */' } });
const notice = [
  'Location data hosted by Bais Medrash of Lakewood Commons. Candle-lighting times are calculated by the site.',
  'ZIP coordinates: GeoNames https://www.geonames.org/ . Postal datasets US, PR, GU, VI, AS and MP.',
  'GeoNames data: Creative Commons Attribution 4.0 https://creativecommons.org/licenses/by/4.0/ .',
  'Changes: selected ZIP/city/state/coordinates, resolved IANA zones, omitted unsupported/ambiguous rows and split by ZIP prefix.',
  'Time-zone boundaries: timezone-boundary-builder https://github.com/evansiroky/timezone-boundary-builder and OpenStreetMap contributors https://www.openstreetmap.org/copyright .',
  'Boundary data: Open Data Commons Open Database License 1.0 https://opendatacommons.org/licenses/odbl/1-0/ .',
  'The combined ZIP/time-zone lookup snapshot is available under ODbL 1.0; the original GeoNames attribution terms are retained.',
  'The original time-zone database is retained without coordinate changes, divided into byte chunks. The index retains the original geometry references.',
  'Source distribution: geo-tz 8.1.10 https://www.npmjs.com/package/geo-tz/v/8.1.10 . Original index and binary SHA256 are in manifest.json; concatenating the ordered chunks reproduces the binary.',
];
for (const name of ['geo-tz', 'geobuf', 'pbf', '@turf/boolean-point-in-polygon', '@turf/helpers', '@turf/invariant', 'point-in-polygon-hao', 'robust-predicates']) {
  const packagePath = path.join(tools, 'node_modules', name);
  if (!fs.existsSync(packagePath)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json')));
  notice.push(`\n${name} ${meta.version}: ${meta.license}`);
  for (const file of fs.readdirSync(packagePath).filter(file => /^licen[cs]e/i.test(file))) notice.push(fs.readFileSync(path.join(packagePath, file), 'utf8'));
}
fs.writeFileSync(path.join(destination, 'NOTICE.txt'), notice.join('\n\n') + '\n');
const manifest = { version: 1, generated: new Date().toISOString().slice(0, 10), zipCount: seen.size,
  sources: archives.map(cc => ({ file: cc + '.zip', url: 'https://download.geonames.org/export/zip/' + cc + '.zip', sha256: hash(fs.readFileSync(path.join(sources, cc + '.zip'))) })),
  geoTzVersion: '8.1.10', indexSha256: hash(indexBytes), boundariesSha256: hash(boundaryBytes), chunkSize, chunks,
  schema: 'ZIP prefix JSON: locations[zip] = [city, state, latitude, longitude, IANA time zone].', skipped: [...new Set(skipped)] };
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ zipCount: seen.size, skipped: manifest.skipped.length, timezoneChunks: chunks.length, boundaryBytes: boundaryBytes.length }));
