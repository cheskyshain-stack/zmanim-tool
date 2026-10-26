export const SEATS_PRINT_VIEW = { x: 12, y: 50, width: 1176, height: 916 };

export function seatsPrintGeometry(paper) {
  const tabloid = paper === 'tabloid', width = tabloid ? 17 : 11, height = tabloid ? 11 : 8.5;
  const margin = tabloid ? 0.5 : 0.35, header = 0.35, contentWidth = width - margin * 2, contentHeight = height - margin * 2;
  const xScale = SEATS_PRINT_VIEW.height * contentWidth / (contentHeight - header) / SEATS_PRINT_VIEW.width;
  return { width, height, margin, header, contentWidth, contentHeight, xScale,
    viewBox: [SEATS_PRINT_VIEW.x * xScale, SEATS_PRINT_VIEW.y, SEATS_PRINT_VIEW.width * xScale, SEATS_PRINT_VIEW.height].join(' ') };
}

// Spread the room across the sheet while preserving the proportions of the lettering.
export function seatsPreparePrint(svg, geometry) {
  if (!svg) return;
  const inverse = 1 / geometry.xScale;
  for (const text of svg.querySelectorAll('text')) {
    let vertical = false;
    for (let node = text; node && node !== svg; node = node.parentElement) {
      if (/rotate\(\s*-?90(?:\s|,|\))/.test(node.getAttribute('transform') || '')) vertical = !vertical;
    }
    if (!text.hasAttribute('data-original-transform')) text.setAttribute('data-original-transform', text.getAttribute('transform') || '');
    const original = text.getAttribute('data-original-transform');
    const anchor = Number(text.getAttribute('x') ?? text.querySelector('tspan')?.getAttribute('x') ?? 0);
    const correction = vertical ? 'scale(1 ' + inverse + ')'
      : 'translate(' + anchor + ' 0) scale(' + inverse + ' 1) translate(' + -anchor + ' 0)';
    text.setAttribute('transform', (original + ' ' + correction).trim());
  }
}
