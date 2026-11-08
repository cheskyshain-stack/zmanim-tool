import { cmykCanvasData, cmykDocument } from './cmyk-document.js';
import { PRINT_RASTER_DPI, PRINT_TILE_WIDTH, PRINT_TILE_HEIGHT, printRasterSize, printRasterTiles } from '../print-quality.js';

const CMYK_PDFJS_BASE = '/vendor/pdfjs-6.5.438/';
let cmykDialogOpen = false;

// Keep the USB copy's native printing. PDF.js is loaded only for a selected file
// on the hosted website, never on ordinary visits or over file://.
export function cmykButtonHtml() {
  return location.protocol === 'file:' ? '' : '<button type="button" class="cmyk-pdf-button no-print" data-cmyk-pdf>CMYK PDF</button>';
}

export function wireCmykButton(root) {
  root.querySelectorAll('[data-cmyk-pdf]').forEach(button => {
    button.addEventListener('click', () => openCmykPdf());
  });
}

export async function convertCmykPdf(file, { signal, progress = () => {} }) {
  if (!globalThis.CompressionStream) throw new Error('Please use a current version of Chrome, Edge, Firefox or Safari.');
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Choose a PDF smaller than 50 MB.');
  signal.throwIfAborted();
  const pdfjsUrl = CMYK_PDFJS_BASE + 'legacy/build/pdf.min.mjs';
  const pdfjs = await import(pdfjsUrl);
  signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = CMYK_PDFJS_BASE + 'legacy/build/pdf.worker.min.mjs';
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const loading = pdfjs.getDocument({
    data: bytes, isEvalSupported: false, enableXfa: false,
    cMapUrl: CMYK_PDFJS_BASE + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: CMYK_PDFJS_BASE + 'standard_fonts/',
    wasmUrl: CMYK_PDFJS_BASE + 'wasm/',
    // PDF.js loads the embedded page resources only, with no interactive viewer.
    useWorkerFetch: false,
  });
  let render = null, canvas = null;
  const abort = () => { render?.cancel(); loading.destroy().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const source = await loading.promise;
    if (source.numPages > 100) throw new Error('Choose a PDF with 100 pages or fewer.');
    const output = cmykDocument();
    let totalBytes = 0;
    for (let number = 1; number <= source.numPages; number++) {
      signal.throwIfAborted();
      progress(number, source.numPages);
      const page = await source.getPage(number);
      const physical = page.getViewport({ scale: 1 });
      // Preserve full resolution, paper size and rotation without a page-sized canvas.
      const viewport = page.getViewport({ scale: PRINT_RASTER_DPI / 72 });
      const { width, height } = printRasterSize(physical.width, physical.height), tiles = [];
      const tileCount = Math.ceil(width / PRINT_TILE_WIDTH) * Math.ceil(height / PRINT_TILE_HEIGHT);
      canvas = document.createElement('canvas');
      for (const tile of printRasterTiles(width, height)) {
        signal.throwIfAborted();
        canvas.width = tile.width; canvas.height = tile.height;
        const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!canvasContext) throw new Error('There is not enough memory to convert this PDF. Try a smaller file.');
        render = page.render({ canvasContext, viewport, transform: [1, 0, 0, 1, -tile.x, -tile.y], background: '#ffffff', intent: 'print' });
        await render.promise;
        render = null;
        const compressed = await cmykCanvasData(canvas, signal);
        totalBytes += compressed.byteLength;
        if (totalBytes > 512 * 1024 * 1024) throw new Error('The converted PDF is too large. Save fewer pages and try again.');
        tiles.push({ ...tile, compressed });
        progress(number, source.numPages, tiles.length / tileCount);
      }
      output.addPage({ width: physical.width, height: physical.height,
        pixelsWide: width, pixelsHigh: height, tiles });
      canvas.width = canvas.height = 0;
      canvas = null;
      page.cleanup();
    }
    signal.throwIfAborted();
    return output.finish();
  } finally {
    signal.removeEventListener('abort', abort);
    if (canvas) canvas.width = canvas.height = 0;
    await loading.destroy().catch(() => {});
  }
}

