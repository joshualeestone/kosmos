'use strict';

/**
 * kosmos#8384: the first-run sleep step on Linux. The macOS Energy pane and its Turn On are not shown there (Linux has
 * no such pane); the sentence the engine's Linux reading returns (engine/machine.js linuxSleepGate, `detail`) is shown
 * under the row while the reading says the computer sleeps, and cleared when it no longer does. A Mac or Windows
 * reading carries no sentence, so their screens are unchanged.
 *
 * Runs the page's real FR_GATES, frReadGate and frPollGates (lifted from web/index.html) against a fake DOM and fetch,
 * as web.a11y-turnon-2559.test.js does.
 *
 *   node --test web.linuxsleep-8384.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function liftObject(script, name) {
  const start = script.indexOf('const ' + name + ' = {');
  assert.ok(start > -1, `const ${name} vanished from the page`);
  const end = script.indexOf('\n};', start);
  assert.ok(end > start, `could not find the end of ${name}`);
  return script.slice(start, end + 3);
}

function fakeRow(gate) {
  const attrs = new Map([['data-gate', gate]]);
  return {
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    closest: () => null,
  };
}

function harness(sleepAnswer) {
  const rows = { sleep: fakeRow('sleep') };
  const say = { textContent: '', hidden: true };
  const asked = [];
  const screen = {
    querySelectorAll: () => [rows.sleep],
    querySelector: (sel) => { asked.push(sel); return sel === '[data-gate-say="sleep"]' ? say : null; },
  };
  const next = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const document = { querySelector: () => null, getElementById: (id) => (id === 'fr-next' ? next : null) };
  const answers = { '/api/sleep-status': sleepAnswer };
  const fetch = async (url) => ({ json: async () => answers[url] || {} });
  const src = [
    page.liftConst(SCRIPT, 'FR_CHECKING_TURN_ON_MS'),
    liftObject(SCRIPT, 'FR_GATES'),
    page.liftConst(SCRIPT, 'FR_CHECKING_SINCE'),
    page.lift(SCRIPT, 'frReadGate'),
    page.lift(SCRIPT, 'frPollGates'),
    'return { poll: (gen) => frPollGates(screen, gen) };',
  ].join('\n');
  const api = new Function('document', 'fetch', 'Date', 'screen', 'platformHides', 'FR_GATE_GEN', src)(
    document, fetch, Date, screen, () => false, 1);
  return { rows, say, next, answers, asked, poll: () => api.poll(1) };
}

const LINUX_SLEEPS = { checkable: true, prevented: false, because: 'This computer can go to sleep on its own',
  detail: 'After 30 minutes with nobody using it, this computer goes to sleep (logind\'s IdleAction).', battOnly: false };

test('kosmos#8384: a Linux reading that sleeps puts its own sentence under the row, and Next stays open', async () => {
  const h = harness(LINUX_SLEEPS);
  await h.poll();
  assert.equal(h.say.hidden, false);
  assert.equal(h.say.textContent, LINUX_SLEEPS.detail);
  assert.equal(h.next.disabled, false, 'the sleep step is advisory (#2587), on Linux too');
});

test('kosmos#8384: the sentence clears when the reading turns to awake, or cannot be read', async () => {
  const h = harness(LINUX_SLEEPS);
  await h.poll();
  assert.equal(h.say.hidden, false, 'control: shown first');
  h.answers['/api/sleep-status'] = { checkable: true, prevented: true };
  await h.poll();
  assert.equal(h.say.hidden, true);
  assert.equal(h.say.textContent, '');
  h.answers['/api/sleep-status'] = LINUX_SLEEPS;
  await h.poll();
  h.answers['/api/sleep-status'] = { checkable: false, because: 'we could not read this computer\'s sleep settings' };
  await h.poll();
  assert.equal(h.say.hidden, true, 'an unreadable reading says nothing under the row');
});

test('kosmos#8384: a Mac reading (no sentence) leaves the line hidden, so the Mac screen is unchanged', async () => {
  const h = harness({ checkable: true, prevented: false, because: 'This computer goes to sleep after 10 minutes', battOnly: false });
  await h.poll();
  assert.equal(h.say.hidden, true);
  assert.equal(h.say.textContent, '');
  assert.ok(h.asked.includes('[data-gate-say="sleep"]'), 'control: the line was looked up, so hidden is a decision, not a miss');
});

test('kosmos#8384: the markup has the line, the Linux CSS hides only the sleep row\'s Turn On, and the Energy pane is hidden on Linux', () => {
  assert.match(PAGE, /<p class="s3-gate-say" data-gate-say="sleep" hidden><\/p>/);
  assert.match(PAGE, /html\[data-kosmos-platform="linux"\] \.s3-gate-row\[data-gate="sleep"\] \.s3-on\{display:none\}/);
  assert.match(PAGE, /<div class="s3-mock" data-win-hide data-linux-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Energy</);
  // Control: the Accessibility mock is not touched by this card.
  assert.match(PAGE, /<div class="s3-mock" data-win-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Accessibility</);
});
