// Spells a name typed in English letters the way it sounds in Hindi ("Samarth" -> "समर्थ"), so the
// Hindi screens can greet people without anyone typing a second spelling. It follows common Indian
// name romanisation; unusual spellings come out phonetic rather than dictionary-correct.

const CONSONANTS: [string, string][] = [
  ['ksh', 'क्ष'], ['chh', 'छ'], ['shh', 'श'],
  ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'], ['ph', 'फ'], ['bh', 'भ'],
  ['sh', 'श'], ['ck', 'क'], ['gy', 'ज्ञ'],
  ['k', 'क'], ['g', 'ग'], ['c', 'क'], ['j', 'ज'], ['t', 'त'], ['d', 'द'], ['n', 'न'], ['p', 'प'], ['b', 'ब'],
  ['m', 'म'], ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'], ['s', 'स'], ['h', 'ह'],
  ['f', 'फ़'], ['z', 'ज़'], ['q', 'क'], ['x', 'क्स'],
];

// [letters, standalone vowel, sign after a consonant]
const VOWELS: [string, string, string][] = [
  ['aa', 'आ', 'ा'], ['ee', 'ई', 'ी'], ['ii', 'ई', 'ी'], ['oo', 'ऊ', 'ू'], ['uu', 'ऊ', 'ू'],
  ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ou', 'औ', 'ौ'],
  ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो'],
];

/** Before these, an n or m after a vowel is a nasal dot: Sanjay -> संजय, Ambika -> अंबिका. */
const NASAL_BEFORE = new Set(['क', 'ख', 'ग', 'घ', 'च', 'छ', 'ज', 'झ', 'त', 'थ', 'द', 'ध', 'प', 'फ', 'ब', 'भ']);
const HALANT = '्';

function match<T extends [string, ...string[]]>(list: T[], word: string, at: number): T | undefined {
  return list.find(([latin]) => word.startsWith(latin, at));
}

function word(w: string): string {
  let out = '';
  let afterConsonant = false; // the last thing written is a consonant still waiting for its vowel
  let afterVowel = false;
  let vowelsSeen = 0;
  let i = 0;
  while (i < w.length) {
    const c = match(CONSONANTS, w, i);
    if (c) {
      const next = match(CONSONANTS, w, i + c[0].length);
      if ((c[0] === 'n' || c[0] === 'm') && afterVowel && next && NASAL_BEFORE.has(next[1])) {
        out += 'ं';
        afterConsonant = false;
      } else {
        if (afterConsonant) out += HALANT;
        out += c[1];
        afterConsonant = true;
      }
      afterVowel = false;
      i += c[0].length;
      continue;
    }
    const v = match(VOWELS, w, i);
    if (v) {
      const rest = i + v[0].length;
      const end = rest === w.length;
      const lastConsonant = match(CONSONANTS, w, rest);
      const beforeLastConsonant = !!lastConsonant && rest + lastConsonant[0].length === w.length;
      // Romanised names drop the long a that Hindi writes: Raj -> राज, Vikas -> विकास, Kumar -> कुमार,
      // Gopal -> गोपाल; but Mohan, Neelam and Sanjay keep the short one.
      const longA = afterConsonant && v[0] === 'a' && beforeLastConsonant &&
        (vowelsSeen === 0 || ['s', 'sh', 'r', 'l'].includes(lastConsonant![0]));
      // Names ending in a or i are usually said long: Sarla -> सरला, Lakshmi -> लक्ष्मी.
      const latin = longA || (end && v[0] === 'a' && afterConsonant) ? 'aa' : end && v[0] === 'i' ? 'ee' : v[0];
      vowelsSeen += 1;
      const [, standalone, sign] = match(VOWELS, latin, 0)!;
      out += afterConsonant ? sign : standalone;
      afterConsonant = false;
      afterVowel = true;
      i += v[0].length;
      continue;
    }
    out += w[i];
    afterConsonant = false;
    afterVowel = false;
    i += 1;
  }
  return out;
}

/** Titles and borrowed English words that sound rules cannot spell. */
const FIXED: Record<string, string> = {
  madam: 'मैडम', mam: 'मैम', maam: 'मैम', sir: 'सर', ji: 'जी', didi: 'दीदी', bhaiya: 'भैया', aunty: 'आंटी',
  auntie: 'आंटी', uncle: 'अंकल', mummy: 'मम्मी', papa: 'पापा', mr: 'श्री', mrs: 'श्रीमती', dr: 'डॉ.',
  singh: 'सिंह', test: 'टेस्ट', user: 'यूज़र',
};

export function toDevanagari(name: string): string {
  if (/[ऀ-ॿ]/.test(name)) return name; // already written in Hindi
  return name.toLowerCase().replace(/[a-z]+/g, (w) => FIXED[w] ?? word(w));
}
