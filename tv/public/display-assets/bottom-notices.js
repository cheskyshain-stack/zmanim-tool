const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const pixels = value => parseFloat(value) || 0;
const tolerance = 2;

// Allocate the available row width without allowing one short card to vanish.
// When even the minimum widths cannot fit, retain every card and report it.
function distribute(wanted, minimums, available) {
  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0);
  if (minimumTotal >= available) return minimums.map(width => width * available / minimumTotal);
  const remaining = available - minimumTotal;
  const weights = wanted.map((width, index) => Math.max(0, width - minimums[index]));
  const total = weights.reduce((sum, width) => sum + width, 0);
  return minimums.map((width, index) => width + remaining * (total ? weights[index] / total : 1 / minimums.length));
}

/** Fit already-rendered, complete announcement cards into one fixed bottom row.
 * The caller owns the row height, rendering and warnings. CSS must consume
 * --notice-columns as grid-template-columns and scale text with --notice-font.
 * Measurements use native layout pixels even when the 1920px stage is scaled.
 * This never changes saved data, markup, order, page count or visibility. */
export function fitBottomNotices(container, groups = [], {preferredFont = 18, minFont = 12} = {}) {
  const cards = [...container.children].filter(child => child.matches('.announcement-group'));
  const lowFont = Math.max(1, Math.ceil(number(minFont, 12)));
  const highFont = Math.max(lowFont, Math.floor(number(preferredFont, 18)));
  let measurements = 0;
  if (!cards.length) {
    container.style.setProperty('--notice-font', highFont + 'px');
    container.style.setProperty('--notice-columns', 'none');
    container.dataset.fit = 'empty';
    return {fontSize:highFont, overflow:0, fits:true, columns:'none', widths:[], cards:[], measurements};
  }
  if (!container.clientWidth || !container.clientHeight || !container.getClientRects().length) {
    container.dataset.fit = 'unmeasured';
    return {fontSize:highFont, overflow:0, fits:false, columns:'', widths:[], cards:[], measurements, reason:'unmeasured'};
  }

  const style = getComputedStyle(container);
  const available = Math.max(1, container.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight)
    - pixels(style.columnGap) * (cards.length - 1));
  const sources = new Map(groups.map(group => [String(group.id), group]));
  const volumes = cards.map(card => {
    const source = sources.get(card.dataset.announcementGroup);
    const textLength = card.textContent.replace(/\s+/g, ' ').trim().length;
    const sectionCount = source?.sections?.length ?? card.querySelectorAll('.announcement-section').length;
    // Headings and separate contact lines need room even in a short notice.
    return Math.max(40, textLength + sectionCount * 42);
  });
  const volumeTotal = volumes.reduce((sum, volume) => sum + volume, 0);
  const scaleX = container.getBoundingClientRect().width / container.offsetWidth || 1;
  const scaleY = container.getBoundingClientRect().height / container.offsetHeight || 1;
  const rect = element => {
    const box = element.getBoundingClientRect();
    return {left:box.left / scaleX, right:box.right / scaleX, top:box.top / scaleY, bottom:box.bottom / scaleY,
      width:box.width / scaleX, height:box.height / scaleY};
  };

  function apply(fontSize, widths) {
    const columns = widths.map(width => `minmax(0, ${Math.max(.001, width).toFixed(3)}fr)`).join(' ');
    container.style.setProperty('--notice-font', fontSize + 'px');
    container.style.setProperty('--notice-columns', columns);
    return columns;
  }

  function measure(fontSize, widths) {
    const columns = apply(fontSize, widths);
    measurements++;
    const outer = rect(container);
    const records = cards.map((card, index) => {
      const box = rect(card), css = getComputedStyle(card);
      const borderTop = pixels(css.borderTopWidth), borderBottom = pixels(css.borderBottomWidth);
      const borderLeft = pixels(css.borderLeftWidth), borderRight = pixels(css.borderRightWidth);
      const paddingTop = pixels(css.paddingTop), paddingBottom = pixels(css.paddingBottom);
      const paddingX = pixels(css.paddingLeft) + pixels(css.paddingRight) + borderLeft + borderRight;
      let left = box.left + borderLeft, right = left, bottom = box.top + borderTop + paddingTop;
      // Child boxes catch margins and empty structural rows. Text ranges catch
      // unbroken phone numbers or glyphs that escape an otherwise fitting box.
      for (const child of card.children) if (child.getClientRects().length) {
        const childBox = rect(child);
        bottom = Math.max(bottom, childBox.bottom + pixels(getComputedStyle(child).marginBottom));
      }
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) if (node.textContent.trim()) {
        if (!node.parentElement.getClientRects().length) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const ink of range.getClientRects()) if (ink.width && ink.height) {
          left = Math.min(left, ink.left / scaleX);
          right = Math.max(right, ink.right / scaleX);
          bottom = Math.max(bottom, ink.bottom / scaleY);
        }
      }
      const requiredHeight = bottom - box.top + paddingBottom + borderBottom;
      const overflowX = Math.max(0, card.scrollWidth - card.clientWidth,
        box.left + borderLeft - left, right - box.right + borderRight,
        outer.left - box.left, box.right - outer.right);
      const overflowY = Math.max(0, card.scrollHeight - card.clientHeight,
        requiredHeight - box.height, outer.top - box.top, box.bottom - outer.bottom);
      return {id:card.dataset.announcementGroup || String(index), width:box.width, height:box.height,
        requiredHeight, paddingX, paddingY:paddingTop + paddingBottom + borderTop + borderBottom,
        overflowX, overflowY};
    });
    const overflow = Math.max(0, container.scrollWidth - container.clientWidth,
      container.scrollHeight - container.clientHeight, ...records.flatMap(card => [card.overflowX, card.overflowY]));
    const score = Math.max(...records.map(card => Math.max(card.overflowX / Math.max(1, card.width), card.overflowY / Math.max(1, card.height))))
      + records.reduce((sum, card) => sum + card.overflowX + card.overflowY, 0) / Math.max(1, available) / 10;
    return {fontSize, overflow:overflow <= tolerance ? 0 : overflow, fits:overflow <= tolerance,
      columns, widths:[...widths], cards:records, score};
  }

  function fitAt(fontSize, seed) {
    container.style.setProperty('--notice-font', fontSize + 'px');
    const minimums = cards.map(card => {
      const css = getComputedStyle(card);
      const padding = pixels(css.paddingLeft) + pixels(css.paddingRight) + pixels(css.borderLeftWidth) + pixels(css.borderRightWidth);
      const phoneWidths = [...card.querySelectorAll('.announcement-phone,.announcement-contact bdi[dir="ltr"]')]
        .map(phone => rect(phone).width);
      return padding + Math.max(fontSize * 6, ...phoneWidths, 0);
    });
    let widths = seed || volumes.map(volume => available * volume / volumeTotal);
    widths = distribute(widths, minimums, available);
    let best = measure(fontSize, widths);
    // Six measured redistributions are enough to account for line-wrap steps.
    // A short card donates width only according to its actual unused height.
    for (let pass = 0; pass < 6 && !best.fits; pass++) {
      const wanted = best.cards.map(card => {
        const room = Math.max(1, card.height - card.paddingY);
        const used = Math.max(fontSize, card.requiredHeight - card.paddingY);
        const ratio = Math.max(.25, Math.min(4, used / room));
        return card.paddingX + Math.max(1, card.width - card.paddingX) * Math.pow(ratio, .85) + card.overflowX;
      });
      const candidate = distribute(wanted, minimums, available);
      if (candidate.every((width, index) => Math.abs(width - best.widths[index]) < .5)) break;
      const next = measure(fontSize, candidate);
      if (next.fits || next.score < best.score - .0001) best = next;
      else {
        // A wrap boundary can make the full redistribution overshoot. One
        // smaller step preserves the useful donor estimate without a search.
        const middle = candidate.map((width, index) => (width + best.widths[index]) / 2);
        const halfway = measure(fontSize, middle);
        if (halfway.fits || halfway.score < best.score - .0001) best = halfway;
        else break;
      }
    }
    return best;
  }

  let selected = fitAt(highFont);
  if (!selected.fits && lowFont < highFont) {
    const smallest = fitAt(lowFont, selected.widths);
    selected = smallest;
    if (smallest.fits) {
      let low = lowFont, high = highFont - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = fitAt(middle, selected.widths);
        if (candidate.fits) {selected = candidate; low = middle;}
        else high = middle - 1;
      }
    }
  }
  // Restore the best candidate after any unsuccessful measurement. Synchronous
  // fitting finishes before paint, so it never flashes intermediate sizes.
  apply(selected.fontSize, selected.widths);
  container.dataset.fit = selected.fits ? 'fit' : 'overflow';
  const {score, ...result} = selected;
  return {...result, measurements};
}
