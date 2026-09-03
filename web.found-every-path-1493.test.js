'use strict';

/**
 * #1493: the disk was only ever read for somebody Kosmos thought had NO agents.
 *
 *   node --test web.found-every-path-1493.test.js
 *
 * 🛑 THE DEFECT. `frFindAgents()` was called from inside the `create` arm of
 * `frPaintFleet`, and `path` comes from `firstrun.js:165`:
 *
 *     const path_ = !here.known ? 'unknown' : (here.count > 0 ? 'adopt' : 'create');
 *
 * ⇒ Two whole populations never had their disk read at all:
 *
 *     adopt     at least one agent running. Screen: "There is nothing to
 *               import and nothing to wait for." SAID WHILE FALSE.
 *     unknown   the roster could not be read. Screen: "We could not see what
 *               is on this computer."
 *
 * ⭐ AND THE SECOND IS THE PERVERSE ONE: `unknown` means tmux could not be
 * asked, and the disk is exactly the source that does not need tmux. The one
 * state where reading the disk is most valuable was the state that skipped it.
 *
 * 🔑 `found()` IS INNOCENT and that was measured separately: the real function
 * against a five-arm fixture returns the agent with `already = false`. The loss
 * was downstream, in the screen never asking.
 *
 * These RUN the real lifted functions rather than matching the source, because
 * every assertion here is about which branch is taken.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync('web/index.html', 'utf8'));
/* #1938: frPaintFleet now also references the disk-scan state (FR_SCAN) and helpers.
   frScanOffer is lifted (it is a pure read of FR_SCAN, so the real function is what we
   want to exercise); frScanAgents and frPaintScan are injected as stubs, the same way
   frFindAgents and frPaintFound are. */
const BODY = lift(SCRIPT, 'frFoundOffer') + '\n' + lift(SCRIPT, 'frScanOffer') + '\n' + lift(SCRIPT, 'frPaintFleet');

/* ⚠️ THIS HARNESS LIFTS frPaintFleet OUT OF ITS MODULE AND CANNOT SEE AN INTEGRATION
   DEFECT (Splinter, 2026-09-02): a test of an extracted copy measures the branch logic,
   not the wired page. The new scan behaviour on the REAL page is covered by
   docs/browser-checks/render-scan-board.js and render-first-run.js's
   `firstrun-fleet-scan-offer` shot, which drive the actual document. FR_SCAN defaults
   to an empty-but-loaded answer here, so every pre-#1938 assertion below reads the same
   branch it always did; the scan-offer branch is exercised by the one test that passes a
   non-empty FR_SCAN. */
function paint(FR, FR_FOUND, FR_SCAN) {
  const scan = FR_SCAN === undefined ? { ok: true, candidates: [] } : FR_SCAN;
  const els = {};
  const mk = (id) => (els[id] = { id, textContent: '', innerHTML: '', hidden: false, focus() {} });
  const calls = [];
  const fn = new Function('document', 'FR', 'FR_FOUND', 'FR_SCAN', 'FR_MACHINE', 'FR_STEP', 'FR_STEP_YOU',
    'frPaintFound', 'frPaintScan', 'frActions', 'frForkActions', 'frFindAgents', 'frScanAgents', 'esc', 'pjSentence',
    BODY + '\nreturn frPaintFleet();');
  fn({ getElementById: (id) => els[id] || mk(id) }, FR, FR_FOUND, scan, null, 6, 3,
    () => calls.push('PAINT-FOUND'), () => calls.push('PAINT-SCAN'), () => calls.push('actions'),
    () => calls.push('fork'), () => calls.push('SEARCH'), () => calls.push('SCAN-SEARCH'), String, String);
  return { calls, title: (els['fr-title'] || {}).textContent || '' };
}

const onDisk = { ok: true, agents: [{ name: 'Hers', dir: '/Users/x/work/hers' }] };

