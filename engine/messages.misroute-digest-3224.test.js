'use strict';

/**
 * #3224: suspectedMisrouteCount -- the digest-time, read-only measure of how
 * many room posts in a window were suspected cross-project misroutes (a post to
 * project A while the author owed an unanswered addressed operator question in a
 * different project B, AS OF the moment of that post).
 *
 * Seeds the message record directly with controlled timestamps (not via
 * sendPost) so the AS-OF-POST-TIME ordering -- ask < post < answer vs
 * ask < answer < post -- is deterministic rather than at the mercy of
 * millisecond collisions between real sends. Rows are crafted to the exact
 * shape record()'s read-side filter accepts (id/from/project strings, to array,
 * text string, outcomes object), so a crafted row silently dropped would fail
 * the count assertion loudly rather than pass.
 */

const os = require('node:os');
const SANDBOX = require('node:path').join(os.tmpdir(), 'kosmos-misroute-digest-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');

const PLACED = chat.DELIVERY.PLACED;
const COULD_NOT = chat.DELIVERY.COULD_NOT;

// A fixed base so timestamps are explicit and ordered by construction.
const BASE = Date.parse('2026-09-17T12:00:00.000Z');
const iso = (offsetMs) => new Date(BASE + offsetMs).toISOString();

function ask(id, project, who, atMs, outcome = PLACED) {
  return { kind: 'post', id, from: 'you', project, to: [who], text: '@' + who + ' where is it?',
    operator: true, mentioned: [who], outcomes: { [who]: outcome }, at: iso(atMs) };
}
function post(id, project, who, atMs) {
  return { kind: 'post', id, from: who, project, to: [], text: 'posting', outcomes: {}, at: iso(atMs) };
}

/** Replace the whole message log with these rows, fresh cache. */
function seed(rows) {
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh (file OR a leftover dir from the read-failure test) */ }
  fs.mkdirSync(require('node:path').dirname(messages.LOG), { recursive: true });
  fs.writeFileSync(messages.LOG, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  messages.resetForTests();
}

// A window comfortably covering everything seeded around BASE.
const WIN_LO = BASE - 1000;
const WIN_HI = BASE + 10 * 60 * 1000;

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('a post to A while owing B (never answered) counts as 1 suspected misroute', () => {
  seed([ ask('q1', 'projB', 'mara', 0), post('p1', 'projA', 'mara', 60000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 1);
});

test('answered B BEFORE posting to A does NOT count (debt cleared before the post)', () => {
  seed([ ask('q1', 'projB', 'mara', 0), post('a1', 'projB', 'mara', 30000), post('p1', 'projA', 'mara', 60000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0);
});

test('answered B AFTER posting to A STILL counts (as-of-post-time: the misroute happened)', () => {
  seed([ ask('q1', 'projB', 'mara', 0), post('p1', 'projA', 'mara', 60000), post('a1', 'projB', 'mara', 120000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 1,
    'a misroute that was later answered must still be counted');
});

test('a post to the SAME room owed is not a misroute', () => {
  seed([ ask('q1', 'projB', 'mara', 0), post('p1', 'projB', 'mara', 60000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0);
});

test('an ask that arrives AFTER the post does not count (the debt did not exist when the post happened)', () => {
  // Exercises the other half of the guard (ask.askAt >= postAt): post at 60000,
  // the operator question in B only at 90000.
  seed([ post('p1', 'projA', 'mara', 60000), ask('q1', 'projB', 'mara', 90000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0,
    'a post cannot be a misroute for a question asked only later');
});

test('only posts inside [since, until) are counted', () => {
  seed([ ask('q1', 'projB', 'mara', 0), post('p1', 'projA', 'mara', 60000) ]);
  // A window that starts after the post excludes it.
  assert.equal(messages.suspectedMisrouteCount(BASE + 90000, WIN_HI), 0, 'post before the window counted');
  // A window that ends before the post excludes it.
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, BASE + 30000), 0, 'post after the window counted');
  // A window covering it counts it.
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 1);
});

test('a colleague (non-operator) ask never owes, and an undelivered operator ask never owes', () => {
  // Colleague ask (operator:false): not an owed operator question.
  const colleagueAsk = { kind: 'post', id: 'c1', from: 'leo', project: 'projB', to: ['mara'],
    text: '@mara ping', mentioned: ['mara'], outcomes: { mara: PLACED }, at: iso(0) };
  seed([ colleagueAsk, post('p1', 'projA', 'mara', 60000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0, 'a colleague mention manufactured an owed debt');

  // Undelivered operator ask (could_not): nothing reached the pane, so not owed.
  seed([ ask('q1', 'projB', 'mara', 0, COULD_NOT), post('p1', 'projA', 'mara', 60000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0, 'an undelivered ask manufactured an owed debt');
});

test('multiple misroute posts by the same agent each count', () => {
  seed([ ask('q1', 'projB', 'mara', 0),
         post('p1', 'projA', 'mara', 60000),
         post('p2', 'projC', 'mara', 90000) ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 2);
});

test('no cross-(agent, project) collision even with space-bearing names/projects (nested map, no delimiter)', () => {
  // Under a space-joined string key this would FALSE-CLEAR: agent 'a' owes project
  // 'b c', and a DIFFERENT agent 'a b' answering in project 'c' both map to the key
  // "a b c". The nested map keeps ('a','b c') and ('a b','c') distinct, so agent a's
  // debt is not cleared and its later post elsewhere still counts. (Agent names /
  // project ids cannot actually contain spaces, so this guards a future charset
  // relaxation, not a reachable production case -- but it pins the fix.)
  seed([
    ask('q1', 'b c', 'a', 0),            // operator asks agent 'a' in project 'b c'
    post('ans', 'c', 'a b', 30000),      // different agent 'a b' posts in project 'c'
    post('p1', 'projX', 'a', 60000),     // agent 'a' posts elsewhere while still owing 'b c'
  ]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 1,
    "agent 'a b' answering project 'c' must not clear agent 'a' debt in project 'b c'");
});

test('an EMPTY record yields 0 (distinct from unreadable)', () => {
  seed([]);
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), 0);
});

test('a genuinely UNREADABLE record yields null, not 0 (so the digest omits the line, never a false zero)', () => {
  const path = require('node:path');
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  // Make the log path a DIRECTORY so record()'s read fails (rec.ok false) -- the
  // could-not-read state, which must NOT collapse to the empty-record 0.
  fs.mkdirSync(messages.LOG, { recursive: true });
  messages.resetForTests();
  assert.equal(messages.suspectedMisrouteCount(WIN_LO, WIN_HI), null,
    'an unreadable record must return null, not a false 0');
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* cleanup */ }
});
