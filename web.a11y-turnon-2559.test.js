'use strict';

/**
 * #2559 day-one (Splinter, 2026-10-03): on a fresh Mac with no Full Disk Access, /api/a11y-status cannot read the
 * app's Accessibility grant and answers {checkable:false}. The onboarding Kosmos row (data-gate="tmux") then sat on
 * "Checking..." with NO Turn On, so a newcomer's first real screen offered no action. Now a row still uncheckable
 * after FR_CHECKING_TURN_ON_MS paints the default "Not activated" + Turn On, and it still never gates Next.
 *
 * This runs the page's REAL FR_GATES, frReadGate and frPollGates (lifted from web/index.html) against a fake DOM, a
 * fake fetch and a fake clock. Red on the code before #2559: the row keeps data-checking for good.
 *
 *   node --test web.a11y-turnon-2559.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/* FR_GATES is an object whose comments contain semicolons, so page.liftConst (which stops at the first ';') would lift
   half of it. Lifted here from its declaration to the '};' that closes it at the start of a line. */
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

/* One first-run screen with a Kosmos (tmux) row and a sleep row. `answers` maps a route to what it returns now;
   `clock.now` is the time frPollGates reads. Returns poll() and the pieces to inspect. */
function harness() {
  const rows = { tmux: fakeRow('tmux'), sleep: fakeRow('sleep') };
  const screen = { querySelectorAll: () => [rows.tmux, rows.sleep] };
  const next = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const document = { querySelector: () => null, getElementById: (id) => (id === 'fr-next' ? next : null) };
  const answers = { '/api/a11y-status': { checkable: false }, '/api/sleep-status': { checkable: false } };
  const fetch = async (url) => ({ json: async () => answers[url] || {} });
  const clock = { now: 1000000 };
  const FakeDate = { now: () => clock.now };
  const src = [
    page.liftConst(SCRIPT, 'FR_CHECKING_TURN_ON_MS'),
    liftObject(SCRIPT, 'FR_GATES'),
    page.liftConst(SCRIPT, 'FR_CHECKING_SINCE'),
    page.lift(SCRIPT, 'frReadGate'),
    page.lift(SCRIPT, 'frPollGates'),
    'return { poll: (gen) => frPollGates(screen, gen), since: FR_CHECKING_SINCE, ms: FR_CHECKING_TURN_ON_MS };',
  ].join('\n');
  const api = new Function('document', 'fetch', 'Date', 'screen', 'platformHides', 'FR_GATE_GEN', src)(
    document, fetch, FakeDate, screen, () => false, 1);
  return { rows, next, answers, clock, poll: () => api.poll(1), api };
}

const checking = (row) => row.hasAttribute('data-checking');
const granted = (row) => row.hasAttribute('data-granted');
const unsure = (row) => row.hasAttribute('data-unsure');

test('#2559: the Kosmos row shows Checking first, then Turn On once it has been uncheckable for the grace period', async () => {
  const h = harness();
  assert.ok(h.api.ms >= 1000 && h.api.ms <= 10000, 'the grace period is a few seconds: ' + h.api.ms);
  await h.poll();
  assert.equal(checking(h.rows.tmux), true, 'a fresh uncheckable reading starts as Checking...');
  h.clock.now += h.api.ms - 1;
  await h.poll();
  assert.equal(checking(h.rows.tmux), true, 'still Checking... just before the grace period ends');
  h.clock.now += 1;
  await h.poll();
  assert.equal(checking(h.rows.tmux), false, 'still Checking... after the grace period: no Turn On for a newcomer');
  assert.equal(granted(h.rows.tmux), false, 'Turn On is the "Not activated" default, never a false green');
  assert.equal(h.next.disabled, false, 'an uncheckable row never gates Next, Turn On or not');
  assert.equal(unsure(h.rows.tmux), true, 'Mona Lisa: the Turn On row reads "Not confirmed" (data-unsure), not the red "Not activated"');
});

