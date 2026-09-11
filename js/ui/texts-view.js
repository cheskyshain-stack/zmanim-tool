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
import { computeSeasonWeeks } from '../sheets/weeks.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { currentSerial } from './nav-helpers.js';
import { weekEndsMins } from '../upcoming.js';
import { erevShabbosText, erevParshaEnglish } from '../erev-text.js';
import { erevRoshHashanaText, netzMinyanText } from '../erev-yomtov-text.js';
import { buildRoshHashanaPoster } from '../posters/roshhashana.js';
import { buildVasikinPoster } from '../posters/vasikin.js';
import { hebrewYear } from '../hebrew-calendar.js';

const txEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** This week's Erev Shabbos message, or null where no saved sheet covers the week.
 *
 *  Null rather than a message built from nothing: the chart is where these times live, and a
 *  week with no chart has no times to send. The screen says so in its place. */
function txErevShabbos(state, settings, tables, today) {
  const found = txWeekNow(state, settings, tables, today);
  if (!found) return null;
  const { columns, row } = rowFor(found.week, found.sheet, state, settings);
  const english = erevParshaEnglish(found.week.parsha, tables?.parshaNames);
  return {
    id: 'erev-shabbos',
    name: 'Erev Shabbos',
    when: english || '',
    text: erevShabbosText(columns, row, english),
  };
}

/** This week, and a sheet to read it against.
 *
 *  **The weeks are computed, not looked up.** This used to read the saved charts and show
 *  nothing at all where none covered the week, which made a page of messages depend on somebody
 *  having generated a chart first. Every number in the message is a calculation the program can
 *  make from the calendar, so it makes it: the chart is where these times are printed, not where
 *  they come from.
 *
 *  Four candidate seasons rather than working out which one today is in. A season runs Sukkos to
 *  Pesach or Pesach to Sukkos, so the year today falls in and the one before it cover every case
 *  including both boundaries, and whichever actually contains this week wins. Brute force, and
 *  it cannot be subtly wrong the way a branch on the date can.
 *
 *  A saved chart still wins where one covers the week, so a cell somebody edited by hand reaches
 *  the message rather than being computed back to what it was. Where there is none, a sheet is
 *  made up on the spot with no overrides on it, which is the same chart minus the hand edits. */
function txWeekNow(state, settings, tables, today) {
  const saved = weekIndex(state);
  const weeks = new Map();
  const year = hebrewDateExtended(today, settings.useGregorianBefore1582).year;
  for (const [season, y] of [['kayitz', year - 1], ['choref', year], ['kayitz', year], ['choref', year + 1]]) {
    let built = [];
    try {
      // It answers { startSerial, endSerial, weeks }, not a bare list.
      built = computeSeasonWeeks(season, y, settings, tables)?.weeks || [];
    } catch {
      // A season the calendar cannot build is a season this week is not in.
      built = [];
    }
    for (const week of built) {
      if (!weeks.has(week.serial)) weeks.set(week.serial, { week, season });
    }
  }
  const serials = [...weeks.keys()].sort((a, b) => a - b);
  if (!serials.length) return null;
  const serial = currentSerial(serials, settings, (s) => weekEndsMins(s, state, settings));

  const savedEntry = saved.get(serial);
  if (savedEntry?.sheet) return { week: savedEntry.week, sheet: savedEntry.sheet };
  const computed = weeks.get(serial);
  if (!computed) return null;
  return { week: computed.week, sheet: { season: computed.season, overrides: {} } };
}

/** How long before a yom tov its messages appear here.
 *
 *  Without a window they are on the page every day of the year: the year is picked by which
 *  sheet has not finished yet, so next ראש השנה arrives the moment this one ends and sits there
 *  for eleven months. A page of messages nobody is about to send is a page people stop reading.
 *
 *  Four days, which is what the shul asked for: whatever is applicable within four days is on
 *  the page and nothing else is. Short enough that the page is a to-do list rather than a
 *  calendar. One number, changed here. */
