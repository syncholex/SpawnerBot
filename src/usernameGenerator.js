// Generates realistic Minecraft-style usernames
// No external dependencies - uses markov chains + pattern mixing

const ADJECTIVES = [
  'Swift', 'Dark', 'Cool', 'Epic', 'Wild', 'Silent', 'Shadow', 'Quick', 'Brave', 'Bold',
  'Sharp', 'Lucky', 'Angry', 'Crazy', 'Tiny', 'Fatal', 'Toxic', 'Royal', 'Grand', 'Iron',
  'Storm', 'Frost', 'Blaze', 'Ghost', 'Stealth', 'Ultra', 'Mega', 'Power', 'Rapid', 'Heavy',
  'Sly', 'Fierce', 'Grim', 'Nova', 'Apex', 'Zero', 'Neo', 'Volt', 'Onyx', 'Void',
];

const NOUNS = [
  'Wolf', 'Fox', 'Hawk', 'Bear', 'Lion', 'Tiger', 'Shark', 'Eagle', 'Raven', 'Viper',
  'Blade', 'Arrow', 'Knight', 'Ninja', 'Wizard', 'Hunter', 'Phoenix', 'Dragon', 'Titan', 'Reaper',
  'Cobra', 'Panther', 'Mantis', 'Falcon', 'Lynx', 'Jaguar', 'Spartan', 'Samurai', 'Viking', 'Raider',
  'Storm', 'Fang', 'Claw', 'Fury', 'Spark', 'Flame', 'Frost', 'Shade', 'Wraith', 'Demon',
];

const NAME_PREFIXES = [
  'xX', 'Itz', 'The', 'Mr', 'King', 'Sir', 'Lord', 'Agent', 'i', 'Pz',
  'Pro', 'Noob', 'Not', 'Real', 'Fake', 'Just', 'Only', 'Im', 'Ya', 'Oi',
];

const NAME_SUFFIXES = [
  'Xx', 'YT', 'PvP', 'HD', 'MC', 'GG', 'Pro', 'Bot', 'MC', 'PvE',
  'ez', 'lol', 'Bruh', 'Twitch', '_',
];

const REALISTIC_ROOTS = [
  'alex', 'jake', 'ryan', 'luke', 'max', 'leo', 'sam', 'ben', 'dan', 'tom',
  'jay', 'kai', 'finn', 'cole', 'owen', 'noah', 'evan', 'seth', 'jack', 'mark',
  'mike', 'nick', 'tyler', 'brandon', 'zack', 'aaron', 'connor', 'logan', 'ethan', 'caleb',
];

const STYLES = [
  // AdjectiveNoun style (e.g., SwiftWolf, DarkBlade)
  () => pick(ADJECTIVES) + pick(NOUNS),
  // PrefixName style (e.g., ItzJake, xXAaronXx)
  () => pick(NAME_PREFIXES) + capitalize(pick(REALISTIC_ROOTS)) + maybe(pick(NAME_SUFFIXES), 0.3),
  // Name + numbers (e.g., alex2024, finn_78)
  () => pick(REALISTIC_ROOTS) + maybe('_', 0.4) + randInt(1, 999),
  // Noun + Adjective reversed (e.g., WolfSwift)
  () => pick(NOUNS) + pick(ADJECTIVES),
  // Double noun (e.g., HawkFang, WolfReaper)
  () => pick(NOUNS) + pick(NOUNS),
  // Name + Noun (e.g., JakeWolf, LeoBlade)
  () => capitalize(pick(REALISTIC_ROOTS)) + pick(NOUNS),
  // L33t style (e.g., D4rkW0lf)
  () => leetify(pick(ADJECTIVES) + pick(NOUNS)),
  // Short + numbers (e.g., Zyk_47, Ren99)
  () => pick(REALISTIC_ROOTS).slice(0, 4) + maybe('_', 0.5) + randInt(1, 99),
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
