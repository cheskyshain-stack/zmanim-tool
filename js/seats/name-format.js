import { seatsIsSurnameParticle } from './name-sort.js';

export function seatsFormatName(value) {
  return String(value).replace(/\s+/gu, ' ').trim().split(' ').map((word, index) => {
    if (index && word === word.toLocaleLowerCase() && seatsIsSurnameParticle(word)) return word;
    return word.replace(/(^|[^\p{L}\p{M}])(\p{Ll})/gu, (match, before, first, offset) => {
      if (["'", '’'].includes(before) && first === 's' && offset + match.length === word.length) return match;
      return before + first.toLocaleUpperCase();
    });
  }).join(' ');
}
