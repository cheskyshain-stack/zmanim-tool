const CHART_PRINT_LAYOUT_KEY = 'zmanim-chart-print-layout';
let chartPrintLayoutFallback = null;

export function isCombinedChartLayout(value) {
  return value === 'combined' || value === 'combined-letter';
}

export function chartPrintSize(value) {
  return value === 'combined' ? { width: 17, height: 11, css: '17in 11in' }
    : { width: 11, height: 8.5, css: 'letter landscape' };
}

export function chartPrintLayout(canCombine = true) {
  try {
    const value = chartPrintLayoutFallback ?? localStorage.getItem(CHART_PRINT_LAYOUT_KEY);
    return canCombine && isCombinedChartLayout(value) ? value : 'separate';
  } catch { return canCombine && isCombinedChartLayout(chartPrintLayoutFallback) ? chartPrintLayoutFallback : 'separate'; }
}

export function rememberChartPrintLayout(value) {
  const choice = isCombinedChartLayout(value) ? value : 'separate';
  try { localStorage.setItem(CHART_PRINT_LAYOUT_KEY, choice); chartPrintLayoutFallback = null; }
  catch { chartPrintLayoutFallback = choice; }
}

export function chartPrintLayoutHtml(value, canCombine = true) {
  return `<label class="chart-print-layout no-print" for="chart-print-layout">Print layout
    <select id="chart-print-layout">
      <option value="separate" ${!isCombinedChartLayout(value) ? 'selected' : ''}>Separate pages · Letter</option>
      <option value="combined-letter" ${value === 'combined-letter' ? 'selected' : ''} ${canCombine ? '' : 'disabled'}>Together · Letter</option>
      <option value="combined" ${value === 'combined' ? 'selected' : ''} ${canCombine ? '' : 'disabled'}>Together · 11 × 17</option>
    </select>
  </label>${canCombine && isCombinedChartLayout(value)
    ? `<p class="hint chart-print-paper-hint no-print">${value === 'combined-letter'
      ? 'Choose Letter paper and Landscape in the print dialog.'
      : 'For full size, choose Ledger (17 × 11) or 11 × 17 landscape in the print dialog.'}</p>` : ''}`;
}
