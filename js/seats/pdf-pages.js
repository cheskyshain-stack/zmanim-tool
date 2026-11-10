import { seatsPrintLayout } from './print-notes.js';

const SEATS_PDF_NS = 'http://www.w3.org/2000/svg';
const SEATS_PDF_STYLES = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'color', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'visibility', 'filter'];

function seatsPdfElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SEATS_PDF_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function seatsPdfPage(width, height) {
  return seatsPdfElement('svg', { xmlns: SEATS_PDF_NS, width, height, viewBox: `0 0 ${width} ${height}` });
}

function seatsPdfText(text, x, y, size, bold = false, serif = false) {
  return seatsPdfElement('text', { x, y, 'font-family': serif ? 'SeatsSerif' : 'SeatsSans', 'font-size': size, 'font-weight': bold ? '700' : '400', fill: '#000' }, text);
}

async function seatsPdfPicture(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('A room picture could not load.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
  });
}

export async function seatsChartPdfPage(source, paper, plan = {}) {
  const { geometry, headerFont, headerLines, footerLines } = seatsPrintLayout({ ...plan, paper: ['legal', 'tabloid'].includes(paper) ? paper : 'letter' });
  const page = seatsPdfPage(geometry.width * 72, geometry.height * 72), room = source.cloneNode(true);
  const originals = [source, ...source.querySelectorAll('*')], copies = [room, ...room.querySelectorAll('*')];
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index], clone = copies[index], style = getComputedStyle(original);
    clone.removeAttribute('style'); clone.removeAttribute('class');
    for (const property of SEATS_PDF_STYLES) {
      const value = style.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^)'"\s]+)["']?\)/g, 'url(#$1)');
      if (value) clone.style.setProperty(property, value);
    }
    // Embedded PDF fonts support Hebrew as well as Latin names.
    if (['text', 'tspan'].includes(clone.localName)) {
      clone.style.fontFamily = style.fontFamily.includes('Seats Serif') ? 'SeatsNames' : /Arial|sans-serif/i.test(style.fontFamily) ? 'SeatsSans' : 'SeatsSerif';
      clone.style.fontWeight = Number(style.fontWeight) >= 600 || style.fontWeight === 'bold' ? 'bold' : 'normal';
    }
    for (const attribute of [...clone.attributes]) if (/^(id|data-|aria-|role|tabindex)/.test(attribute.name) && attribute.name !== 'id') clone.removeAttribute(attribute.name);
    if (original.classList.contains('design-room-floor')) clone.setAttribute('data-pdf-layer', 'floor');
    if (original.classList.contains('floor-tile-joints')) clone.setAttribute('data-pdf-layer', 'grid');
  }
  const pictures = new Map();
  await Promise.all([...room.querySelectorAll('image')].map(async picture => {
    const href = picture.getAttribute('href');
    if (!pictures.has(href)) pictures.set(href, seatsPdfPicture(href));
    picture.setAttribute('href', await pictures.get(href));
  }));
  room.setAttribute('x', geometry.margin * 72); room.setAttribute('y', (geometry.margin + geometry.header) * 72);
  room.setAttribute('width', geometry.contentWidth * 72); room.setAttribute('height', (geometry.contentHeight - geometry.header - geometry.footer) * 72);
  room.setAttribute('viewBox', geometry.viewBox); room.setAttribute('preserveAspectRatio', 'none'); room.style.overflow = 'visible';
  page.append(seatsPdfText('7:30 Minyan', geometry.margin * 72, geometry.margin * 72 + 17, 17, true, true), room);
  for (let index = 0; index < headerLines.length; index++) {
    const text = seatsPdfText(headerLines[index], (geometry.width - geometry.margin) * 72, geometry.margin * 72 + headerFont + index * 11, headerFont, true);
    text.setAttribute('text-anchor', 'end'); page.append(text);
  }
  for (let index = 0; index < footerLines.length; index++) {
    const text = seatsPdfText(footerLines[index], geometry.width * 36, (geometry.height - geometry.margin - geometry.footer) * 72 + 13 + index * 11, 9);
    text.setAttribute('text-anchor', 'middle'); page.append(text);
  }
  return { svg: page, size: [geometry.width * 72, geometry.height * 72] };
}

export function seatsRosterPdfPages(rows) {
  const size = [612, 792], margin = 36, gap = 18, column = (size[0] - margin * 2 - gap) / 2;
  const measure = document.createElement('canvas').getContext('2d'); measure.font = '10px Arial';
  const wrap = (value, width) => {
    const lines = []; let line = '';
    for (const word of String(value).split(/\s+/)) {
      if (line && measure.measureText(line + ' ' + word).width <= width) { line += ' ' + word; continue; }
      if (line) lines.push(line);
      line = '';
      for (const letter of word) {
        if (line && measure.measureText(line + letter).width > width) { lines.push(line); line = ''; }
        line += letter;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const pages = []; let svg, side = 2, y = 105;
  for (const item of rows) {
    const names = wrap(item.name, column - 88), tables = wrap(item.table, 72), height = Math.max(names.length, tables.length) * 12 + 2;
    if (side === 2 || y + height > size[1] - margin) {
      if (++side >= 2) { side = 0; svg = seatsPdfPage(...size); svg.append(seatsPdfText('7:30 Minyan', margin, margin + 17, 17, true, true)); pages.push({ svg, size }); }
      y = 105;
      const x = margin + side * (column + gap);
      svg.append(seatsPdfText('Name', x, 86, 10, true), seatsPdfText('Table', x + column - 72, 86, 10, true));
    }
    const x = margin + side * (column + gap);
    for (let line = 0; line < names.length; line++) svg.append(seatsPdfText(names[line], x, y + line * 12, 10));
    for (let line = 0; line < tables.length; line++) svg.append(seatsPdfText(tables[line], x + column - 72, y + line * 12, 10));
    svg.append(seatsPdfElement('path', { d: `M${x} ${y + height - 9} H${x + column}`, fill: 'none', stroke: '#bbb', 'stroke-width': '.5' }));
    y += height;
  }
  return pages;
}
