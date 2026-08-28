// Handing the chart over as a real PDF.
//
// Why this exists at all: an iPhone will not print these boards at the right size and
// there is no way to make it. Safari ignores @page's size descriptor, imposes margins that
// cannot be zeroed, and reports a width for print media queries that is the phone's own
// screen rather than the paper, so every route to "fit the page to the sheet" is guessing.
// Three rounds of that produced, in turn, a chart with its right columns sliced off, a
// chart printed at a third of the sheet, and a chart held at a safe but small 72%.
//
// A PDF ends the argument. Its page size is written into the file, so 11in x 8.5in
// landscape is a fact the phone reads rather than a request it can ignore, and the print
// sheet then has nothing left to decide. Open it, share it, print it, mail it to whoever
// prints the boards.
//
// This is additive and deliberately kept to one side. The Print button and the whole
// print.css path are untouched, so what a desktop puts on paper is exactly what it put on
// paper before: that output is checked pixel for pixel and is not something to put at risk
// for a phone's benefit.
//
// The page is rasterised rather than drawn as text. Redrawing the chart as PDF text would
// mean embedding the Hebrew faces and laying out every right-to-left run by hand, which is
// a second renderer to keep in step with the first, and the first is the one that has been
// checked against the workbook. Photographing what the browser already lays out cannot
// drift from it. At the scale below the result is about 300 dots per inch, which is more
// than a laser printer resolves.
//
// The two libraries this needs are vendored in /vendor and loaded only by the site, never
// by the offline build (build-offline.py strips the tags). Everything here therefore has
// to cope with them being absent, which is what pdfReady() is for: no libraries, no
// button, and the offline copy carries neither.

/** Whether the vendored libraries actually arrived. The offline build ships without them
 *  on purpose, and a slow network can lose them on the site too, so this is asked before
 *  the button is offered rather than assumed. */
export function pdfReady() {
  return typeof window !== 'undefined' && !!window.html2canvas && !!(window.jspdf && window.jspdf.jsPDF);
}

export function pdfButtonHtml(id = 'pdf-btn') {
  if (!pdfReady()) return '';
  // No btn-primary: Print is the one filled button on this screen and stays the one thing
  // worth pressing. This is the quiet alternative beside it, styled like Previous/Next.
  return `<button type="button" class="pdf-btn" id="${id}">PDF</button>`;
}

/** 11in x 8.5in at 300dpi is 3300 x 2550. The pages are laid out at 96dpi, so photograph
 *  them at 300/96 to land there. Higher makes a file too big to mail without making the
 *  print any better; lower starts to show on the thin rules. */
const PDF_DPI = 300;
const CSS_DPI = 96;

/** JPEG rather than PNG. The chart is mostly flat white with grey banding, which PNG does
 *  compress well, but at 3300px across a two page PDF still came out around 4MB, and these
 *  get sent to people. At this quality the difference is not visible on paper and the file
 *  is a fraction of the size. */
const JPEG_QUALITY = 0.92;

/** html2canvas is from 2022 and does not know the color() function, which it meets here
 *  and throws on: "Attempting to parse an unsupported color function". The striped body
 *  rows are a color-mix (see tbody tr:nth-child(even) in app.css), and a browser reports a
 *  color-mix back as color(srgb r g b), so the very banding that makes the chart readable
 *  is what stopped the PDF being made at all.
 *
 *  Not an engine quirk to shrug at either: color-mix resolves to color(srgb ...) in Safari
 *  as much as in Chromium, so without this there would be no PDF on the phone this is for.
 *
 *  srgb is the space the numbers are already in, so the conversion is a multiplication by
 *  255, not a colour-management problem. */
function srgbToRgb(value) {
  const m = /^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*(?:\/\s*([\d.eE+-]+)\s*)?\)$/.exec(String(value).trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.round(Math.min(1, Math.max(0, parseFloat(n))) * 255));
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Every colour property html2canvas reads off an element. */
const COLOUR_PROPS = [
  'color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
  'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor',
];

/** Rewrite any color() the library cannot read into the rgb() it means.
 *
 *  Done on html2canvas's own clone, never on the page in front of the person: it hands the
 *  copy it is about to photograph to onclone, so the live chart is not touched, nothing
 *  flickers, and there is nothing to put back if this throws. */
function flattenModernColours(root) {
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const cs = view.getComputedStyle(el);
    for (const prop of COLOUR_PROPS) {
      const plain = srgbToRgb(cs[prop]);
      if (plain) el.style[prop] = plain;
    }
  }
}

