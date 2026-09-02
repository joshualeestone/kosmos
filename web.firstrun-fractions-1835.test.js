'use strict';

/**
 * #1835: frActions(primary, alt) must render the ALT when primary is null.
 *
 * The guard for the agent-search interim screen (which passes NEITHER button
 * and must show nothing) also discarded a legitimate alt when one WAS passed.
 * Five first-run buttons rode on frActions(null, {alt}) and never painted:
 *   - four Cancels across download, install and sign-in
 *   - the model step's "Skip connecting a model" link
 * Found by Angel, confirmed by Mona Lisa, source-traced (kosmos#1835).
 *
 * This is runnable source coverage. A browser check cannot run on the fleet
 * right now (kosmos#1769); Josh's live morning walk is the interim live
 * confirm, and a rendered docs/browser-checks/*.js follows when #1769 unblocks.
 *
 * The function is extracted from web/index.html by brace-matching and run with
 * stubbed fr-next / fr-alt elements -- the same pattern the sibling first-run
 * tests use for frPaintSubscription / frPaintOpenai.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function frActionsBody() {
  const at = PAGE.indexOf('function frActions(');
  assert.notEqual(at, -1, 'frActions moved; re-point this test');
  let d = 0;
  let i = PAGE.indexOf('{', PAGE.indexOf(')', at));
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') d++;
    else if (PAGE[i] === '}') { d--; if (!d) break; }
  }
  return PAGE.slice(at, i + 1);
}

function makeEl() {
  const cls = new Set();
  return {
    hidden: false,
    textContent: '',
    onclick: undefined,
    disabled: false,
    removeAttribute() {},
    classList: {
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); },
      contains: (c) => cls.has(c),
    },
  };
}

function run(primary, alt) {
  const next = makeEl();
  const other = makeEl();
  const els = { 'fr-next': next, 'fr-alt': other };
  const body = frActionsBody();
  // eslint-disable-next-line no-new-func
  new Function('document', '_p', '_a', body + '\nfrActions(_p, _a);')(
    { getElementById: (id) => els[id] || null },
    primary,
    alt,
  );
  return { next, other };
}

test('primary null WITH an alt renders the alt (the #1835 bug: it was hidden)', () => {
  const { next, other } = run(null, { label: 'Cancel', go: () => 'cancelled' });
  assert.equal(next.hidden, true, 'the primary button should be hidden when there is no primary');
  assert.equal(other.hidden, false, 'the alt was discarded on a null primary -- this is the bug five buttons hit');
  assert.equal(other.textContent, 'Cancel', 'the alt label did not render');
  assert.equal(typeof other.onclick, 'function', 'the alt has no handler, so pressing it does nothing');
});

test('primary null with a LINK alt renders it as a quiet link (the model step Skip)', () => {
  const { other } = run(null, { label: 'Skip connecting a model', go: () => 'skipped', link: true });
  assert.equal(other.hidden, false, 'the Skip link did not render');
  assert.equal(other.classList.contains('is-link'), true, 'link:true did not draw the alt as a quiet text link');
});

test('primary null and NO alt shows nothing (the agent-search intent is preserved)', () => {
  const { next, other } = run();
  assert.equal(next.hidden, true, 'agent-search must show no primary');
  assert.equal(other.hidden, true, 'agent-search passes no alt and must show no second button');
});

test('a primary with no alt shows only the primary', () => {
  const { next, other } = run({ label: 'Set up Kosmos', go: () => 'go' });
  assert.equal(next.hidden, false);
  assert.equal(next.textContent, 'Set up Kosmos');
  assert.equal(other.hidden, true, 'an alt painted when none was passed');
});

test('a primary AND an alt shows both (unchanged behaviour)', () => {
  const { next, other } = run({ label: 'Continue', go: () => 'c' }, { label: 'Back', go: () => 'b' });
  assert.equal(next.hidden, false);
  assert.equal(next.textContent, 'Continue');
  assert.equal(other.hidden, false);
  assert.equal(other.textContent, 'Back');
});
