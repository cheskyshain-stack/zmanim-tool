import { escAttr, escText } from '../util.js';
import { seatsFront, SEATS_BACK_WALKWAY_Y, SEATS_CROSS_WALKWAY, SEATS_FRONT_RIGHT_DOOR } from './model.js';

export function seatsRoomFeatures(plan) {
  const cross = SEATS_CROSS_WALKWAY;
  const door = SEATS_FRONT_RIGHT_DOOR, doorWidth = door.bottom - door.top;
  const { aron } = seatsFront(plan), font = Math.min(15, (aron.width - 8) / 4.5);
  const a = plan.tables.filter(table => ['A7', 'A8'].includes(table.id));
  const d = plan.tables.filter(table => ['D7', 'D8'].includes(table.id));
  const aRight = a.length ? Math.min(...a.map(table => table.x)) : 103;
  const dRight = d.length ? Math.min(...d.map(table => table.x)) : 1030;
  const dLeft = plan.tables.find(table => table.id === 'D6')?.x ?? 968;
  const side = (id, left, right) => right - left < 24 ? '' : `<g class="walkway rear-side-walkway" data-walkway="${id}"><path d="M${left} ${cross.bottom} V${SEATS_BACK_WALKWAY_Y} M${right} ${cross.bottom} V${SEATS_BACK_WALKWAY_Y}"/></g>`;
  return `<path class="room-boundary" d="M17 ${cross.top} V70 H1183 V${cross.top} M1183 ${cross.bottom} V960 H17 V${cross.bottom}"/>
    <g class="aron-kodesh" data-fixture="aron" aria-label="Aron Kodesh"><rect class="aron" x="${aron.x}" y="${aron.y}" width="${aron.width}" height="${aron.height}"/><text class="aron-label" text-anchor="middle" style="font-size:${font}px"><tspan x="${aron.x + aron.width / 2}" y="90">ARON</tspan><tspan x="${aron.x + aron.width / 2}" y="108">KODESH</tspan></text></g>
    <g class="walkway" data-walkway="cross" aria-label="Walkway between rows 6 and 7"><path d="M18 ${cross.top} H1182 M18 ${cross.bottom} H1182"/></g>
    <g class="room-opening" data-door="left-entrance" data-kind="open" aria-label="Left entrance"></g>
    <g class="room-opening" data-door="right-entrance" data-kind="open" aria-label="Right entrance"></g>
    <g class="room-door" data-door="front-right" data-kind="open" aria-label="Front right door"><path class="door-gap" d="M1183 ${door.top} V${door.bottom}"/><path class="door-leaf" d="M1183 ${door.top} H${1183 - doorWidth}"/><path class="door-swing" d="M1183 ${door.bottom} A${doorWidth} ${doorWidth} 0 0 1 ${1183 - doorWidth} ${door.top}"/></g>
    ${side('rear-left', 41, aRight)}${side('rear-right', dLeft, dRight)}
    <g class="walkway rear-walkway" data-walkway="back" aria-label="Walkway across the back of the room"><path d="M41 ${SEATS_BACK_WALKWAY_Y} H1159 M41 936 H1159"/></g>
    <g class="room-door closed-door" data-door="back-left" data-kind="closed" aria-label="Back left door"><path class="door-gap" d="M241 960 H291"/><path class="door-leaf" d="M241 960 H291 M241 956 V964 M291 956 V964"/></g>
    <g class="room-door closed-door" data-door="back-right" data-kind="closed" aria-label="Back right door"><path class="door-gap" d="M909 960 H959"/><path class="door-leaf" d="M909 960 H959 M909 956 V964 M959 956 V964"/></g>`;
}

export function seatsCabinetArt(object, drawName) {
  const vertical = object.height > object.width;
  const length = vertical ? object.height : object.width, depth = vertical ? object.width : object.height;
  const spines = Array.from({ length: Math.max(0, Math.floor((length - 8) / 12)) }, (_, index) => {
    const coordinate = 7 + index * 12;
    return vertical ? `<path d="M4 ${coordinate} h${object.width - 8}" class="shelf-line"/>`
      : `<path d="M${coordinate} 4 v${object.height - 8}" class="shelf-line"/>`;
  }).join('');
  const surface = `<rect width="${object.width}" height="${object.height}" rx="1" class="object-surface"/>${spines}`;
  if (object.id.startsWith('rear-case-')) return surface;
  const labelWidth = Math.min(length - 6, Math.max(60, object.label.length * 5.5));
  return `${surface}<g transform="translate(${object.width / 2} ${object.height / 2})${vertical ? ' rotate(-90)' : ''}"><rect class="cabinet-label-bg" x="${-labelWidth / 2}" y="${-(depth - 6) / 2}" width="${labelWidth}" height="${depth - 6}"/>
    ${drawName(object.label, 0, -depth / 2, length - 6, depth, object.label, 10)}</g>`;
}

export function seatsRavArt(object, people, drawName, interactive, printScale = 1) {
  const name = people.get(object.seats[0]), center = object.width / 2;
  const size = Math.min(object.width - 2, object.height - 30), width = size / printScale;
  const top = 30, nameHeight = size - 4;
  const attributes = interactive ? `id="seat-${escAttr(object.id)}-0" data-seat="0" data-table="${escAttr(object.id)}" role="button" tabindex="0" aria-label="${escAttr(object.label + ': ' + (name || 'empty'))}"` : '';
  return `<rect class="station-frame" width="${object.width}" height="${object.height}"/>
    <g class="drag-handle"><rect x="0" y="-18" width="${object.width}" height="16" fill="transparent"/></g>
    <g class="table-seat rav-seat${name ? ' assigned' : ''}" ${attributes} data-facing="south">
      <path class="rav-chair" d="M${center - 10} 3 h20 M${center - 8} 7 h16 v10 h-16 z M${center - 5} 17 v5 m10 0 v-5"/>
      <rect class="shtender-surface" x="${center - width / 2}" y="${top}" width="${width}" height="${size}"/>
      <rect class="seat-area" x="${center - width / 2 + 2}" y="${top + 2}" width="${Math.max(1, width - 4)}" height="${nameHeight}"/>
      ${name ? drawName(name, center, top + 2, width - 4, nameHeight, object.label, 11) : `<text class="table-label rav-label" x="${center}" y="${top + 2 + nameHeight / 2 + 4}" text-anchor="middle">${escText(object.label)}</text>`}
    </g>`;
}
