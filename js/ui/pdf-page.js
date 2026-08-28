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

/** Everything the library needs helping with, done on its own clone.
 *
 *  html2canvas hands the copy it is about to photograph to onclone, so none of this
 *  touches the chart in front of the person: nothing flickers, and there is nothing to put
 *  back if it throws.
 *
 *  Two jobs. The colours, above. And the underlines, which mark an alternate time and are
 *  the whole point of half the times on the board: the library does not implement
 *  text-underline-offset, so it drew every one of them hard against the digits. Measured
 *  by scanning the rows of both renderings of the same cell, the browser leaves a clear
 *  band of paper between the bottom of the digits and the line, and the PDF ran the line
 *  straight on from them, which is what came back as "the underline is attached to the
 *  time".
 *
 *  A border stands in for the decoration, because a border it does implement, and a
 *  border on an inline box sits below the descender rather than tight under the baseline.
 *  It is not the browser's own placement to the pixel: measured, the gap comes out a
 *  little larger than print's. It is separated, which is what the line is for. */
function prepareClone(root) {
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const cs = view.getComputedStyle(el);
    for (const prop of COLOUR_PROPS) {
      const plain = srgbToRgb(cs[prop]);
      if (plain) el.style[prop] = plain;
    }
    if (cs.textDecorationLine.includes('underline')) {
      el.style.textDecoration = 'none';
      el.style.borderBottom = `1px solid ${srgbToRgb(cs.color) || cs.color}`;
    }
  }
  redrawZoomAsScale(root, view);
}

/** html2canvas does not implement zoom, and the week card uses one inside itself.
 *
 *  .week-lines-inner is magnified by --fit-scale to fill the height of the card, which on
 *  a typical week is about 1.5. The library ignored it and drew that block at its
 *  unmagnified size, so the weekday times came out small, loosely spaced and sitting away
 *  from their labels: measured, the browser paints that block 197px wide where
 *  html2canvas rendered 131.
 *
 *  Clearing the zoom is not an option, because here it is not a fit-to-window that can be
 *  thrown away, it is how the card is laid out. So it is restated as the transform that
 *  means the same thing, which the library does implement. The catch is that the two size
 *  boxes differently: under zoom a percentage width resolves against the parent divided by
 *  the zoom, while under a transform it resolves against the parent itself and would come
 *  out magnified twice over. Pinning the element to the size it already computed to,
 *  before anything is changed, is what keeps the two equivalent.
 *
 *  Where it ends up then has to be put right, and no fixed transform-origin does that on
 *  its own. A zoomed box is laid out at its shrunken size and painted outwards from
 *  wherever that box sits, and where it sits depends on how its parent aligns it:
 *  .week-lines-inner is centred with margin-inline: auto, so scaling it from the top left
 *  walked it rightwards until the labels were clipped off the edge of the card. Rather
 *  than guess an origin per element, each one is measured against its own parent before
 *  and after and translated back by the difference, which is right however it is aligned.
 *
 *  Three passes, and the order matters: read every element before changing any, or
 *  resizing one moves another still to be read. Positions are taken relative to the
 *  parent rather than the viewport so that correcting an outer element does not
 *  invalidate the reading for something inside it. */
