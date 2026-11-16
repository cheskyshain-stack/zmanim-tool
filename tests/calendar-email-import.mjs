import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isLcTextSource, lcTextWording, LC_TEXT_SUBJECT } from '../js/calendar/lc-text.js';
import { lcTextCalendarScript } from '../worker/calendar/gmail-bridge.js';

const from = '"Lc Text (SMS)" <15510001111.18483564187.synthetic@txt.voice.google.com>';
const wrapper = text => '<https://voice.google.com>\r\n' + text + '\r\nYOUR ACCOUNT <https://voice.google.com> HELP CENTER\r\n<https://support.google.com/voice#topic=1707989> HELP FORUM\r\n<https://productforums.google.com/forum/#!forum/voice>\r\nThis email was sent to you because you indicated that you\'d like to receive\r\nemail notifications for text messages.\r\nGoogle LLC\r\n1600 Amphitheatre Pkwy\r\nMountain View CA 94043 USA';

test('matches the exact LC Text subject, Google Voice domain and originating phone', () => {
  assert(isLcTextSource({ subject: LC_TEXT_SUBJECT, from }));
  for (const change of [
    { subject: 'Fwd: ' + LC_TEXT_SUBJECT }, { subject: LC_TEXT_SUBJECT + ' other' },
    { from: 'Lc Text <sender@example.test>' }, { from: from.replace('@txt.voice.google.com', '@txt.voice.google.com.example.test') },
    { from: from.replace('18483564187', '18483564188') },
  ]) assert(!isLcTextSource({ subject: LC_TEXT_SUBJECT, from, ...change }));
});

test('extracts just the actual wording, preserving Hebrew, numbers, line breaks and links', () => {
  const wording = 'Synthetic community notice\nמזל טוב למשפחה\n7:30-8:20 @ #230\nhttps://example.test/details';
  assert.equal(lcTextWording({ text: wrapper(wording) }), wording);
  assert.equal(lcTextWording({ text: LC_TEXT_SUBJECT + '\n\n' + wrapper(wording) }), wording);
  assert.equal(lcTextWording({ text: wording + '\nTo respond to this text message, reply to this email or visit Google Voice.\nHelp' }), wording);
  assert.equal(lcTextWording({ text: wrapper('YOUR ACCOUNT needs attention\nHelp us at the shul.') }), 'YOUR ACCOUNT needs attention\nHelp us at the shul.');
  assert.equal(lcTextWording({ text: wrapper(LC_TEXT_SUBJECT + '\nhttps://voice.google.com') }), LC_TEXT_SUBJECT + '\nhttps://voice.google.com');
  assert.equal(lcTextWording({ text: '<img src=x onerror=alert(1)>' }), '<img src=x onerror=alert(1)>');
});

test('ambiguous, empty, truncated and oversized messages require review', () => {
  for (const input of [{ text: wrapper('') }, { text: '[No text in this email. Open Gmail to review the attachment.]' }, { text: wrapper('a'.repeat(4001)) }, { text: wrapper('Notice'), truncated: true }, { text: 'Notice\nemail notifications for text messages' }]) assert.throws(() => lcTextWording(input));
});

function googleFixture({ count = 123, failOnce = false, alias = false } = {}) {
  const properties = {}, accepted = new Map(), calls = [], triggers = [{ getHandlerFunction: () => 'importCommonsMail' }];
  let failures = failOnce ? 1 : 0;
  const now = Date.now() - 10000;
  const threads = Array.from({ length: count }, (_, index) => {
    const message = { getDate: () => new Date(now - index * 86400000), getId: () => (index + 10000000).toString(16), getFrom: () => from,
      getSubject: () => LC_TEXT_SUBJECT, getPlainBody: () => wrapper('Synthetic notice ' + index), isDraft: () => false, isInTrash: () => false,
      getTo: () => alias && index === 0 ? 'other@example.test' : 'ads@neileich.org', getCc: () => '', getHeader: () => '' };
    return { getMessages: () => [message] };
  });
  const context = vm.createContext({
    Session: { getEffectiveUser: () => ({ getEmail: () => alias ? 'primary@example.test' : 'ads@neileich.org' }) },
    GmailApp: { getAliases: () => alias ? ['ads@neileich.org'] : [], search: (query, offset, limit) => {
      const start = Number(query.match(/after:(\d+)/)[1]), end = Number(query.match(/before:(\d+)/)[1]);
      return threads.filter(thread => { const stamp = +thread.getMessages()[0].getDate() / 1000; return stamp >= start && stamp < end; }).slice(offset, offset + limit);
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }), setProperties: values => Object.assign(properties, values), setProperty: (key, value) => { properties[key] = value; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [...triggers], deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1), newTrigger: name => ({ timeBased: () => ({ everyMinutes: minutes => ({ create: () => { assert.equal(minutes, 5); triggers.push({ getHandlerFunction: () => name }); } }) }) }) },
    UrlFetchApp: { fetch: (url, options) => {
      assert.equal(url, 'https://calendar.example.test/api/email-import/receive');
      assert.deepEqual(Object.keys(options.headers), ['X-Calendar-Inbox-Key']);
      const value = JSON.parse(options.payload); calls.push(value);
      if (value.message) {
        accepted.set(value.message.sourceId, value.message);
        if (failures && accepted.size === 4) { failures--; throw new Error('Synthetic lost response'); }
      }
      return { getResponseCode: () => 200, getContentText: () => '{"accepted":true}' };
    } },
  });
  const script = lcTextCalendarScript({ endpoint: 'https://calendar.example.test', token: 'a'.repeat(64), includeExisting: true });
  vm.runInContext(script, context);
  return { context, properties, accepted, triggers, calls, script };
}

test('Google bridge resumes a long historical import, oldest first, without touching the Comments trigger', () => {
  const fixture = googleFixture();
  vm.runInContext('setupLcTextCalendar()', fixture.context);
  assert.equal(fixture.accepted.size, 100);
  vm.runInContext('importLcTextCalendar()', fixture.context);
  assert.equal(fixture.accepted.size, 123);
  assert.equal(fixture.properties.lcPhase, '');
  const times = [...fixture.accepted.values()].map(message => Date.parse(message.receivedAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.deepEqual(fixture.triggers.map(trigger => trigger.getHandlerFunction()), ['importCommonsMail', 'importLcTextCalendar']);
  vm.runInContext('importLcTextCalendar()', fixture.context);
  assert.equal(fixture.accepted.size, 123);
  assert(!fixture.script.includes('calendar-session'));
});

test('a lost response retries the same source message and alias mail is scoped to Ads', () => {
  const fixture = googleFixture({ count: 8, failOnce: true, alias: true });
  assert.throws(() => vm.runInContext('setupLcTextCalendar()', fixture.context), /lost response/);
  vm.runInContext('importLcTextCalendar()', fixture.context);
  assert.equal(fixture.accepted.size, 7);
  const ids = fixture.calls.filter(call => call.message).map(call => call.message.sourceId);
  assert(ids.length > new Set(ids).size, 'The unconfirmed original is retried with its stable Gmail ID');
  assert(!fixture.accepted.has((10000000).toString(16)), 'An email to another primary-account address is not imported through the Ads alias');
});
