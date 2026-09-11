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
import { erevRoshHashanaText, erevYomKippurText, erevSukkosText, erevShminiAtzeresText, erevPesachText, erevShviiShelPesachText, netzMinyanText } from '../erev-yomtov-text.js';
import { buildRoshHashanaPoster } from '../posters/roshhashana.js';
import { buildVasikinPoster } from '../posters/vasikin.js';
import { buildYomKippurPoster } from '../posters/yomkippur.js';
import { buildPesachPoster } from '../posters/pesach.js';
import { buildSukkosPoster } from '../posters/sukkos.js';
import { hebrewYear, dateFromHebrew } from '../hebrew-calendar.js';

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
    kind: 'parsha',
    // The Friday, which is the day it goes out, not the Shabbos it is about.
    serial: found.week.serial - 1,
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
 *
 *  Two halves, and only one of them is relaxed by the year view. **Finished is finished in both
 *  views**: the year view showing everything means everything ahead, not everything ever, and
 *  letting a past occasion through is how the page opened on last פסח's שביעי message. It sorted
 *  to the top, being the earliest date on the screen, which is exactly where a stale message does
 *  the most harm. The half the year view does drop is the four day one. */
const txDaysInWindow = (from, to, today) =>
  to >= today && (txAll || from - today <= TX_AHEAD_DAYS);

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

/** The ערב of a Hebrew date: the day the message about it goes out.
 *
 *  What every card is sorted by, and it is the day of the message rather than the day of the yom
 *  tov, because that is the order somebody sending these works in. Month numbering counts ניסן as
 *  1, so תשרי is 7. See dateFromHebrew. */
const txErevOf = (day, month, year) => dateFromHebrew(day, month, year) - 1;

/** The ערב ראש השנה message for a given Hebrew year. */
function txErevRoshHashana(year, settings, today) {
  const poster = buildRoshHashanaPoster(year, settings);
  if (!txInWindow(poster, today)) return null;
  return {
    id: `erev-rh-${year}`,
    kind: 'yomtov',
    serial: txErevOf(1, 7, year),
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
    kind: 'yomtov',
    serial: txErevOf(10, 7, year),
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
    kind: 'yomtov',
    serial: erev,
    name: 'Erev Sukkos',
    when: hebrewYear(year),
    text: erevSukkosText(poster),
  };
}

/** The ערב שמיני עצרת message.
 *
 *  Off the same סוכות sheet the ערב סוכות one is, a fortnight further into it, and windowed on
 *  שמיני עצרת and שמחת תורה rather than on the sheet. */
function txErevShminiAtzeres(year, settings, today) {
  const poster = buildSukkosPoster(year, settings);
  if (!poster) return null;
  const shmini = dateFromHebrew(22, 7, year);
  if (!txDaysInWindow(shmini - 1, shmini + 1, today)) return null;
  const text = erevShminiAtzeresText(poster);
  if (!text) return null;
  return {
    id: `erev-shmini-${year}`,
    kind: 'yomtov',
    serial: shmini - 1,
    name: 'Erev Shemini Atzeres',
    when: hebrewYear(year),
    text,
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
    if (!poster) continue;
    /* The two first days, not the sheet's span, for the same reason ערב סוכות is windowed that
       way: the פסח sheet speaks to the last day, and an "Erev Pesach" card sitting there through
       חול המועד is a message nobody is about to send. ערב שביעי של פסח covers the far end. */
    const first = dateFromHebrew(15, 1, y);
    if (!txDaysInWindow(first - 1, first + 1, today)) continue;
    return {
      id: `erev-pesach-${y}`,
      kind: 'yomtov',
      serial: txErevOf(15, 1, y),
      name: 'Erev Pesach',
      when: hebrewYear(y),
      text: erevPesachText(poster),
    };
  }
  return null;
}

/** The ערב שביעי של פסח message.
 *
 *  Off the same פסח sheet the ערב פסח one is, a week further into it, and windowed on שביעי and
 *  אחרון rather than on the sheet. Both candidate years for the same reason ערב פסח asks both. */