/** Photograph each .page and put one on each sheet of a letter landscape PDF.
 *
 *  The pages are photographed where they stand, which means whatever the screen has done
 *  to them has to be undone first. On a phone the chart browser holds .pages at a
 *  transform (fitChartToWindow), and html2canvas reads the transform: without this the PDF
 *  came out with the chart a third of the size in the corner of the sheet, which is the
 *  very fault this is here to fix. So the transform comes off, the shot is taken at full
 *  size, and it goes back on in a finally, including if anything throws. */
export async function buildChartPdf(pagesEl, filename = 'zmanim.pdf') {
  if (!pdfReady()) throw new Error('PDF libraries are not loaded');
  const pages = [...pagesEl.querySelectorAll('.page')];
  if (!pages.length) throw new Error('there is no chart on the screen to turn into a PDF');

  const held = {
    transform: pagesEl.style.transform,
    width: pagesEl.style.width,
    fitHeight: pagesEl.parentElement ? pagesEl.parentElement.style.height : null,
    fitOverflow: pagesEl.parentElement ? pagesEl.parentElement.style.overflow : null,
  };
  try {
    pagesEl.style.transform = 'none';
    pagesEl.style.width = '';
    if (pagesEl.parentElement) {
      pagesEl.parentElement.style.height = 'auto';
      pagesEl.parentElement.style.overflow = 'visible';
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
    const scale = PDF_DPI / CSS_DPI;
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], {
        scale,
        backgroundColor: '#ffffff',
        // The shot is of this element at its own size, not of a scrolled window. Left to
        // work it out, html2canvas measured the phone's viewport and cropped the page to
        // it, so the sheet came out with only the left-hand columns on it.
        width: pages[i].offsetWidth,
        height: pages[i].offsetHeight,
        windowWidth: pages[i].offsetWidth,
        windowHeight: pages[i].offsetHeight,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        logging: false,
        onclone: (_doc, el) => flattenModernColours(el),
      });
      if (i > 0) doc.addPage('letter', 'landscape');
      // Corner to corner: the page is already 11 x 8.5, and the PDF page is too, so there
      // is no fitting to do and no margin to add. Anything else would reintroduce the
      // shrink-to-fit this whole file exists to avoid.
      doc.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, 11, 8.5, undefined, 'FAST');
    }
    return { doc, filename };
  } finally {
    pagesEl.style.transform = held.transform;
    pagesEl.style.width = held.width;
    if (pagesEl.parentElement) {
      pagesEl.parentElement.style.height = held.fitHeight;
      pagesEl.parentElement.style.overflow = held.fitOverflow;
    }
  }
}

/** Hand the finished PDF to the person.
 *
 *  A tab is opened on the click itself, before any of the work, and pointed at the file
 *  afterwards. Opening it at the end instead is what a popup blocker stops: by then the
 *  tap that authorised it is long over, and on an iPhone this is exactly where it would be
 *  refused. If the tab was blocked anyway, or there never was one, it falls back to a
 *  download, which is the ordinary answer on a desktop. */
function deliver(doc, filename, tab) {
  const url = URL.createObjectURL(doc.output('blob'));
  if (tab && !tab.closed) {
    tab.location = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Long enough for the tab or the download to have taken hold. Revoking straight away
  // left an iPhone showing a blank viewer.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** @param {() => Element|null} getPages - looked up at click time, because the chart
 *  browser rebuilds its container on every Previous/Next and a reference taken when the
 *  button was wired would be pointing at a page that has since been thrown away. */
export function wirePdfButton(root, getPages, nameFor, id = 'pdf-btn') {
  const btn = root.querySelector(`#${id}`);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const pagesEl = getPages();
    if (!pagesEl) return;
    // Opened now, while the tap is still what is happening. See deliver().
    const tab = window.open('', '_blank');
    const said = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working...';
    try {
      const { doc, filename } = await buildChartPdf(pagesEl, nameFor ? nameFor() : 'zmanim.pdf');
      deliver(doc, filename, tab);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      console.error('PDF failed', err);
      // Said on the button rather than in an alert: the person is holding a phone and an
      // alert here would be one more thing to dismiss.
      btn.textContent = 'PDF failed';
      setTimeout(() => { btn.textContent = said; }, 2500);
      return;
    } finally {
      btn.disabled = false;
      if (btn.textContent === 'Working...') btn.textContent = said;
    }
  });
}