function redrawZoomAsScale(root, view) {
  const near = (el) => {
    const parent = el.parentElement;
    const r = el.getBoundingClientRect();
    if (!parent) return { x: r.left, y: r.top };
    const p = parent.getBoundingClientRect();
    return { x: r.left - p.left, y: r.top - p.top };
  };
  const found = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const z = parseFloat(view.getComputedStyle(el).zoom);
    if (z && Math.abs(z - 1) > 0.001) found.push({ el, z, w: el.offsetWidth, h: el.offsetHeight, was: near(el) });
  }
  for (const { el, z, w, h } of found) {
    el.style.zoom = '1';
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transformOrigin = 'top left';
    el.style.transform = `scale(${z})`;
  }
  for (const { el, z, was } of found) {
    const now = near(el);
    const dx = was.x - now.x;
    const dy = was.y - now.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${z})`;
    }
  }
}

/** Undo whatever the screen has done to fit these sheets into a window, and give back a
 *  function that puts it all back.
 *
 *  The sheets are photographed where they stand, and html2canvas reads the scaling: with
 *  it left on, the first PDF came out with the chart a third of the size in the corner of
 *  the sheet, which is the very fault this file exists to fix.
 *
 *  Three fits are covered, because the screens shrink in three different ways and
 *  html2canvas is fooled by all of them. The chart browser puts a transform on .pages and
 *  sizes the wrapper round it (fitChartToWindow). The week cards set --page-zoom on their
 *  container and carry is-scaled (fitPagesToWindow). And the one-sheet week view puts an
 *  inline zoom on the .week-pair itself (fitSheetToWindow), which is the one that caught
 *  this out: clearing only the container left the sheet's own zoom in place, and since
 *  html2canvas does not implement zoom at all the PDF came back a third of the size in the
 *  corner of the page with the text piled on itself.
 *
 *  So any inline zoom anywhere inside is cleared, rather than the two places known about
 *  today. A rule-driven zoom is left alone deliberately: --fit-scale shrinks a long week's
 *  times to keep them on the card, and clearing that would not undo a fit, it would
 *  overflow the page. */
function unscale(hostEl) {
  const fit = hostEl.parentElement;
  const zoomed = [hostEl, ...hostEl.querySelectorAll('*')]
    .filter((el) => el.style && el.style.zoom)
    .map((el) => [el, el.style.zoom]);
  const held = {
    transform: hostEl.style.transform,
    width: hostEl.style.width,
    pageZoom: hostEl.style.getPropertyValue('--page-zoom'),
    scaled: hostEl.classList.contains('is-scaled'),
    fitHeight: fit ? fit.style.height : null,
    fitOverflow: fit ? fit.style.overflow : null,
  };
  for (const [el] of zoomed) el.style.removeProperty('zoom');
  hostEl.style.transform = 'none';
  hostEl.style.width = '';
  hostEl.style.removeProperty('--page-zoom');
  hostEl.classList.remove('is-scaled');
  if (fit) {
    fit.style.height = 'auto';
    fit.style.overflow = 'visible';
  }
  return () => {
    for (const [el, value] of zoomed) el.style.zoom = value;
    hostEl.style.transform = held.transform;
    hostEl.style.width = held.width;
    if (held.pageZoom) hostEl.style.setProperty('--page-zoom', held.pageZoom);
    if (held.scaled) hostEl.classList.add('is-scaled');
    if (fit) {
      fit.style.height = held.fitHeight;
      fit.style.overflow = held.fitOverflow;
    }
  };
}

/** Photograph each sheet inside hostEl and put one on each page of a letter PDF.
 *
 *  @param {object} opts
 *    - sheet: what counts as one sheet of paper. '.page' for the wall chart, '.week-card'
 *      or '.week-pair' for the week, since a paired sheet is one piece of paper holding
 *      two cards and must not be photographed as two.
 *    - orientation/size: the wall chart is landscape 11 x 8.5, the week portrait 8.5 x 11.
 *      They travel together and must agree, or the image is laid on a page turned the
 *      other way and everything this was built for is lost.
 *
 *  Whatever the screen did to fit the sheets is undone first and put back in a finally,
 *  including if anything throws. */
export async function buildPdf(hostEl, opts = {}) {
  const { sheet = '.page', orientation = 'landscape', size = [11, 8.5], filename = 'zmanim.pdf' } = opts;
  if (!pdfReady()) throw new Error('PDF libraries are not loaded');
  const restore = unscale(hostEl);
  try {
    const sheets = [...hostEl.querySelectorAll(sheet)];
    if (!sheets.length) throw new Error('there is nothing on the screen to turn into a PDF');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation, unit: 'in', format: 'letter' });
    const scale = PDF_DPI / CSS_DPI;
    for (let i = 0; i < sheets.length; i++) {
      const canvas = await window.html2canvas(sheets[i], {
        scale,
        backgroundColor: '#ffffff',
        // The shot is of this element at its own size, not of a scrolled window. Left to
        // work it out, html2canvas measured the phone's viewport and cropped the page to
        // it, so the sheet came out with only the left-hand columns on it.
        width: sheets[i].offsetWidth,
        height: sheets[i].offsetHeight,
        windowWidth: sheets[i].offsetWidth,
        windowHeight: sheets[i].offsetHeight,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        logging: false,
        onclone: (_doc, el) => prepareClone(el),
      });
      if (i > 0) doc.addPage('letter', orientation);
      // Corner to corner: the sheet on the screen is already letter and so is the PDF
      // page, so there is no fitting to do and no margin to add. Anything else would
      // reintroduce the shrink-to-fit this whole file exists to avoid.
      doc.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, size[0], size[1], undefined, 'FAST');
    }
    return { doc, filename };
  } finally {
    restore();
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

/** @param {object} opts
 *    - host: () => Element, and a function rather than an element because both screens
 *      rebuild their container whenever the week or the spread changes, so anything held
 *      from when the button was wired would be pointing at markup already thrown away.
 *    - name: () => string, the filename. These get saved and mailed on, so they are named
 *      for what they cover.
 *    - sheet/orientation/size: handed straight to buildPdf. */
export function wirePdfButton(root, opts = {}) {
  const { host, name, sheet, orientation, size, id = 'pdf-btn' } = opts;
  const btn = root.querySelector(`#${id}`);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const hostEl = host && host();
    if (!hostEl) return;
    // Opened now, while the tap is still what is happening. See deliver().
    const tab = window.open('', '_blank');
    const said = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working...';
    try {
      const { doc, filename } = await buildPdf(hostEl, {
        sheet, orientation, size, filename: name ? name() : 'zmanim.pdf',
      });
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
