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
      + `<pattern id="${id}-floor" x="${tileX}" y="${tileY}" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}" patternUnits="userSpaceOnUse"><rect width="144" height="72" fill="#f7f7f3"/><path d="M0 72 V0 H144" fill="none" stroke="#dcdcd4" stroke-width=".7"/><path d="M8 64 Q32 48 58 52 T130 17 M32 70 Q58 55 87 61 T140 36" fill="none" stroke="#e4e4dc" stroke-width=".65" opacity=".45"/></pattern>`
      + `<filter id="${id}-shadow" x="-.15" y="-.4" width="1.3" height="1.9"><feDropShadow dx="0" dy="1.5" stdDeviation="1.1" flood-color="#544b41" flood-opacity=".14"/></filter>`,
    style: ['wood', 'edge', 'chair', 'cabinet', 'shelf', 'floor', 'shadow'].map(name => `--room-${name}:url(#${id}-${name})`).join(';'),
  };
}

// Transparent fixture pictures, clipped per object without stretching their proportions.
const SEATS_FIXTURE_ATLAS = '/assets/seats/room-fixtures-photo-v1.png';
const SEATS_CROWN_PICTURE = '/assets/seats/aron-crown-round-v1.png';
const SEATS_AMUD_PICTURE = '/assets/seats/amud-front-photo-v1.png';
const SEATS_FIXTURE_CROPS = {
  aron: [55, 0, 672, 696],
  bimah: [788, 173, 872, 516],
  amud: [33, 17, 925, 1548],
};
let seatsFixtureClipCount = 0;

export async function seatsWaitForFixturePictures() {
  await Promise.all([SEATS_FIXTURE_ATLAS, SEATS_CROWN_PICTURE, SEATS_AMUD_PICTURE].map(src => {
    const picture = new Image();
    picture.src = src;
    return picture.decode();
  }));
}

function seatsFixturePicture(kind, center, top, width, height, printScale) {
  const crop = SEATS_FIXTURE_CROPS[kind], clip = 'seats-fixture-clip-' + ++seatsFixtureClipCount;
  const [source, imageWidth, imageHeight] = kind === 'amud' ? [SEATS_AMUD_PICTURE, 990, 1589] : [SEATS_FIXTURE_ATLAS, 2172, 724];
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
  const size = 1.1;
  return seatsFixturePicture('bimah', x + width / 2, y - height * (size - 1) / 2, width * printScale * size, height * size, printScale);
}

export function seatsAmudDesign(x, y, width, height, printScale = 1) {
  const size = 1.21;
  return seatsFixturePicture('amud', x + width / 2, y - height * (size - 1) / 2, width * printScale * size, height * size, printScale);
}

export function seatsChairDesign(center, top) {
  return `<path class="chair-marker" d="M${center - 6} ${top + 3} Q${center} ${top - 1} ${center + 6} ${top + 3} v5 q0 3 -3 3 h-6 q-3 0 -3 -3 Z M${center - 4} ${top + 11} v3 m8 0 v-3"/><path class="design-chair-piping" d="M${center - 4.5} ${top + 4} Q${center} ${top + 1} ${center + 4.5} ${top + 4} M${center - 4} ${top + 8.5} h8" aria-hidden="true"/>`;
}
