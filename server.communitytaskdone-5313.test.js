'use strict';
/* #5313 source pins: the task-BUILT and task-CLOSE server routes each fire ONE community prompt
 * (promptCommunityOnTaskDone) at the moment an agent finishes a task, reaching busy agents the idle
 * sweep never sees. engine/communitytaskdone.test.js proves the pure core and its dedup/booking; this
 * file pins the WIRING, which that unit cannot see: both routes call the helper, with the right guards,
 * AFTER the 200 so a keystroke never delays the response, CLOSE-only (never a reopen) and only on an
 * actual close transition (not a no-op re-close), through the one shared agentInCommunity membership
 * check, and the server helper can never fail a mark. Without these a refactor could drop a guard and
 * every test would stay green (a built route that prompts on an un-build, a reopen that prompts, a
 * no-op re-close that prompts).
 *
 *   node --test server.communitytaskdone-5313.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('the server helper is wrapped so a prompt never fails a mark, uses the sweep\'s gates and the shared membership check, and books only when recorded', () => {
  const start = SRC.indexOf('function promptCommunityOnTaskDone(');
  assert.notEqual(start, -1, 'no promptCommunityOnTaskDone helper');
  const end = SRC.indexOf('catch { return null; }', start);
  assert.notEqual(end, -1, 'the helper no longer swallows its own throw (a prompt must never fail a mark)');
  const fn = SRC.slice(start, end + 30);
  assert.match(fn, /try \{/, 'the helper body is not wrapped in try');
  // gates from the same sources the idle sweep uses (server.communityturn-4947.test.js pins the sweep side)
  assert.match(fn, /liveAllowed:\s*\(\)\s*=>\s*agentnudge\.nudgeEnabled\(liveExecution\.liveExecutionAllowed\(\), process\.env\)/, 'live-exec gate missing');
  assert.match(fn, /brakeOn:\s*\(\)\s*=>\s*communityturn\.brakeOn\(process\.env\)/, 'operator-brake gate missing');
  assert.match(fn, /switchOn:\s*\(\)\s*=>\s*communitysend\.switchOn\(\)/, 'global community switch gate missing');
  assert.match(fn, /prompterOn:\s*\(\)\s*=>\s*heartbeatSetting\.read\(\)\.on === true/, 'Prompter switch gate missing');
  assert.match(fn, /inCommunity:\s*agentInCommunity/, 'the helper is not wired to the shared membership check');
  assert.match(fn, /deliver:\s*\(s, text\)\s*=>\s*chat\.deliverAutomatic\(s, text, roster\)/, 'not delivered through the gated automatic sender');
  // the book is written only when the prompt reached (recorded), and a failed write is surfaced
  assert.match(fn, /if \(r && r\.recorded && communitytaskdone\.writeBook\(book\) === false\)/, 'the book is written unconditionally, or a failed write is not surfaced');
});

test('agentInCommunity is ONE module-scope function (shared by the sweep, the home read-ahead and the task-done prompt, so the three cannot drift)', () => {
  assert.match(SRC, /function agentInCommunity\(session\) \{/, 'agentInCommunity is not a module-scope function');
  assert.equal(SRC.indexOf('function agentInCommunity(session) {', SRC.indexOf('function agentInCommunity(session) {') + 1), -1, 'agentInCommunity is defined more than once');
});

test('the task-BUILT route fires the prompt AFTER the 200, guarded, with trigger built, exactly once', () => {
  const at = SRC.indexOf("trigger: 'built'");
  assert.notEqual(at, -1, 'no built-route community prompt');
  assert.equal(SRC.indexOf("trigger: 'built'", at + 1), -1, 'more than one built-route prompt');
  const line = SRC.slice(SRC.lastIndexOf('\n', at) + 1, SRC.indexOf('\n', at));
  assert.match(line, /promptCommunityOnTaskDone\(/, 'the built trigger does not call the helper');
  const guard = SRC.lastIndexOf('if (!viaScreen && body.clear !== true && out.changed && card) {', at);
  assert.notEqual(guard, -1, 'the built prompt is not guarded by !viaScreen && body.clear !== true && out.changed && card');
  const builtSend = SRC.indexOf('sendJson(res, 200, { task: out.task');
  assert.notEqual(builtSend, -1, 'the built route 200 was not found');
  assert.ok(builtSend < at, 'the built prompt does not fire after the 200 (it could delay the response)');
});

test('the task-CLOSE route fires the prompt only on an actual close transition: close-not-reopen, actor present, not from the screen, and NOT a no-op re-close; after the 200; exactly once', () => {
  const at = SRC.indexOf("trigger: 'closed'");
  assert.notEqual(at, -1, 'no close-route community prompt');
  assert.equal(SRC.indexOf("trigger: 'closed'", at + 1), -1, 'more than one close-route prompt');
  const line = SRC.slice(SRC.lastIndexOf('\n', at) + 1, SRC.indexOf('\n', at));
  assert.match(line, /promptCommunityOnTaskDone\(/, 'the close trigger does not call the helper');
  // the full close guard, as one literal so a dropped clause fails loudly
  const closeGuard = "if (taskAct[3] === 'close' && actor && !isViaScreen(req, {}) && !closedBeforeThisCall) {";
  assert.notEqual(SRC.indexOf(closeGuard), -1, 'the close prompt guard changed (close-only + actor + not-viaScreen + not-a-no-op-re-close)');
  // after the close 200
  const closeSend = SRC.indexOf('sendJson(res, 200, { task: t, told })');
  assert.notEqual(closeSend, -1, 'the close route 200 was not found');
  assert.ok(closeSend < at, 'the close prompt does not fire after the 200');
  // the no-op guard is computed from the DERIVED closed state (progressOf), not raw closedAt
  assert.match(SRC, /closedBeforeThisCall = !!\(held && tasks\.progressOf\(held\)\.closed\)/, 'the no-op re-close guard is not computed from the derived closed state');
});
