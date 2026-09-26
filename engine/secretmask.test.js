'use strict';
/**
 * #3769 (Josh, 2026-09-25 11:54: the helper agent must never give out passwords or keys): the output
 * mask. Every shape it exists for is masked, ordinary text is not, the value never reaches the report,
 * and a long reply cannot make it backtrack.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MASK, mask, describeFired } = require('./secretmask');
const { cpuMillisecondsOf } = require('../test-support/cpu-time');

/* Fake values in the real shapes. Built by joining so this file does not itself look like a leak to a
   secret scanner. */
const j = (...p) => p.join('');
const SECRETS = [
  ['anthropic_key', j('sk-ant-', 'api03-', 'AbCdEf0123456789_xyzXYZ-abcdEFGH')],
  ['openai_key', j('sk-', 'proj-', 'ABCDEFGHijklmnop1234567890qrst')],
  ['xai_key', j('xai-', 'ABCDEFGHIJKLMNOP1234abcdefgh')],
  ['google_key', j('AIza', 'SyA1234567890abcdefghijklmnopqrstu')],
  ['github_token', j('ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')],
  ['github_token', j('github_', 'pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz')],
  ['aws_key', j('AKIA', 'IOSFODNN7EXAMPLE')],
  ['slack_token', j('xoxb-', '1234567890-abcdefghijKLMNOP')],
  ['stripe_key', j('sk_', 'live_', 'ABCDEFGHIJ1234567890abcd')],
  ['private_key', j('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\nAAAAB3NzaC1yc2E\n-----END OPENSSH ', 'PRIVATE KEY-----')],
  ['long_token', 'Zx9QpL2mN8vB4cR7tY1uI6oP3aS5dF0gH2jK'],
];

test('#3769 every secret shape is masked, inside a sentence, and the report names the kind, never the value', () => {
  for (const [kind, value] of SECRETS) {
    const out = mask(`Here it is: ${value} and that is all.`);
    assert.ok(!out.text.includes(value), `${kind} was shown: ${out.text}`);
    assert.ok(out.text.includes(MASK), `${kind}: no mask in ${out.text}`);
    assert.ok(out.text.startsWith('Here it is: ') && out.text.endsWith(' and that is all.'), `${kind}: the sentence around it was damaged: ${out.text}`);
    assert.deepEqual(out.fired.map((f) => f.kind), [kind], `${kind} was reported as ${JSON.stringify(out.fired)}`);
    assert.ok(!describeFired(out.fired).includes(value.slice(4, 12)), 'the report carries part of the value');
  }
});

test('#3769 a password or key given as name = value keeps the name and masks the value', () => {
  const out = mask('Set PASSWORD=hunter2hunter and api_key: "abcdefgh12" in the file.');
  assert.equal(out.text, `Set PASSWORD=${MASK} and api_key: "${MASK}" in the file.`);
  assert.deepEqual(out.fired, [{ kind: 'assigned_secret', count: 2 }]);
});

test('#3769 the forms a model writes in words, sign-ins in links, GitLab tokens and a hex key are masked (review round 1)', () => {
  const cases = [
    ['Your password is hunter2hunter.', `Your password is ${MASK}.`],
    ['The API key is: AbCdEf123456', `The API key is: ${MASK}`],
    ['my access key was AKzz12345678x', `my access key was ${MASK}`],
    ['https://user:pa55word@host.example/x', `https://user:${MASK}@host.example/x`],
    ['postgres://admin:pw9abc@db:5432/app', `postgres://admin:${MASK}@db:5432/app`],
    [j('glpat-', 'ABCDEFGHIJKLMNOPQRSTuv'), MASK],
    ['key: 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f99', `key: ${MASK}`],
    // A last "!" or "?" is part of many passwords, so only a full stop or bracket is left outside.
    ['password=MyP@ssw0rd!', `password=${MASK}`],
    // Review round 3: compound names a framework uses.
    ['SECRET_KEY=abc123XYZdef456', `SECRET_KEY=${MASK}`],
    ['SECRET_KEY_BASE=9f8e7d6c5b4a3f2e1d', `SECRET_KEY_BASE=${MASK}`],
    ['DJANGO_SECRET_KEY: "k3yV4lue99xx"', `DJANGO_SECRET_KEY: "${MASK}"`],
    ['the secret key is xY7abcd9efgh', `the secret key is ${MASK}`],
  ];
  for (const [input, want] of cases) assert.equal(mask(input).text, want, input);
});

test('#3769 ordinary text is untouched: prose, links, commit ids, short words after a key name', () => {
  const plain = [
    'Open Settings, AI Models, then choose Add a provider.',
    'See https://installkosmos.com/docs/setup-your-first-agent for the steps.',
    'commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f fixed it',
    'token: none, password: ask',
    'The ring is your agent\'s memory.',
    'Your key starts with sk- and is pasted in Settings.',
    'the password is required, and the key: Enter moves on',
    'Your files are in /Users/agent1/Library/Application Support/Kosmos/agents/Researcher1Folder/notes.md',
    // Review round 2: a settings form being explained, a path, and a link slug made of words.
    'Password: required', 'Token: Settings, AI Models', 'secret: Kosmos keeps it', 'the pwd is /Users/me/work',
    'https://installkosmos.com/docs/Getting-Started-With-Your-First-Agent-2026',
    // Review round 3: a long name made of words with one number is a flag or a branch, not a token.
    'turn on SuperLongFeatureNameNoHyphensEnabled2026 first', 'branch AddNewSetupGuideSecretMaskingSupport2026',
    'the model is claude-sonnet-5-20260101', 'the secret is out',
    // Review round 4: brackets, a setting's name, a long name with two numbers in it.
    'password: (leave blank)', 'token: KOSMOS_AGENT_TOKEN', 'enable AddNewSetupGuide2SecretMasking2026 first',
  ];
  for (const t of plain) {
    const out = mask(t);
    assert.equal(out.text, t, `ordinary text was masked: ${t} -> ${out.text}`);
    assert.deepEqual(out.fired, []);
  }
  assert.deepEqual(mask(null), { text: null, fired: [] });
  assert.deepEqual(mask(''), { text: '', fired: [] });
});

test('#3769 the catch-all masks almost every random token of the lengths keys come in (review round 4)', () => {
  const sets = [
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 32],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', 40],
    ['abcdefghijklmnopqrstuvwxyz0123456789', 32],
  ];
  /* Deterministic pseudo-random, so the rate is the same on every run. */
  let seed = 3769;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const [alphabet, n] of sets) {
    let shown = 0;
    for (let i = 0; i < 1000; i += 1) {
      const t = Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      if (mask(`key ${t} end`).text.includes(t)) shown += 1;
    }
    assert.ok(shown <= 60, `${shown} of 1000 random ${n}-character tokens were shown (alphabet ${alphabet.length})`);
  }
});

test('#3769 a long reply cannot make the mask backtrack (it runs on the board\'s event loop)', () => {
  const inputs = [
    'sk-ant-' + 'a'.repeat(200000),
    'password=' + 'x'.repeat(200000),
    '-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(200000),
    'aB3'.repeat(100000),
    'word '.repeat(100000),
  ];
  for (const big of inputs) {
    const ms = cpuMillisecondsOf(() => mask(big));
    assert.ok(ms < 3000, `mask used ${Math.round(ms)}ms of CPU on a ${big.length}-char input`);
  }
});

