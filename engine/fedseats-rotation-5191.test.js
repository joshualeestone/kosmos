'use strict';
/**
 * kosmos#5191 / #5197 follow-up (Renet's review): both revoke graces rest on one assumption. The owner's
 * graceAfter and the member's REVOKE_GRACE_MS treat EVERY room-key rotation as a revoke. That holds only while
 * the one place an owner advances the room's epoch is the revoke step. A rotation added for any other reason (a
 * periodic key change, a new member) would silently get the revoke grace, and no behavioural test would notice.
 *
 * Two guards, the second because the first can only see the spellings it knows (review round 1):
 * 1. WHO WRITES THE ROOM STATE. Across every engine file, fedseal.setRoomState is called only from a pinned set
 *    of functions: revokeCheck (the rotation, and its clock clamp), ownerHello (the room's creation, epoch 0) and
 *    onKeyFrame (a member ADOPTING the owner's rotation from a frame verified against the pinned owner key, which
 *    creates no rotation of its own). A new caller is a new way the room's key can change: re-decide the graces.
 * 2. HOW THE EPOCH ADVANCES. Exactly one advance spelled "epoch + 1" / "+= 1" / "++", inside revokeCheck. Exactly
 *    one, not "at least one": zero means that spelling is gone and this guard went blind.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = __dirname;
const WRITERS = { 'fedseats.js': ['revokeCheck', 'ownerHello', 'onKeyFrame'] };
const FED_FILES = ['fedseats.js', 'fedseal.js', 'federation.js', 'fedmembers.js'];
const ADVANCE = /\bepoch\s*\+\s*1\b|\bepoch\s*\+=\s*1\b|\bepoch\+\+/;
const TOP_FN = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;

/** For each line of a file, the name of the top-level function it sits in (or null). */
function enclosing(src) {
  let fn = null;
  return src.split('\n').map((line) => {
    const m = TOP_FN.exec(line);
    if (m) fn = m[1];
    // Any other unindented code line (a const, exports, if, try, a call...) ends the function: a writer after an
    // allowed function cannot borrow its name. Closing braces and comment lines do not end it.
    else if (/^[^\s}/*]/.test(line)) fn = null;
    return { line, fn };
  });
}
const code = (line) => line.replace(/(^|[^:])\/\/.*$/, '$1');   // strip a // comment, not a URL's "://"

test('#5191: only revokeCheck, ownerHello and onKeyFrame write a room\'s key state', () => {
  const engineFiles = fs.readdirSync(ENGINE).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  assert.ok(engineFiles.includes('fedseats.js') && engineFiles.includes('fedseal.js'), 'the federation engine files moved: update this guard');
  const found = {};
  for (const f of engineFiles) {
    enclosing(fs.readFileSync(path.join(ENGINE, f), 'utf8')).forEach(({ line, fn }) => {
      // Any mention, not only a call: an alias (const set = fedseal.setRoomState) is a writer too.
      if (!/\bsetRoomState\b/.test(code(line))) return;
      // In fedseal.js, its definition and the top-level export list are not writers (a use inside any function is).
      if (f === 'fedseal.js' && (/^function setRoomState\s*\(/.test(line) || (fn === null && /^\s+.*\bsetRoomState\s*,/.test(line)))) return;
      (found[f] = found[f] || new Set()).add(fn || '(top level)');
    });
  }
  const got = Object.fromEntries(Object.entries(found).map(([f, s]) => [f, [...s].sort()]));
  const want = Object.fromEntries(Object.entries(WRITERS).map(([f, a]) => [f, [...a].sort()]));
  assert.deepEqual(got, want, 'a room\'s key state has a new writer: is it a rotation that is not a revoke? Re-decide graceAfter and REVOKE_GRACE_MS (#5191, #5197), then update WRITERS.');
});

test('#5191: the one epoch advance is inside revokeCheck', () => {
  const hits = [];
  for (const f of FED_FILES) {
    const p = path.join(ENGINE, f);
    assert.ok(fs.existsSync(p), f + ' is gone: update this guard');
    enclosing(fs.readFileSync(p, 'utf8')).forEach(({ line, fn }, i) => {
      if (ADVANCE.test(code(line))) hits.push({ where: f + ':' + (i + 1), fn, line: line.trim() });
    });
  }
  assert.equal(hits.length, 1, 'expected exactly one epoch advance, found:\n' + hits.map((h) => h.where + ' ' + h.line).join('\n'));
  assert.equal(hits[0].fn, 'revokeCheck', 'the epoch advances outside revokeCheck: ' + hits[0].where);
});

test('#5191: graceAfter does not branch on why a room rotated, and still gives the revoke grace', () => {
  const lines = enclosing(fs.readFileSync(path.join(ENGINE, 'fedseats.js'), 'utf8')).filter((l) => l.fn === 'graceAfter');
  assert.ok(lines.length > 0, 'graceAfter is gone: update this guard');
  // Block comments removed too: the next function's doc comment (which the slice reaches) must not trip this.
  const grace = lines.map((l) => code(l.line)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(grace, /reason|why|kind|cause/i, 'graceAfter branches on why a room rotated; re-decide #5191 and #5197 together');
  assert.match(grace, /REVOKE_GRACE_MS/, 'graceAfter no longer gives the revoke grace');
});
