'use strict';

/**
 * Styles (#480): tokens only, never a stylesheet, every refusal a
 * sentence naming the line.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'styles-test-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const styles = require('./styles');

test('a token file parses; anything shaped like behavior is refused with the line named', () => {
  const good = styles.parseTokens('--k-bg: #fff;\n\n/* a note */\n--k-ink: rgba(0,0,0,.9)');
  assert.equal(good.ok, true);
  assert.equal(good.tokens.length, 2);

  for (const [text, why] of [
    ['body { color: red }', /line 1 is not a token line/],
    ['--k-bg: #fff;\n--x: url(http://x)', /line 2 uses url\(\)/],
    ['--x: red; --y: blue', /not a token line/],
    ['--x: <img>', /not a token line/],
    ['--' + 'a'.repeat(60) + ': red', /not a token line/],
    ['--k-bg: url(http://x)', /uses url\(\)/],
    /* The escape family: a blocklist of spellings is a guard the CSS
       tokenizer walks through (\75rl( decodes to url( at substitution
       time), so the BACKSLASH itself is refused, closing every encoding
       at once, and functions pass by allowlist only. */
    ['--k-bg: \\75rl(http://x)', /backslash/],
    ['--k-bg: image-set(url(http://x))', /image-set\(\)/],
    ['--k-bg: expression(alert(1))', /expression\(\)/],
    ['--x: @import', /@-rule/],
    /* The comment-split family (iteration-2 blocker): the tokenizer
       drops comments BEFORE producing tokens, so a comment wedged into
       a function name splits it for a detector and joins it for the
       browser. Both of these ACCEPTED before the comment ban landed;
       the value-level comment refusal is what turns them away now. */
    ['--k-bg: url/**' + '*'.repeat(0) + '/("http://evil/x")', /comment inside a value/],
    ['--k-bg: image-set/**' + '/(url/**' + '/("http://e/x.png"))', /comment inside a value/],
    /* Iteration 3: the paren is judged by the ident TOUCHING it, so a
       function name a letters-only scan walks past still fails closed. */
    ['--a: foo3(1)', /uses foo3\(\)/],
    ['--a: foo_(1)', /uses foo_\(\)/],
    /* A declaration hiding behind a full-line comment is refused, not
       silently dropped. */
    ['/* a note */ --x: red', /not a token line/],
    ['--a: ' + '1'.repeat(140), /longer than 120 characters/],
    /* Iteration 4: a carriage return is a line break the naked eye
       cannot see, and !important never belongs in a pasted color. */
    ['--x: red\rextra', /hidden line break/],
    ['--x: red !important', /exclamation mark/],
    ['/* an unclosed comment\n--a: red', /opens a comment it does not close/],
  ]) {
    const r = styles.parseTokens(text);
    assert.equal(r.ok, false, text.slice(0, 30));
    assert.match(r.because, why, text.slice(0, 30));
  }
});

test('theme and custom round-trip; effective layers custom over theme; an unknown theme is refused', () => {
  assert.equal(styles.set({ theme: 'nope' }).ok, false);
  assert.equal(styles.set({ theme: 'paper' }).ok, true);
  assert.equal(styles.set({ customText: '--k-bg: #123456' }).ok, true);
  const eff = styles.effective();
  assert.equal(eff.theme, 'paper');
  assert.equal(eff.tokens['--k-bg'], '#123456', 'the pasted style does not win over the theme');
  assert.equal(eff.tokens['--k-surface'], styles.THEMES.paper.tokens['--k-surface'], 'the theme under it was lost');
  /* Clearing: an empty paste removes the custom set and keeps the theme. */
  assert.equal(styles.set({ customText: '' }).ok, true);
  assert.equal(styles.effective().customCount, 0);
  assert.equal(styles.effective().theme, 'paper');
});

