// The messages, on a page of their own, for whoever sends them out.
//
// These go into a chat every week and before every yom tov, and they used to be typed by hand
// off a sheet that already carried every time on them. Every one here is read off that same
// sheet instead, so the chat and the paper cannot come to disagree. Where each line of each
// message comes from is written beside the message that builds it: erev-text.js for שבת,
// erev-yomtov-text.js for the rest.
//
// This is a page rather than a button on each sheet, and that is the point of it: the person
// who sends the messages is not the person who prints the boards, and the address can be handed
// to them on its own. It carries no way back into the admin or out to the congregation's site
// deliberately, so nothing on it invites somebody who was given one link to wander into the
// rest of the program.
//
// It asks for no PIN. The admin does, because somebody wandering in there can change the boards;
// nothing here changes anything, and what it prints is about to be sent to the whole congregation
// in any case. A gate would only mean handing the admin's four digits to the one person this page
// was built for, which is the opposite of the point of giving them their own address.

import { weekIndex, rowFor } from '../sheets/rows.js';
import { currentSerial } from './nav-helpers.js';
import { weekEndsMins } from '../upcoming.js';
import { erevShabbosText, erevParshaEnglish } from '../erev-text.js';
import { erevRoshHashanaText } from '../erev-yomtov-text.js';
import { buildRoshHashanaPoster } from '../posters/roshhashana.js';
import { hebrewYear } from '../hebrew-calendar.js';

const txEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** This week's Erev Shabbos message, or null where no saved sheet covers the week.
 *
 *  Null rather than a message built from nothing: the chart is where these times live, and a
 *  week with no chart has no times to send. The screen says so in its place. */
function txErevShabbos(state, settings, tables) {
  const index = weekIndex(state);
  const serials = [...index.keys()].sort((a, b) => a - b);
  if (!serials.length) return null;
  const serial = currentSerial(serials, settings, (s) => weekEndsMins(s, state, settings));
  const entry = index.get(serial);
  if (!entry?.sheet) return null;
  const { columns, row } = rowFor(entry.week, entry.sheet, state, settings);
  return {
    id: 'erev-shabbos',
    name: 'Erev Shabbos',
    when: erevParshaEnglish(entry.week.parsha, tables?.parshaNames) || '',
    text: erevShabbosText(columns, row, erevParshaEnglish(entry.week.parsha, tables?.parshaNames)),
  };
}

/** The ערב ראש השנה message for a given Hebrew year. */
function txErevRoshHashana(year, settings) {
  const poster = buildRoshHashanaPoster(year, settings);
  if (!poster) return null;
  return {
    id: `erev-rh-${year}`,
    name: 'Erev Rosh Hashana',
    when: hebrewYear(year),
    text: erevRoshHashanaText(poster),
  };
}

/** Which ראש השנה is the one worth showing.
 *
 *  The one coming, and the one just gone until its second day is over, so somebody sending the
 *  message on ערב ר"ה itself is not handed next year's by a screen that has already moved on.
 *  Worked from the poster's own span rather than from a date this file decides, so it turns over
 *  when the sheet does. */
function txRoshHashanaYear(settings, todaySerial) {
  /* Three candidates rather than arithmetic on which Hebrew year it is. ר"ה falls in September
     or October, so the civil year plus 3760, 3761 or 3762 always contains the right one, and
     the poster's own span settles which without this file having to know the calendar. */
  const civil = new Date(Date.UTC(1899, 11, 30) + todaySerial * 86400000).getUTCFullYear();
  for (const y of [civil + 3760, civil + 3761, civil + 3762]) {
    const poster = buildRoshHashanaPoster(y, settings);
    if (poster && poster.span.to >= todaySerial) return y;
  }
  return civil + 3761;
}

/** One message, with what it is, when it is for, and a button that copies it. */
function txCard(msg) {
  return `
    <section class="tx-card" data-id="${txEsc(msg.id)}">
      <header class="tx-head">
        <h2 class="tx-name">${txEsc(msg.name)}</h2>
        ${msg.when ? `<span class="tx-when">${txEsc(msg.when)}</span>` : ''}
        <button type="button" class="copy-btn tx-copy">Copy</button>
      </header>
      <pre class="tx-body">${txEsc(msg.text)}</pre>
    </section>`;
}

/** The screen. */
export function renderTexts(container, state, settings, tables) {
  const messages = [];
  const today = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86400000);

  const shabbos = txErevShabbos(state, settings, tables);
  if (shabbos) messages.push(shabbos);

  const rh = txErevRoshHashana(txRoshHashanaYear(settings, today), settings);
  if (rh) messages.push(rh);

  container.innerHTML = `
    <div class="tx-page">
      <h1 class="tx-title">Messages</h1>
      <p class="tx-hint">Every time here is read off the shul's own boards and sheets, so this
      and the paper cannot disagree. Press Copy and paste it into the chat.</p>
      ${shabbos ? '' : `<div class="panel"><p>No Erev Shabbos message: no saved chart covers this
        week, and the times come off the chart. Generate the week's sheet and it appears
        here.</p></div>`}
      ${messages.map(txCard).join('')}
    </div>`;

  /* The clipboard is asked for twice over, the same as everywhere else in this program:
     navigator.clipboard is refused outside a secure context and on some older phones, and a
     message nobody can paste is no use. What happened is said on the button. */
  container.querySelectorAll('.tx-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const said = btn.textContent;
      const text = btn.closest('.tx-card')?.querySelector('.tx-body')?.textContent || '';
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const box = document.createElement('textarea');
          box.value = text;
          box.setAttribute('readonly', '');
          box.style.position = 'fixed';
          box.style.opacity = '0';
          document.body.appendChild(box);
          box.select();
          document.execCommand('copy');
          box.remove();
        }
        btn.textContent = 'Copied';
      } catch (err) {
        console.error('copy failed', err);
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => { btn.textContent = said; }, 2000);
    });
  });
}
