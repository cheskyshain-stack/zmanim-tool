const CHART_PRINT_LAYOUT_KEY = 'zmanim-chart-print-layout';
let chartPrintLayoutFallback = null;

export function chartPrintLayout(canCombine = true) {
  try {
    return canCombine && (chartPrintLayoutFallback ?? localStorage.getItem(CHART_PRINT_LAYOUT_KEY)) === 'combined' ? 'combined' : 'separate';
  } catch { return canCombine && chartPrintLayoutFallback === 'combined' ? 'combined' : 'separate'; }
}

export function rememberChartPrintLayout(value) {
  const choice = value === 'combined' ? 'combined' : 'separate';
  try { localStorage.setItem(CHART_PRINT_LAYOUT_KEY, choice); chartPrintLayoutFallback = null; }
  catch { chartPrintLayoutFallback = choice; }
}

export function chartPrintLayoutHtml(value, canCombine = true) {
  return `<label class="chart-print-layout no-print" for="chart-print-layout">Print layout
    <select id="chart-print-layout">
      <option value="separate" ${value !== 'combined' ? 'selected' : ''}>Separate pages · Letter</option>
      <option value="combined" ${value === 'combined' ? 'selected' : ''} ${canCombine ? '' : 'disabled'}>Together · 11 × 17</option>
    </select>
  </label>`;
}
