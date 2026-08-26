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

/* kosmos#1001 removed the paste-your-own-tokens box. These three tests used to
   guard the PASTE path; what survives is stronger and is what actually matters
   on a machine where somebody already used it. */
test('the theme round-trips, and a stored custom set no longer reaches the page', () => {
  assert.equal(styles.set({ theme: 'nope' }).ok, false);
  assert.equal(styles.set({ theme: 'paper' }).ok, true);
  const eff = styles.effective();
  assert.equal(eff.theme, 'paper');
  assert.equal(eff.tokens['--k-surface'], styles.THEMES.paper.tokens['--k-surface'], 'the theme itself was lost');
  assert.equal(eff.customCount, undefined,
    'customCount is still reported; nothing reads it and it implies a feature that is gone');
});

/* 🔑 THE SECURITY PROPERTY GOT SIMPLER RATHER THAN WEAKER. The old test proved
   a tampered store could not smuggle past the paste path's validation. Now
   nothing applies stored tokens at all, so there is no path to smuggle along --
   the whole class is closed by construction rather than by a filter. */
test('a tampered store reaches the page with nothing, however it is written', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), JSON.stringify({ theme: 'kosmos', layout: 'tabs', custom: [
    { name: '--a: red', value: '#fff' },
    { name: '--k-bg', value: '#123456' },
    { name: '--k-sneak', value: 'red\nblue' },
  ] }));
  const eff = styles.effective();
  assert.equal(eff.tokens['--k-bg'], styles.THEMES.kosmos.tokens['--k-bg'],
    'a token from the store overrode the theme; nothing should apply the stored set any more');
  assert.equal(eff.tokens['--k-sneak'], undefined, 'a store-only token reached the page');
  assert.equal(eff.tokens['--a'], undefined, 'a composed-name token reached the page');
});

/* ⚠️ AND THE PERSON'S FILE IS NOT REWRITTEN UNDER THEM. Removing a feature is
   not a licence to delete what somebody already saved: the key stops being
   READ, it does not stop existing. A later save must carry it through. */
test('a saved custom set survives a theme change after the feature is gone', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), JSON.stringify({ theme: 'paper', layout: 'tabs', custom: [{ name: '--k-bg', value: '#123456' }] }));
  assert.equal(styles.set({ theme: 'kosmos' }).ok, true);
  assert.deepEqual(styles.read().custom, [{ name: '--k-bg', value: '#123456' }],
    'saving the theme destroyed the custom set the person had stored');
});

test('a theme name off the prototype chain is refused, not persisted (iteration 4)', () => {
  const before = styles.read().theme;
  for (const bad of ['__proto__', 'constructor', 'hasOwnProperty']) {
    assert.equal(styles.set({ theme: bad }).ok, false, bad);
  }
  assert.equal(styles.read().theme, before, 'a refused theme name reached the store');
});

test('a corrupt saved style falls back to the shipped look, never a crash', () => {
  fs.mkdirSync(nodePath.dirname(styles.FILE()), { recursive: true });
  fs.writeFileSync(styles.FILE(), '{nope');
  const r = styles.read();
  assert.equal(r.theme, 'kosmos');
  assert.equal(r.ok, false, 'a corrupt file did not say so');
  fs.rmSync(styles.FILE(), { force: true });
});
