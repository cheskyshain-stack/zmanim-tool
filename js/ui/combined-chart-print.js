const COMBINED_PRINT_ID = 'combined-chart-print-run';
const COMBINED_PRINT_CLASS = 'has-combined-chart-print';
const COMBINED_SVG_NS = 'http://www.w3.org/2000/svg';

export function clearCombinedChartPrint() {
  document.getElementById(COMBINED_PRINT_ID)?.remove();
  document.body.classList.remove(COMBINED_PRINT_CLASS);
}

function prepareCombinedChartPrint() {
  clearCombinedChartPrint();
  const pages = [...document.querySelectorAll('.pages > .page.is-combined-chart')]
    .filter(page => !page.classList.contains('page-excluded') && page.getClientRects().length);
  if (!pages.length) return;
  const run = document.createElement('div');
  run.id = COMBINED_PRINT_ID;
  run.className = 'combined-chart-print-run';
  run.setAttribute('aria-hidden', 'true');
  for (const page of pages) {
    const frame = document.createElement('div');
    frame.className = 'combined-chart-print-frame';
    const svg = document.createElementNS(COMBINED_SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1632 1056');
    svg.setAttribute('width', '1632');
    svg.setAttribute('height', '1056');
    svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
    const content = document.createElementNS(COMBINED_SVG_NS, 'foreignObject');
    content.setAttribute('width', '1632');
    content.setAttribute('height', '1056');
    const copy = page.cloneNode(true);
    copy.style.setProperty('zoom', '1', 'important');
    content.appendChild(copy);
    svg.appendChild(content);
    frame.appendChild(svg);
    run.appendChild(frame);
  }
  document.body.appendChild(run);
  document.body.classList.add(COMBINED_PRINT_CLASS);
  // Keep this hidden copy until the next draw or print. Android can return from
  // window.print() before it re-renders the job for a changed paper selection.
}

/** Register after the view's paper fitting, so the copied layout is final. The SVG
 *  viewport fits the real containing block without querying a phone viewport or
 *  adding a second scale when Android fits the requested page to its chosen paper.
 *  This is the original HTML layout, retaining its fonts, rules and PDF text. */
export function wireCombinedChartPrint() {
  clearCombinedChartPrint();
  window.removeEventListener('beforeprint', prepareCombinedChartPrint);
  window.addEventListener('beforeprint', prepareCombinedChartPrint);
}
