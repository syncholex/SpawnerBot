// Generates Minecraft-style usernames unlikely to collide with real premium accounts
// Uses invented syllable combinations and game-themed patterns

const ADJECTIVES = [
  'Swift', 'Dark', 'Cool', 'Epic', 'Wild', 'Silent', 'Shadow', 'Quick', 'Brave', 'Bold',
  'Sharp', 'Lucky', 'Crazy', 'Tiny', 'Fatal', 'Toxic', 'Royal', 'Grand', 'Iron',
  'Storm', 'Frost', 'Blaze', 'Ghost', 'Stealth', 'Ultra', 'Mega', 'Power', 'Rapid', 'Heavy',
  'Sly', 'Fierce', 'Grim', 'Nova', 'Apex', 'Zero', 'Neo', 'Volt', 'Onyx', 'Void',
];

const NOUNS = [
  'Wolf', 'Fox', 'Hawk', 'Bear', 'Lion', 'Tiger', 'Shark', 'Eagle', 'Raven', 'Viper',
  'Blade', 'Arrow', 'Knight', 'Ninja', 'Wizard', 'Hunter', 'Phoenix', 'Dragon', 'Titan', 'Reaper',
  'Cobra', 'Panther', 'Mantis', 'Falcon', 'Lynx', 'Jaguar', 'Spartan', 'Samurai', 'Viking', 'Raider',
  'Storm', 'Fang', 'Claw', 'Fury', 'Spark', 'Flame', 'Frost', 'Shade', 'Wraith', 'Demon',
];

// Made-up syllable stems — not real names, but pronounceable
const STEMS = [
  'zyx', 'kry', 'vex', 'nox', 'pyx', 'dax', 'mux', 'glx',
  'thy', 'rux', 'blix', 'snur', 'klax', 'plix', 'druz', 'gorm',
  'thyx', 'krul', 'vyn', 'nurf', 'plox', 'drav', 'skol', 'trel',
  'zorp', 'klux', 'frim', 'gralt', 'spok', 'twyn', 'bruv', 'skarn',
  'qex', 'zult', 'plam', 'trix', 'blon', 'krev', 'stux', 'phlox',
];

const SUFFIX_PARTS = [
  'ix', 'us', 'on', 'ar', 'ek', 'ul', 'ok', 'in',
  'ax', 'or', 'en', 'is', 'al', 'un', 'ir', 'os',
];

const STYLES = [
  // AdjectiveNoun (e.g., SwiftWolf, GrimViper)
  () => pick(ADJECTIVES) + pick(NOUNS),
  // NounAdjective reversed (e.g., WolfSwift)
  () => pick(NOUNS) + pick(ADJECTIVES),
  // Double noun (e.g., HawkFang, WolfReaper)
  () => pick(NOUNS) + pick(NOUNS),
  // Stem + suffix (e.g., Krynox, Vexar)
  () => capitalize(pick(STEMS)) + pick(SUFFIX_PARTS),
  // Adjective + stem (e.g., DarkRux, FrostVyn)
  () => pick(ADJECTIVES) + capitalize(pick(STEMS)),
  // Stem + noun (e.g., ZyxWolf, PlixDragon)
  () => capitalize(pick(STEMS)) + pick(NOUNS),
  // L33t style (e.g., D4rkW0lf)
  () => leetify(pick(ADJECTIVES) + pick(NOUNS)),
  // Stem + numbers (e.g., Kry_47, Vex99)
  () => pick(STEMS) + maybe('_', 0.5) + randInt(1, 999),
  // Two stems combined (e.g., Krynok, Vexdruz)
  () => capitalize(pick(STEMS)) + pick(STEMS).slice(0, 3),
  // Noun + stem suffix (e.g., Wolfek, Dragonir)
  () => pick(NOUNS) + maybe(pick(SUFFIX_PARTS), 0.6),
];

function generate(count = 1) {
  const names = new Set();
  let attempts = 0;
  while (names.size < count && attempts < count * 10) {
    const name = generateOne();
    if (name.length >= 3 && name.length <= 16) {
      names.add(name);
    }
    attempts++;
  }
  return [...names];
}

function generateOne() {
  const style = pick(STYLES);
  return style();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maybe(value, chance) {
  return Math.random() < chance ? value : '';
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function leetify(str) {
  const map = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
  let result = '';
  for (const ch of str) {
    if (Math.random() < 0.3 && map[ch.toLowerCase()]) {
      result += map[ch.toLowerCase()];
    } else {
      result += ch;
    }
  }
  return result;
}

module.exports = { generate, generateOne };