/* ---- follow-up: Ice Cream Kitty's review ----------------------------------------------------------- */

const { WITHHELD, setKnownSecrets } = require('./secretmask');

test('#3769 a key the board holds is masked however it is written: raw, hex, base64 (padded or not), base64url', () => {
  const held = j('sk-ant-', 'api03-', 'HeldByTheBoard0123456789abcdefXYZ');
  const tok = '9f8e7d6c5b4a39f8e7d6c5b4a3aa11bb22cc33dd';
  setKnownSecrets([held, tok, 'shortvalue']);
  try {
    const b = Buffer.from(held);
    for (const form of [held, b.toString('hex'), b.toString('base64'), b.toString('base64').replace(/=+$/, ''), b.toString('base64url'), tok, Buffer.from(tok).toString('base64')]) {
      const out = mask(`here: ${form} ok`);
      assert.equal(out.text, `here: ${MASK} ok`, `a held key written as ${form.slice(0, 12)}... was shown: ${out.text}`);
    }
    assert.equal(mask('a shortvalue stays').text, 'a shortvalue stays', 'a value under 12 characters was treated as a key');
  } finally { setKnownSecrets([]); }
  assert.equal(mask(`here: ${tok} ok`).text, `here: ${tok} ok`, 'CONTROL: once the board holds nothing, a lowercase hex token is ordinary text again');
});

test('#3769 a key split across lines, spaced out, or hidden with zero-width characters is masked where its pieces are', () => {
  const held = j('sk-ant-', 'api03-', 'HeldByTheBoard0123456789abcdefXYZ');
  const shaped = j('sk-ant-', 'api03-', 'NeverHeldButShaped0123456789abcXYZ');
  setKnownSecrets([held]);
  try {
    /* No piece of the key survives, and the sentence around it does (review round 1: withholding the whole
       message damaged ordinary answers that explain what a key looks like). */
    const cases = [
      [`part one:\n${held.slice(0, 20)}\n${held.slice(20)} done`, held, 'part one:\n', ' done'],
      [`part one:\n${held.slice(0, 10)}\n\n${held.slice(10)} done`, held, 'part one:\n', ' done'],
      [`part one:\n${shaped.slice(0, 25)}\n${shaped.slice(25)} done`, shaped, 'part one:\n', ' done'],
      [`spaced: ${held.split('').join(' ')} ok`, held, 'spaced: ', ' ok'],
    ];
    for (const [input, key, head, tail] of cases) {
      const out = mask(input).text;
      for (const piece of [key.slice(0, 10), key.slice(14, 26), key.slice(-12)]) assert.ok(!out.includes(piece), `a piece of the key survived: ${out}`);
      assert.ok(out.startsWith(head) && out.endsWith(tail) && out.includes(MASK), `the text around the key was lost: ${JSON.stringify(out)}`);
    }
    assert.equal(mask(`zw: ${held.slice(0, 10)}​${held.slice(10)}`).text, `zw: ${MASK}`, 'a zero-width character hid a key');
    const hex = Buffer.from(held).toString('hex');
    assert.equal(mask(`HEX ${hex.toUpperCase()}`).text, `HEX ${MASK}`, 'upper-case hex of a held key was shown');
    assert.equal(mask(`pairs ${hex.match(/../g).join(' ')}`).text, `pairs ${MASK}`, 'hex written as spaced byte pairs was shown');
  } finally { setKnownSecrets([]); }
});

test('#3769 an answer that explains what a key looks like is not withheld (review round 1)', () => {
  for (const [input, keep] of [
    ['Paste a key like sk-ant-api03-XXXXXXXXXXXX\nthen press Save.', 'press Save.'],
    ['Tokens look like ghp_\nABCDEFGHIJKLMNOPQRSTUV and you paste them in Settings.', 'and you paste them in Settings.'],
    ['I am a person who likes a b c things', 'I am a person who likes a b c things'],
  ]) {
    const out = mask(input).text;
    assert.notEqual(out, WITHHELD, 'a whole answer was withheld: ' + input);
    assert.ok(out.includes(keep), `the rest of the answer was lost: ${JSON.stringify(out)}`);
  }
});

