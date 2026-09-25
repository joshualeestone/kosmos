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

test('#3769 ordinary text is untouched: prose, links, commit ids, short words after a key name', () => {
  const plain = [
    'Open Settings, AI Models, then choose Add a provider.',
    'See https://installkosmos.com/docs/setup-your-first-agent for the steps.',
    'commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f fixed it',
    'token: none, password: ask',
    'The ring is your agent\'s memory.',
    'Your key starts with sk- and is pasted in Settings.',
  ];
  for (const t of plain) {
    const out = mask(t);
    assert.equal(out.text, t, `ordinary text was masked: ${t} -> ${out.text}`);
    assert.deepEqual(out.fired, []);
  }
  assert.deepEqual(mask(null), { text: null, fired: [] });
  assert.deepEqual(mask(''), { text: '', fired: [] });
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
