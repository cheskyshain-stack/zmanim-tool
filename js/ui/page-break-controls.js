import { alignPageSizesTo, defaultPageSizes, validatePageSizes } from '../pagination.js';

export function pageBreakControls(sheet, companion, apply) {
  const panel = document.createElement('details');
  panel.className = 'print-page-breaks';
  panel.id = 'print-page-breaks';
  panel.innerHTML = `<summary>Adjust weeks per page</summary><div class="print-page-breaks-body">
    <label for="print-page-count">Number of pages</label><div class="print-number-step">
      <button type="button" id="print-page-count-less" aria-label="Fewer pages">−</button>
      <input id="print-page-count" type="number" min="1" max="8" value="${sheet.pageSizes.length}">
      <button type="button" id="print-page-count-more" aria-label="More pages">+</button></div>
    <div class="print-page-counts"></div><p class="print-page-allocation" role="status"></p>
    <button type="button" id="print-apply-page-breaks">Apply page breaks</button></div>`;
  let sizes = [...sheet.pageSizes];
  const inputs = panel.querySelector('.print-page-counts');
  const count = panel.querySelector('#print-page-count');
  const validate = () => {
    const error = validatePageSizes(sheet.weeks.length, sizes);
    const text = panel.querySelector('.print-page-allocation');
    text.textContent = error || `All ${sheet.weeks.length} weeks are included.`;
    text.classList.toggle('is-invalid', Boolean(error));
    panel.querySelector('#print-apply-page-breaks').disabled = Boolean(error);
    panel.querySelector('#print-page-count-less').disabled = sizes.length <= 1;
    panel.querySelector('#print-page-count-more').disabled = sizes.length >= 8;
  };
  const rows = () => {
    inputs.replaceChildren();
    sizes.forEach((size, index) => {
      const field = document.createElement('label');
      field.textContent = `Page ${index + 1} weeks`;
      const step = document.createElement('div');
      step.className = 'print-number-step';
      step.innerHTML = `<button type="button" aria-label="Fewer weeks on page ${index + 1}">−</button>
        <input id="print-page-weeks-${index}" type="number" min="0" value="${size}">
        <button type="button" aria-label="More weeks on page ${index + 1}">+</button>`;
      const input = step.querySelector('input');
      const change = value => { sizes[index] = Math.max(0, Math.trunc(Number(value) || 0)); input.value = sizes[index]; validate(); };
      input.addEventListener('input', () => change(input.value));
      step.firstElementChild.addEventListener('click', () => change(sizes[index] - 1));
      step.lastElementChild.addEventListener('click', () => change(sizes[index] + 1));
      field.htmlFor = input.id;
      field.append(step);
      inputs.append(field);
    });
    validate();
  };
  const changeCount = value => {
    count.value = Math.max(1, Math.min(8, Math.trunc(Number(value) || 1)));
    sizes = defaultPageSizes(sheet.weeks.length, Number(count.value), sheet.season);
    rows();
  };
  count.addEventListener('change', () => changeCount(count.value));
  panel.querySelector('#print-page-count-less').addEventListener('click', () => changeCount(sizes.length - 1));
  panel.querySelector('#print-page-count-more').addEventListener('click', () => changeCount(sizes.length + 1));
  panel.querySelector('#print-apply-page-breaks').addEventListener('click', () => {
    if (validatePageSizes(sheet.weeks.length, sizes)) return;
    sheet.pageSizes = [...sizes];
    if (companion) companion.pageSizes = alignPageSizesTo(sheet.weeks, sizes, companion.weeks);
    apply();
  });
  rows();
  return panel;
}
