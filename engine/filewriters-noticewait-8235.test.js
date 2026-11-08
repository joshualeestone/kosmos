'use strict';
/**
 * kosmos#8235: a file-owner notice reaches the owner at a prompt of its own, fetched at most once every five minutes,
 * so a check made just after the change can read as the feature not working. The throttle stays; it is said where a
 * checker reads: the room's copy of the notice, and the `kosmos file-notices` usage on both CLIs.
 *   node --test engine/filewriters-noticewait-8235.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fw = require('./filewriters');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const N = { name: 'brief.md', owner: 'mona', writer: 'kitty' };

test('kosmos#8235: the room\'s copy says when the owner gets its own; the owner\'s copy does not', () => {
  const room = fw.roomNoticeText(N);
  const own = fw.ownerNoticeText(N);
  assert.ok(room.startsWith(own + ' '), 'the room copy is not the owner\'s text plus a sentence');
  assert.match(room, / If mona runs in Claude Code, Kosmos also hands it this notice at a prompt of its own, looking at most once every five minutes, so a prompt soon after its last look may not carry it yet\.$/);
  assert.doesNotMatch(own, /five minutes/, 'the owner\'s own copy carries the delivery sentence');
});

// Which copy reaches the room and which the owner is measured end to end in engine/filenotices-7989.test.js.

test('kosmos#8235: "five minutes" is what both report hooks wait (FILE_NOTICE_EVERY = 300 s)', () => {
  assert.match(read('engine/kosmos-report-hook.js'), /^const FILE_NOTICE_EVERY = 300;/m);
  assert.match(read('install/kosmos-report-hook.sh'), /^FILE_NOTICE_EVERY=300$/m);
});

test('kosmos#8235: both CLIs\' file-notices usage says the hook asks at most once every five minutes, in the same words', () => {
  const SENT = 'run by hand, this clears them; Kosmos\'s hook looks at most once every five minutes, so a prompt soon after its last look may not carry a new notice.';
  assert.ok(require('../tools/windows/kosmos-cli').USAGE['file-notices'].includes(SENT), 'the Windows usage lacks it');
  const mac = read('install/kosmos');
  assert.ok(mac.includes(SENT.replace(/'/g, '\'"\'"\'')), 'the Mac usage lacks it (in its shell quoting)');
});
