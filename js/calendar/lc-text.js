import { calendarAnnouncementText } from './announcement-model.js';

export const LC_TEXT_MAILBOX = 'ads@neileich.org';
export const LC_TEXT_SUBJECT = 'New text message from Lc Text (848) 356-4187';

export function isLcTextSource(message) {
  if (typeof message?.subject !== 'string' || message.subject.trim() !== LC_TEXT_SUBJECT) return false;
  const address = String(message.from || '').match(/(?:<|^)([^<>\s]+@[^<>\s]+)>?$/)?.[1]?.toLowerCase();
  if (!address?.endsWith('@txt.voice.google.com')) return false;
  return address.split('@')[0].split('.').some(part => ['18483564187', '8483564187'].includes(part));
}

// Google Voice surrounds the SMS with a logo link and account/help links. Match
// complete wrapper lines so words and links inside the actual message stay intact.
export function lcTextWording(message) {
  if (message.truncated) throw new Error('The email was too long to import safely. Open the original in Gmail.');
  if (typeof message.text !== 'string') throw new Error('This email has no readable text.');
  const lines = message.text.replace(/\r\n?/g, '\n').trim().split('\n');
  const logo = line => /^<?https:\/\/voice\.google\.com\/?[>]?$/i.test(line?.trim() || '');
  if ([LC_TEXT_SUBJECT, 'Lc Text (848) 356-4187'].includes(lines[0].trim()) && logo(lines.slice(1).find(line => line.trim()))) { lines.shift(); while (lines.length && !lines[0].trim()) lines.shift(); }
  const wrapped = logo(lines[0]);
  if (wrapped) lines.shift();
  const footer = lines.findIndex((line, index) => /^YOUR ACCOUNT\s+<?https:\/\/voice\.google\.com(?:[\/>\s]|$)/i.test(line.trim()) || /^To respond to this text message, (?:reply to this email|visit Google Voice)/i.test(line.trim()) || /^YOUR ACCOUNT\s*$/i.test(line) && /^<?https:\/\/voice\.google\.com(?:[\/>\s]|$)/i.test(lines[index + 1]?.trim() || ''));
  if (footer >= 0) lines.splice(footer);
  if (wrapped && footer < 0) throw new Error('The email format was not recognized. Check its wording before posting.');
  const text = lines.join('\n').trim();
  if (!text || /^(?:\[No text in this email|View (?:this )?message|Image\s*$)/i.test(text)) throw new Error('This email needs a person to check the original message.');
  if (/email notifications for text messages|Google LLC\n1600 Amphitheatre|HELP CENTER\s*\n?<?https:\/\/support\.google\.com\/voice/i.test(text)) throw new Error('The email format was not recognized. Check its wording before posting.');
  return calendarAnnouncementText(text);
}
