'use strict';
/**
 * kosmos#5191 / #5197 follow-up (Renet's review): both revoke graces rest on one assumption. The owner's
 * graceAfter and the member's REVOKE_GRACE_MS treat EVERY room-key rotation as a revoke. That holds only
 * while the one place an owner advances the room's epoch is rotateForRevoked. A rotation added for any other
 * reason (a periodic key change, a new member) would silently give a non-revoke rotation the revoke grace,
 * or a revoke a different one, and no behavioural test would notice.
 *
 * So this pins the structure: across the federation engine there is exactly ONE epoch advance, and it is
 * inside revokeCheck, the step that rotates a room once a member's edge is found revoked (rotateForRevoked is
 * its thin wrapper, and checkRoom calls it on the edge check). Exactly one (not "at least one"): zero means the pattern no longer matches the
 * code (the guard went blind), two means a second rotation path exists and graceAfter needs re-deciding.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['fedseats.js', 'fedseal.js', 'federation.js', 'fedmembers.js'];
// An epoch advance: "<something>.epoch + 1", "epoch + 1" or "epoch += 1" / "epoch++".
const ADVANCE = /\bepoch\s*\+\s*1\b|\bepoch\s*\+=\s*1\b|\bepoch\+\+/;

/** The body of a top-level `function name(` in src, up to the next top-level function or the end. */
function body(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.notEqual(start, -1, 'no top-level function ' + name + ': the guard must be updated with the code');
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test('#5191: the one place the room epoch advances is revokeCheck, so every rotation is a revoke', () => {
  const hits = [];
  for (const f of FILES) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');   // a comment that mentions epoch + 1 is not an advance
      if (ADVANCE.test(code)) hits.push(f + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  assert.equal(hits.length, 1, 'expected exactly one epoch advance (in revokeCheck), found:\n' + hits.join('\n'));
  const rotate = body(fs.readFileSync(path.join(__dirname, 'fedseats.js'), 'utf8'), 'revokeCheck');
  assert.ok(rotate.includes(hits[0].split(': ').slice(1).join(': ')), 'the epoch advance is not inside revokeCheck: ' + hits[0]);
});

test('#5191: graceAfter gives the revoke grace to every rotation a member can see, and none to an owner with no member', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fedseats.js'), 'utf8');
  const grace = body(src, 'graceAfter');
  // The shape that makes "every rotation is a revoke" the only reading: no branch on why the room rotated.
  assert.doesNotMatch(grace, /reason|why|kind|cause/i, 'graceAfter now branches on why a room rotated; re-decide #5191 and #5197 together');
  assert.match(grace, /REVOKE_GRACE_MS/, 'graceAfter no longer gives the revoke grace');
});