function txErevShviiShelPesach(rhYear, settings, today) {
  for (const y of [rhYear - 1, rhYear]) {
    const poster = buildPesachPoster(y, settings);
    if (!poster) continue;
    const shvii = dateFromHebrew(21, 1, y);
    // txDaysInWindow turns away the year already gone, which is what picks between the two.
    if (!txDaysInWindow(shvii - 1, shvii + 1, today)) continue;
    const text = erevShviiShelPesachText(poster);
    if (!text) continue;
    return {
      id: `erev-shvii-${y}`,
      kind: 'yomtov',
      serial: shvii - 1,
      name: "Erev Shevii Shel Pesach",
      when: hebrewYear(y),
      text,
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
    if (text) {
      out.push({
        id: `netz-${which}-${year}`,
        kind: 'yomtov',
        // Sent with the ערב message of the day it is about, so it sorts beside it.
        serial: txErevOf(which === 'yk' ? 10 : 1, 7, year),
        name,
        when: hebrewYear(year),
        text,
      });
    }
  }
  return out;
}

/** Which Hebrew year's תשרי is the one worth showing.
 *
 *  **Held until שמחת תורה is over, not until ראש השנה is.** This used to turn over the moment the
 *  ראש השנה sheet finished, which meant that from the day after ראש השנה every other message of
 *  the season was asked of next year: ערב יום כיפור, ערב סוכות, ערב שמיני עצרת and the יום כיפור
 *  ותיקין announcement were a year out and so never appeared at all. Found by walking a year of
 *  dates a day at a time and printing what each day's page held, which is the only way a hole like
 *  that shows up: every one of those days looked fine on its own, it just had nothing on it.
 *
 *  23 תשרי is the last day this file has a תשרי message about. פסח picks its own year, being half
 *  a year along, so nothing here has to hold past שמחת תורה.
 *
 *  Three candidates rather than arithmetic on which Hebrew year it is: ראש השנה falls in September
 *  or October, so the civil year plus 3760, 3761 or 3762 always contains the right one. */
function txTishreiYear(todaySerial) {
  const civil = new Date(Date.UTC(1899, 11, 30) + todaySerial * 86400000).getUTCFullYear();
  for (const y of [civil + 3760, civil + 3761, civil + 3762]) {
    if (dateFromHebrew(23, 7, y) >= todaySerial) return y;
  }
  return civil + 3761;
}

/** The day a message goes out, written so nobody has to work out which year it is.
 *
 *  Asked for, and the reason is the bug above: a card carrying last פסח's times looked exactly
 *  like one carrying this year's, since a message is only times and the year was a Hebrew one in
 *  small grey letters. A weekday and a full date cannot be mistaken for another year's.
 *
 *  The device's own locale, so a date reads the way the reader writes dates. UTC parts throughout,
 *  because a serial is a whole day and turning it into a local midnight puts it on the day before
 *  anywhere west of Greenwich. */
function txDateLabel(serial) {
  if (!Number.isFinite(serial)) return '';
  const at = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return at.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** One message, with what it is, the day it goes out, when it is for, and a button that copies
 *  it. */
function txCard(msg) {
  const date = txDateLabel(msg.serial);
  return `
    <section class="tx-card" data-id="${txEsc(msg.id)}">
      <header class="tx-head">
        <h2 class="tx-name">${txEsc(msg.name)}</h2>
        ${date ? `<span class="tx-date">${txEsc(date)}</span>` : ''}
        ${msg.when ? `<span class="tx-when">${txEsc(msg.when)}</span>` : ''}
        <button type="button" class="copy-btn tx-copy">Copy</button>
      </header>
      <textarea class="tx-body" rows="1" spellcheck="false"
        aria-label="${txEsc(msg.name)} message">${txEsc(msg.text)}</textarea>
    </section>`;
}

/** Which kinds of message the year view is showing.
 *
 *  Two buttons, asked for: about fifty Shabbos messages and a handful of yom tov ones is a list
 *  nobody can find anything in, and the two are checked for different reasons. Independent
 *  toggles rather than one switch with two positions, so both can be on, which is the state it
 *  opens in. Not stored, like the year view itself: this is how you are looking at it now.
 *
 *  Only the year view has them. The four day window is a handful of cards and filtering that
 *  would be two buttons over almost nothing. */
const txKinds = { parsha: true, yomtov: true };

const TX_KIND_NAMES = { parsha: 'Parsha', yomtov: 'Yom Tov' };

/** The screen. */
export function renderTexts(container, state, settings, tables) {
  const messages = [];
  const today = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86400000);

  const year = txTishreiYear(today);

  /* The yom tov messages. The same list in both views: each builder keeps its own window and
     txInWindow lets everything through while the year is showing, so the only difference between
     the two views is the window, not which messages exist. */
  const yomTov = () => {
    const out = [];
    for (const msg of [
      txErevRoshHashana(year, settings, today),
      txErevYomKippur(year, settings, today),
      txErevSukkos(year, settings, today),
      txErevShminiAtzeres(year, settings, today),
      txErevPesach(year, settings, today),
      txErevShviiShelPesach(year, settings, today),
      ...txNetz(year, settings, today),
    ]) {
      if (msg) out.push(msg);
    }
    return out;
  };

  if (txAll) {
    messages.push(...yomTov());
    const weeks = txSeasonWeeks(settings, tables, today, 2);
    for (const serial of [...weeks.keys()].sort((a, b) => a - b)) {
      if (serial < today || serial - today > TX_ALL_DAYS) continue;
      const found = txAgainst(state, weeks, serial);
      if (!found) continue;
      const { columns, row } = rowFor(found.week, found.sheet, state, settings);
      const english = erevParshaEnglish(found.week.parsha, tables?.parshaNames);
      messages.push({
        id: `erev-shabbos-${serial}`,
        kind: 'parsha',
        // The Friday, which is the day the message goes out, not the Shabbos it is about.
        serial: serial - 1,
        name: 'Erev Shabbos',
        when: english || '',
        text: erevShabbosText(columns, row, english),
      });
    }
  } else {
    const shabbos = txErevShabbos(state, settings, tables, today);
    if (shabbos) messages.push(shabbos);
    messages.push(...yomTov());
  }

  /* Everything in date order, which is the order they get sent in and the only order somebody
     looking for "what comes after סוכות" can read. It used to be the yom tov ones and then the
     fifty Shabbosos, which put פסח in front of every Shabbos between here and it. A stable sort,
     so the ותיקין announcement stays under the ערב message of the day it belongs to. */
  messages.sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0));

  const shown = txAll ? messages.filter((m) => txKinds[m.kind] !== false) : messages;
  const kinds = Object.keys(TX_KIND_NAMES).map((k) => `
    <button type="button" class="tx-filter ${txKinds[k] ? 'is-on' : ''}" data-kind="${k}"
      aria-pressed="${txKinds[k] ? 'true' : 'false'}">${TX_KIND_NAMES[k]}</button>`).join('');

  container.innerHTML = `
    <div class="tx-page">
      <h1 class="tx-title" title="Triple click to show the whole year">Messages</h1>
      ${txAll ? `<p class="tx-all">Showing everything for the year ahead, in date order. Triple
        click the heading again for the next ${TX_AHEAD_DAYS} days only.</p>
        <div class="tx-filters">${kinds}</div>` : ''}
      <p class="tx-hint">Every time here is read off the shul's own boards and sheets, so this
      and the paper cannot disagree. Type into a message to add a line, then press Copy. Edits
      are for this visit only: reload and the times come back fresh, which is the way round that
      cannot leave an old time in a new message.</p>

      ${shown.map(txCard).join('')}
      ${shown.length ? '' : `<div class="panel"><p>${txAll
        ? 'Both kinds are switched off, so there is nothing to show.'
        : `Nothing to send just now. Yom tov messages appear ${TX_AHEAD_DAYS} days before the yom
           tov and stay up until it is over.`}</p></div>`}
    </div>`;

  for (const btn of container.querySelectorAll('.tx-filter')) {
    btn.addEventListener('click', () => {
      const k = btn.dataset.kind;
      txKinds[k] = !txKinds[k];
      renderTexts(container, state, settings, tables);
    });
  }

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
