// Basic pan-&-zoom image cropper for the header photo. No external library (this is a
// static, build-step-free app) — just a fixed-aspect viewport, a drag-to-reposition
// image, and a zoom slider, rendered onto a canvas at a fixed output size on save.
//
// renderImageCropper(container, currentDataUrl, onSave):
//   currentDataUrl - the saved custom photo (a data: URL) or null (using the default).
//   onSave(dataUrl | null) - called with a new cropped data: URL, or null if the user
//   removed the custom photo to go back to the bundled default.
export function renderImageCropper(container, currentDataUrl, onSave) {
  // Matches assets/logo-building-icon.png's own aspect ratio, so a freshly cropped
  // photo sits in the header the same shape as the default did.
  const ASPECT = 155 / 90;
  const VIEW_W = 240;
  const VIEW_H = Math.round(VIEW_W / ASPECT);
  const OUT_W = 620; // rendered at ~2.5x the on-screen viewport for a crisp print output
  const OUT_H = Math.round(OUT_W / ASPECT);

  container.innerHTML = `
    <div class="crop-tool">
      <div class="crop-current-row">
        <img class="crop-current" src="${currentDataUrl || 'assets/logo-building-icon.png'}" alt="Current header photo">
        <div>
          <div class="hint">${currentDataUrl ? 'Custom photo' : 'Default photo (assets/logo-building-icon.png)'}</div>
          <label class="file-label">Choose a photo…<input type="file" id="crop-file" accept="image/*" hidden></label>
          ${currentDataUrl ? '<button type="button" id="crop-remove" class="btn-danger">Remove — use default</button>' : ''}
        </div>
      </div>
      <div id="crop-editor" class="crop-editor" hidden>
        <div class="crop-viewport" id="crop-viewport" style="width:${VIEW_W}px;height:${VIEW_H}px;">
          <img id="crop-image" draggable="false" alt="">
        </div>
        <label class="crop-zoom">Zoom<input type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1"></label>
        <p class="hint">Drag the photo to reposition it.</p>
        <div class="actions">
          <button type="button" id="crop-save" class="btn-primary">Use this photo</button>
          <button type="button" id="crop-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#crop-file');
  const editor = container.querySelector('#crop-editor');
  const viewport = container.querySelector('#crop-viewport');
  const imgEl = container.querySelector('#crop-image');
  const zoomInput = container.querySelector('#crop-zoom');

  let img = null;
  let naturalW = 0;
  let naturalH = 0;
  let baseScale = 1;
  let scale = 1;
  let left = 0;
  let top = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startLeft = 0;
  let startTop = 0;

  function clamp() {
    const dispW = naturalW * scale;
    const dispH = naturalH * scale;
    left = Math.min(0, Math.max(VIEW_W - dispW, left));
    top = Math.min(0, Math.max(VIEW_H - dispH, top));
  }
  function apply() {
    clamp();
    imgEl.style.width = naturalW * scale + 'px';
    imgEl.style.height = naturalH * scale + 'px';
    imgEl.style.left = left + 'px';
    imgEl.style.top = top + 'px';
  }
  function startDrag(x, y) {
    dragging = true;
    dragStartX = x;
    dragStartY = y;
    startLeft = left;
    startTop = top;
  }
  function moveDrag(x, y) {
    if (!dragging) return;
    left = startLeft + (x - dragStartX);
    top = startTop + (y - dragStartY);
    apply();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      img = new Image();
      img.onload = () => {
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        baseScale = Math.max(VIEW_W / naturalW, VIEW_H / naturalH); // "cover" the viewport
        scale = baseScale;
        left = (VIEW_W - naturalW * scale) / 2;
        top = (VIEW_H - naturalH * scale) / 2;
        imgEl.src = reader.result;
        zoomInput.value = '1';
        editor.hidden = false;
        apply();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  zoomInput.addEventListener('input', () => {
    // Re-anchor on the viewport's center so zooming feels like it zooms "in place"
    // rather than yanking the image toward its top-left corner.
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const imgX = (cx - left) / scale;
    const imgY = (cy - top) / scale;
    scale = baseScale * Number(zoomInput.value);
    left = cx - imgX * scale;
    top = cy - imgY * scale;
    apply();
  });

  viewport.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  viewport.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  viewport.addEventListener('touchmove', (e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  viewport.addEventListener('touchend', () => {
    dragging = false;
  });

  container.querySelector('#crop-cancel').addEventListener('click', () => {
    editor.hidden = true;
    fileInput.value = '';
  });
  container.querySelector('#crop-save').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    const sx = -left / scale;
    const sy = -top / scale;
    const sw = VIEW_W / scale;
    const sh = VIEW_H / scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
    onSave(canvas.toDataURL('image/png'));
  });
  container.querySelector('#crop-remove')?.addEventListener('click', () => onSave(null));
}
