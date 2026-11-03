// Artwork only. Saved room geometry, seat hit areas and names stay independent.
export function seatsRoomDesignPaint(id) {
  const gradient = (name, stops) => `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1">${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  return {
    defs: gradient('wood', [['0%', '#f8e8ca'], ['48%', '#efd3a3'], ['100%', '#e5c18b']])
      + gradient('edge', [['0%', '#d0ac74'], ['100%', '#a37d49']])
      + gradient('chair', [['0%', '#ffffff'], ['65%', '#eaf0f3'], ['100%', '#c6d3dc']])
      + gradient('navy', [['0%', '#36576e'], ['100%', '#18364e']])
      + `<filter id="${id}-shadow" x="-.15" y="-.4" width="1.3" height="1.9"><feDropShadow dx="0" dy="1.8" stdDeviation="1.3" flood-color="#17344c" flood-opacity=".2"/></filter>`,
    style: ['wood', 'edge', 'chair', 'navy', 'shadow'].map(name => `--room-${name}:url(#${id}-${name})`).join(';'),
  };
}

export function seatsTableDesign(table) {
  const width = Math.max(1, table.width - 2), height = table.height;
  return `<path class="design-table-edge" d="M1 ${height - 2} h${width} v4 h-${width} Z" aria-hidden="true"/>
    <path class="design-table-highlight" d="M2 ${height + .5} H${Math.max(2, table.width - 2)}" aria-hidden="true"/>`;
}
