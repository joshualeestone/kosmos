'use strict';

/**
 * Delete your history.
 *
 * 🛑 EVERY TEST HERE RUNS AGAINST A SANDBOXED DATA ROOT, SET BEFORE THE MODULE
 * LOADS, and that is not routine hygiene for this file: it is the one module in
 * the product whose whole job is `rmSync(..., {recursive: true})`. An
 * unsandboxed run of these tests would delete the operator's real
 * conversations, which is precisely the outcome the module is written to make
 * deliberate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const forget = require('./forget');

function seed() {
  fs.rmSync(nodePath.join(store.ROOT, 'chats'), { recursive: true, force: true });
  fs.rmSync(nodePath.join(store.ROOT, 'commitments'), { recursive: true, force: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'chats'), { recursive: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'commitments'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'chats', 'april.json'), '[]');
  fs.writeFileSync(nodePath.join(store.ROOT, 'chats', 'room-1.json'), '[]');
  fs.writeFileSync(nodePath.join(store.ROOT, 'commitments', 'april.json'), '{}');
  // The compiled daily rollup (#2924): a DERIVED view of chats/, deleted WITH
  // the chats kind but not counted. Seeded so its deletion is observed.
  fs.rmSync(nodePath.join(store.ROOT, 'chats-daily'), { recursive: true, force: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'chats-daily'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'chats-daily', '2026-09-13.md'), '# a day');
  // The things that MUST survive, seeded so their survival is observed rather
  // than assumed.
  fs.mkdirSync(nodePath.join(store.ROOT, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(store.ROOT, 'avatars'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'profiles', 'april.json'), '{"role":"Researcher"}');
  fs.writeFileSync(nodePath.join(store.ROOT, 'avatars', 'april.png'), 'not really a png');
  fs.writeFileSync(nodePath.join(store.ROOT, 'projects.json'), '[{"id":"p1"}]');
  fs.writeFileSync(nodePath.join(store.ROOT, 'first-run.json'), '{"completedAt":"x"}');
}

test('the summary counts what is there, per kind', () => {
  seed();
  const sum = forget.summary();
  assert.equal(sum.readable, true);
  assert.equal(sum.total, 3);
  const byKey = Object.fromEntries(sum.parts.map((p) => [p.key, p.count]));
  assert.deepEqual(byKey, { chats: 2, commitments: 1 });
  // The words the screen says come from here, so a change to them is a change
  // to a sentence somebody reads before an irreversible act.
  assert.deepEqual(sum.parts.map((p) => p.label), ['conversations', 'reports']);
});

test('an empty store reads as zero, not as unreadable', () => {
  seed();
  fs.rmSync(nodePath.join(store.ROOT, 'chats'), { recursive: true, force: true });
  fs.rmSync(nodePath.join(store.ROOT, 'commitments'), { recursive: true, force: true });
  const sum = forget.summary();
  assert.equal(sum.total, 0);
  /* ⚠️ AND IT IS STILL READABLE. "Nothing to delete" and "we could not look"
     must not collapse into one answer: the screen offers the button on the
     first and refuses it on the second. */
  assert.equal(sum.readable, true);
});

test('it deletes both kinds and NOTHING else', () => {
  seed();
  const out = forget.forget();
  assert.equal(out.ok, true, out.because);
  assert.equal(out.total, 3);
  assert.equal(fs.existsSync(nodePath.join(store.ROOT, 'chats')), false, 'the conversations survived');
  assert.equal(fs.existsSync(nodePath.join(store.ROOT, 'commitments')), false, 'the reports survived');

  /**
   * 🔑 THE HALF THAT MATTERS MORE. A delete that removes the right things and
   * one extra is a worse failure than one that removes nothing, and nothing in
   * the "it deleted the chats" assertions above can see it. Each of these was
   * seeded above precisely so its survival is measured.
   *
   * ⚠️ The transcripts are not listed here because they are not in this root at
   * all -- they are Claude Code's, under ~/.claude/projects, shared across
   * accounts. That they are unreachable from this module is the guarantee; a
   * test asserting their survival would imply they were ever in scope.
   */
  for (const kept of [['profiles', 'april.json'], ['avatars', 'april.png']]) {
    assert.ok(fs.existsSync(nodePath.join(store.ROOT, ...kept)), kept.join('/') + ' was deleted');
  }
  assert.equal(fs.readFileSync(nodePath.join(store.ROOT, 'projects.json'), 'utf8'), '[{"id":"p1"}]',
    'projects were deleted or rewritten');
  assert.ok(fs.existsSync(nodePath.join(store.ROOT, 'first-run.json')), 'first-run was deleted');
  assert.ok(fs.existsSync(store.ROOT), 'the data folder itself was deleted');
});

