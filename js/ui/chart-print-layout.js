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
  return 'separate';
}

export function rememberChartPrintLayout(value) {
  const choice = 'separate';
  try { localStorage.setItem(CHART_PRINT_LAYOUT_KEY, choice); chartPrintLayoutFallback = null; }
  catch { chartPrintLayoutFallback = choice; }
}

export function chartPrintLayoutHtml(value, canCombine = true) {
  return '<input id="chart-print-layout" class="chart-print-layout no-print" type="hidden" value="separate">';
}
