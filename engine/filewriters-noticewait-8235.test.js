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
  assert.match(room, / mona is handed this notice too, at a prompt of its own; Kosmos looks for it at most once every five minutes, so a prompt sooner than that may not carry it yet\.$/);
  assert.doesNotMatch(own, /five minutes/, 'the owner\'s own copy carries the delivery sentence');
});

test('kosmos#8235: the room note uses the room copy, and the owner is queued the owner copy', () => {
  const src = read('engine/filewriters.js');
  assert.match(src, /messages\.roomNote\(n\.projectId, n\.heldBack \? HELD_BACK_TEXT : roomNoticeText\(n\)/);
  assert.match(src, /require\('\.\/filenotices'\)\.queue\(n\.owner, ownerNoticeText\(n\)\)/);
});

test('kosmos#8235: "five minutes" is what both report hooks wait (FILE_NOTICE_EVERY = 300 s)', () => {
  assert.match(read('engine/kosmos-report-hook.js'), /^const FILE_NOTICE_EVERY = 300;/m);
  assert.match(read('install/kosmos-report-hook.sh'), /^FILE_NOTICE_EVERY=300$/m);
});

test('kosmos#8235: both CLIs\' file-notices usage says the hook asks at most once every five minutes, in the same words', () => {
  const SENT = 'run by hand, this clears them; Kosmos\'s hook asks at most once every five minutes, so a notice can wait that long for your next prompt.';
  assert.ok(require('../tools/windows/kosmos-cli').USAGE['file-notices'].includes(SENT), 'the Windows usage lacks it');
  const mac = read('install/kosmos');
  assert.ok(mac.includes(SENT.replace(/'/g, '\'"\'"\'')), 'the Mac usage lacks it (in its shell quoting)');
});
