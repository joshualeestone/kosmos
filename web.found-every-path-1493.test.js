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
   frFindAgents and frPaintFound are.
   #4 (0.6.42): frPaintFleet's create-arm gate now also reads frImportOffer (the loose
   agent FILES the scan found), so lift it too -- another pure read of FR_SCAN. Without
   it the gate call throws and every empty-answer control errors instead of asserting. */
const BODY = lift(SCRIPT, 'frFoundOffer') + '\n' + lift(SCRIPT, 'frScanOffer') + '\n' + lift(SCRIPT, 'frImportOffer') + '\n' + lift(SCRIPT, 'frPaintFleet');

/* ⚠️ THIS HARNESS LIFTS frPaintFleet OUT OF ITS MODULE AND CANNOT SEE AN INTEGRATION
   DEFECT (Splinter, 2026-09-02): a test of an extracted copy measures the branch logic,
   not the wired page. The new scan behaviour on the REAL page is covered by
   docs/browser-checks/render-scan-board.js and render-first-run.js's
   `firstrun-fleet-scan-offer` shot, which drive the actual document. FR_SCAN defaults
   to an empty-but-loaded answer here, so every pre-#1938 assertion below reads the same
   branch it always did; the scan-offer branch is exercised by the one test that passes a
   non-empty FR_SCAN. */
function paint(FR, FR_FOUND, FR_SCAN, FR_SCAN_INFLIGHT) {
  const scan = FR_SCAN === undefined ? { ok: true, candidates: [] } : FR_SCAN;
  // #2389 (iter 3): frPaintFleet reads FR_SCAN_INFLIGHT (a global on the real page) to
  // keep the adopt "checking" copy up while a granted two-phase scan is mid-flight, so
  // it must be a declared param here or the lifted function throws a ReferenceError.
  // Defaults falsy (settled) for every existing caller.
  const inflight = FR_SCAN_INFLIGHT === undefined ? false : FR_SCAN_INFLIGHT;
  const els = {};
  const mk = (id) => (els[id] = { id, textContent: '', innerHTML: '', hidden: false, focus() {} });
  const calls = [];
  const fn = new Function('document', 'FR', 'FR_FOUND', 'FR_SCAN', 'FR_MACHINE', 'FR_STEP', 'FR_STEP_YOU',
    'frPaintFound', 'frPaintScan', 'frActions', 'frForkActions', 'frFindAgents', 'frScanAgents', 'frArmRescanOnGrant', 'esc', 'pjSentence', 'FR_SCAN_INFLIGHT',
    BODY + '\nreturn frPaintFleet();');
  fn({ getElementById: (id) => els[id] || mk(id) }, FR, FR_FOUND, scan, null, 6, 3,
    () => calls.push('PAINT-FOUND'), () => calls.push('PAINT-SCAN'), () => calls.push('actions'),
    () => calls.push('fork'), () => calls.push('SEARCH'), () => calls.push('SCAN-SEARCH'),
    // #3/#4(a): frPaintFleet's create arm now calls frArmRescanOnGrant() (arms the grant-flip
    // re-scan poll on S9). This harness lifts frPaintFleet out of its module, so inject it as a
    // no-op stub -- the poll's real behaviour is covered in render-firstrun-scan-on-grant-1652.js.
    () => calls.push('ARM-RESCAN'), String, String, inflight);
  // install-flow-9screen: the fleet painters now write the heading into the
  // pane-9 head (#fr-fleet-title), not the retired shell #fr-title.
  // #2389: also return the body copy so the adopt-arm tests can assert the
  // verbatim "nothing to import" sentence renders only when the scan confirms it.
  return {
    calls,
    title: (els['fr-fleet-title'] || {}).textContent || '',
    box: (els['fr-fleet'] || {}).innerHTML || '',
  };
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

test('#4: loose importable FILES (no folder candidates) route to the scan screen, on BOTH the create and unknown arms', () => {
  /* Josh 0.6.42: 7 loose agent files, no folder candidates. frImportOffer is the
     new second consumer of FR_SCAN, and BOTH create-arm gates must read it -- the
     known-empty (create) arm AND the could-not-count-tmux (unknown) arm, or
     loose-files-only falls through to an empty/could-not-see screen one location
     over (the exact class #4 fixes). */
  const filesOnly = { ok: true, candidates: [], importable: [
    { file: '/Users/x/Documents/a.md', name: 'A', role: 'r', preview: 'You are A.' },
  ] };
  const c = paint({ path: 'create', fleetCount: 0 }, { ok: true, agents: [] }, filesOnly);
  assert.ok(c.calls.includes('PAINT-SCAN'),
    'create arm: loose importable files did not route to the scan screen (fell through to "create your first agent")');
  const u = paint({ path: 'unknown', fleetCount: null }, { ok: true, agents: [] }, filesOnly);
  assert.ok(u.calls.includes('PAINT-SCAN'),
    'unknown arm: loose importable files did not route to the scan screen (fell through to "could not see")');
});

test('#2389: the adopt path SCANS the disk, the one arm #1938 left out', () => {
  /* The adopt arm (>=1 running agent, so tmux said "adopt") rendered the verbatim
     "nothing to import" and returned WITHOUT ever scanning the disk. A person with
     a running fleet AND agents in Documents/Downloads whose folders Claude has no
     record of was told there was nothing to import while it was false. Fire the scan
     here too, exactly as the create and unknown arms do. */
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, null);
  assert.ok(r.calls.includes('SCAN-SEARCH'),
    'the adopt path still never scanned the disk (the #2389 gap #1938 left on this one arm)');
});