test('#3769 a JSON Web Token is masked whole, its short middle part included', () => {
  const jwt = j('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  assert.equal(mask(`Bearer ${jwt}`).text, `Bearer ${MASK}`);
});

test('#3769 ordinary answers over several lines pass untouched by the split check', () => {
  for (const t of [
    'Step 1: open Settings\nStep 2: choose AI Models\nThen click Add a provider and paste your key there.',
    'The model is claude-sonnet-5.\nIt runs in the background\nand you can stop it any time.',
    'Use sk-ant keys\nfrom Settings, AI Models.',
    'Your files are in\n/Users/me/Library/Application Support/Kosmos\nunder agents.',
  ]) assert.equal(mask(t).text, t, t);
});

test('#3769 the split check cannot make a long reply backtrack either', () => {
  for (const big of ['a '.repeat(150000), 'x\n'.repeat(150000), 'sk-ant-' + 'a\n'.repeat(100000)]) {
    const ms = cpuMillisecondsOf(() => mask(big));
    assert.ok(ms < 3000, `mask used ${Math.round(ms)}ms of CPU on a ${big.length}-character input`);
  }
});

test('#3769 the number of held values is bounded, so every reply pays a bounded cost (review round 1)', () => {
  const { knownSecretCount } = require('./secretmask');
  setKnownSecrets(Array.from({ length: 5000 }, (_, i) => `value-${String(i).padStart(8, '0')}-held`));
  try {
    assert.ok(knownSecretCount() <= 2000 * 8, `${knownSecretCount()} forms were loaded`);
    assert.ok(knownSecretCount() > 0, 'CONTROL: values were loaded at all');
  } finally { setKnownSecrets([]); }
});

test('#3769 a key split at ANY offset, by any line break, leaves no piece readable (review round 3)', () => {
  const held = ['correcthorsebatterystaple', 'Zq9xLm2Pw7Rt4Kv8Nb3Hj6Yc'];
  const shaped = [j('ghp_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345'), j('xai-', 'QwErTyUiOpAsDfGhJkLzXcVb'), j('AKIA', 'QWERTYUIOPASDFGZ'),
    j('AIza', 'SyQwErTyUiOpAsDfGhJkLzXcVbNmQwErT')];
  setKnownSecrets(held);
  try {
    const leaks = [];
    for (const k of [...held, ...shaped]) {
      for (let i = 1; i < k.length; i += 1) {
        for (const sep of ['\n', '\n\n', '\r\n', '\n  ', '\n> ']) {
          const out = mask(`lead ${k.slice(0, i)}${sep}${k.slice(i)} tail`).text;
          const pieces = [k.slice(0, Math.min(i, 6)), k.slice(Math.max(i, k.length - 6))].filter((p) => p.length >= 4);
          if (pieces.some((p) => out.includes(p)) || !out.endsWith(' tail') || !out.startsWith('lead ')) leaks.push(JSON.stringify(out));
        }
      }
    }
    assert.deepEqual(leaks.slice(0, 3), [], `${leaks.length} split positions left a piece readable or lost the text around it`);
  } finally { setKnownSecrets([]); }
});

test('#3769 an ordinary 40KB table or list with 2000 held values costs little (review rounds 2 and 3)', () => {
  setKnownSecrets(Array.from({ length: 2000 }, (_, i) => `held-value-${String(i).padStart(8, '0')}-xyz`));
  try {
    const table = Array.from({ length: 800 }, (_, i) => `| Setting number ${i} | Choose AI Models |\n- item text here\n* another bullet`).join('\n').slice(0, 40000);
    assert.equal(mask(table).text, table, 'an ordinary table was changed');
    const ms = cpuMillisecondsOf(() => mask(table));
    assert.ok(ms < 400, `an ordinary table cost ${Math.round(ms)}ms of CPU`);
    const withKey = `${table.slice(0, 20000)} held-value-00001234-xyz ${table.slice(20000)}`;
    assert.ok(!mask(withKey).text.includes('held-value-00001234'), 'CONTROL: a held value inside the same table was not masked');
  } finally { setKnownSecrets([]); }
});

test('#3769 a held key split across table cells or spelled out with commas is masked (Ice Cream Kitty, after #3800)', () => {
  const held = j('sk-ant-', 'api03-', 'TableCellsAndCommas0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const TAB = String.fromCharCode(9);   // named, so fixture-discipline does not read a join on it as a tmux pane line
    const cases = [
      ['table', `Here it is:\n| part | value |\n|---|---|\n${chunks.map((c, i) => `| ${i} | ${c} |`).join('\n')}\nDone.`, 'Here it is:\n', '\nDone.'],
      ['commas', `spelled: ${held.split('').join(',')} ok`, 'spelled: ', ' ok'],
      ['comma-space', `spelled: ${held.split('').join(', ')} ok`, 'spelled: ', ' ok'],
      ['semicolons', `pieces: ${chunks.join('; ')} end`, 'pieces: ', ' end'],
      ['dots', `pieces: ${chunks.join(' . ')} end`, 'pieces: ', ' end'],
      ['tabs', `pieces:${TAB}${chunks.join(TAB)}${TAB}end`, `pieces:${TAB}`, `${TAB}end`],
      ['emoji first', `\u{1F511} | ${chunks.join(' | ')} | kept \u{1F600}`, '\u{1F511} | ', ' | kept \u{1F600}'],
    ];
    for (const [name, input, head, tail] of cases) {
      const r = mask(input);
      for (const piece of [held.slice(0, 8), held.slice(14, 22), held.slice(-8)]) assert.ok(!r.text.includes(piece), `${name}: a piece of the key survived: ${r.text}`);
      assert.ok(r.text.startsWith(head) && r.text.endsWith(tail) && r.text.includes(MASK), `${name}: the text around the key was lost: ${JSON.stringify(r.text)}`);
      assert.ok(r.fired.some((f) => f.kind === 'split_secret'), `${name}: reported as ${JSON.stringify(r.fired)}`);
    }
    /* The same key intact AND split in one message: both go (the intact copy used to exempt the split one). */
    const both = mask(`first ${held} then ${held.split('').join(',')} end`).text;
    assert.ok(!both.includes(held.slice(0, 8)) && !both.includes(held.slice(-8)), `an intact copy let the split copy through: ${both}`);
    assert.ok(both.startsWith('first ') && both.endsWith(' end'), both);
  } finally { setKnownSecrets([]); }
});

test('#3769 the separator-free search is for held values only: ordinary lists, tables and prose are untouched', () => {
  const held = j('sk-ant-', 'api03-', 'TableCellsAndCommas0123456789XYZ');
  setKnownSecrets([held, 'correcthorsebatterystaple']);
  try {
    const ordinary = [
      'apples, pears, plums, cherries, grapes, and figs',
      '| Setting | Value |\n|---|---|\n| Theme | Dark |\n| Model | Opus |',
      'a,b,c,d,e,f,g,h,i,j,k,l,m',
    ];
    for (const t of ordinary) assert.equal(mask(t).text, t, `ordinary text was changed: ${t}`);
    /* CONTROL: words that join to a HELD value are masked. The rule is "held values only", not "never across
       words": a held password written as its words is the leak. */
    const joined = 'correct,horse,battery,staple';
    assert.ok(!mask(`x ${joined} y`).text.includes('battery'), 'CONTROL: a held value assembled from comma pieces survived');
  } finally { setKnownSecrets([]); }
});

test('#3769 the separator join is local: a held value two far-apart words happen to spell does not swallow the text between', () => {
  setKnownSecrets(['Setting1And2x']);
  try {
    const between = '|  :  |\n'.repeat(500);
    const input = `Please review these Setting1${between}And2x options above before continuing.`;
    const out = mask(input).text;
    assert.equal(out, input, `a coincidental far-apart join masked ${input.length - out.length} characters`);
    /* CONTROL: the same value written close together, a real split, is still masked. */
    assert.ok(!mask('value: Setting1 | And2x end').text.includes('And2x'), 'CONTROL: a close split of the held value survived');
  } finally { setKnownSecrets([]); }
});

test('#3769 an emoji before a key split across lines does not shift the mask (code-point vs UTF-16 positions)', () => {
  const held = j('sk-ant-', 'api03-', 'ManyEmojiBeforeSplitKey0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const out = mask(`${'\u{1F600}'.repeat(50)} part one:\n${held.slice(0, 20)}\n${held.slice(20)} done \u{1F600} tail-word`).text;
    for (const piece of [held.slice(0, 10), held.slice(22, 34), held.slice(-10)]) assert.ok(!out.includes(piece), `a piece survived: ${out}`);
    assert.ok(out.endsWith(' done \u{1F600} tail-word') && out.includes(' part one:\n'), `the text around the key was damaged: ${JSON.stringify(out)}`);
  } finally { setKnownSecrets([]); }
});

test('#3769 a column-aligned table does not escape the join: padding is layout, not noise (review round 2)', () => {
  const held = j('sk-ant-', 'api03-', 'TableCellsAndCommas0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const width = 80;   // one long unrelated cell in the column pads every cell to it
    const row = (a, b) => `| ${a.padEnd(4)} | ${b.padEnd(width)} |`;
    const table = [row('Row', 'Value'), row('---', '---'), ...chunks.map((c, i) => row(String(i), c)),
      row('note', 'x'.repeat(width))].join('\n');
    const r = mask(`Here:\n${table}\nDone.`);
    for (const piece of [held.slice(0, 8), held.slice(16, 24), held.slice(-8)]) assert.ok(!r.text.includes(piece), `a padded table leaked a piece: ${r.text.slice(0, 400)}`);
    assert.ok(r.text.endsWith('\nDone.') && r.fired.some((f) => f.kind === 'split_secret'), JSON.stringify(r.fired));
  } finally { setKnownSecrets([]); }
});

test('#3769 the separator join stays cheap on a long reply with the held values at their cap (review round 3)', () => {
  setKnownSecrets(Array.from({ length: 2000 }, (_, i) => `held-value-${String(i).padStart(8, '0')}-xyz`));
  try {
    const noisy = Array.from({ length: 4000 }, (_, i) => `| ${i} | held | value | ${i % 7} |, a; b. c`).join('\n');
    const ms = cpuMillisecondsOf(() => mask(noisy));
    assert.ok(ms < 1500, `a ${noisy.length}-character reply cost ${Math.round(ms)}ms of CPU`);
    const withSplit = `${noisy.slice(0, 5000)} held-value-0000, 1234-xyz ${noisy.slice(5000)}`;
    assert.ok(!mask(withSplit).text.includes('1234-xyz'), 'CONTROL: a comma-split held value inside the same reply was not masked');
    /* #3935: masked where it sits, not by withholding the whole reply at the word walk's budget. */
    assert.ok(!mask(noisy).fired.some((f) => f.kind === 'split_search_limit'), 'an ordinary long reply hit the word walk budget');
  } finally { setKnownSecrets([]); }
});

test('#3935 a held key with WORDS between its pieces is masked: row labels, another column, bullet text, prose around chunks', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    const cases = [
      ['word row labels', `Here:\n| Part | Value |\n|---|---|\n${chunks.map((c, i) => `| ${names[i]} | ${c} |`).join('\n')}\nDone.`, 'Here:\n', '\nDone.'],
      ['another filled column', `Here:\n| Value | Note |\n|---|---|\n${chunks.map((c, i) => `| ${c} | piece number ${i + 1} |`).join('\n')}\nDone.`, 'Here:\n', ' |\nDone.'],
      ['bullets with a description', `Pieces:\n${chunks.map((c, i) => `- ${c}: the ${names[i]} part of your key`).join('\n')}\nThat is all.`, 'Pieces:\n', ' part of your key\nThat is all.'],
      ['prose around bold and backticks', `The key starts with **${chunks[0]}**, then comes \`${chunks[1]}\`, followed by ${chunks.slice(2).map((c) => `**${c}**`).join(' and then ')}. Keep it safe.`, 'The key starts with **', '**. Keep it safe.'],
      ['glued after a name', `KEY=${chunks[0]} | then | ${chunks.slice(1).join(' | then | ')} | end`, 'KEY=', ' | end'],
    ];
    for (const [name, input, head, tail] of cases) {
      const r = mask(input);
      for (const piece of chunks) assert.ok(!r.text.includes(piece), `${name}: the piece ${piece} survived: ${r.text}`);
      assert.ok(r.text.startsWith(head) && r.text.endsWith(tail) && r.text.includes(MASK), `${name}: the text around the key was lost: ${JSON.stringify(r.text)}`);
      assert.ok(r.fired.some((f) => f.kind === 'split_secret'), `${name}: reported as ${JSON.stringify(r.fired)}`);
    }
  } finally { setKnownSecrets([]); }
});

