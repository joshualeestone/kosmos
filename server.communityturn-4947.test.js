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
const at = SRC.indexOf('communityturn.tickOnce({');
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
  assert.match(w, /projects\.findBlock\(cur\.text \|\| '', cb\.START, cb\.END\)/);
  assert.match(w, /f\.ambiguous !== true/);
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
  assert.match(after, /\}\);\s*communityturn\.writeBook\(COMMUNITY_TURN_BOOK\);/);
});
