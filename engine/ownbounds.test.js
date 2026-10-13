'use strict';
/* #5154 slice B: the needs-you record for Kosmos's OTHER silent bounds (engine/ownbounds.js).
 * The record is on disk (store.ROOT/ownbounds) so forget is reachable from create/remove/delete-leftover;
 * the sandbox below points store.ROOT at a temp dir, as stuckterminal-5154 / crashloop-5154 tests do.
 *
 *   node --test engine/ownbounds.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-ownbounds-5154-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const test = require('node:test');
const assert = require('node:assert/strict');
const ob = require('./ownbounds');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const GRACE = ob.GRACE_MS;
const STALE = ob.STALE_MS;

// Each test uses its own agent key so the shared on-disk dir does not couple them.
function freshKey(name) { ob.forget(name); return name; }

test('sandbox: the store root is the temp dir', () => {
  assert.equal(path.resolve(store.ROOT), path.resolve(SANDBOX, 'Kosmos'));
});

// ---- class gate ----

test('#5154-B: only the three known per-agent classes are accepted; an unknown class is ignored by note', () => {
  for (const c of ['quota', 'nudge', 'firstreply']) assert.equal(ob.isClass(c), true, c);
  // 'assigner' is NOT a class here: its give-up is project-keyed (header), carved out of this per-agent record.
  for (const c of ['assigner', 'connlost', 'crashloop', 'stuck', '', null, undefined]) assert.equal(ob.isClass(c), false, String(c));
  const k = freshKey('unknown-class');
  ob.note(k, 'connlost', 'should not land', 1000);          // not a known class
  assert.deepEqual(ob.readRec(k), {}, 'an unknown class never creates a record');
});

// ---- note / assess (pure-ish on-disk) ----

test('#5154-B: note opens an episode; assess raises it only past GRACE', () => {
  const k = freshKey('leo'); const t0 = 1_000_000;
  ob.note(k, 'nudge', 'gave up nudging after 3 tries (task #4)', t0);
  assert.equal(ob.assess(ob.readRec(k), t0).raised, false, 'just opened: within grace, not raised');
  assert.equal(ob.assess(ob.readRec(k), t0 + GRACE - 1).raised, false, 'one ms before grace: not raised');
  const a = ob.assess(ob.readRec(k), t0 + GRACE);
  assert.equal(a.raised, true, 'at grace: raised');
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].cls, 'nudge');
  assert.equal(a.items[0].sinceAt, t0, 'sinceAt is first-seen');
  assert.equal(a.items[0].forMs, GRACE);
  assert.match(a.items[0].evidence, /gave up nudging/);
});

test('#5154-B: a repeat note keeps sinceAt (the clock runs) but advances lastAt (liveness) and can update evidence', () => {
  const k = freshKey('churn'); const t0 = 2_000_000;
  ob.note(k, 'quota', 'gave up after 3 tries', t0);
  assert.equal(ob.readRec(k).quota.lastAt, t0, 'lastAt stamped at first note');
  ob.note(k, 'quota', 'gave up after 3 tries', t0 + 5000);  // same evidence, later tick
  const rec2 = ob.readRec(k);
  assert.equal(rec2.quota.sinceAt, t0, 'sinceAt unchanged by a repeat note');
  assert.equal(rec2.quota.lastAt, t0 + 5000, 'lastAt advanced by the repeat note (liveness refresh)');
  // a changed evidence string keeps sinceAt and advances lastAt
  ob.note(k, 'quota', 'gave up after 3 tries (reset was 2h ago)', t0 + 9000);
  const rec3 = ob.readRec(k);
  assert.equal(rec3.quota.sinceAt, t0, 'sinceAt still first-seen after evidence update');
  assert.equal(rec3.quota.lastAt, t0 + 9000);
  assert.match(rec3.quota.evidence, /reset was 2h ago/);
});

test('#5154-B: a note after a STALE gap starts a FRESH episode (does not inherit an ancient sinceAt)', () => {
  const k = freshKey('stalegap'); const t0 = 3_000_000;
  ob.note(k, 'nudge', 'gave up #1', t0);
  // a new give-up long after the last note (> STALE_MS): the prior episode is finished, so sinceAt resets
  const t1 = t0 + STALE + 10_000;
  ob.note(k, 'nudge', 'gave up #2', t1);
  assert.equal(ob.readRec(k).nudge.sinceAt, t1, 'fresh clock after a stale gap');
});

test('#5154-B: assess marks a stale entry (not raised) and lists it in .stale for pruning', () => {
  const k = freshKey('staleassess'); const t0 = 4_000_000;
  ob.note(k, 'firstreply', 'gave up', t0);
  assert.equal(ob.assess(ob.readRec(k), t0 + GRACE).raised, true, 'fresh + past grace: raised');
  const a = ob.assess(ob.readRec(k), t0 + STALE);
  assert.equal(a.raised, false, 'past STALE_MS with no re-note: not raised');
  assert.deepEqual(a.stale, ['firstreply'], 'listed for the sweep to prune');
});

test('#5154-B: two classes on one agent are independent; assess sorts oldest-first', () => {
  const k = freshKey('two');
  ob.note(k, 'quota', 'gave up resuming after 3 tries', 100);
  ob.note(k, 'firstreply', 'gave up reminding after 3 tries', 200);
  const a = ob.assess(ob.readRec(k), 200 + GRACE);          // both past GRACE at this point
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].cls, 'quota', 'oldest sinceAt first');
  assert.equal(a.items[1].cls, 'firstreply');
});

// ---- recovered / forget / clearAll ----

test('#5154-B: recovered clears one class and leaves the others; forget drops all', () => {
  const k = freshKey('recov');
  ob.note(k, 'quota', 'a', 100);
  ob.note(k, 'nudge', 'b', 100);
  ob.recovered(k, 'quota');
  const rec = ob.readRec(k);
  assert.equal(rec.quota, undefined, 'quota cleared');
  assert.ok(rec.nudge, 'nudge remains');
  ob.recovered(k, 'quota');                                 // idempotent: clearing an absent class is a no-op
  assert.ok(ob.readRec(k).nudge);
  ob.forget(k);
  assert.deepEqual(ob.readRec(k), {}, 'forget drops the whole record');
  assert.equal(fs.existsSync(ob.fileFor(k)), false, 'and removes the file');
});

test('#5154-B: clearAll wipes every record (the boot reset)', () => {
  ob.note(freshKey('a1'), 'nudge', 'x', 100);
  ob.note(freshKey('a2'), 'quota', 'y', 100);
  assert.ok(ob.keys().length >= 2);
  ob.clearAll();
  assert.deepEqual(ob.keys(), [], 'no records after clearAll');
});

test('#5154-B: peek is read-only (never writes)', () => {
  const k = freshKey('peekonly');
  assert.deepEqual(ob.peek(k, 999).items, [], 'absent record: nothing raised');
  assert.equal(fs.existsSync(ob.fileFor(k)), false, 'peek on an absent key writes nothing');
});

// ---- tellBounds: one push per episode, precedence, recover-and-retell, prune ----

test('#5154-B: tellBounds tells once per episode, not again while it stands', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  ob.note('loopy', 'nudge', 'gave up after 3', 100);
  const rows = [{ key: 'loopy', shown: 'Loopy', ownNeedsYou: false }];
  const tell = (key, item, shown) => calls.push([key, item.cls, shown]);
  ob.tellBounds({ rows, told, now: 100 + GRACE, tell });
  ob.tellBounds({ rows, told, now: 100 + GRACE + 60_000, tell });  // still raised, already told
  assert.equal(calls.length, 1, 'exactly one push for one standing episode');
  assert.deepEqual(calls[0], ['loopy', 'nudge', 'Loopy']);
});

test('#5154-B precedence: an agent in its OWN needs_you is suppressed, then surfaces when that clears', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  ob.note('busy', 'quota', 'gave up resuming', 100);
  const tell = (key, item) => calls.push([key, item.cls]);
  // while the agent has its own question, suppress — and do NOT mark told
  ob.tellBounds({ rows: [{ key: 'busy', shown: 'Busy', ownNeedsYou: true }], told, now: 100 + GRACE, tell });
  assert.equal(calls.length, 0, 'suppressed while the agent has its own needs_you');
  assert.equal(told.size, 0, 'not marked told, so it can still surface later');
  // the agent answers its own question; our give-up still stands → now it surfaces
  ob.tellBounds({ rows: [{ key: 'busy', shown: 'Busy', ownNeedsYou: false }], told, now: 100 + GRACE + 1000, tell });
  assert.deepEqual(calls, [['busy', 'quota']], 'surfaces once the agent’s own question clears');
});

test('#5154-B: a recovered episode clears its told-mark, so a later give-up tells again', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  const tell = (key, item) => calls.push([key, item.cls]);
  ob.note('again', 'quota', 'gave up #1', 100);
  ob.tellBounds({ rows: [{ key: 'again', shown: 'Again', ownNeedsYou: false }], told, now: 100 + GRACE, tell });
  assert.equal(calls.length, 1);
  ob.recovered('again', 'quota');                           // the helper resumed
  ob.tellBounds({ rows: [{ key: 'again', shown: 'Again', ownNeedsYou: false }], told, now: 100 + GRACE + 1000, tell });
  assert.equal(calls.length, 1, 'nothing raised after recovery');
  assert.equal(told.size, 0, 'told-mark cleared');
  ob.note('again', 'quota', 'gave up #2', 200_000);         // a fresh give-up later
  ob.tellBounds({ rows: [{ key: 'again', shown: 'Again', ownNeedsYou: false }], told, now: 200_000 + GRACE, tell });
  assert.equal(calls.length, 2, 'the new episode tells again');
});

test('#5154-B mootness: an idle-only give-up (nudge) clears crisply once the agent is no longer idle', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  ob.note('backtowork', 'nudge', 'gave up nudging', 100);
  // the agent is now working, not idle: its nudge give-up is moot and must clear at once (not be told, not wait STALE)
  ob.tellBounds({ rows: [{ key: 'backtowork', shown: 'Back', state: 'working', ownNeedsYou: false }], told, now: 100 + GRACE, tell: (k, it) => calls.push([k, it.cls]) });
  assert.deepEqual(calls, [], 'a moot (non-idle) nudge give-up is not told');
  assert.equal(ob.readRec('backtowork').nudge, undefined, 'cleared crisply');
});

test('#5154-B mootness: a quota give-up is NOT idle-gated, so a non-idle state does not clear it', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  ob.note('paused', 'quota', 'gave up resuming', 100);
  // a quota-paused agent is not "idle"; a non-idle state must NOT moot-clear a quota give-up (relies on recovered/stale)
  ob.tellBounds({ rows: [{ key: 'paused', shown: 'Paused', state: 'working', ownNeedsYou: false }], told, now: 100 + GRACE, tell: (k, it) => calls.push([k, it.cls]) });
  assert.deepEqual(calls, [['paused', 'quota']], 'quota give-up still told regardless of idle state');
});

test('#5154-B backstop: tellBounds prunes a STALE episode for an agent still on the roster (left the helper view)', () => {
  ob.clearAll();
  const told = new Set(); const calls = [];
  ob.note('leftview', 'nudge', 'gave up', 100);
  const rows = [{ key: 'leftview', shown: 'LeftView', ownNeedsYou: false }];
  // long after the last note, the agent is still on the roster but the helper stopped giving up (it went to
  // working and left the idle list, so no recovered() ever came). The stale entry must be pruned, not told.
  ob.tellBounds({ rows, told, now: 100 + STALE + 1000, tell: (k, it) => calls.push([k, it.cls]) });
  assert.deepEqual(calls, [], 'a stale episode is never told');
  assert.equal(fs.existsSync(ob.fileFor('leftview')), false, 'and is pruned from disk');
});

test('#5154-B: tellBounds prunes a DEPARTED agent’s record on a good roster', () => {
  ob.clearAll();
  const told = new Set();
  ob.note('gone', 'nudge', 'x', 100);
  ob.note('here', 'nudge', 'y', 100);
  // a good roster that no longer contains "gone"
  ob.tellBounds({ rows: [{ key: 'here', shown: 'Here', ownNeedsYou: false }], told, now: 100 + GRACE, tell: () => {} });
  assert.equal(fs.existsSync(ob.fileFor('gone')), false, 'departed agent pruned');
  assert.equal(fs.existsSync(ob.fileFor('here')), true, 'present agent kept');
});

// ---- sweepRoster: the null-skip SAFETY INVARIANT (slice C W3) ----

test('#5154-B W3: sweepRoster does NOTHING on a failed (null) snapshot — never wipes a live record', () => {
  ob.clearAll();
  ob.note('alive', 'nudge', 'x', 100);
  const told = new Set();
  const swept = ob.sweepRoster({ roster: null, told, now: 100 + GRACE, tell: () => { throw new Error('must not tell'); } });
  assert.equal(swept, false, 'a failed read returns false');
  assert.equal(fs.existsSync(ob.fileFor('alive')), true, 'the live record survives a failed snapshot');
});

test('#5154-B: sweepRoster on an empty SUCCESSFUL snapshot ([]) prunes every record', () => {
  ob.clearAll();
  ob.note('x', 'nudge', 'e', 100);
  assert.equal(ob.sweepRoster({ roster: [], told: new Set(), now: 100 + GRACE, tell: () => {} }), true);
  assert.deepEqual(ob.keys(), [], 'empty success prunes every record');
});

// sweepRoster's thin glue -- the our-named filter (`a.sessionName && a.isNamedOurs`) and the
// row mapping (state -> ownNeedsYou for precedence, state passthrough for mootness) -- is deliberately
// NOT unit-tested here, because hand-building `{ sessionName, isNamedOurs, state }` rows violates the
// fixture-discipline lint (a hand stand-in can carry fields the producer never emits). The PRECEDENCE
// and MOOTNESS behaviour it maps into is fully covered by the tellBounds tests above (which take the
// already-mapped `{ key, state, ownNeedsYou }` rows), and the end-to-end render is covered by the
// browser check docs/browser-checks/render-own-bounds-5154.js. Same choice as stuckterminal.test.js.
