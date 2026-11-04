import { SEATS_BOUNDS } from './model.js';

const SEATS_FLOOR_TEXTURE = '/assets/seats/light-marble-floor-v1.png';
const SEATS_TABLE_TEXTURE = '/assets/seats/light-tabletop-v1.png';

const SEATS_ROOM_PALETTE = {
  ink: '#344757', boundary: '#9ca29e', outline: '#8b9699', grout: '#dcdcdc',
  'edge-line': '#a18c74', highlight: '#ede5d5', name: '#243b4d', number: '#596771',
  'chair-line': '#69777c', piping: '#e4e6e1', 'cabinet-line': '#876b55',
  'shelf-line': '#a98e70', molding: '#dcc9aa', 'book-line': '#a49984',
  'book-0': '#242522', 'book-1': '#343029', 'book-2': '#292b30', 'book-3': '#46312e',
  band: '#c5ad79', 'label-red': '#bd4745', 'label-blue': '#4382b5',
  'label-green': '#57916c', 'label-cream': '#ddd8c7', hover: '#a78b53', remote: '#347b60',
};

function seatsGrayscaleColor(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  const gray = Math.round(rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722).toString(16).padStart(2, '0');
  return '#' + gray.repeat(3);
}

// Artwork only. Saved room geometry, seat hit areas and names stay independent.
export function seatsRoomDesignPaint(id, monochrome = false) {
  const gradient = (name, stops) => `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1">${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  const tileWidth = 144, tileHeight = 72;
  // Keep the original photographic grain, without mirrored marble patterns.
  // The swatch spans nine tiles, with one rectangular tile centered in the room.
  const floorWidth = tileWidth * 3, floorHeight = tileHeight * 3;
  const floorX = (SEATS_BOUNDS.left + SEATS_BOUNDS.right - floorWidth) / 2;
  const floorY = (SEATS_BOUNDS.top + SEATS_BOUNDS.bottom - floorHeight) / 2;
  const gridPaths = [];
  let firstX = (SEATS_BOUNDS.left + SEATS_BOUNDS.right) / 2 - tileWidth / 2;
  let firstY = (SEATS_BOUNDS.top + SEATS_BOUNDS.bottom) / 2 - tileHeight / 2;
  while (firstX - tileWidth > SEATS_BOUNDS.left) firstX -= tileWidth;
  while (firstY - tileHeight > SEATS_BOUNDS.top) firstY -= tileHeight;
  for (let x = firstX; x < SEATS_BOUNDS.right; x += tileWidth) gridPaths.push(`<path d="M${x} ${SEATS_BOUNDS.top} V${SEATS_BOUNDS.bottom}"/>`);
  for (let y = firstY; y < SEATS_BOUNDS.bottom; y += tileHeight) gridPaths.push(`<path d="M${SEATS_BOUNDS.left} ${y} H${SEATS_BOUNDS.right}"/>`);
  const defs = gradient('wood-tone', [['0%', '#fffefa'], ['45%', '#faf7ef'], ['100%', '#eee9de']])
      + `<pattern id="${id}-wood" width="180" height="40" patternUnits="userSpaceOnUse"><rect width="180" height="40" fill="url(#${id}-wood-tone)"/><path d="M0 8 Q45 6 90 9 T180 8 M0 20 Q65 17 120 21 T180 20 M0 33 Q60 31 110 34 T180 33" fill="none" stroke="#ad967b" stroke-width=".5" opacity=".09"/></pattern>`
      + `<pattern id="${id}-tabletop" width="240" height="80" viewBox="0 0 240 80" patternUnits="userSpaceOnUse"><rect width="240" height="80" fill="#faf8f2"/><image class="design-table-texture" href="${SEATS_TABLE_TEXTURE}" width="240" height="80" preserveAspectRatio="xMidYMid meet" opacity=".5"/></pattern>`
      + gradient('edge', [['0%', '#c9b49a'], ['100%', '#ab9479']])
      + gradient('chair', [['0%', '#d0d2cf'], ['60%', '#a7aaa8'], ['100%', '#858a89']])
      + gradient('cabinet', [['0%', '#a58b71'], ['100%', '#715a47']])
      + gradient('shelf', [['0%', '#f3efe6'], ['100%', '#e7dfd1']])
      + `<pattern id="${id}-floor" x="${floorX}" y="${floorY}" width="${floorWidth}" height="${floorHeight}" viewBox="0 0 ${floorWidth} ${floorHeight}" patternUnits="userSpaceOnUse"><rect width="${floorWidth}" height="${floorHeight}" fill="#fafaf7"/><image class="design-floor-texture" href="${SEATS_FLOOR_TEXTURE}" width="${floorWidth}" height="${floorHeight}" preserveAspectRatio="xMidYMid meet" opacity=".5"/></pattern>`
      + `<filter id="${id}-shadow" x="-.15" y="-.4" width="1.3" height="1.9"><feDropShadow dx="0" dy="1.5" stdDeviation="1.1" flood-color="#544b41" flood-opacity=".14"/></filter>`;
  // Convert vector paint directly so printed names and book details remain searchable and sharp.
  // Raster artwork receives an image-only grayscale filter in CSS.
  return {
    defs: monochrome ? defs.replace(/#[0-9a-f]{6}\b/gi, seatsGrayscaleColor) : defs,
    grid: `<g class="floor-tile-joints">${gridPaths.join('')}</g>`,
    style: [
      ...['wood', 'tabletop', 'edge', 'chair', 'cabinet', 'shelf', 'floor', 'shadow'].map(name => `--room-${name}:url(#${id}-${name})`),
      ...Object.entries(SEATS_ROOM_PALETTE).map(([name, color]) => `--room-${name}:${monochrome ? seatsGrayscaleColor(color) : color}`),
    ].join(';'),
  };
}

