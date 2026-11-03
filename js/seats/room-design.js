// Artwork only. Saved room geometry, seat hit areas and names stay independent.
export function seatsRoomDesignPaint(id) {
  const gradient = (name, stops) => `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1">${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  return {
    defs: gradient('wood-tone', [['0%', '#735246'], ['45%', '#614238'], ['100%', '#51372f']])
      + `<pattern id="${id}-wood" width="180" height="40" patternUnits="userSpaceOnUse"><rect width="180" height="40" fill="url(#${id}-wood-tone)"/><path d="M0 8 Q45 6 90 9 T180 8 M0 20 Q65 17 120 21 T180 20 M0 33 Q60 31 110 34 T180 33" fill="none" stroke="#c3a18a" stroke-width=".6" opacity=".13"/></pattern>`
      + gradient('edge', [['0%', '#473027'], ['100%', '#2e211c']])
      + gradient('chair', [['0%', '#514b48'], ['60%', '#383432'], ['100%', '#242321']])
      + gradient('cabinet', [['0%', '#463029'], ['100%', '#281e1b']])
      + gradient('fabric', [['0%', '#64283d'], ['50%', '#4d1e30'], ['100%', '#391624']])
      + `<pattern id="${id}-floor" width="96" height="96" patternUnits="userSpaceOnUse"><rect width="96" height="96" fill="#f4f3ef"/><path d="M0 96 V0 H96" fill="none" stroke="#ddd9d1" stroke-width=".7"/></pattern>`
      + `<filter id="${id}-shadow" x="-.15" y="-.4" width="1.3" height="1.9"><feDropShadow dx="0" dy="1.8" stdDeviation="1.3" flood-color="#241d19" flood-opacity=".2"/></filter>`,
    style: ['wood', 'edge', 'chair', 'cabinet', 'fabric', 'floor', 'shadow'].map(name => `--room-${name}:url(#${id}-${name})`).join(';'),
  };
}

export function seatsTableDesign(table) {
  const width = Math.max(1, table.width - 2), height = table.height;
  return `<path class="design-table-edge" d="M1 ${height - 2} h${width} v4 h-${width} Z" aria-hidden="true"/>
    <path class="design-table-highlight" d="M2 ${height + .5} H${Math.max(2, table.width - 2)}" aria-hidden="true"/>`;
}

export function seatsBimahDesign(x, y, width, height) {
  const left = x + 3, right = x + width - 3, bottom = y + height - 3;
  const fringe = Array.from({ length: Math.max(1, Math.floor((width - 8) / 3)) }, (_, index) => {
    const at = left + 1 + index * 3;
    return `M${at} ${bottom - 4} v4`;
  }).join(' ');
  return `<g class="design-bimah" aria-hidden="true"><rect class="design-fabric" x="${left}" y="${y + 3}" width="${width - 6}" height="${height - 6}" rx="1"/><path class="design-gold-trim" d="M${left} ${bottom - 4} H${right} ${fringe}"/></g>`;
}

export function seatsChairDesign(center, top) {
  return `<path class="chair-marker" d="M${center - 6} ${top + 3} Q${center} ${top - 1} ${center + 6} ${top + 3} v5 q0 3 -3 3 h-6 q-3 0 -3 -3 Z M${center - 4} ${top + 11} v3 m8 0 v-3"/><path class="design-chair-piping" d="M${center - 4.5} ${top + 4} Q${center} ${top + 1} ${center + 4.5} ${top + 4} M${center - 4} ${top + 8.5} h8" aria-hidden="true"/>`;
}
