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
    ['--k-bg: #fff;\n--x: url(http://x)', /line 2 loads something from elsewhere/],
    ['--x: red; --y: blue', /not a token line/],
    ['--x: <img>', /not a token line/],
    ['--' + 'a'.repeat(60) + ': red', /not a token line/],
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

test('a corrupt saved style falls back to the shipped look, never a crash', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), '{nope');
  const r = styles.read();
  assert.equal(r.theme, 'kosmos');
  assert.equal(r.ok, false, 'a corrupt file did not say so');
  fs.rmSync(styles.FILE(), { force: true });
});