test('🛑 the adopt path offers agents on the disk instead of saying there is nothing to import', () => {
  const r = paint({ path: 'adopt', fleetCount: 2 }, onDisk);
  assert.ok(r.calls.includes('PAINT-FOUND'),
    'somebody with a running agent is still never shown the agents on their own disk');
  assert.doesNotMatch(r.title, /already have/,
    'the screen still claims the fleet is complete while an agent on the disk is not in it');
});

test('🛑 the unknown path reads the disk, which is the one source that does not need tmux', () => {
  const r = paint({ path: 'unknown', fleetCount: null }, onDisk);
  assert.ok(r.calls.includes('PAINT-FOUND'),
    'when the roster could not be read we still refuse to look at the disk');
});

test('the search runs on every path, not only on create', () => {
  for (const path of ['create', 'adopt', 'unknown']) {
    const r = paint({ path, fleetCount: path === 'adopt' ? 2 : 0 }, null);
    assert.ok(r.calls.includes('SEARCH'), 'the ' + path + ' path never looks on the disk');
  }
});

test('the search is started ONCE, not once per arm', () => {
  const r = paint({ path: 'create', fleetCount: 0 }, null);
  assert.equal(r.calls.filter((c) => c === 'SEARCH').length, 1,
    'two fetches for one answer; the generation guard hides it rather than making it right');
});

test('an agent Kosmos ALREADY holds is not offered again', () => {
  /* An "Add to Kosmos" button on an agent Kosmos already holds is an action
     that means nothing, and on the adopt path most rows are that. */
  const held = { ok: true, agents: [{ name: 'Held', dir: '/d', already: true }] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, held);
  assert.ok(!r.calls.includes('PAINT-FOUND'), 'an already-held agent was offered as if it were new');
  assert.match(r.title, /already have 2 agents/, 'the honest adopt screen was lost');
});

test('unknown is UNKNOWN, not a no', () => {
  /* found() leaves `already` undefined when the roster could not be read, and
     that is exactly the unknown path. Treating undefined as "already in" would
     hide every agent in the case this card is about. */
  const noFlag = { ok: true, agents: [{ name: 'Hers', dir: '/d' }] };
  assert.ok(paint({ path: 'unknown', fleetCount: null }, noFlag).calls.includes('PAINT-FOUND'),
    'an agent whose already-flag could not be determined was treated as already held');
});

test('#1938: when found() has nothing but the disk scan does, the create path shows the scan', () => {
  /* The whole point of #1938: found() reaches only folders Claude has a record of, so
     a person's agent that never ran is invisible to it and they land on "create your
     first agent". The disk scan is the complementary population, and the create path
     shows it instead of the empty state. (Branch-level; the wired page is covered by
     docs/browser-checks/render-scan-board.js.) */
  const scan = { ok: true, candidates: [{ dir: '/Users/x/work/hers', name: 'Hers', preview: 'You are **Hers**.' }] };
  const r = paint({ path: 'create', fleetCount: 0 }, { ok: true, agents: [] }, scan);
  assert.ok(r.calls.includes('PAINT-SCAN'),
    'found() empty but the disk had an agent, and the create screen still said "create your first"');
});

test('#1938: the scan runs on the unknown path too, the one source that does not need tmux', () => {
  const r = paint({ path: 'unknown', fleetCount: null }, { ok: true, agents: [] }, null);
  assert.ok(r.calls.includes('SCAN-SEARCH'),
    'the unknown path never scanned the disk, which is exactly the source tmux failure does not touch');
});

test('CONTROLS: the honest empty answers are untouched', () => {
  const none = { ok: true, agents: [] };
  assert.match(paint({ path: 'adopt', fleetCount: 2 }, none).title, /already have 2 agents/,
    'the adopt screen changed for somebody who genuinely has nothing to add');
  assert.match(paint({ path: 'unknown', fleetCount: null }, none).title, /could not see/,
    'the honest could-not-see answer was replaced by a guess');
  assert.match(paint({ path: 'create', fleetCount: 0 }, { ok: false, agents: [] }).title, /Create your first agent/,
    'a search that could not run now paints something else');
});
