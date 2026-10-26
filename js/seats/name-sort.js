const seatsNameCollator = new Intl.Collator(['en', 'he'], { sensitivity: 'base', numeric: true, ignorePunctuation: true });
const seatsNameTitles = new Set(['rabbi', 'rav', 'r', 'reb', 'rebbetzin', 'mr', 'mrs', 'ms', 'miss', 'dr', 'הרב', 'הרבנית', 'רבי', 'ר', 'הרהג', 'הגאון']);
const seatsNameSuffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'שליטא', 'זצל', 'זל', 'זצוקל']);
const seatsNameWord = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}]/gu, '');

function seatsNameParts(value) {
  const original = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const words = original.split(' ').filter(Boolean);
  while (words.length > 1 && seatsNameTitles.has(seatsNameWord(words[0]))) words.shift();
  while (words.length > 1 && seatsNameSuffixes.has(seatsNameWord(words.at(-1)))) words.pop();
  return { original, full: words.join(' '), first: words[0] || '', last: words.at(-1) || '' };
}

export function seatsCompareNames(a, b, order = 'first') {
  const left = seatsNameParts(a), right = seatsNameParts(b), field = order === 'last' ? 'last' : 'first';
  return seatsNameCollator.compare(left[field], right[field])
    || seatsNameCollator.compare(left.full, right.full)
    || seatsNameCollator.compare(left.original, right.original);
}

export function seatsSortPeople(people, order = 'first') {
  return [...people].sort((a, b) => seatsCompareNames(a.name, b.name, order));
}
