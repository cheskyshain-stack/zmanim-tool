import { LC_TEXT_MAILBOX, LC_TEXT_SUBJECT } from '../../js/calendar/lc-text.js';

// Serialized functions run in a separate Google Apps Script project owned by the
// mailbox account. No Gmail credentials or calendar login are sent to the site.
function setupLcTextCalendar() {
  var account = Session.getEffectiveUser().getEmail().toLowerCase();
  var addresses = [account].concat(GmailApp.getAliases().map(function(value) { return value.toLowerCase(); }));
  if (addresses.indexOf(LC_CALENDAR_CONFIG.mailbox) < 0) throw new Error('Run this project while signed in to ' + LC_CALENDAR_CONFIG.mailbox + '.');
  var props = PropertiesService.getScriptProperties(), old = props.getProperties();
  props.setProperties({ lcUrl: LC_CALENDAR_CONFIG.url, lcKey: LC_CALENDAR_CONFIG.key, lcAccount: account, lcMailbox: LC_CALENDAR_CONFIG.mailbox });
  if (!old.lcCursor || old.lcKey !== LC_CALENDAR_CONFIG.key) props.setProperties({ lcCursor: LC_CALENDAR_CONFIG.includeExisting ? '0' : String(Math.floor(Date.now() / 1000)), lcPhase: '', lcOffset: '0', lcThread: '0', lcMessage: '0' });
  ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'importLcTextCalendar'; }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('importLcTextCalendar').timeBased().everyMinutes(5).create();
  importLcTextCalendar();
}

function importLcTextCalendar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties(), p = props.getProperties(), started = Date.now();
    var account = Session.getEffectiveUser().getEmail().toLowerCase();
    var addresses = [account].concat(GmailApp.getAliases().map(function(value) { return value.toLowerCase(); }));
    if (!p.lcKey || !p.lcUrl || p.lcAccount !== account || addresses.indexOf(p.lcMailbox) < 0) throw new Error('Run setupLcTextCalendar from the connected Google account.');
    function send(value) {
      value.mailbox = p.lcMailbox;
      var response = UrlFetchApp.fetch(p.lcUrl, { method: 'post', contentType: 'application/json', headers: { 'X-Calendar-Inbox-Key': p.lcKey }, payload: JSON.stringify(value), muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) throw new Error('Calendar import failed (' + response.getResponseCode() + '). Check the LC Text connection in Calendar access.');
      var result = JSON.parse(response.getContentText());
      if (result.accepted !== true) throw new Error('The calendar did not confirm the import. It will be retried.');
      return result;
    }
    send({ heartbeat: true, catchingUp: !!p.lcPhase });
    if (!p.lcPhase) {
      props.setProperties({ lcPhase: 'count', lcStart: String(Math.max(0, Number(p.lcCursor) - 600)), lcEnd: String(Math.floor(started / 1000) + 1), lcOffset: '0', lcThread: '0', lcMessage: '0' });
      p = props.getProperties();
    }
    var query = '-in:spam -in:trash subject:"' + LC_CALENDAR_CONFIG.subject + '" after:' + p.lcStart + ' before:' + p.lcEnd;
    var offset = Number(p.lcOffset) || 0, searches = 0, sent = 0;
    // Count the fixed search window first, then read its pages backwards. This
    // imports older messages first and lets long initial histories resume safely.
    if (p.lcPhase === 'count') {
      while (searches++ < 10 && Date.now() - started < 180000) {
        var counted = GmailApp.search(query, offset, 50); offset += counted.length;
        props.setProperty('lcOffset', String(offset));
        if (counted.length < 50) {
          offset = offset ? Math.floor((offset - 1) / 50) * 50 : -1;
          props.setProperties({ lcPhase: 'import', lcOffset: String(offset) });
          p = props.getProperties(); break;
        }
      }
      if (p.lcPhase === 'count') { send({ heartbeat: true, catchingUp: true }); return; }
    }
    while (offset >= 0 && searches++ < 20 && Date.now() - started < 180000) {
      var threads = GmailApp.search(query, offset, 50).reverse();
      for (var t = Number(p.lcThread) || 0; t < threads.length; t++) {
        var messages = threads[t].getMessages().sort(function(a, b) { return a.getDate().getTime() - b.getDate().getTime(); });
        for (var m = Number(p.lcMessage) || 0; m < messages.length; m++) {
          props.setProperties({ lcThread: String(t), lcMessage: String(m) });
          if (sent >= 100 || Date.now() - started >= 180000) { send({ heartbeat: true, catchingUp: true }); return; }
          var message = messages[m], stamp = message.getDate().getTime() / 1000;
          if (stamp < Number(p.lcStart) || stamp >= Number(p.lcEnd) || message.isDraft() || message.isInTrash() || message.getSubject().trim() !== LC_CALENDAR_CONFIG.subject) continue;
          var from = message.getFrom(), sender = from.match(/(?:<|^)([^<>\s]+@[^<>\s]+)>?$/);
          if (!sender || !/^(?:[0-9]+\.)*(?:1?8483564187)\.[^@]+@txt\.voice\.google\.com$/i.test(sender[1])) continue;
          if (account !== p.lcMailbox) {
            var recipients = [message.getTo(), message.getCc(), message.getHeader('Delivered-To'), message.getHeader('X-Original-To')].join(',').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
            if (recipients.indexOf(p.lcMailbox) < 0) continue;
          }
          var text = message.getPlainBody();
          send({ message: { sourceId: message.getId(), from: from, subject: message.getSubject(), receivedAt: message.getDate().toISOString(), text: text.slice(0, 20000), truncated: text.length > 20000 } });
          sent++;
        }
        p.lcMessage = '0'; props.setProperties({ lcThread: String(t + 1), lcMessage: '0' });
      }
      offset -= 50; p.lcThread = p.lcMessage = '0';
      props.setProperties({ lcOffset: String(offset), lcThread: '0', lcMessage: '0' });
    }
    if (offset < 0) {
      props.setProperties({ lcCursor: String(Number(p.lcEnd) - 1), lcPhase: '', lcOffset: '0', lcThread: '0', lcMessage: '0' });
      send({ heartbeat: true, catchingUp: false });
    } else send({ heartbeat: true, catchingUp: true });
  } finally { lock.releaseLock(); }
}

export function lcTextCalendarScript({ endpoint, token, includeExisting }) {
  const config = { url: endpoint + '/api/email-import/receive', key: token, mailbox: LC_TEXT_MAILBOX, subject: LC_TEXT_SUBJECT, includeExisting };
  return '// Private connection script. Create a separate Google Apps Script project.\n// Save, then run setupLcTextCalendar as ads@neileich.org and authorize Google access.\n// Keep this file private. It can submit only LC Text notifications.\nvar LC_CALENDAR_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n\n' + [setupLcTextCalendar, importLcTextCalendar].map(fn => fn.toString()).join('\n\n') + '\n';
}
