import { escText } from '../util.js';

export function calendarCompactDayFacts(day) {
  const observances = day.facts.map(fact => `<span class="cal-observance">${escText(fact)}</span>`);
  if (day.parsha) return observances.join('') + `<span class="cal-parsha">${escText(day.parsha)}</span>`;
  if (observances.length) return observances.join('');
  const fallback = day.specialLabel || (day.mevarchim ? 'מברכים' : '');
  return fallback ? `<span class="cal-observance">${escText(fallback)}</span>` : '';
}

export function fitCalendarDayFacts(container, compact) {
  const context = document.createElement('canvas').getContext('2d');
  for (const facts of container.querySelectorAll('.cal-facts')) {
    const labels = [...facts.children];
    if (compact && getComputedStyle(facts).visibility === 'hidden') continue;

    // Keep a complete Hebrew word on one line, even in a narrow Shabbos column.
    const initialSizes = new Map();
    for (const label of labels) {
      if (!compact && !label.classList.contains('cal-parsha')) continue;
      label.hidden = false;
      label.style.fontSize = '';
      const style = getComputedStyle(label);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const widest = Math.max(...label.textContent.split(/\s+/).map(word => context.measureText(word).width));
      if (widest > facts.clientWidth && facts.clientWidth > 1) {
        label.style.fontSize = `${parseFloat(style.fontSize) * (facts.clientWidth - 1) / widest}px`;
      }
      initialSizes.set(label, label.style.fontSize);
    }

    if (!compact) continue;
    const fits = () => {
      const space = facts.getBoundingClientRect();
      return labels.every(label => {
        const box = label.getBoundingClientRect();
        return box.top >= space.top + .5 && box.bottom <= space.bottom - .5;
      });
    };
    while (!fits()) {
      let shrank = false;
      const initialSizes = new Map();
    for (const label of labels) {
        const size = parseFloat(getComputedStyle(label).fontSize);
        if (size > 7) {
          label.style.fontSize = `${Math.max(7, size - .25)}px`;
          shrank = true;
        }
      }
      // Observances come first. Drop the lowest-priority label if shrinking is insufficient.
      if (!shrank) {
        labels.pop().hidden = true;
        for (const label of labels) label.style.fontSize = initialSizes.get(label);
      }
    }
  }
}
