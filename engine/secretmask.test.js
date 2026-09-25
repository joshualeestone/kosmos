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
      for (const piece of [key.slice(0, 12), key.slice(14, 26), key.slice(-12)]) assert.ok(!out.includes(piece), `a piece of the key survived: ${out}`);
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