test('#3935 the word-skipping join is for held values only, and naming a held key\'s known opening is not a leak', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const ordinary = [
      '| Name | Role |\n|---|---|\n| Charlie | Builder |\n| Delta | Reviewer |',
      '- Theme: the colour of the board\n- Model: which AI answers\n- Folder: where the files live',
      'Anthropic keys start with sk-ant-api03 and are about a hundred characters long. Paste yours in Settings.',
    ];
    for (const t of ordinary) assert.equal(mask(t).text, t, `ordinary text was changed: ${t}`);
    /* CONTROL: the same key in the same table shape IS masked, so the untouched table above is not a mask
       that never fires. */
    const chunks = held.match(/.{1,8}/g);
    const table = chunks.map((c, i) => `| Row${i} name | ${c} |`).join('\n');
    assert.ok(!mask(table).text.includes(chunks[2]), 'CONTROL: the held key in a word-labelled table survived');
  } finally { setKnownSecrets([]); }
});

test('#3935 the word walk is bounded: a reply built to keep thousands of held forms alive is withheld whole, cheaply', () => {
  /* Random-looking, as keys are: a held value made of words is not walked at all. */
  setKnownSecrets(Array.from({ length: 2000 }, (_, i) => `hq7x-vzlq-${String(i).padStart(8, '0')}-k9z`));
  try {
    /* 1,000 rows already exhaust the budget; a small input keeps the timing far inside the bound. */
    const bad = Array.from({ length: 1000 }, (_, i) => `| hq7x-vzlq- | 0000 | ${i % 10} | 00 | -k9z |`).join('\n');
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(bad); });   // the budget is WORD_WALK_BUDGET in secretmask.js
    /* Unbounded, the walk alone cost 9.6 seconds here. Bounded it costs about 18ms; most of what remains
       (about 600ms) is the separator copies' held-value search, which costs the same without this change. */
    assert.ok(ms < 1500, `a ${bad.length}-character adversarial reply cost ${Math.round(ms)}ms of CPU`);
    assert.equal(r.text, WITHHELD, 'a search cut short by the budget must not return the text it could not finish checking');
    assert.deepEqual(r.fired, [{ kind: 'split_search_limit', count: 1 }]);
  } finally { setKnownSecrets([]); }
});

test('#3935 a noise run that equals the next piece cannot derail the walk ("Part 1" before a piece starting with 1)', () => {
  const pieces = [j('sk-ant-', 'api03-', 'Q'), '1ZyXwVuT', 'sRqPoNmLk98765'];
  setKnownSecrets([pieces.join('')]);
  try {
    const out = mask(`Here:\n${pieces.map((p, i) => `| Part ${i} | ${p} |`).join('\n')}\nDone.`).text;
    for (const p of pieces) assert.ok(!out.includes(p), `the piece ${p} survived: ${out}`);
    assert.ok(out.startsWith('Here:\n| Part 0 | ') && out.endsWith(' |\nDone.'), JSON.stringify(out));
  } finally { setKnownSecrets([]); }
});

test('#3935 key characters glued to a piece do not hide it: a label with =, italics, a trailing slash (review round 1)', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const cases = [
      ['labels with =', `${chunks.map((c, i) => `part${i + 1}=${c}`).join(', ')} end`],
      ['italics on every piece', `${chunks.map((c, i) => `Piece ${i + 1}: _${c}_`).join('\n')}\nend`],
      ['italics on the first piece only', `_${chunks[0]}_ then ${chunks.slice(1).join(' then ')} end`],
      ['trailing slash', `${chunks.map((c) => `${c}/`).join(' next ')} end`],
      ['leading slash (review round 8)', `${chunks[0]} ${chunks.slice(1).map((c) => `/${c}`).join(' next ')} end`],
    ];
    for (const [name, input] of cases) {
      const r = mask(input);
      for (const piece of chunks) assert.ok(!r.text.includes(piece), `${name}: the piece ${piece} survived: ${r.text}`);
      assert.ok(r.text.endsWith('end') && r.fired.some((f) => f.kind === 'split_secret'), `${name}: ${JSON.stringify(r)}`);
    }
  } finally { setKnownSecrets([]); }
});

