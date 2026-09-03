'use strict';

/*
 * kosmos#2066 -- the board's build marker (paintBuildMark) in web/index.html.
 * Executes the extracted function against a fake DOM with stubbed bakedVersion /
 * esc / pageIsStale / location, so the branching logic is really run, not just
 * pinned by source text. The browser check render-build-marker-2066.js proves it
 * RENDERS with the staging treatment (computed style); this proves the value logic:
 * baked wins, an absent/unknown channel folds to prod, no version hides.
 *
 *   node --test web.build-marker-2066.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

const SRC = PAGE.match(/function paintBuildMark\(version, sourceChannel\) \{[\s\S]*?\n\}/);
assert.ok(SRC, 'paintBuildMark() moved or was renamed');

// Build a fresh fake DOM + stubbed helpers, eval the extracted function so it
// closes over them (direct eval resolves the function's free identifiers against
// this scope), and return both.
function harness(overrides) {
  const o = overrides || {};
  // eslint-disable-next-line no-unused-vars
  const bakedVersion = o.bakedVersion || (() => null);
  // eslint-disable-next-line no-unused-vars
  const esc = (s) => String(s);
  // eslint-disable-next-line no-unused-vars
  const pageIsStale = o.pageIsStale || (() => false);
  // eslint-disable-next-line no-unused-vars
  const location = Object.prototype.hasOwnProperty.call(o, 'location') ? o.location : { port: '' };
  const el = {
    hidden: true, className: '', textContent: '', title: '', innerHTML: '',
    querySelector(sel) { return (sel === '.bm-v' && this.innerHTML.indexOf('bm-v') !== -1) ? {} : null; },
  };
  // eslint-disable-next-line no-unused-vars
  const document = { getElementById: (id) => (id === 'buildmark' ? el : null) };
  // eslint-disable-next-line no-eval
  const fn = eval('(' + SRC[0] + ')');
  return { fn, el };
}

test('prod: a dim version string, no staging class, no badge markup', () => {
  const { fn, el } = harness();
  fn('0.6.26', 'prod');
  assert.equal(el.hidden, false);
  assert.equal(el.className, '', 'prod must not carry the staging class');
  assert.equal(el.textContent, 'v0.6.26');
  assert.equal(el.innerHTML, '', 'prod is plain text, not badge markup');
  assert.match(el.title, /prod/, 'the hover line names the channel');
});

test('staging: the loud badge -- STAGING, the version in a .bm-v span, the staging class', () => {
  const { fn, el } = harness();
  fn('0.6.27', 'staging');
  assert.equal(el.hidden, false);
  assert.equal(el.className, 'staging');
  assert.match(el.innerHTML, /STAGING/);
  assert.match(el.innerHTML, /class="bm-v"/);
  assert.match(el.innerHTML, /v0\.6\.27/);
  assert.match(el.title, /staging/);
});

test('an absent or unknown channel folds to PROD -- a corrupt signal never paints STAGING', () => {
  for (const ch of [undefined, null, '', 'PROD', 'stage', 'production', 'STAGING']) {
    // Only the exact lowercase 'staging' is staging; the frontend trusts the
    // server to have normalised, and anything else is the safe default.
    const { fn, el } = harness();
    fn('0.6.26', ch);
    if (ch === 'staging') { assert.equal(el.className, 'staging', 'exact "staging" is staging'); }
    else { assert.equal(el.className, '', 'channel ' + JSON.stringify(ch) + ' must render as prod'); }
  }
});

test('no version -> hidden, never a flash of "unknown"', () => {
  const { fn, el } = harness({ bakedVersion: () => null });
  fn(null, 'staging');
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');
  assert.equal(el.className, '');
  assert.equal(el.title, '');
});

test('the BAKED version wins over the polled one (what am I looking at), and stale is noted in the title', () => {
  const { fn, el } = harness({ bakedVersion: () => '0.6.26', pageIsStale: () => true });
  fn('0.6.27', 'prod'); // served 0.6.27, page baked 0.6.26 -> stale
  assert.equal(el.textContent, 'v0.6.26', 'the marker shows the page it IS, not the server it polls');
  assert.match(el.title, /reload for v0\.6\.27/, 'the disagreement (stale) rides the hover line');
});

test('the per-account port rides the hover line (the cabal9 which-app case)', () => {
  const { fn, el } = harness({ location: { port: '17401' } });
  fn('0.6.26', 'prod');
  assert.match(el.title, /port 17401/);
});

test('source: channel is NOT baked -- paintBuildMark reads sourceChannel as an argument, off the poll', () => {
  // The value must come from the poll (an argument), never from a baked meta tag,
  // to preserve #2036's same-artifact promotion. Guard against a regression that
  // reads a baked channel token.
  assert.doesNotMatch(SRC[0], /meta\[name="kosmos-channel"\]|__KOSMOS_CHANNEL__/,
    'the channel must not be baked into the artifact');
});