test('#2559: a granted read still turns the row Activated at once, and a definite not-granted still blocks Next', async () => {
  const h = harness();
  await h.poll();
  h.clock.now += 60000;
  await h.poll();
  assert.equal(checking(h.rows.tmux), false, 'fixture: the row offers Turn On');
  h.answers['/api/a11y-status'] = { checkable: true, trusted: true };
  await h.poll();
  assert.equal(granted(h.rows.tmux), true, 'a measured grant is green at once');
  assert.equal(unsure(h.rows.tmux), false, 'a measured grant drops "Not confirmed"');
  assert.equal(h.next.disabled, false);
  h.answers['/api/a11y-status'] = { checkable: true, trusted: false };
  await h.poll();
  assert.equal(granted(h.rows.tmux) || checking(h.rows.tmux), false, 'a measured not-granted is the red Turn On row');
  assert.equal(h.next.disabled, true, 'CONTROL: a definite not-granted still gates Next (#2911 re-gate unchanged)');
  assert.equal(unsure(h.rows.tmux), false, 'a KNOWN not-granted is the red "Not activated", never "Not confirmed"');
});

test('#2559: the clock starts again after any other reading, so Checking always gets its grace period', async () => {
  const h = harness();
  await h.poll();
  h.clock.now += 60000;
  h.answers['/api/a11y-status'] = { checkable: true, trusted: true };
  await h.poll();
  h.answers['/api/a11y-status'] = { checkable: false };
  h.clock.now += 1000;
  await h.poll();
  assert.equal(checking(h.rows.tmux), true, 'a NEW uncheckable spell starts as Checking..., not as Turn On');
});

test('#2559 review 1: a clock set backward restarts the Checking spell; the row still reaches Turn On', async () => {
  const h = harness();
  await h.poll();
  h.clock.now -= 3600 * 1000;   // network time corrects the clock an hour back while the row is Checking
  await h.poll();
  assert.equal(checking(h.rows.tmux), true, 'right after the jump the row is Checking (a new spell)');
  h.clock.now += h.api.ms;
  await h.poll();
  assert.equal(checking(h.rows.tmux), false, 'a backward clock jump left the row on Checking past its grace period');
});

test('#2559: only the Kosmos row changes; the advisory sleep row keeps its own Checking... (scope)', async () => {
  const h = harness();
  await h.poll();
  h.clock.now += 60000;
  await h.poll();
  assert.equal(checking(h.rows.tmux), false, 'fixture: the Kosmos row offers Turn On');
  assert.equal(checking(h.rows.sleep), true, 'the sleep row is unchanged by #2559');
});

test('#2559: a new screen starts every row\'s Checking clock afresh (frGateStart clears it)', () => {
  const start = page.lift(SCRIPT, 'frGateStart');
  assert.match(start, /FR_CHECKING_SINCE\.clear\(\)/, 'frGateStart does not reset the Checking clock');
  assert.ok(start.indexOf('FR_CHECKING_SINCE.clear()') < start.indexOf('frPollGates(screenEl, gen)'),
    'the clock must be cleared before the first poll of the new screen');
});

test('#2559 (Mona Lisa): the Kosmos row carries a neutral "Not confirmed" pill that shows only in the unsure state', () => {
  const row = PAGE.slice(PAGE.indexOf('aria-label="Turn on Kosmos accessibility"') - 400, PAGE.indexOf('aria-label="Turn on Kosmos accessibility"'));
  assert.match(row, /<span class="s3-pill s3-pill-wait s3-pill-unsure">Not confirmed<\/span>/, 'the neutral Not confirmed pill is gone from the Kosmos row');
  assert.match(PAGE, /\.s3-pill-unsure\{display:none\}/, 'the Not confirmed pill must be hidden by default');
  assert.match(PAGE, /\.s3-gate-row\[data-unsure\] \.s3-pill-req\{display:none\}/, 'the red pill must hide in the unsure state');
  assert.match(PAGE, /\.s3-gate-row\[data-unsure\] \.s3-pill-unsure\{display:inline\}/, 'the Not confirmed pill must show in the unsure state');
});
