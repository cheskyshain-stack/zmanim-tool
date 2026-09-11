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
import { erevRoshHashanaText, erevYomKippurText, erevSukkosText, erevPesachText, netzMinyanText } from '../erev-yomtov-text.js';
import { buildRoshHashanaPoster } from '../posters/roshhashana.js';
import { buildVasikinPoster } from '../posters/vasikin.js';
import { buildYomKippurPoster } from '../posters/yomkippur.js';
import { buildPesachPoster } from '../posters/pesach.js';
import { buildSukkosPoster } from '../posters/sukkos.js';
import { hebrewYear } from '../hebrew-calendar.js';

const txEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The coming Shabbos's Erev Shabbos message, or null where there is no Shabbos to send one for
 *  within the window. */
function txErevShabbos(state, settings, tables, today) {
  const found = txWeekNow(state, settings, tables, today);
  if (!found) return null;
  /* Only when that Shabbos is actually near.
     This is the case the window is really for. A שבת that is ראש השנה, יום כיפור or a day of
     yom tov is not a row on the chart at all, so on those weeks the search for "this week" walks
     forward and lands on the next week that is: in תשפ"ז, ר"ה falls on Shabbos and the answer
     came back האזינו, eight days out, presented as this week's message. The shul spotted it,
     and it was the same mistake twice over, since that Shabbos wants the ראש השנה schedule and
     not a שבת one.
     Measured to the Shabbos itself rather than to the week, so a row that is not this week's
     simply does not appear until it is four days off. */
  if (found.week.serial - today > TX_AHEAD_DAYS) return null;
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
function txSeasonWeeks(settings, tables, today, years = 2) {
  const weeks = new Map();
  const year = hebrewDateExtended(today, settings.useGregorianBefore1582).year;
  const pairs = [['kayitz', year - 1], ['choref', year], ['kayitz', year], ['choref', year + 1]];
  // One more year of both seasons for the everything view, which reaches a year ahead.
  if (years > 1) pairs.push(['kayitz', year + 1], ['choref', year + 2]);
  for (const [season, y] of pairs) {
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
  return weeks;
}

/** A week, against a saved chart where one covers it and a made-up sheet where none does. */
function txAgainst(state, weeks, serial) {
  const savedEntry = weekIndex(state).get(serial);
  if (savedEntry?.sheet) return { week: savedEntry.week, sheet: savedEntry.sheet };
  const computed = weeks.get(serial);
  if (!computed) return null;
  return { week: computed.week, sheet: { season: computed.season, overrides: {} } };
}

function txWeekNow(state, settings, tables, today) {
  const weeks = txSeasonWeeks(settings, tables, today, 1);
  const serials = [...weeks.keys()].sort((a, b) => a - b);
  if (!serials.length) return null;
  const serial = currentSerial(serials, settings, (s) => weekEndsMins(s, state, settings));
  return txAgainst(state, weeks, serial);
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

/** Whether a stretch of days is close enough, or still running.
 *  Everything passes while the whole year is showing, which is what that mode is. */
const txDaysInWindow = (from, to, today) =>
  txAll || (to >= today && from - today <= TX_AHEAD_DAYS);

/** The same asked of a sheet, which is what most of these messages have to hand. */
const txInWindow = (poster, today) =>
  Boolean(poster) && txDaysInWindow(poster.span.from, poster.span.to, today);

/** The year ahead instead of the next four days.
 *
 *  For checking. The page is built to show only what is about to be sent, which is right for the
 *  person sending it and useless for anybody wanting to see what a message will say at פסח. A
 *  triple click on the heading turns the window off and shows every message the year holds;
 *  another triple click puts it back.
 *
 *  Triple click rather than a button, because this is not for the person the page is for and a
 *  button would be one more thing on a screen whose whole point is having almost nothing on it.
 *  Nothing is stored, so a reload is back to the four days.
 *
 *  A year of Shabbosos is about fifty messages, each one a real calculation. That is slow enough
 *  to notice and it only happens when somebody asks for it. */
let txAll = false;
const TX_ALL_DAYS = 380;

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

/** The ערב יום כיפור message. */
function txErevYomKippur(year, settings, today) {
  const poster = buildYomKippurPoster(year, settings);
  if (!txInWindow(poster, today)) return null;
  return {
    id: `erev-yk-${year}`,
    name: 'Erev Yom Kippur',
    when: hebrewYear(year),
    text: erevYomKippurText(poster),
  };
}

/** The ערב סוכות message.
 *
 *  ראש השנה's own year, since סוכות is a fortnight after it and inside the same one.
 *
 *  Windowed on the two days of יום טוב rather than on the sheet's span, which is the one place
 *  here where those differ: the סוכות sheet speaks all the way past שמחת תורה and into the week
 *  after it, and an "Erev Sukkos" card still on the page a fortnight later is not a message
 *  anybody is about to send. ערב סוכות is the day before the sheet's first day, which is where
 *  the span starts. */
function txErevSukkos(year, settings, today) {
  const poster = buildSukkosPoster(year, settings);
  if (!poster) return null;
  const erev = poster.span.from;
  if (!txDaysInWindow(erev, erev + 2, today)) return null;
  return {
    id: `erev-sukkos-${year}`,
    name: 'Erev Sukkos',
    when: hebrewYear(year),
    text: erevSukkosText(poster),
  };
}

/** The ערב פסח message.
 *
 *  Its own Hebrew year rather than ראש השנה's: פסח is in ניסן, half a year along, so the year
 *  whose ר"ה is being counted from has its פסח six months later. Asked of both candidates and
 *  whichever is still to come, or still running, is the one. */
function txErevPesach(rhYear, settings, today) {
  for (const y of [rhYear - 1, rhYear]) {
    const poster = buildPesachPoster(y, settings);
    if (!poster || poster.span.to < today) continue;
    if (!txInWindow(poster, today)) continue;
    return {
      id: `erev-pesach-${y}`,
      name: 'Erev Pesach',
      when: hebrewYear(y),
      text: erevPesachText(poster),
    };
  }
  return null;
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

  const year = txRoshHashanaYear(settings, today);

  if (txAll) {
    /* Every yom tov message the year holds, and then every Shabbos of it in date order. The yom
       tov ones first, since they are the ones being checked; the Shabbosos are the long tail. */
    const rh = txErevRoshHashana(year, settings, today);
    if (rh) messages.push(rh);
    const yk = txErevYomKippur(year, settings, today);
    if (yk) messages.push(yk);
    const sk = txErevSukkos(year, settings, today);
    if (sk) messages.push(sk);
    const ps = txErevPesach(year, settings, today);
    if (ps) messages.push(ps);
    messages.push(...txNetz(year, settings, today));
    const weeks = txSeasonWeeks(settings, tables, today, 2);
    for (const serial of [...weeks.keys()].sort((a, b) => a - b)) {
      if (serial < today || serial - today > TX_ALL_DAYS) continue;
      const found = txAgainst(state, weeks, serial);
      if (!found) continue;
      const { columns, row } = rowFor(found.week, found.sheet, state, settings);
      const english = erevParshaEnglish(found.week.parsha, tables?.parshaNames);
      messages.push({
        id: `erev-shabbos-${serial}`,
        name: 'Erev Shabbos',
        when: english || '',
        text: erevShabbosText(columns, row, english),
      });
    }
  } else {
    const shabbos = txErevShabbos(state, settings, tables, today);
    if (shabbos) messages.push(shabbos);
    const rh = txErevRoshHashana(year, settings, today);
    if (rh) messages.push(rh);
    const yk = txErevYomKippur(year, settings, today);
    if (yk) messages.push(yk);
    const sk = txErevSukkos(year, settings, today);
    if (sk) messages.push(sk);
    const ps = txErevPesach(year, settings, today);
    if (ps) messages.push(ps);
    messages.push(...txNetz(year, settings, today));
  }

  container.innerHTML = `
    <div class="tx-page">
      <h1 class="tx-title" title="Triple click to show the whole year">Messages</h1>
      ${txAll ? `<p class="tx-all">Showing everything for the year ahead, ${messages.length}
        ${messages.length === 1 ? 'message' : 'messages'}. Triple click the heading again for the
        next ${TX_AHEAD_DAYS} days only.</p>` : ''}
      <p class="tx-hint">Every time here is read off the shul's own boards and sheets, so this
      and the paper cannot disagree. Type into a message to add a line, then press Copy. Edits
      are for this visit only: reload and the times come back fresh, which is the way round that
      cannot leave an old time in a new message.</p>

      ${messages.map(txCard).join('')}
      ${messages.length ? '' : `<div class="panel"><p>Nothing to send just now. Yom tov messages
        appear ${TX_AHEAD_DAYS} days before the yom tov and stay up until it is over.</p></div>`}
    </div>`;

  /* Triple click on the heading, which is `detail` reaching 3 on an ordinary click. Listened
     for on the heading rather than the page so that selecting a message by triple clicking it,
     which is how somebody selects a paragraph, does not turn the whole year on by accident. */
  container.querySelector('.tx-title')?.addEventListener('click', (e) => {
    if (e.detail < 3) return;
    txAll = !txAll;
    renderTexts(container, state, settings, tables);
  });

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