test('#3935 a very long held value (a whole file) cannot make the word walk scan a reply once per mention (review round 1)', () => {
  const long = Array.from({ length: 1000 }, (_, i) => `Zq${String(i).padStart(4, '0')}Xw9Lp2Mn7Rt4Kv1B`).join('').slice(0, 40000);
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([long, held]);
  try {
    const reply = `${long.slice(0, 6)} x y z `.repeat(10000);
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    assert.ok(ms < 600, `a ${reply.length}-character reply repeating a long held value's opening cost ${Math.round(ms)}ms of CPU`);
    assert.equal(r.text, reply, 'a reply holding no key was changed');
    /* CONTROL: a short held key split by words in the same reply is still masked. */
    const chunks = held.match(/.{1,8}/g);
    const withKey = `${reply.slice(0, 2000)} ${chunks.map((c, i) => `| Row${i} name | ${c} |`).join('\n')} ${reply.slice(2000, 4000)}`;
    assert.ok(!mask(withKey).text.includes(chunks[2]), 'CONTROL: a split held key beside the long value survived');
  } finally { setKnownSecrets([]); }
});

test('#3935 the look-ahead is charged per run visited, so repeating a held value\'s opening cannot run unbounded (review round 1)', () => {
  const atCap = Array.from({ length: 64 }, (_, i) => `Qv${String(i).padStart(3, '0')}Jk8Wd3Hs6Nb`).join('').slice(0, 1024);
  setKnownSecrets([atCap]);
  try {
    const reply = `${atCap.slice(0, 6)} x y z `.repeat(10000);
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    assert.ok(ms < 600, `a ${reply.length}-character reply repeating a held value's opening cost ${Math.round(ms)}ms of CPU`);
    /* The charge is what decides it (raising WORD_WALK_BUDGET in secretmask.js changes this test's answer): 10,000 openings each looking ahead over hundreds of runs spend the budget,
       and the reply is withheld whole. That is the stated price of the bound on a reply built this way
       (it holds no key); uncharged, the scan ran to the end instead. */
    assert.equal(r.text, WITHHELD);
    assert.deepEqual(r.fired, [{ kind: 'split_search_limit', count: 1 }]);
  } finally { setKnownSecrets([]); }
});

test('#3935 two held keys that share an opening, both split in one reply, are masked separately (review round 2)', () => {
  const heldA = j('sk-ant-', 'api03-', 'QpLg7fWs2Xo9RbTe4Nk1Yz6Hd3Mv8Cu5Ao0Bi');
  const heldB = j('sk-ant-', 'api03-', 'Vf4Rt9Kx2Zc7Ln0Sp5Wj8Ho3Mu6Db1Ea9Gy2Cq');
  setKnownSecrets([heldA, heldB]);
  try {
    const rows = (k) => k.match(/.{1,8}/g).map((c, i) => `| Row${i} | ${c} |`).join('\n');
    const input = `Account one:\n${rows(heldA)}\nAccount two:\n${rows(heldB)}\nDone.`;
    const r = mask(input);
    for (const k of [heldA, heldB]) for (const c of k.match(/.{1,8}/g).slice(1)) assert.ok(!r.text.includes(c), `the piece ${c} survived: ${r.text}`);
    assert.ok(r.text.includes('\nAccount two:\n'), `the text between the two keys was masked: ${JSON.stringify(r.text)}`);
    assert.ok(r.text.startsWith('Account one:\n') && r.text.endsWith(' |\nDone.'), JSON.stringify(r.text));
    assert.ok(!r.text.includes(MASK + MASK), `two masks printed side by side: ${JSON.stringify(r.text)}`);
    /* Masked piece by piece (review round 18), so one split_secret per piece: at least one per key. */
    assert.ok(r.fired.find((f) => f.kind === 'split_secret').count >= 2, JSON.stringify(r.fired));
  } finally { setKnownSecrets([]); }
});

test('#3935 a short mention of a key\'s opening in the prose does not cut a real split walk short', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const input = `${chunks[0]} is the first part. Anthropic keys all start sk-ant so that is expected. Then ${chunks.slice(1).join(' then ')} end`;
    const out = mask(input).text;
    for (const c of chunks) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a first piece that ends in the key\'s own _ or / is still an opening (review round 3)', () => {
  for (const held of ['Qx7Lm2V_Rt4Kp1ZsWq9Bn3Hy6Jd0', 'Qx7Lm2V/Rt4Kp1ZsWq9Bn3Hy6Jd0']) {
    setKnownSecrets([held]);
    try {
      const chunks = held.match(/.{1,8}/g);
      const out = mask(`Here:\n${chunks.map((c, i) => `| Row${i} name | ${c} |`).join('\n')}\nDone.`).text;
      for (const c of chunks) assert.ok(!out.includes(c), `${held}: the piece ${c} survived: ${out}`);
    } finally { setKnownSecrets([]); }
  }
});

