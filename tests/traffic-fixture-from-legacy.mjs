// Convert a saved public v1 response into a truthful preview through the actual
// v2 Worker. Only recorded hourly counts survive; UTC category totals do not.
// Usage: node tests/traffic-fixture-from-legacy.mjs input.json output.json [days]
import fs from 'node:fs/promises';
import worker from '../worker/traffic-worker.js';

export async function previewFromLegacy(raw, days = 7) {
  const months = new Map();
  for (const row of raw.groups?.hour?.rows || []) {
    const date = String(row.key).slice(0, 10);
    const month = date.slice(0, 7);
    const content = months.get(month) || {};
    const rec = content[date] || { v: new Array(24).fill(0), w: new Array(24).fill(0), at: raw.fetchedAt };
    const hour = new Date(row.key).getUTCHours();
    rec.v[hour] += row.visits;
    rec.w[hour] += row.views;
    content[date] = rec;
    months.set(month, content);
  }
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  globalThis.fetch = async () => { throw new Error('No live collection is performed in this saved-data preview.'); };
  globalThis.caches = { default: { async match() { return null; }, async put() {} } };
  try {
    const response = await worker.fetch(new Request(`https://preview.invalid/?days=${days}&asOf=${encodeURIComponent(raw.until || raw.fetchedAt)}`, {
      headers: { Origin: 'http://127.0.0.1:8990' },
    }), {
      CF_API_TOKEN: 'preview-only', CF_ACCOUNT_ID: '04b085d9f19ac1ba6d333e0006fc94c1', CF_SITE_TAG: raw.site || 'preview-site',
      ARCHIVE: { async get(key) { return key.startsWith('m:') ? months.get(key.slice(2)) || null : null; }, async put() {} },
    }, { waitUntil() {} });
    const body = await response.json();
    body.preview = { source: 'Saved public analytics response', capturedAt: raw.fetchedAt,
      explanation: 'This preview uses actual saved hourly counts. Category detail is unavailable because the old Worker did not save it by hour. No live collection was performed.' };
    return body;
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
}

if (process.argv[1]?.endsWith('traffic-fixture-from-legacy.mjs') && process.argv[2]) {
  const raw = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const body = await previewFromLegacy(raw, Number(process.argv[4] || 7));
  await fs.writeFile(process.argv[3], JSON.stringify(body, null, 2));
  console.log(JSON.stringify({ range: body.range, totals: body.totals, coverage: body.coverage?.status }));
}
