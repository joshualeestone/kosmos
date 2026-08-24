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
  ]) {
    const r = styles.parseTokens(text);
    assert.equal(r.ok, false, text.slice(0, 30));
    assert.match(r.because, why, text.slice(0, 30));
  }
});

test('theme and custom round-trip; effective layers custom over theme; an unknown theme is refused', () => {
  assert.equal(styles.setTheme('nope').ok, false);
  assert.equal(styles.setTheme('paper').ok, true);
  assert.equal(styles.setCustom('--k-bg: #123456').ok, true);
  const eff = styles.effective();
  assert.equal(eff.theme, 'paper');
  assert.equal(eff.tokens['--k-bg'], '#123456', 'the pasted style does not win over the theme');
  assert.equal(eff.tokens['--k-surface'], styles.THEMES.paper.tokens['--k-surface'], 'the theme under it was lost');
  /* Clearing: an empty paste removes the custom set and keeps the theme. */
  assert.equal(styles.setCustom('').ok, true);
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

test('one request with a good theme and a bad paste applies NEITHER (#480 review)', () => {
  styles.setTheme('kosmos');
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
