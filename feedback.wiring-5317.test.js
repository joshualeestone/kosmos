'use strict';
/**
 * kosmos#5317 review 1: the writer is named where the report is written (both CLIs), and the board's sweep is the one
 * that also sends a changed yesterday. Dropping either reds this file; the behaviour itself is pinned in
 * engine/feedback.test.js and engine/feedbacksend.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('#5317 the Mac CLI writes the report as the writing agent', () => {
  assert.match(read('install/kosmos'), /fb\.write\(process\.env\.KOSMOS_FEEDBACK_BODY \|\| "", \{ from: fb\.writer\(process\.env\) \}\)/);
});
test('#5317 the Windows CLI writes the report as the writing agent', () => {
  assert.match(read('tools/windows/kosmos-cli.js'), /fb\.write\(body, \{ from: typeof fb\.writer === 'function' \? fb\.writer\(ctx\.env\) : null \}\)/);
});
test('#5317 the board sweep sends a changed yesterday too (sweepTick, not today alone)', () => {
  const s = read('server.js');
  assert.match(s, /feedbacksend\.sweepTick\(\)/);
  assert.doesNotMatch(s, /feedbacksend\.sendDailyOnce\(feedback\.today\(\)\)/);
});