test('#2389: while the adopt scan is in flight the screen does NOT assert "nothing to import"', () => {
  /* Same rule the create arm follows for its empty state: the claim about their
     machine must not sit on screen before the disk has been read. */
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, null);
  assert.doesNotMatch(r.box, /nothing to import/,
    'the false "nothing to import" sentence is shown before the disk scan can answer');
  assert.match(r.title, /already have 2 agents/,
    'the running-fleet acknowledgment was dropped during the scan');
});

test('#2389: the adopt scan waits for the found search to settle, so it fires ONCE not twice', () => {
  /* frFindAgents() fires at the top of frPaintFleet for every path, and frFoundOffer()
     reads empty while FR_FOUND is still null. If the adopt arm scanned straight on
     FR_SCAN===null it would fire frScanAgents once at first render (FR_FOUND null) and
     again on the found-settle repaint (FR_SCAN still null) -- two /api/scan-import TCC
     walks and a possible double permission prompt. The FR_FOUND===null gate (mirroring
     the create arm) defers the scan until the found search settles, so it fires once. */
  const r = paint({ path: 'adopt', fleetCount: 2 }, null, null);
  assert.ok(r.calls.includes('SEARCH'), 'the found search did not fire at the top');
  assert.ok(!r.calls.includes('SCAN-SEARCH'),
    'the adopt arm scanned the disk before the found search settled -- the double-fire the FR_FOUND gate prevents');
  assert.doesNotMatch(r.box, /nothing to import/,
    'the false "nothing to import" sentence is shown before the found search even settled');
  assert.match(r.title, /already have 2 agents/, 'the running-fleet acknowledgment was dropped');
});

test('#2389: when the adopt scan finds a folder candidate, it hands to the scan screen', () => {
  const scan = { ok: true, candidates: [{ dir: '/Users/x/work/hers', name: 'Hers', preview: 'You are **Hers**.' }] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, scan);
  assert.ok(r.calls.includes('PAINT-SCAN'),
    'an agent on the adopt person’s disk was not offered; they were told there was nothing to import');
  assert.ok(r.calls.includes('ARM-RESCAN'),
    'the adopt arm did not arm the grant-flip re-scan, so a late file-access grant never re-scans (the #4 gap, one arm over)');
});

test('#2389: loose importable FILES on the adopt path also route to the scan screen', () => {
  /* frImportOffer is the second consumer of FR_SCAN (#4); the adopt gate must read
     it too, or a person with only loose agent files (no folder candidates) plus a
     running fleet falls through to the flat "nothing to import". */
  const filesOnly = { ok: true, candidates: [], importable: [
    { file: '/Users/x/Documents/a.md', name: 'A', role: 'r', preview: 'You are A.' },
  ] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, filesOnly);
  assert.ok(r.calls.includes('PAINT-SCAN'),
    'adopt arm: loose importable files did not route to the scan screen (fell through to "nothing to import")');
});