test('a tampered store cannot smuggle what the paste path refuses (#480 review)', () => {
  /* The read path runs the FULL rules: a hand-edited styles.json holding
     a literal url() token must not round-trip into applyStyle just
     because it skipped the parser. The refused token is dropped, the
     inert direction, and the good token beside it survives. */
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), JSON.stringify({
    theme: 'kosmos',
    custom: [
      { name: '--k-bg', value: 'url(http://evil.example/x.png)' },
      { name: '--k-ink', value: '#222222' },
    ],
  }));
  const eff = styles.effective();
  assert.equal(eff.tokens['--k-bg'], undefined, 'a tampered url() token reached the page');
  assert.equal(eff.tokens['--k-ink'], '#222222', 'the good token beside it was lost');
  fs.rmSync(styles.FILE(), { force: true });
});

test('the allowlist speaks current CSS: modern color spaces and calc siblings pass (iteration 4)', () => {
  for (const good of ['--a: oklch(0.7 0.1 200)', '--a: color-mix(in oklab, red, blue)',
    '--a: light-dark(#fff, #000)', '--w: clamp(1rem, 2vw, 2rem)', '--w: min(10px, 2vw)']) {
    assert.equal(styles.parseTokens(good).ok, true, good);
  }
});

test('a theme name off the prototype chain is refused, not persisted (iteration 4)', () => {
  for (const bad of ['__proto__', 'constructor', 'hasOwnProperty']) {
    assert.equal(styles.set({ theme: bad }).ok, false, bad);
  }
});

test('a duplicate name counts once, the last value winning as it would in a sheet (iteration 3)', () => {
  const r = styles.parseTokens('--a: red\n--a: blue\n--b: #fff');
  assert.equal(r.ok, true);
  assert.deepEqual(r.tokens, [{ name: '--a', value: 'blue' }, { name: '--b', value: '#fff' }]);
  /* And calc grouping parens survive the adjacency rule. */
  assert.equal(styles.parseTokens('--w: calc((100% - 10px) / 2)').ok, true);
});

test('a store token judges name and value as separate fields, and read mirrors the paste caps (iteration 2)', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  const many = [];
  for (let i = 0; i < 80; i += 1) many.push({ name: '--pad-' + i, value: '#111' });
  fs.writeFileSync(styles.FILE(), JSON.stringify({ theme: 'kosmos', custom: [
    /* the composed-line smuggle: a name field carrying ': red' read as
       one valid LINE before the fields were judged separately */
    { name: '--a: red', value: '#fff' },
    { name: '--K-Bg', value: '#123456' },
    /* a raw newline in a stored value: the paste path can never make
       one, so the read path refuses it too (iteration 3) */
    { name: '--k-sneak', value: 'red\nblue' },
    /* the same name twice: read dedupes last-wins, so the count shown
       is the count in force (iteration 4) */
    { name: '--k-dup', value: '#111' },
    { name: '--k-dup', value: '#222' },
  ].concat(many) }));
  const eff = styles.effective();
  assert.equal(Object.keys(eff.tokens).some((k) => k.includes(':')), false,
    'a store name smuggling a colon reached the page');
  assert.equal(eff.tokens['--k-bg'], '#123456', 'read did not lowercase the stored name');
  assert.equal(eff.tokens['--k-sneak'], undefined, 'a stored multi-line value reached the page');
  assert.equal(eff.tokens['--k-dup'], '#222', 'last-wins did not hold on read');
  assert.ok(eff.customCount <= 60, 'read applied more tokens than the paste path allows: ' + eff.customCount);
  fs.rmSync(styles.FILE(), { force: true });
});

test('one request with a good theme and a bad paste applies NEITHER (#480 review)', () => {
  styles.set({ theme: 'kosmos' });
  const r = styles.set({ theme: 'slate', customText: 'body { color: red }' });
  assert.equal(r.ok, false);
  assert.equal(styles.read().theme, 'kosmos',
    'a refused paste left a half-applied theme behind it');
});

test('a corrupt saved style falls back to the shipped look, never a crash', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), '{nope');
  const r = styles.read();
  assert.equal(r.theme, 'kosmos');
  assert.equal(r.ok, false, 'a corrupt file did not say so');
  fs.rmSync(styles.FILE(), { force: true });
});
