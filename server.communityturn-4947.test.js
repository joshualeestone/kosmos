'use strict';
/* #4947 slice 2: source pins on the community-turn timer in server.js. engine/communityturn.test.js proves the planner
 * and the tick; this pins that the board wires it to the gated sender and to every gate.
 *
 *   node --test server.communityturn-4947.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const at = SRC.indexOf('communityturn.tickOnce({');   // const done = communityturn.tickOnce({ ... })
const w = at === -1 ? '' : SRC.slice(at, SRC.indexOf('});', at));

test('the community-turn timer exists and calls communityturn.tickOnce', () => {
  assert.notEqual(at, -1, 'no communityturn.tickOnce call in server.js');
  assert.ok(w.includes('DELIVERY:') && w.includes('log:'), 'review 6: the pinned window does not reach the end of the call');
  assert.equal(SRC.indexOf('communityturn.tickOnce({', at + 1), -1, 'more than one community-turn call');
});

test('it sends through chat.deliverAutomatic (the quota hold and the Gemini cap apply), never plain deliver', () => {
  assert.match(w, /deliver:\s*\(session, text, r\)\s*=>\s*chat\.deliverAutomatic\(session, text, r, undefined, undefined\)/);
  assert.doesNotMatch(w, /chat\.deliver\(/);
});

test('it passes every gate: live execution, the community switch, the Prompter\'s switch, and the env for the brake', () => {
  assert.match(w, /allowed:\s*\(\)\s*=>\s*liveExecution\.liveExecutionAllowed\(\)/);
  assert.match(w, /switchOn:\s*\(\)\s*=>\s*communitysend\.switchOn\(\)/);
  assert.match(w, /prompterOn:\s*\(\)\s*=>\s*heartbeatSetting\.read\(\)\.on === true/);
  assert.match(w, /env:\s*process\.env/);
});

test('an agent counts as in the community only when its instructions carry exactly one community block', () => {
  // #5212: the check is one function above the call, shared by the turn and the home read-ahead.
  const pre = SRC.slice(SRC.lastIndexOf('const communityTurnTick', at), at);
  assert.match(pre, /const inCommunity = \(session\) => \{[\s\S]*?projects\.findBlock\(cur\.text \|\| '', cb\.START, cb\.END\)[\s\S]*?f\.ambiguous !== true/);
  assert.match(w, /\binCommunity,/, 'the turn is not given the shared check');
  assert.match(w, /postTimes:\s*\(session\)\s*=>\s*\{ const all = allPosts\(\);/);
});

test('review 1: it shares the board-wide hour log and Agent Communication\'s limit, reads projects, the idle report and the quota hold', () => {
  const pre = SRC.slice(SRC.lastIndexOf('const communityTurnTick', at), at);
  assert.match(pre, /postsNow = require\('\.\/engine\/communitystore'\)\.postTimesAll\(\)/, 'posts.json is not read once a pass');
  assert.match(w, /sent:\s*AGENT_NUDGE_SENT/);
  assert.match(w, /idleSeen:\s*COMMUNITY_TURN_IDLE_SEEN/, 'review 4: idle at the previous pass is not wired');
  assert.match(w, /readLimit:\s*\(\)\s*=>\s*limits\.read\(\)/);
  assert.match(w, /readProjects:\s*\(\)\s*=>\s*projects\.readAll\(\)/);
  assert.match(w, /idleSince:\s*\(session\)\s*=>\s*\{ const r = selfreport\.read\(session\)/);
  assert.match(w, /quotaHeld:\s*\(session, roster\)\s*=>\s*require\('\.\/engine\/agyquota'\)\.heldForQuota\(session, roster, Date\.now\(\)\) !== null/);
});

test('review 6: the tries book is read at boot and written after every pass', () => {
  const pre = SRC.slice(SRC.lastIndexOf('const COMMUNITY_TURN_BOOK', at), at);
  assert.match(pre, /const COMMUNITY_TURN_BOOK = communityturn\.readBook\(\);/);
  const after = SRC.slice(at, SRC.indexOf('communityTurnTick.unref', at));
  assert.match(after, /\}\);\s*if \(done\.length\) communityturn\.writeBook\(COMMUNITY_TURN_BOOK\);/);
});

test('#5212 (April\'s review 4): the turn is given the home line, and each pass reads ahead for the next', () => {
  assert.match(w, /lineFor:\s*\(session\)\s*=>\s*communityHomeLine\(session\)/, 'the turn is not given the waiting line');
  const after = SRC.slice(at, SRC.indexOf('communityTurnTick.unref', at));
  assert.match(after, /refreshHomeLines\(stale\.slice\(0, HOME_REFRESH_PER_PASS\)\)/, 'no read-ahead after a pass');
  assert.match(after, /inCommunity\(s\)/, 'the read-ahead is not limited to community members');
  assert.match(SRC, /function communityHomeLine\(session\) \{ const e = homeFresh\(session\); return e \? e\.line : null; \}/);
});

test('#5296: the turn is given the agent\'s report history, so a further prompt needs work since the last post', () => {
  assert.match(w, /history:\s*\(session\)\s*=>\s*selfreport\.history\(session\)/);
});

test('#5297: at board start the community block is refreshed in the agents that carry it, and an agent whose rules changed is owed a re-read', () => {
  const r = SRC.indexOf("require('./engine/communityblock').refreshEveryone(safeRoster(), communityswitch.participating())");
  assert.notEqual(r, -1, 'no board-start refresh of the community block');
  const win = SRC.slice(r, SRC.indexOf('could not refresh what agents know about the Kosmos+ community', r + 300));
  assert.match(win, /t\.rulesChanged === true/, 'agents are owed a re-read whether or not their rules changed');
  assert.match(win, /ir\.owe\(owed, t\.agent, 'community'\)/);
  assert.match(win, /ir\.writeOwed\(owed\)/);
  assert.ok(r < SRC.indexOf("/* #5050: the person's language block, refreshed at boot"), 'the refresh is not among the board-start sweeps');
  assert.ok(r > SRC.indexOf('const told = dmfiles.syncEveryone(safeRoster());'), 'the refresh is not among the board-start sweeps');
});

test('#5297: the board runs instructionreread.passOnce on a timer with the idle gate, the automatic sender and live execution', () => {
  const a = SRC.indexOf('async function instructionRereadPass()');
  assert.notEqual(a, -1, 'no re-read pass');
  const fn = SRC.slice(a, SRC.indexOf('function instructionRereadOwe', a));
  assert.match(fn, /ir\.passOnce\(\{/);
  assert.match(fn, /isIdle:\s*\(c\)\s*=>\s*require\('\.\/engine\/agentnudge'\)\.nudgeableCard\(c\)/, 'the pass is not given the idle-card gate');
  assert.match(fn, /seenIdle:\s*INSTRUCTION_REREAD_IDLE_SEEN/);
  assert.match(fn, /allowed:\s*\(\)\s*=>\s*liveExecution\.liveExecutionAllowed\(\)/);
  assert.match(fn, /deliver:\s*\(session, line, r\)\s*=>\s*chat\.deliverAutomaticAsync\(session, line, r, undefined, undefined\)/);
  assert.match(fn, /history:\s*\(session\)\s*=>\s*selfreport\.history\(session\)/);
  assert.doesNotMatch(fn, /chat\.deliver\(|chat\.deliverAsync\(/);
  assert.match(SRC, /setInterval\(\(\) => \{ instructionRereadPass\(\); \}, INSTRUCTION_REREAD_MS\)/);
});

test('#5297 / #4890: a consented working-rules refresh (per agent AND fleet) owes the running agent a re-read', () => {
  assert.match(SRC, /const got = doctrine\.refresh\(name, safeRoster\(\), \{ expectHash: body\.hash \}\);\s*if \(got && got\.state === 'added'\) instructionRereadOwe\(name\);/);
  assert.match(SRC, /const got = doctrine\.refresh\(name, roster\);\s*if \(got && got\.state === 'added'\) instructionRereadOwe\(name\);/);
  const owe = SRC.slice(SRC.indexOf('function instructionRereadOwe'), SRC.indexOf('function instructionRereadOwe') + 300);
  assert.match(owe, /oweNow\(session, 'rules'\)/);
});
