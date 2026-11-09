// Read-only release checks. Never create a production account or announcement.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const endpoint = JSON.parse(fs.readFileSync(new URL('../data/calendar.json', import.meta.url), 'utf8')).endpoint;
const origin = 'https://' + fs.readFileSync(new URL('../CNAME', import.meta.url), 'utf8').trim();
const headers = { Origin: origin, 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' };
const infoResponse = await fetch(endpoint + '/api/info', { headers });
assert.equal(infoResponse.status, 200, 'The existing private calendar service must respond.');
const info = await infoResponse.json();
assert.equal(info.ready, true, 'Keep the existing configured calendar owner.');
assert.equal(info.announcementDateEditing, true, 'Deploy the calendar Worker update before publishing the date controls.');
assert.equal(info.announcementHistoryDays, 10, 'The congregation history limit must be active on the server.');
assert.equal(info.smsImport, true, 'Keep the existing Tasker/Shul SMS connection available.');
for (const path of ['/api/announcements', '/api/announcements/status', '/api/announcements/updates?after=0', '/api/announcements?view=admin&days=1000', '/api/sms-import']) {
  const response = await fetch(endpoint + path, { headers });
  assert.equal(response.status, 401, path + ' must still require its existing private account.');
  await response.body?.cancel();
}
if (process.argv.includes('--site')) {
  const local = fs.readFileSync(new URL('../admin/calendar/index.html', import.meta.url), 'utf8');
  const version = html => /"\/js\/ui\/calendar-announcements.js": "\/js\/ui\/calendar-announcements.js\?v=([a-f0-9]+)"/.exec(html)?.[1];
  const response = await fetch(origin + '/admin/calendar/?release-check=' + Date.now(), { headers });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(version(local), 'Build the release checkout before checking site versions.');
  assert.equal(version(html), version(local), 'Wait for GitHub Pages to publish the matching announcement client.');
  const script = await fetch(origin + '/js/ui/calendar-announcements.js?v=' + version(html), { headers }).then(response => response.text());
  assert(script.includes('Added date and time') && script.includes('view=congregation'), 'The date controls and congregation view must be in the live client.');
}
console.log('Verified announcement date editing, the 10-day server limit, private access and the existing SMS capability' + (process.argv.includes('--site') ? ', with matching live client assets.' : '.'));