test('#3935 a held password with symbols in it is walked without them (review round 3)', () => {
  const held = 'Xk9mR#mP2wQ!qL7zN@vT4';
  setKnownSecrets([held]);
  try {
    const out = mask('First: Xk9mR# then mP2wQ! then qL7zN@ and finally vT4. Done.').text;
    for (const c of ['Xk9mR', 'mP2wQ', 'qL7zN']) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(out.startsWith('First: ') && out.endsWith('. Done.'), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 a held value made of words is not assembled out of an ordinary sentence (review round 3)', () => {
  setKnownSecrets(['Administrator1', 'Settings2024']);
  try {
    for (const t of ['Log in as Administrator on step 1 of the guide.', 'Open Settings, then in 2024 you will see the new layout.']) {
      assert.equal(mask(t).text, t, `an ordinary sentence was masked: ${t}`);
    }
    /* CONTROL: written whole, the same held values are still masked. */
    /* No secret-name word in the sentence, so only holding the value can mask it (review round 7). */
    const whole = mask('use Administrator1 here');
    assert.equal(whole.text.includes('Administrator1'), false, 'CONTROL: a whole held value survived');
    assert.ok(whole.fired.some((f) => f.kind === 'known_secret'), JSON.stringify(whole.fired));
  } finally { setKnownSecrets([]); }
});

test('#3935 every distinct opening scanned is charged, so many openings sharing one index cost bounded CPU (review round 3)', () => {
  const rnd = (i) => { let x = (i + 1) * 2654435761 % 4294967296, o = ''; for (let k = 0; k < 40; k += 1) { x = (x * 1103515245 + 12345) % 2147483648; o += 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[x % 57]; } return o; };
  setKnownSecrets(Array.from({ length: 2000 }, (_, i) => j('sk-ant-', 'api03-', rnd(i))));
  try {
    const reply = Array.from({ length: 10000 }, (_, i) => `sk-an${i}`).join(' ');
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    assert.ok(ms < 600, `a ${reply.length}-character reply of distinct openings cost ${Math.round(ms)}ms of CPU`);
    /* 10,000 distinct openings each scanning 2,000 forms spend the budget: withheld whole, the stated price
       (the budget is WORD_WALK_BUDGET in secretmask.js). Uncharged, the scan ran to the end instead. */
    assert.equal(r.text, WITHHELD);
  } finally { setKnownSecrets([]); }
});

test('#3935 a sentence naming the key\'s longer prefix between two pieces does not stop the walk (review round 5)', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const input = `${chunks[0]} is the first part (every Anthropic key starts with sk-ant-api03). Then ${chunks.slice(1).join(' then ')} end`;
    const out = mask(input).text;
    /* The first chunk is masked where it stands; the sentence's own public prefix (sk-ant-api03, which contains
       it) stays readable now that pieces are masked one by one (review round 18). */
    assert.ok(out.startsWith(MASK + ' is the first part (every Anthropic key starts with sk-ant-api03).'), out);
    for (const c of chunks.slice(1)) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(out.endsWith(' end'), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 a key whose later chunk repeats its opening is still masked (review round 5)', () => {
  const held = 'Qz7kQz7kVb2nLp9xWm4c';
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,4}/g);
    const out = mask(`Here:\n${chunks.map((c, i) => `| Row${i} name | ${c} |`).join('\n')}\nDone.`).text;
    for (const c of ['Vb2n', 'Lp9x', 'Wm4c']) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(!out.includes('Qz7k'), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 a held PEM key does not start a walk at every markdown rule (review round 5)', () => {
  const pem = j('-----BEGIN EC ', 'PRIVATE KEY-----\nMHcCAQEEIBx7Qz9Lm2Vk4Rt8Wp1Nc6Hd3Js0Fg5Ya2Ub7Xe9Ko\n-----END EC ', 'PRIVATE KEY-----');
  setKnownSecrets([pem]);
  try {
    const reply = Array.from({ length: 3000 }, (_, i) => `Section ${i}\n\n------\n\nsome text`).join('\n');
    const r = mask(reply);
    assert.equal(r.text, reply, `an ordinary reply with markdown rules was changed or withheld: ${JSON.stringify(r.fired)}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a comparison is charged by its length: held values sharing a long prefix cannot run long under the budget (review round 6)', () => {
  let x = 7; const rnd = (n) => { let o = ''; for (let k = 0; k < n; k += 1) { x = (x * 1103515245 + 12345) % 2147483648; o += 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[x % 57]; } return o; };
  const prefix = rnd(1000);
  setKnownSecrets(Array.from({ length: 2000 }, () => prefix + rnd(20)));
  try {
    /* Near misses: each run matches the shared prefix for 999 characters, then diverges on a key character, so
       each is a distinct opening. Most of what this reply still costs is the separator copies' search
       (knownFormsIn, #3938), the same with or without the word walk, so only the walk's outcome is asserted. */
    const reply = Array.from({ length: 120 }, (_, i) => `${prefix.slice(0, 999)}Z${i}`).join(' ');
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    /* Charged by length, two such openings spend the budget (the budget is WORD_WALK_BUDGET in secretmask.js);
       counted per comparison only, all 120 ran to the end, 1.5 to 2.4 seconds on the reviewer's machine. */
    assert.equal(r.text, WITHHELD, `the long comparisons were not charged (${Math.round(ms)}ms)`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a key character left out where the reply splits the key does not end the walk (review round 7)', () => {
  const held = 'sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko';
  setKnownSecrets([held]);
  try {
    const rest = held.slice(13).match(/.{1,8}/g);
    const out = mask(`Prefix sk-ant-api03, then the rest: ${rest.map((c, i) => `part ${i + 1} ${c}`).join(', ')}.`).text;
    for (const c of rest) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(out.startsWith('Prefix '), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 an abandoned first try at a key stays masked when the key is then given in full (review round 7)', () => {
  const held = 'Qx7Lm2VbRt4Kp1ZsWq9Bn3Hy6Jd0Tc8F';
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const out = mask(`First try: ${chunks.slice(0, 3).join(' then ')}. Sorry, again: ${chunks.join(' then ')} end`).text;
    for (const c of chunks) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(out.startsWith('First try: ') && out.endsWith(' end'), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 deciding which starts to keep is not quadratic: many repeated openings cost little and are not withheld (review round 8)', () => {
  const reply = Array.from({ length: 20000 }, () => `a1b2 a1b2 c3d4e5f6${'@'.repeat(60)}`).join('');
  try {
    /* Measured against the same reply with an unrelated held value, since most of a 1.5MB reply's cost is the
       mask's ordinary linear passes: 1.3x with the sweep, 4x when every completion was compared with every other. */
    setKnownSecrets(['zz9yx8wv7ut6']);
    const baseline = cpuMillisecondsOf(() => mask(reply));
    setKnownSecrets(['a1b2c3d4e5f6']);
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    assert.ok(ms < 2 * baseline, `20,000 repeated openings cost ${Math.round(ms)}ms of CPU against ${Math.round(baseline)}ms for the same reply with no match`);
    assert.ok(!r.text.includes('c3d4e5f6'), 'the held value was not masked');
  } finally { setKnownSecrets([]); }
});

test('#3935 glue at the end of a piece: a trailing -, a label after =, pieces wrapped in + (review round 9)', () => {
  const held = 'sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko';
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const cases = [
      ['trailing -', `${chunks.map((c, i) => `step${i}: ${c}-`).join(' ')} end`],
      ['label after =', `${chunks.map((c, i) => `${c}=part${i}`).join(' ')} end`],
      ['wrapped in +', `${chunks.map((c) => `+${c}+`).join(' word ')} end`],
    ];
    for (const [name, input] of cases) {
      const out = mask(input).text;
      for (const c of chunks.slice(1)) assert.ok(!out.includes(c), `${name}: the piece ${c} survived: ${out}`);
      assert.ok(out.endsWith(' end'), `${name}: ${out}`);
    }
  } finally { setKnownSecrets([]); }
});

test('#3935 a bare mention of the key\'s prefix before the key is not taken for a first try: the explanation stays (review round 9)', () => {
  const held = 'sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko';
  setKnownSecrets([held]);
  try {
    const rest = held.slice(13).match(/.{1,8}/g);
    const out = mask(`Every Anthropic key begins sk-ant-api03- like this. Here is yours, split: sk-ant-api03- ${rest.join(' | ')} done`).text;
    /* The last chunk is one letter, which ordinary words contain: check the pieces a reader could use. */
    for (const c of rest.filter((x) => x.length >= 4)) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    assert.ok(out.includes(' like this. Here is yours, split: '), `the explanation was masked: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 an unrelated key between an abandoned try and the retry does not unmask the try (review round 10)', () => {
  const C = 'Qw8eRt2yUi9oPa3sDf6gHj1kLz5xCv0b';
  const B = 'Nm4bVc7xZq1wEr8tYu5iOp2aSd9fGh3j';
  setKnownSecrets([C, B]);
  try {
    const text = [
      'First try: Qw8eRt2y then Ui9oPa3s then Df6gHj1k.',
      "Meanwhile, here is another account's key:",
      '| Row0 | Nm4bVc7x |', '| Row1 | Zq1wEr8t |', '| Row2 | Yu5iOp2a |', '| Row3 | Sd9fGh3j |',
      'Sorry, retry: Qw8eRt2y then Ui9oPa3s then Df6gHj1k then Lz5xCv0b end',
    ].join('\n');
    const out = mask(text).text;
    for (const piece of [...C.match(/.{8}/g), ...B.match(/.{8}/g)]) assert.ok(!out.includes(piece), `the piece ${piece} survived: ${out}`);
    assert.ok(out.startsWith('First try: ') && out.endsWith(' end'), out);
  } finally { setKnownSecrets([]); }
});

test('#3935 a partial walk needs real pieces after a PUBLIC prefix: guide prose naming sk-ant-api03 is not masked (review round 11)', () => {
  const cases = [
    ['sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko', 'Anthropic keys start with sk-ant-api03 and look like this:\n- go to Settings\n- paste it in'],
    ['sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko', 'Your key begins sk-ant-api03 - the rest is private.'],
    ['sk-ant-api03-aXy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9K', 'Keys start with sk-ant-api03 and are a hundred characters long.'],
    ['sk-ant-api03-2Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9K', 'Keys start with sk-ant-api03. Step 2: paste it.'],
    [j('github_', 'pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'), 'Fine-grained tokens start with github_pat_ and you make one like this. Step 1: open GitHub settings.'],
  ];
  for (const [held, text] of cases) {
    setKnownSecrets([held]);
    try {
      assert.equal(mask(text).text, text, `ordinary guide text was masked: ${text}`);
    } finally { setKnownSecrets([]); }
  }
  /* CONTROL: a real partial try (two 8-character pieces after the opening) is still masked. */
  const held = 'Qw8eRt2yUi9oPa3sDf6gHj1kLz5xCv0b';
  setKnownSecrets([held]);
  try {
    const out = mask('First try: Qw8eRt2y then Ui9oPa3s then Df6gHj1k. ' + 'Later text here. '.repeat(20)).text;
    for (const piece of ['Qw8eRt2y', 'Ui9oPa3s', 'Df6gHj1k']) assert.ok(!out.includes(piece), `CONTROL: the piece ${piece} survived: ${out.slice(0, 120)}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a run of the key\'s own separators left out at a split does not end the walk (review round 12)', () => {
  for (const held of ['Qx7pLm2--Vb4Rt8Kz1WnAb3dEf7hJk9mNp2qRs5t', 'Qx7pLm2__Vb4Rt8Kz1WnAb3dEf7hJk9mNp2qRs5t']) {
    setKnownSecrets([held]);
    try {
      const r = mask('Prefix Qx7pLm2, then the rest: part 1 Vb4Rt8Kz, part 2 1WnAb3dE, part 3 f7hJk9mN, part 4 p2qRs5t.');
      for (const piece of ['Qx7pLm2', 'Vb4Rt8Kz', '1WnAb3dE', 'f7hJk9mN']) assert.ok(!r.text.includes(piece), `${held}: the piece ${piece} survived: ${r.text}`);
      assert.ok(r.fired.some((f) => f.kind === 'split_secret'), JSON.stringify(r.fired));
    } finally { setKnownSecrets([]); }
  }
});

test('#3935 a URL-shaped held value: naming its public scheme and host is not a partial try (review round 13)', () => {
  const cases = [
    /* Joined, like SECRETS at the top, so this file does not itself read as a leak to a secret scanner. */
    [j('https://discord.com/api/', 'webhooks/', '1234567890123/', 'AbCdEf0123456789GhIjKlMnOpQrStUvWx'), 'For Discord it looks like https://discord.com/api/webhooks/ followed by two ids.'],
    [j('https://hooks.', 'slack.com/services/', 'T0123ABCD/', 'B0123EFGH/', 'Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3'), 'Slack webhook links begin https://hooks.slack.com/services/ and then three ids.'],
    [j('postgres://kosmos:', 'Xy7Qp2Lm9Vb4', '@localhost:5432/kosmos'), 'Kosmos stores data in postgres://kosmos on localhost:5432 by default.'],
  ];
  for (const [held, text] of cases) {
    setKnownSecrets([held]);
    try {
      assert.equal(mask(text).text, text, `ordinary text naming a URL's public part was masked: ${text}`);
    } finally { setKnownSecrets([]); }
  }
});

test('#3935 a key in chunks joined by hyphens, licence-key style, is masked (review round 13)', () => {
  const held = 'Qw8eRt2yUi9oPa3sDf6gHj1kLz5xCv0b';
  setKnownSecrets([held]);
  try {
    const r = mask(`Here it is: ${held.match(/.{4}/g).join('-')} done`);
    for (const c of held.match(/.{4}/g)) assert.ok(!r.text.includes(c), `the chunk ${c} survived: ${r.text}`);
    assert.ok(r.text.startsWith('Here it is: ') && r.text.endsWith(' done'), r.text);
    const u = mask(`Here it is: ${held.match(/.{4}/g).join('_')} done`).text;
    assert.ok(!u.includes('Rt2y') && !u.includes('Cv0b'), `joined by underscores: ${u}`);
  } finally { setKnownSecrets([]); }
  /* CONTROL: a held value with its OWN hyphens is not searched with them dropped, and is still masked split by words. */
  const own = 'sk-ant-api03-Xy7Qp2Lm9Vb4Rt8Kz1Wn6Hd3Js0Fg5Ya2Ub7Xe9Ko';
  setKnownSecrets([own]);
  try {
    const chunks = own.match(/.{1,8}/g);
    const out = mask(`${chunks.map((c, i) => `| Row${i} name | ${c} |`).join('\n')}`).text;
    assert.ok(!out.includes(chunks[3]), `CONTROL: a key with its own hyphens, split by words, survived: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 licence-key chunks with words between the groups are masked (review round 14)', () => {
  const held = 'Qw8eRt2yUi9oZa3sLz5xCv0bAb12Cd34';
  setKnownSecrets([held]);
  try {
    for (const text of [
      'Here it is: Qw8e-Rt2y and then Ui9o-Za3s and more text Lz5x-Cv0b and finally Ab12-Cd34 done',
      'Piece one: Qw8e-Rt2y. Piece two: Ui9o-Za3s. Piece three: Lz5x-Cv0b. Piece four: Ab12-Cd34. done',
      'Here it is: Qw8e_Rt2y and then Ui9o_Za3s and more text Lz5x_Cv0b and finally Ab12_Cd34 done',
    ]) {
      const r = mask(text);
      for (const c of held.match(/.{4}/g)) assert.ok(!r.text.includes(c), `the chunk ${c} survived: ${r.text}`);
      assert.ok(r.text.endsWith(' done'), r.text);
    }
  } finally { setKnownSecrets([]); }
});

test('#3935 a key given without its public prefix, split by words, is masked (review round 15)', () => {
  const held = 'sk-ant-api03-Qx7vRt2mNp9bKd4sLw8zYh3cFj6gTa1e';
  setKnownSecrets([held]);
  try {
    for (const text of ['After the usual prefix, yours goes Qx7vRt2m then Np9bKd4s then Lw8zYh3cFj6gTa1e end',
      '| Qx7vRt2m | Np9bKd4s | Lw8zYh3cFj6gTa1e | end']) {
      const out = mask(text).text;
      for (const c of ['Qx7vRt2m', 'Np9bKd4s', 'Lw8zYh3c']) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    }
    /* CONTROL: prose naming the public prefix alone is still untouched. */
    const prose = 'Anthropic keys start with sk-ant-api03 and are about a hundred characters long.';
    assert.equal(mask(prose).text, prose);
  } finally { setKnownSecrets([]); }
});

test('#3935 a label joined to a piece by a hyphen does not hide the piece (review round 15)', () => {
  const held = 'sk-ant-api03-Qx7vRt2mNp9bKd4sLw8zYh3cFj6gTa1e';
  setKnownSecrets([held]);
  try {
    const out = mask('chunk-1-sk-ant-api03-Qx7v then chunk-2-Rt2mNp9b then chunk-3-Kd4sLw8z then chunk-4-Yh3cFj6gTa1e').text;
    for (const c of ['Rt2mNp9b', 'Kd4sLw8z', 'Yh3cFj6gTa1e']) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a random single-case secret is not taken for words: split by a word it is masked (review round 16)', () => {
  for (const [held, text] of [['kitgaubjgEFJMLCW', 'kitgaubjg account EFJMLCW'], ['zvqxrpldkinaeout', 'zvqxrpldki account naeout'], ['ZVQXRPLDKINAEOUT', 'ZVQXRPLDKI account NAEOUT']]) {
    setKnownSecrets([held]);
    try {
      const r = mask(text);
      assert.ok(!r.text.includes(text.split(' ')[0]) && !r.text.includes(text.split(' ')[2]), `${held} split by a word survived: ${r.text}`);
      assert.ok(r.fired.some((f) => f.kind === 'split_secret'), JSON.stringify(r.fired));
    } finally { setKnownSecrets([]); }
  }
  /* CONTROL: word-made values are still not walked (round 3's sentences stay readable). */
  setKnownSecrets(['Administrator1', 'Settings2024']);
  try {
    for (const t2 of ['Log in as Administrator on step 1 of the guide.', 'Open Settings, then in 2024 you will see the new layout.']) assert.equal(mask(t2).text, t2);
  } finally { setKnownSecrets([]); }
});

test('#3935 a retry within reach of an abandoned try: the prose between them stays (review round 16)', () => {
  const held = 'Qx7Lm2VbRt4Kp1ZsWq9Bn3Hy6Jd0Tc8F';
  setKnownSecrets([held]);
  try {
    const out = mask('First try: Qx7Lm2Vb then Rt4Kp1Zs then Wq9Bn3Hy. Sorry, again: Qx7Lm2Vb then Rt4Kp1Zs then Wq9Bn3Hy then 6Jd0Tc8F end').text;
    for (const c of held.match(/.{8}/g)) assert.ok(!out.includes(c), `the chunk ${c} survived: ${out}`);
    assert.ok(out.includes('Sorry, again:'), `the prose between the two tries was masked: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 pieces given without the key\'s own separators at several splits: every piece is masked (review round 17)', () => {
  const anth = j('sk-ant-', 'api03-', 'Ab3dEf7hIj-Kl9mNo2pQr_St4uVw6xYz-Ab1cDe5fGh8iJk0lMn');
  const five = 'Qw8eRt2yZm-Ui9oPa3sXc-Df4gHj5kVb-Zx7cVb1nMq-Lk3jHg6fDs';
  const cases = [
    [anth, 'Key: sk-ant-api03 then Ab3dEf7hIj then Kl9mNo2pQr then St4uVw6xYz and so on.', ['Ab3dEf7hIj', 'Kl9mNo2pQr', 'St4uVw6xYz']],
    [five, 'Here: Qw8eRt2yZm then Ui9oPa3sXc then Df4gHj5kVb then Zx7cVb1nMq, and the rest later.', ['Qw8eRt2yZm', 'Ui9oPa3sXc', 'Df4gHj5kVb', 'Zx7cVb1nMq']],
    [five, 'First Qw8eRt2yZm then Ui9oPa3sXc then Df4gHj5kVb oops. Sorry, again: Qw8eRt2yZm Ui9oPa3sXc Df4gHj5kVb Zx7cVb1nMq Lk3jHg6fDs done.', ['Qw8eRt2yZm', 'Ui9oPa3sXc', 'Df4gHj5kVb', 'Zx7cVb1nMq', 'Lk3jHg6fDs']],
  ];
  for (const [held, text, pieces] of cases) {
    setKnownSecrets([held]);
    try {
      const out = mask(text).text;
      for (const piece of pieces) assert.ok(!out.includes(piece), `the piece ${piece} survived: ${out}`);
    } finally { setKnownSecrets([]); }
  }
});

test('#3935 a label with many hyphens before a piece still offers the piece (review round 17)', () => {
  const held = j('sk-ant-', 'api03-', 'Qx7vRt2mNp9bKd4sLw8zYh3cFj6gTa1e');
  setKnownSecrets([held]);
  try {
    /* Six hyphens before a piece: more than the four tails, so only tails taken from the end reach it. */
    const out = mask('first sk-ant-api03-Qx7v then a-very-long-label-name-here-Rt2mNp9b then yet-another-long-label-name-here-Kd4sLw8z then Yh3cFj6gTa1e').text;
    for (const c of ['Rt2mNp9b', 'Kd4sLw8z', 'Yh3cFj6gTa1e']) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 a completed walk masks the key\'s pieces, not the rows and bullets between them (review round 18)', () => {
  const held = j('sk-ant-', 'api03-', 'WordsBetweenThePieces0123456789XYZ');
  setKnownSecrets([held]);
  try {
    const chunks = held.match(/.{1,8}/g);
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    const out = mask(`Here:\n| Part | Value |\n|---|---|\n${chunks.map((c, i) => `| ${names[i]} | ${c} |`).join('\n')}\nDone.`).text;
    for (const c of chunks.slice(1)) assert.ok(!out.includes(c), `the piece ${c} survived: ${out}`);
    for (const n of names) assert.ok(out.includes(`| ${n} | ${MASK} |`), `the row ${n} lost its shape: ${out}`);
  } finally { setKnownSecrets([]); }
});

test('#3935 text dense with - _ and = but no held opening costs little (review round 18)', () => {
  setKnownSecrets(Array.from({ length: 50 }, (_, i) => j('sk-ant-', 'api03-', `Qx7v${String(i).padStart(4, '0')}Rt2mNp9bKd4sLw8zYh3cFj6gTa1e`)));
  try {
    const reply = Array.from({ length: 4000 }, (_, i) => `pa-rt${i}_va=lue-${i}_end`).join(' ');
    const baseline = (() => { setKnownSecrets(['zz9yx8wv7ut6']); return cpuMillisecondsOf(() => mask(reply)); })();
    setKnownSecrets(Array.from({ length: 50 }, (_, i) => j('sk-ant-', 'api03-', `Qx7v${String(i).padStart(4, '0')}Rt2mNp9bKd4sLw8zYh3cFj6gTa1e`)));
    let r;
    const ms = cpuMillisecondsOf(() => { r = mask(reply); });
    assert.equal(r.text, reply, 'glue-dense text holding no key was changed');
    /* A ceiling, not a pin: measured 76ms here with variants built lazily against 118ms built for every run. */
    assert.ok(ms < 4 * baseline + 100, `a ${reply.length}-character glue-dense reply cost ${Math.round(ms)}ms against ${Math.round(baseline)}ms with one unrelated held value`);
  } finally { setKnownSecrets([]); }
});