test('#2389 (iter 3): a still-scanning granted partial does NOT flash the verbatim false claim', () => {
  /* The granted two-phase scan (frScanAgents -> fetchImportScanComplete) sets FR_SCAN to a
     scanning:true partial with no rows yet (the TCC folders land last, and those are exactly
     the #2389 target's) and repaints. FR_SCAN is then non-null with both offers empty, but the
     scan is STILL RUNNING (FR_SCAN_INFLIGHT set). The adopt arm must keep the "checking" copy,
     not render the verbatim "nothing to import" -- that would flash the exact #2389 false claim,
     to the exact target user, for as long as the scan takes. */
  const partial = { ok: true, scanning: true, candidates: [], importable: [] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, partial, true);
  assert.doesNotMatch(r.box, /nothing to import/,
    'the verbatim false claim flashed while a granted two-phase scan was still in flight');
  assert.match(r.box, /Checking this computer/, 'the checking copy was not held during the in-flight partial');
  assert.match(r.title, /already have 2 agents/, 'the running-fleet acknowledgment was dropped');
});

test('#2389 (iter 4): a retry-exhausted still-scanning result does NOT assert the verbatim', () => {
  /* fetchImportScanComplete can return scanning:true after MAX retries; frScanAgents then
     stores FR_SCAN = that result (scanning:true) and CLEARS FR_SCAN_INFLIGHT. That is
     settled-but-not-a-clean-empty: the disk was not finished, so "nothing to import" would be
     false. The verbatim must render only on a clean, complete, readable-empty scan. */
  const exhausted = { ok: true, scanning: true, candidates: [], importable: [] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, exhausted, false);
  assert.doesNotMatch(r.box, /nothing to import/,
    'the verbatim false claim rendered on a retry-exhausted, unfinished scan');
  assert.match(r.title, /already have 2 agents/, 'the running-fleet heading was dropped');
});

test('#2389 (iter 4): a hard scan failure does NOT assert the verbatim', () => {
  /* On a failed read frScanAgents stores FR_SCAN = {ok:false, candidates:[]}. The disk was
     not read, so the adopt arm must not claim "nothing to import" -- the create arm renders
     silent neutral copy here and the unknown arm renders "could not see"; the adopt arm must
     not be the only one making a positive machine claim on a failed read (#1493 SAID-WHILE-FALSE). */
  const failed = { ok: false, candidates: [] };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, failed, false);
  assert.doesNotMatch(r.box, /nothing to import/,
    'the verbatim false claim rendered on a hard scan failure (unread disk)');
  assert.match(r.title, /already have 2 agents/, 'the running-fleet heading was dropped');
});

test('#2389 (iter 5): a tccUnavailable result (grant given, Documents unread) does NOT assert the verbatim', () => {
  /* When file access was granted but the app-identity hatch failed, the scan settles
     bounded.tccUnavailable: Documents/Downloads/Desktop (where the #2389 target's agents live)
     were NOT read, yet the contract marks it full/complete (scanning falsy, FR_SCAN_FULL true),
     so the grant-flip poll STOPS. Claiming "nothing to import" over those unread folders would be
     a PERMANENT false claim on the granted path -- the exact #2389 population. */
  const tccOut = { ok: true, candidates: [], importable: [], bounded: { tccUnavailable: true } };
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, tccOut, false);
  assert.doesNotMatch(r.box, /nothing to import/,
    'the verbatim false claim rendered on a tccUnavailable scan (Documents unread)');
  assert.match(r.title, /already have 2 agents/, 'the running-fleet heading was dropped');
});

test('#2389 CONTROL: with a running fleet and a genuinely empty disk, the verbatim pack copy still renders', () => {
  /* The Josh-ruled sentence (2026-08-17, verbatim) must survive untouched for the
     true-empty case. This pins that the fix ADDED a branch and did not edit the
     ruled string: scan done + nothing on disk => "There is nothing to import". */
  const r = paint({ path: 'adopt', fleetCount: 2 }, { ok: true, agents: [] }, { ok: true, candidates: [] });
  assert.match(r.box, /nothing to import and nothing to wait for/,
    'the verbatim pack sentence was lost for the case where it is true');
  assert.match(r.title, /already have 2 agents/, 'the honest adopt heading was lost');
  assert.ok(!r.calls.includes('PAINT-SCAN'), 'the scan screen fired though there was nothing on the disk');
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
