'use strict';

/**
 * The shared comment stripper, shown working in BOTH directions (#1080).
 *
 * 🛑 A STRIPPER IS THE EASIEST THING IN THIS REPO TO GET SILENTLY WRONG,
 * because both of its failure modes look like success:
 *   - strip too little and a comment quoting the deleted thing answers the
 *     assertion. That is a false FAIL, and somebody investigates it.
 *   - strip too much and real code disappears, so an absence check goes green
 *     for the worst possible reason. NOBODY investigates a pass.
 * So every arm below has a partner asserting the opposite direction.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { codeOnly } = require('./test-support/code-only');

const T = 'id="create-tell"';

test('prose carrying the token is removed, in all three comment forms', () => {
  assert.doesNotMatch(codeOnly(`<!-- ${T} -->`), /create-tell/, 'HTML comment survived');
  assert.doesNotMatch(codeOnly(`/* ${T} */`), /create-tell/, 'block comment survived');
  assert.doesNotMatch(codeOnly(`  // ${T}`), /create-tell/, 'line comment survived');
  assert.doesNotMatch(codeOnly(`/*\n  ${T}\n*/`), /create-tell/, 'multi-line block comment survived');
});

test('CONTROL: real code carrying the token is KEPT', () => {
  /* 🔑 Without this, a codeOnly() that returned '' would pass every assertion
     above, and every absence check built on it, forever. */
  assert.match(codeOnly(`const a = '${T}';`), /create-tell/, 'the stripper ate real code');
  assert.match(codeOnly(`<input ${T}>`), /create-tell/, 'the stripper ate real markup');
});

test('CONTROL: a URL survives, because // is not always a comment', () => {
  /* ⚠️ MEASURED, not stylistic (Mona Lisa, on web/index.html): that file
     carries many https:// URLs. A naive /\/\/.*$/ truncates live code after
     every one, which HIDES occurrences and turns absence checks green. */
  assert.match(codeOnly('const u = "https://example.com/create-tell";'), /example\.com\/create-tell/);
  assert.match(codeOnly('fetch("https://a.b/x"); // trailing note'), /a\.b\/x/,
    'a trailing comment took the code on its own line with it');
});

test('a comment and its code on separate lines: one goes, one stays', () => {
  const src = [`// removed: ${T}`, `const kept = '${T}';`].join('\n');
  const out = codeOnly(src);
  assert.doesNotMatch(out.split('const kept')[0], /create-tell/, 'the comment line survived');
  assert.match(out, /const kept/, 'the code line was eaten');
});

test('it is total: null, undefined and empty are strings, not throws', () => {
  /* A helper that throws on a missing read turns a test file red for a reason
     that has nothing to do with what it was asserting. */
  assert.equal(codeOnly(undefined), '');
  assert.equal(codeOnly(null), '');
  assert.equal(codeOnly(''), '');
});
