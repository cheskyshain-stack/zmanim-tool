import { SEATS_BOUNDS } from './model.js';

// Artwork only. Saved room geometry, seat hit areas and names stay independent.
export function seatsRoomDesignPaint(id) {
  const gradient = (name, stops) => `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1">${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  const tileWidth = 144, tileHeight = 72;
  const tileX = (SEATS_BOUNDS.left + SEATS_BOUNDS.right - tileWidth) / 2;
  const tileY = (SEATS_BOUNDS.top + SEATS_BOUNDS.bottom - tileHeight) / 2;
  return {
    defs: gradient('wood-tone', [['0%', '#fffefa'], ['45%', '#faf7ef'], ['100%', '#eee9de']])
      + `<pattern id="${id}-wood" width="180" height="40" patternUnits="userSpaceOnUse"><rect width="180" height="40" fill="url(#${id}-wood-tone)"/><path d="M0 8 Q45 6 90 9 T180 8 M0 20 Q65 17 120 21 T180 20 M0 33 Q60 31 110 34 T180 33" fill="none" stroke="#ad967b" stroke-width=".5" opacity=".09"/></pattern>`
      + gradient('edge', [['0%', '#c9b49a'], ['100%', '#ab9479']])
      + gradient('chair', [['0%', '#d0d2cf'], ['60%', '#a7aaa8'], ['100%', '#858a89']])
      + gradient('cabinet', [['0%', '#a58b71'], ['100%', '#715a47']])
      + gradient('shelf', [['0%', '#f3efe6'], ['100%', '#e7dfd1']])
      + gradient('fabric', [['0%', '#64283d'], ['50%', '#4d1e30'], ['100%', '#391624']])
      + `<pattern id="${id}-floor" x="${tileX}" y="${tileY}" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}" patternUnits="userSpaceOnUse"><rect width="144" height="72" fill="#f7f7f3"/><path d="M0 72 V0 H144" fill="none" stroke="#dcdcd4" stroke-width=".7"/><path d="M8 64 Q32 48 58 52 T130 17 M32 70 Q58 55 87 61 T140 36" fill="none" stroke="#e4e4dc" stroke-width=".65" opacity=".45"/></pattern>`
      + `<filter id="${id}-shadow" x="-.15" y="-.4" width="1.3" height="1.9"><feDropShadow dx="0" dy="1.5" stdDeviation="1.1" flood-color="#544b41" flood-opacity=".14"/></filter>`,
    style: ['wood', 'edge', 'chair', 'cabinet', 'shelf', 'fabric', 'floor', 'shadow'].map(name => `--room-${name}:url(#${id}-${name})`).join(';'),
  };
}

export function seatsAronDesign({ x, y, width, height }) {
  const center = x + width / 2, curtainX = x + 14, curtainWidth = width - 28, swag = curtainWidth / 3;
  return `<g class="design-aron-detail" aria-hidden="true">
    <rect class="design-aron-wood" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="4"/>
    <rect class="design-aron-wood" x="${x + 2}" y="${y + 6}" width="10" height="${height - 9}"/>
    <rect class="design-aron-wood" x="${x + width - 12}" y="${y + 6}" width="10" height="${height - 9}"/>
    <path class="design-aron-panel-lines" d="M${x + 2} ${y + 18} h10 m-10 12 h10 M${x + width - 12} ${y + 18} h10 m-10 12 h10"/>
    <rect class="design-aron-panel" x="${curtainX}" y="${y + 7}" width="${curtainWidth}" height="${height - 11}"/>
    <path class="design-aron-fold" d="M${curtainX + 6} ${y + 9} v${height - 15} M${curtainX + curtainWidth - 6} ${y + 9} v${height - 15}"/>
    <path class="design-aron-trim" d="M${x + 13} ${y + 6} V${y + height - 3} M${x + width - 13} ${y + 6} V${y + height - 3} M${x + 2} ${y + 5} H${x + width - 2}"/>
    <path class="design-aron-swag" d="M${curtainX} ${y + 8} q${swag / 2} 6 ${swag} 0 q${swag / 2} 6 ${swag} 0 q${swag / 2} 6 ${swag} 0"/>
    <path class="design-aron-crown" d="M${center - 6} ${y + 15} l3 3 3-4 3 4 3-3-1 7 h-10 Z M${center - 5} ${y + 24} h10"/>
  </g>`;
}

export function seatsTableDesign(table) {
  const width = Math.max(1, table.width - 2), height = table.height;
  return `<path class="design-table-edge" d="M1 ${height - 2} h${width} v4 h-${width} Z" aria-hidden="true"/>
    <path class="design-table-highlight" d="M2 ${height + .5} H${Math.max(2, table.width - 2)}" aria-hidden="true"/>`;
}

export function seatsBimahDesign(x, y, width, height) {
  const fringe = Array.from({ length: 22 }, (_, index) => `M${4 + index * 3} 65 v4`).join(' ');
  return `<g class="design-bimah" aria-hidden="true"><g transform="translate(${x} ${y}) scale(${width / 72} ${height / 72})"><rect class="design-fabric" x="3" y="3" width="66" height="66" rx="1"/><path class="design-fabric-fold" d="M5 6 V63 M67 6 V63"/><rect class="design-bimah-glass" x="10" y="10" width="52" height="52" rx="1"/><path class="design-bimah-book" d="M36 17 q-4-3-8-1 v6 q4-2 8 1 q4-3 8-1 v-6 q-4-2-8 1 v6"/><path class="design-gold-trim" d="M3 65 H69 ${fringe}"/></g></g>`;
}

export function seatsChairDesign(center, top) {
  return `<path class="chair-marker" d="M${center - 6} ${top + 3} Q${center} ${top - 1} ${center + 6} ${top + 3} v5 q0 3 -3 3 h-6 q-3 0 -3 -3 Z M${center - 4} ${top + 11} v3 m8 0 v-3"/><path class="design-chair-piping" d="M${center - 4.5} ${top + 4} Q${center} ${top + 1} ${center + 4.5} ${top + 4} M${center - 4} ${top + 8.5} h8" aria-hidden="true"/>`;
}