// Transparent fixture pictures, clipped per object without stretching their proportions.
const SEATS_FIXTURE_ATLAS = '/assets/seats/room-fixtures-photo-v1.png';
const SEATS_CROWN_PICTURE = '/assets/seats/aron-crown-round-v1.png';
const SEATS_AMUD_PICTURE = '/assets/seats/amud-front-photo-v1.png';
const SEATS_BIMAH_PICTURE = '/assets/seats/bimah-two-panel-photo-v2.png';
const SEATS_FIXTURE_IMAGES = {
  aron: [SEATS_FIXTURE_ATLAS, 2172, 724],
  bimah: [SEATS_BIMAH_PICTURE, 1419, 1108],
  amud: [SEATS_AMUD_PICTURE, 990, 1589],
};
const SEATS_FIXTURE_CROPS = {
  aron: [55, 0, 672, 696],
  bimah: [20, 143, 1382, 882],
  amud: [33, 17, 925, 1548],
};
let seatsFixtureClipCount = 0;

export async function seatsWaitForFixturePictures() {
  await Promise.all([SEATS_FIXTURE_ATLAS, SEATS_CROWN_PICTURE, SEATS_AMUD_PICTURE, SEATS_BIMAH_PICTURE, SEATS_FLOOR_TEXTURE, SEATS_TABLE_TEXTURE].map(src => {
    const picture = new Image();
    picture.src = src;
    return picture.decode();
  }));
}

function seatsFixturePicture(kind, center, top, width, height, printScale) {
  const crop = SEATS_FIXTURE_CROPS[kind], clip = 'seats-fixture-clip-' + ++seatsFixtureClipCount;
  const [source, imageWidth, imageHeight] = SEATS_FIXTURE_IMAGES[kind];
  // Replace only the small crown finial with a round bead. Keep the original artwork everywhere else.
  const crown = kind === 'aron' ? `<defs><clipPath id="${clip}-crown" clipPathUnits="userSpaceOnUse"><rect x="386" y="280" width="24" height="27"/></clipPath></defs><g class="fixture-crown-correction" clip-path="url(#${clip}-crown)"><image href="${SEATS_CROWN_PICTURE}" x="340" y="270" width="115" height="110" preserveAspectRatio="none"/></g>` : '';
  return `<g class="design-realistic-fixture design-${kind}" aria-hidden="true"><g transform="translate(${center} ${top})"><g class="fixture-paper-correction"><g transform="scale(${1 / printScale} 1)"><svg class="fixture-picture" x="${-width / 2}" width="${width}" height="${height}" viewBox="${crop.join(' ')}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${crop[0]}" y="${crop[1]}" width="${crop[2]}" height="${crop[3]}"/></clipPath></defs><image href="${source}" width="${imageWidth}" height="${imageHeight}" clip-path="url(#${clip})"/>${crown}</svg></g></g></g></g>`;
}

export function seatsAronDesign(aron, printScale = 1, frontTop = 15) {
  const height = Math.min(100, aron.y + aron.height - frontTop - 2);
  return seatsFixturePicture('aron', aron.x + aron.width / 2, aron.y + aron.height - height, aron.width, height, printScale);
}

export function seatsTableDesign(table) {
  const width = Math.max(1, table.width - 2), height = table.height;
  return `<path class="design-table-edge" d="M1 ${height - 2} h${width} v4 h-${width} Z" aria-hidden="true"/>
    <path class="design-table-highlight" d="M2 ${height + .5} H${Math.max(2, table.width - 2)}" aria-hidden="true"/>`;
}

export function seatsBimahDesign(x, y, width, height, printScale = 1) {
  // The previous broad picture was 1.1 times the footprint's depth in width.
  const pictureWidth = height * 1.1 * .75;
  const crop = SEATS_FIXTURE_CROPS.bimah, pictureHeight = pictureWidth * crop[3] / crop[2];
  return seatsFixturePicture('bimah', x + width / 2, y + (height - pictureHeight) / 2, pictureWidth, pictureHeight, printScale);
}

export function seatsAmudDesign(x, y, width, height, printScale = 1) {
  const size = 1.21;
  return seatsFixturePicture('amud', x + width / 2, y - height * (size - 1) / 2, width * printScale * size, height * size, printScale);
}

export function seatsChairDesign(center, top) {
  return `<path class="chair-marker" d="M${center - 6} ${top + 3} Q${center} ${top - 1} ${center + 6} ${top + 3} v5 q0 3 -3 3 h-6 q-3 0 -3 -3 Z M${center - 4} ${top + 11} v3 m8 0 v-3"/><path class="design-chair-piping" d="M${center - 4.5} ${top + 4} Q${center} ${top + 1} ${center + 4.5} ${top + 4} M${center - 4} ${top + 8.5} h8" aria-hidden="true"/>`;
}
