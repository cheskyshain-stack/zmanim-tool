// Loads the ported Hebrew-calendar lookup tables (data/*.json - exact copies of the
// workbook's PARSHA_TABLE_CHUTZ / PARSHA_TABLE_EY / PARSHA_NAMES_TABLE / SPECIAL_DAYS_TABLE).
//
// Every page begins here: the admin, the congregation's site and the messages page all wait on
// these four files before they draw anything. So this failing is the whole screen failing, and
// what it says when it fails is the only thing anybody has to go on.
//
// **It used to say almost nothing.** Somebody opening /texts/ on a phone got "Failed to load
// Hebrew-calendar data files: Unexpected token '<'", which is a JSON parser complaining about a
// character. It does not say which of the four files, what came back, or where from. The `!r.ok`
// check named the file and the status; the `r.json()` beside it threw all of that away, so the
// one failure that actually happened was the one reported worst.
//
// "Unexpected token '<'" has one meaning and it is worth writing down: **a request for JSON was
// answered with a web page, and answered 200**, because a 404 would have been caught above. That
// is not the site being broken. That is something standing between the reader and the site
// answering on its behalf: a hotel or airport wifi sign-in page, a phone network's interstitial,
// an in-app browser, a filter. The page it hands back begins "<!DOCTYPE html" and is otherwise
// indistinguishable from the data until something tries to parse it.
//
// So the error now carries the file, the status, the content type and the first of what came
// back, which turns that whole paragraph into one line on the screen that says which it was.
const FILES = [
  '/data/parsha_chutz.json',
  '/data/parsha_ey.json',
  '/data/parsha_names.json',
  '/data/special_days.json',
];

/** One file, or an error that says what happened instead.
 *
 *  Read as text and parsed here rather than through `r.json()`, which is the same work and keeps
 *  what came back so it can be quoted. Eighty characters is enough for "<!DOCTYPE html>" and the
 *  beginning of a title, which is normally the name of whatever answered.
 *
 *  `cache: 'no-cache'` revalidates rather than trusting a stored copy. A page handed over by a
 *  sign-in portal can be cached like anything else, and then the failure outlives the network
 *  that caused it: the reader gets back on a real connection, reloads, and sees the same error
 *  out of their own browser. Four conditional requests on a page load is a small price for not
 *  having a fault that will not go away. */
async function loadOne(path) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-cache' });
  } catch (e) {
    throw new Error(`${path} could not be reached (${e.message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    const type = (res.headers.get('content-type') || 'no content type').split(';')[0].trim();
    const head = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    const page = /^<(?:!doctype|html|head|meta|script)/i.test(text.trim());
    return Promise.reject(new Error(
      `${path} answered with ${type}, not the data${page
        ? '. Something on this network is answering for the site, which is usually a wifi sign-in '
          + 'page or a phone network getting in the way'
        : ''}: "${head}"`,
    ));
  }
}

let cached = null;

export async function loadTables() {
  if (cached) return cached;
  const [parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all(FILES.map(loadOne));
  cached = { parshaChutz, parshaEY, parshaNames, specialDays };
  return cached;
}

/** The whole sentence to put on the screen when these do not load, as plain text.
 *
 *  Here rather than written out on each entry page, because it is one failure and the two pages
 *  were saying different things about it, one of them wrong.
 *
 *  **Plain text, and the caller sets it with textContent.** It was interpolated into innerHTML,
 *  and the first thing this quotes is whatever answered instead of the data, which on the day it
 *  mattered was a sign-in page. So the markup of a network's interstitial was being parsed into
 *  the admin: the screen showed "Please sig" rather than "<!DOCTYPE html>", the quote that was
 *  supposed to identify the culprit was the one part of it that could not be read, and anything
 *  that page cared to send was running in this one. Whatever is on the other end of a fetch that
 *  has already proved it is not the site is the last string to hand to an HTML parser.
 *
 *  The general hint is left off where the error already named the cause, so the screen does not
 *  offer two explanations for a thing it knows the answer to. */
export function dataErrorMessage(err) {
  const said = err?.message || String(err);
  const known = /answering for the site/.test(said);
  return `The Hebrew calendar tables did not load: ${said}.${known ? '' : ' Either something on '
    + 'this network is answering for the site, which a different connection settles, or this '
    + 'folder is being opened as files rather than through a web address, in which case use the '
    + 'offline copy, which fetches nothing.'}`;
}

/** And putting it on the screen, which is the only way either entry page should.
 *
 *  A function rather than a line of innerHTML at each call site, so that the string which quotes
 *  whatever answered instead of the data cannot be handed to an HTML parser by somebody writing
 *  the next page. */
export function showDataError(host, err) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = dataErrorMessage(err);
  host.replaceChildren(p);
}
