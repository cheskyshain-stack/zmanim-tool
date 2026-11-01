const seatsNameCollator = new Intl.Collator(['en', 'he'], { sensitivity: 'base', numeric: true, ignorePunctuation: true });
const seatsNameTitles = new Set(['rabbi', 'rav', 'r', 'reb', 'rebbetzin', 'mr', 'mrs', 'ms', 'miss', 'dr', 'הרב', 'הרבנית', 'רבי', 'ר', 'הרהג', 'הגאון']);
const seatsNameSuffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'שליטא', 'זצל', 'זל', 'זצוקל']);
const seatsSurnameParticles = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'du', 'da', 'der', 'den', 'la', 'le', 'ben', 'bar']);
const seatsNameWord = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}]/gu, '');
export const seatsIsSurnameParticle = value => seatsSurnameParticles.has(seatsNameWord(value));

function seatsNameParts(value) {
  const original = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const words = original.split(' ').filter(Boolean);
  const suffixes = [];
  while (words.length > 1 && seatsNameTitles.has(seatsNameWord(words[0]))) words.shift();
  while (words.length > 1 && seatsNameSuffixes.has(seatsNameWord(words.at(-1)))) suffixes.unshift(words.pop());
  return { original, words, suffixes, full: words.join(' '), first: words[0] || '', last: words.at(-1) || '' };
}

export function seatsInitialsName(value) {
  const { original, words, suffixes } = seatsNameParts(value);
  if (words.length < 2) return original;
  let surnameStart = words.length - 1;
  while (surnameStart > 1 && seatsSurnameParticles.has(seatsNameWord(words[surnameStart - 1]))) surnameStart--;
  const initials = words.slice(0, surnameStart).map(word => (word.normalize('NFC').match(/\p{L}\p{M}*/u)?.[0] || word).toLocaleUpperCase());
  const surname = words.slice(surnameStart).map(word => !seatsSurnameParticles.has(seatsNameWord(word)) && word === word.toLocaleLowerCase()
    ? word.replace(/\p{L}/u, letter => letter.toLocaleUpperCase()) : word);
  return [...initials, ...surname, ...suffixes].join(' ');
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