export function openCmykPdf() {
  if (cmykDialogOpen) return;
  cmykDialogOpen = true;
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'cmyk-pdf-dialog no-print';
  dialog.setAttribute('aria-labelledby', 'cmyk-pdf-title');
  dialog.innerHTML = `<div class="cmyk-pdf-heading"><h2 id="cmyk-pdf-title">CMYK print PDF</h2><button type="button" data-close aria-label="Close">×</button></div>
    <p>First use <strong>Print / Save as PDF</strong>. Then choose that saved PDF here to make a CMYK copy for your printer.</p>
    <label for="cmyk-pdf-file">Saved PDF</label>
    <input id="cmyk-pdf-file" type="file" accept="application/pdf,.pdf">
    <p class="cmyk-pdf-status" role="status" aria-live="polite">Your file stays on this device.</p>
    <progress aria-label="PDF conversion" hidden></progress>
    <div class="cmyk-pdf-actions"><button type="button" data-convert disabled>Convert to CMYK</button><a data-download hidden>Download CMYK PDF</a></div>
    <details><summary>About the print file</summary><p>Keeps the saved PDF’s page sizes and layout. Pages become lossless CMYK images at ${PRINT_RASTER_DPI} dpi; text in this copy is flattened. Black and gray use black ink only. Uses standard CMYK without a printer-specific colour profile. Normal browser printing keeps sharp vector text and its existing colour settings.</p></details>`;
  const picker = dialog.querySelector('input'), convert = dialog.querySelector('[data-convert]');
  const status = dialog.querySelector('[role="status"]'), progress = dialog.querySelector('progress');
  const download = dialog.querySelector('[data-download]');
  let controller = null, downloadUrl = null;
  const resetDownload = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    download.hidden = true;
    download.removeAttribute('href');
  };
  const close = () => {
    controller?.abort();
    resetDownload();
    dialog.close();
    dialog.remove();
    cmykDialogOpen = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }
  });
  picker.addEventListener('change', () => {
    resetDownload();
    convert.disabled = !picker.files.length;
    status.textContent = 'Your file stays on this device.';
  });
  convert.addEventListener('click', async () => {
    const file = picker.files[0];
    if (!file) return;
    resetDownload();
    controller = new AbortController();
    const active = controller;
    convert.disabled = picker.disabled = true;
    progress.hidden = false;
    progress.removeAttribute('value');
    status.textContent = 'Opening PDF…';
    dialog.querySelector('[data-close]').setAttribute('aria-label', 'Cancel conversion and close');
    try {
      const blob = await convertCmykPdf(file, { signal: active.signal, progress: (page, total, fraction = 0) => {
        status.textContent = `Converting page ${page} of ${total}…`;
        progress.max = total;
        progress.value = page - 1 + fraction;
      } });
      if (!dialog.isConnected || active.signal.aborted) return;
      downloadUrl = URL.createObjectURL(blob);
      download.href = downloadUrl;
      download.download = file.name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 120) + '-CMYK.pdf';
      download.hidden = false;
      status.textContent = 'Your CMYK PDF is ready.';
      download.focus({ preventScroll: true });
    } catch (error) {
      if (active.signal.aborted) return;
      status.textContent = error.name === 'PasswordException' ? 'This PDF is password protected. Save an unlocked copy and try again.'
        : error.name === 'InvalidPDFException' ? 'This file could not be read as a PDF. Choose the PDF saved from Print.'
        : error.message || 'The PDF could not be converted. Try a smaller file.';
    } finally {
      if (dialog.isConnected) {
        progress.hidden = true;
        convert.disabled = picker.disabled = false;
        dialog.querySelector('[data-close]').setAttribute('aria-label', 'Close');
      }
      controller = null;
    }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}
