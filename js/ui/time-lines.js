import { balancedLineCuts } from '../util.js';

/** Used CSS widths retain fractions in paper pixels under phone zoom. Inline spans
 *  fall back to offsetWidth, including on rotated posters. Emptying an item briefly
 *  measures its CSS separator without counting it as time text. */
export function measureTimeItems(items) {
  const widthOf = item => {
    const width = parseFloat(getComputedStyle(item).width);
    return Number.isFinite(width) ? width : item.offsetWidth;
  };
  const widths = items.map(widthOf);
  const measured = new Map();
  const prefixes = items.map(item => {
    const style = getComputedStyle(item, '::before');
    if (style.content === 'none' || style.content === 'normal') return 0;
    const key = [style.content, style.fontFamily, style.fontSize, style.fontWeight,
      style.letterSpacing, style.paddingLeft, style.paddingRight].join('|');
    if (measured.has(key)) return measured.get(key);
    const children = [...item.childNodes];
    item.replaceChildren();
    const width = widthOf(item);
    item.replaceChildren(...children);
    measured.set(key, width);
    return width;
  });
  return { widths, prefixes };
}

export function balanceChartTimeLists(container) {
  for (const list of container.querySelectorAll('.chart-time-list')) {
    const items = [...list.querySelectorAll('.chart-time-item')];
    const first = list.firstElementChild;
    first.replaceChildren(...items);
    while (first.nextElementSibling) first.nextElementSibling.remove();
    const { widths, prefixes } = measureTimeItems(items);
    const available = parseFloat(getComputedStyle(list).width);
    const fullWidth = widths.reduce((sum, width) => sum + width, 0) - (prefixes[0] || 0);
    if (fullWidth <= available + 0.01) continue;
    const [cut] = balancedLineCuts(widths, { prefixes });
    if (!cut) continue;
    const bottom = document.createElement('span');
    bottom.className = 'chart-time-line';
    bottom.append(...items.slice(cut));
    first.after(bottom);
  }
}
