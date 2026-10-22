import dictionaries from './words.json' with { type: 'json' };
export const RULES_VERSION = 1;
export function wordStream(seed, pack) {
  let state = seed >>> 0;
  let previous = '';
  return () => {
    let word;
    do {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      word = dictionaries[pack][(state >>> 0) % 64];
    } while (word === previous);
    previous = word;
    return word;
  };
}
export function replay(run, events) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 2400) throw new Error('Invalid event count');
  const next = wordStream(run.seed, run.pack);
  let word = next(), input = '', attempts = 0, correct = 0, words = 0, committed = 0, previousTime = -1;
  const duration = run.mode * 1000;
  for (const event of events) {
    if (!Array.isArray(event) || event.length !== 2) throw new Error('Invalid event');
    const [time, key] = event;
    if (!Number.isInteger(time) || time < 0 || time >= duration || time < previousTime) throw new Error('Invalid event time');
    if (typeof key !== 'string' || key.length !== 1 || !/^[\x20-\x7e\b]$/.test(key)) throw new Error('Invalid key');
    if (previousTime === -1 && (time !== 0 || key === ' ' || key === '\b')) throw new Error('Invalid first event');
    previousTime = time;
    if (key === '\b') { input = input.slice(0, -1); continue; }
    attempts++;
    const character = key.toLowerCase();
    if (character === ' ') {
      if (input !== word) continue;
      correct++; words++; committed += word.length + 1;
      input = ''; word = next(); continue;
    }
    if (input.length < word.length && word[input.length] === character) correct++;
    if (input.length < word.length + 4) input += character;
  }
  let prefix = 0;
  while (prefix < input.length && prefix < word.length && input[prefix] === word[prefix]) prefix++;
  return { wpm: Math.min(999, Math.floor((committed + prefix) * 12000 / duration)),
    accuracy: attempts ? Math.floor(correct * 100 / attempts) : 100, words };
}
