export function seatsFitName(name, width, height, measure, maxFont = 13) {
  const words = name.split(/\s+/), available = Math.max(0, width - 6);
  let result;
  for (let font = maxFont; font >= 7; font -= .5) {
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (measure(next, font) <= available) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const fits = lines.length * font * 1.1 <= height - 3 && words.every(word => measure(word, font) <= available);
    result = { font, lines, fits };
    if (fits) return result;
  }
  return result;
}

export function seatsCommonNameFont(layouts) {
  const fonts = layouts.filter(layout => layout.fits).map(layout => layout.font).sort((a, b) => a - b);
  if (!fonts.length) return 13;
  // Keep roughly 85% at one size without letting an isolated long name shrink the whole chart.
  const exceptions = Math.min(fonts.length - 1, Math.max(1, Math.floor(fonts.length * .15)));
  return fonts[exceptions];
}