const TX_AHEAD_DAYS = 4;

/** Whether a sheet's occasion is close enough, or still running. */
const txInWindow = (poster, today) =>
  Boolean(poster) && poster.span.to >= today && poster.span.from - today <= TX_AHEAD_DAYS;

/** The ערב ראש השנה message for a given Hebrew year. */
function txErevRoshHashana(year, settings, today) {
  const poster = buildRoshHashanaPoster(year, settings);
  if (!txInWindow(poster, today)) return null;
  return {
    id: `erev-rh-${year}`,
    name: 'Erev Rosh Hashana',
    when: hebrewYear(year),
    text: erevRoshHashanaText(poster),
  };
}

/** The ותיקין announcements, one for each of the two occasions the sheet covers.
 *
 *  Built separately rather than from the two-in-one sheet, because the message is per occasion:
 *  ראש השנה is two days and says so, יום כיפור is one. Each keeps its own window, so the יום
 *  כיפור one does not turn up beside ראש השנה's a fortnight early. */
function txNetz(year, settings, today) {
  const out = [];
  for (const [which, name] of [['rh', 'Netz Minyan, Rosh Hashana'], ['yk', 'Netz Minyan, Yom Kippur']]) {
    const poster = buildVasikinPoster(year, settings, which);
    if (!txInWindow(poster, today)) continue;
    const text = netzMinyanText(poster, which);
    if (text) out.push({ id: `netz-${which}-${year}`, name, when: hebrewYear(year), text });
  }
  return out;
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
      <textarea class="tx-body" rows="1" spellcheck="false"
        aria-label="${txEsc(msg.name)} message">${txEsc(msg.text)}</textarea>
    </section>`;
}

/** The screen. */
export function renderTexts(container, state, settings, tables) {
  const messages = [];
  const today = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86400000);

  const shabbos = txErevShabbos(state, settings, tables, today);
  if (shabbos) messages.push(shabbos);

  const year = txRoshHashanaYear(settings, today);
  const rh = txErevRoshHashana(year, settings, today);
  if (rh) messages.push(rh);
  messages.push(...txNetz(year, settings, today));

  container.innerHTML = `
    <div class="tx-page">
      <h1 class="tx-title">Messages</h1>
      <p class="tx-hint">Every time here is read off the shul's own boards and sheets, so this
      and the paper cannot disagree. Type into a message to add a line, then press Copy. Edits
      are for this visit only: reload and the times come back fresh, which is the way round that
      cannot leave an old time in a new message.</p>
      ${shabbos ? '' : `<div class="panel"><p>No Erev Shabbos message this week: the calendar
        built no שבת week covering it.</p></div>`}
      ${messages.map(txCard).join('')}
      ${messages.length ? '' : `<div class="panel"><p>Nothing to send just now. Yom tov messages
        appear ${TX_AHEAD_DAYS} days before the yom tov and stay up until it is over.</p></div>`}
    </div>`;

  /* Each box opened to the height of what is in it, and kept there as it is typed into.
     A textarea has no height of its own, so without this every message would open as one line
     with the rest of it scrolled out of sight, and somebody would copy what they could see.
     Measured off scrollHeight rather than counted in lines, so a line that wraps on a phone
     takes the two rows it actually occupies. */
  const fit = (box) => {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  };
  container.querySelectorAll('.tx-body').forEach((box) => {
    fit(box);
    box.addEventListener('input', () => fit(box));
  });

  /* The clipboard is asked for twice over, the same as everywhere else in this program:
     navigator.clipboard is refused outside a secure context and on some older phones, and a
     message nobody can paste is no use. What happened is said on the button. */
  container.querySelectorAll('.tx-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const said = btn.textContent;
      // What is in the box now, not what was built into it: the whole point of the box being
      // editable is that a line somebody added goes out with the message.
      const text = btn.closest('.tx-card')?.querySelector('.tx-body')?.value || '';
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
