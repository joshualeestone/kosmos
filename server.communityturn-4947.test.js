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
  assert.match(w, /postTimes:\s*\(session\)\s*=>\s*require\('\.\/engine\/communitystore'\)\.postTimesBy\(session\)/);
});