test('forgetting conversations also deletes their compiled daily rollup (#2924)', () => {
  /* The derived chats-daily rollup holds conversation content in a second place,
     so a forget that leaves it behind is a plaintext privacy residue. It is not
     counted (summary total stays 3), but it must be GONE after the forget. */
  seed();
  assert.ok(fs.existsSync(nodePath.join(store.ROOT, 'chats-daily')), 'fixture must seed chats-daily');
  const out = forget.forget();
  assert.equal(out.ok, true, out.because);
  assert.equal(fs.existsSync(nodePath.join(store.ROOT, 'chats-daily')), false,
    'the compiled daily rollup survived the forget - a plaintext residue');
});

test('forget REFUSES a derived dir that escapes the data root, and deletes nothing outside', () => {
  /* The whole premise of this module is that a computed path outside the data
     root is refused before rmSync. This drives that guard on the NEW derived-dir
     path with a deliberately-escaping list, so a regression that flips it to
     always-pass goes red instead of silently deleting outside the root. */
  seed();
  const outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-escape-'));
  fs.writeFileSync(nodePath.join(outside, 'sentinel'), 'x');
  const escaping = [{
    key: 'chats',
    dir: () => nodePath.join(store.ROOT, 'chats'),
    label: 'conversations', one: 'conversation',
    derived: [{ base: nodePath.basename(outside), dir: () => outside }],
  }];
  const out = forget.forget(escaping);
  assert.equal(out.ok, false, 'a derived dir outside the data root must be refused');
  assert.match(out.because, /outside your Kosmos data folder/);
  assert.ok(fs.existsSync(nodePath.join(outside, 'sentinel')), 'a dir outside the data root must NOT be deleted');
  // Atomicity: a derived-guard failure must delete NOTHING, including the kind's
  // own dir -- guards all run before any delete.
  assert.ok(fs.existsSync(nodePath.join(store.ROOT, 'chats')), 'a refusal must not have already deleted the parent kind');
  fs.rmSync(outside, { recursive: true, force: true });
});

test('forget REFUSES a derived dir whose basename does not match, and does not delete it', () => {
  seed();
  const insideWrong = nodePath.join(store.ROOT, 'chats-daily');
  fs.mkdirSync(insideWrong, { recursive: true });
  fs.writeFileSync(nodePath.join(insideWrong, 'keep'), 'x');
  const mismatched = [{
    key: 'chats',
    dir: () => nodePath.join(store.ROOT, 'chats'),
    label: 'conversations', one: 'conversation',
    derived: [{ base: 'not-the-basename', dir: () => insideWrong }],
  }];
  const out = forget.forget(mismatched);
  assert.equal(out.ok, false, 'a derived dir with a mismatched basename must be refused');
  assert.match(out.because, /does not look like the folder/);
  assert.ok(fs.existsSync(nodePath.join(insideWrong, 'keep')), 'a mismatched derived dir must NOT be deleted');
  assert.ok(fs.existsSync(nodePath.join(store.ROOT, 'chats')), 'a refusal must not have already deleted the parent kind');
});

test('deleting twice is not an error', () => {
  seed();
  assert.equal(forget.forget().ok, true);
  const again = forget.forget();
  assert.equal(again.ok, true, again.because);
  assert.equal(again.total, 0, 'the second pass claimed to delete things that were already gone');
});

test('the surface is exactly two names, and widening it takes an edit here', () => {
  /* 🛑 THE SCOPE IS THE FEATURE. This pins the list itself, so adding a third
     kind cannot happen as a side effect of some other change: it goes red, and
     whoever widened it has to say so in a diff somebody reads. */
  assert.deepEqual(forget.KINDS.map((k) => k.key), ['chats', 'commitments']);
});

test('the full deletable-directory surface is pinned, derived dirs included', () => {
  /* 🛑 KINDS keys alone do NOT see a `derived` dir, which is a second way to add
     a deletable directory. This pins the WHOLE surface -- every dir forget()
     can rmSync, kind dirs and derived dirs alike -- by basename, so adding or
     repointing a derived dir also goes red and must be defended in a diff. */
  const basenames = forget.KINDS.flatMap((k) => [
    nodePath.basename(k.dir()),
    ...((k.derived || []).map((d) => nodePath.basename(d.dir()))),
  ]);
  assert.deepEqual(basenames.sort(), ['chats', 'chats-daily', 'commitments']);
});

test('one of a thing is not "1 reports"', () => {
  seed();
  const sum = forget.summary();
  const one = sum.parts.find((p) => p.key === 'commitments');
  assert.equal(one.count, 1, 'the fixture must have exactly one for this to test anything');
  /* ⚠️ THE PLURAL IS ONLY WRONG AT EXACTLY ONE, which is why reading the code
     never caught it and rendering the dialog did. Both forms come from the
     engine, because the screen must not invent grammar for a control with no
     undo any more than it invents the scope. */
  assert.equal(one.one, 'report');
  assert.equal(one.label, 'reports');
  for (const p of sum.parts) {
    assert.ok(p.one && p.label && p.one !== p.label, p.key + ' is missing one of its two forms');
  }
});
