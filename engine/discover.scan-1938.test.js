'use strict';
/**
 * The disk scan (#1938): the complementary population `found()` cannot reach.
 *
 * 🛑 EVERY TEST IS SANDBOXED AND NEVER TOUCHES A REAL DIRECTORY. The scan reads
 * files off a disk, so a test that walked the operator's real home would both leak
 * their machine into assertions and be the exact defect the sandbox guard exists to
 * stop. All fixtures live under one mkdtemp root; `scan({roots})` is pointed at it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scan-'));
/* found()'s Claude-records population lives here; scan() dedups against it. */
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
/* data-dir files (declined list, profiles) land in the sandbox, not the real Mac. */
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');
const store = require('./store');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const DISK = path.join(SB, 'disk');

/** A folder on disk with a CLAUDE.md, under the scan root. NOT in Claude's records. */
function onDisk(rel, claudeMd) {
  const dir = path.join(DISK, rel);
  fs.mkdirSync(dir, { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  return dir;
}

/** Give a disk folder a Claude project record, so `found()` owns it. */
function inRecords(folderKey, cwd) {
  const proj = path.join(SB, 'claude', 'projects', folderKey);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${folderKey}-sess.jsonl`),
    `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
}

/** Scan the sandbox disk, deep enough for these fixtures unless a test overrides. */
function scanDisk(extra) {
  return discover.scan({ roots: [{ dir: DISK, maxDepth: 6 }], ...(extra || {}) });
}

test('an agent Claude never ran in is found by the disk scan, with a name', () => {
  /* 🔑 THE WHOLE POINT. This folder is on disk with an introducing CLAUDE.md and
     has NO Claude project record, so `found()` is blind to it. The scan is the only
     thing that can surface it. */
  const dir = onDisk('lilnacho', 'You are **Lil Nacho**, a project manager.\n\nMore.\n');
  const r = scanDisk();
  assert.equal(r.ok, true);
  const hit = r.candidates.find((c) => c.dir === dir);
  assert.ok(hit, `Lil Nacho was not scanned up: ${JSON.stringify(r.candidates.map((c) => c.dir))}`);
  assert.equal(hit.name, 'Lil Nacho');
  assert.equal(hit.role, 'project manager');
});

test('an introducing file that names nobody is offered with an empty name', () => {
  /* ⚠️ THE SAME TWO-SOURCE RULE `found()` USES. "You are lilnacho" (lowercase) is
     an introduction `identityFromText` cannot name, so the row ships with an empty
     name and the screen asks -- never a guess. */
  const dir = onDisk('unnamed-intro', 'You are lilnacho, a project manager.\n');
  const hit = scanDisk().candidates.find((c) => c.dir === dir);
  assert.ok(hit, 'an unnamed introduction was not offered');
  assert.equal(hit.name, '');
});

test('a CLAUDE.md that introduces nobody is NOT a candidate', () => {
  /* ⚠️ EVERY REPO HAS ONE and they are project instructions. Widening past the
     introduce signal is the "You are an expert in Rust" false-positive class. */
  const dir = onDisk('a-repo', '# Build notes\n\nRun the tests before pushing.\n');
  const expert = onDisk('a-template', 'You are an expert in Rust.\n');
  const dirs = scanDisk().candidates.map((c) => c.dir);
  assert.ok(!dirs.includes(dir), 'project instructions were listed as an agent');
  /* "You are an expert in Rust" DOES match the crude introduce signal by design
     (one Skip on the screen), so it is NOT asserted absent here -- that is the
     documented cost, and the preview is what makes it cheap. The assertion that
     matters is that a file with no "You are" line at all never appears. */
  void expert;
});

test('a folder found() already owns is not double-listed by the scan', () => {
  /* 🔑 COMPLEMENTARY, NOT OVERLAPPING. A folder Claude has a record of is better
     found by found() -- it can read the identity from the transcript -- so a scan
     row for it would be a worse duplicate of a better offer. */
  const dir = onDisk('has-record', 'You are **Recorded**, a tester.\n');
  inRecords('has-record-key', dir);
  const found = discover.found();
  assert.ok(found.agents.some((a) => a.dir === dir), 'the fixture was not in found() to begin with');
  const scanned = scanDisk().candidates.map((c) => c.dir);
  assert.ok(!scanned.includes(dir), 'a folder found() already owns was double-listed by the scan');
});

test('a folder Kosmos already looks after (alreadyIn) is not a candidate', () => {
  const dir = onDisk('kept', 'You are **Kept**, a writer.\n');
  /* Recorded the way `connect` records it: the folder against the folder's own name. */
  store.writeProfile(path.basename(dir), { dir, displayName: 'Kept' });
  const scanned = scanDisk().candidates.map((c) => c.dir);
  assert.ok(!scanned.includes(dir), 'an agent Kosmos already holds was offered by the scan');
});

test('a declined folder is not offered again', () => {
  const dir = onDisk('said-no', 'You are **SaidNo**, a tester.\n');
  assert.ok(scanDisk().candidates.some((c) => c.dir === dir), 'the fixture was not offered before declining');
  discover.decline(dir);
  assert.ok(!scanDisk().candidates.some((c) => c.dir === dir), 'a declined folder came back');
});

test('node_modules, .git and dotdirs are skipped', () => {
  onDisk('proj-nm/node_modules/pkg', 'You are **Vendored**, a tester.\n');
  onDisk('proj-git/.git/hooks', 'You are **GitInternal**, a tester.\n');
  onDisk('.hidden/inside', 'You are **Hidden**, a tester.\n');
  const names = scanDisk().candidates.map((c) => c.name);
  assert.ok(!names.includes('Vendored'), 'node_modules was walked');
  assert.ok(!names.includes('GitInternal'), '.git was walked');
  assert.ok(!names.includes('Hidden'), 'a dotdir was walked');
});

test('the walk stops at the depth cap', () => {
  onDisk('deep/at-cap', 'You are **AtCap**, a tester.\n');            // depth 2 under DISK
  onDisk('deep/at-cap/below', 'You are **BelowCap**, a tester.\n');  // depth 3 under DISK
  const r = discover.scan({ roots: [{ dir: DISK, maxDepth: 2 }] });
  const names = r.candidates.map((c) => c.name);
  assert.ok(names.includes('AtCap'), 'an agent AT the depth cap was missed');
  assert.ok(!names.includes('BelowCap'), 'an agent BELOW the depth cap was found');
  assert.equal(r.bounded.depth, true, 'the depth cap was hit but not reported');
});

test('the walk stops at the candidate cap and says so', () => {
  onDisk('cap-a', 'You are **CapA**, a tester.\n');
  onDisk('cap-b', 'You are **CapB**, a tester.\n');
  onDisk('cap-c', 'You are **CapC**, a tester.\n');
  const r = scanDisk({ maxCandidates: 2 });
  assert.equal(r.candidates.length, 2, 'the candidate cap did not bound the list');
  assert.equal(r.bounded.count, true, 'the candidate cap was hit but not reported');
});

test('the walk stops at the directory-visit cap and says so', () => {
  const r = scanDisk({ maxDirs: 1 });
  assert.equal(r.bounded.dirs, true, 'the directory-visit cap was hit but not reported');
});

test('a symlinked directory is not descended (no escape from the roots)', () => {
  /* An agent file that lives OUTSIDE the scan roots, reachable only through a
     symlink planted inside them. Following the link would walk out of the home
     tree, which is the escape this refuses. */
  const outside = path.join(SB, 'outside-escape');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), 'You are **Escaped**, a tester.\n');
  const linkDir = path.join(DISK, 'via-symlink');
  try { fs.symlinkSync(outside, linkDir, 'dir'); } catch { /* platform without symlinks: skip */ return; }
  const names = scanDisk().candidates.map((c) => c.name);
  assert.ok(!names.includes('Escaped'), 'a symlinked directory was descended, escaping the roots');
});

test('a symlinked CLAUDE.md is not read', () => {
  const outside = path.join(SB, 'outside-file');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), 'You are **LinkedFile**, a tester.\n');
  const dir = path.join(DISK, 'symlinked-md');
  fs.mkdirSync(dir, { recursive: true });
  try { fs.symlinkSync(path.join(outside, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'), 'file'); }
  catch { return; }
  const names = scanDisk().candidates.map((c) => c.name);
  assert.ok(!names.includes('LinkedFile'), 'a symlinked CLAUDE.md was read');
});

test('the preview carries the file bytes, capped at READ_CAP', () => {
  const body = 'You are **Previewed**, a tester.\n\nSome real instructions here.\n';
  const dir = onDisk('previewed', body);
  const hit = scanDisk().candidates.find((c) => c.dir === dir);
  assert.ok(hit, 'the preview fixture was not found');
  assert.equal(hit.preview, body, 'the preview did not carry the file content');

  /* A file larger than the cap is shown truncated, never read whole. 4000 is the
     same slice found() reads for identity. */
  const big = 'You are **Bigfile**, a tester.\n' + 'x'.repeat(9000);
  const bigDir = onDisk('bigfile', big);
  const bigHit = scanDisk().candidates.find((c) => c.dir === bigDir);
  assert.ok(bigHit, 'the big-file fixture was not found');
  assert.ok(bigHit.preview.length <= 4000, `preview was ${bigHit.preview.length} bytes, past the cap`);
  assert.ok(bigHit.preview.startsWith('You are **Bigfile**'), 'the preview did not start at the top of the file');
});

test('SANDBOX GUARD: a bare scan with no explicit roots refuses to walk the real home', () => {
  /**
   * 🛑 THE SECURITY PROPERTY, WITH A CONTROL THAT CAN RETURN THE DANGEROUS ANSWER.
   * This test process is an inconsistent sandbox (AGENT_WORKFORCE_DATA is under the
   * temp dir, homeDir() is the real machine), so a bare `scan()` -- no explicit
   * roots, no SCAN_ROOTS env -- MUST refuse and return nothing rather than walk the
   * operator's real home. The explicit-roots tests above are the control: they DO
   * find fixtures, so an empty answer here is the guard firing, not a broken scan.
   */
  const had = process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  delete process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  try {
    const r = discover.scan();
    assert.equal(r.ok, true);
    assert.deepEqual(r.candidates, [], 'a bare scan walked the real home from a fixture');
  } finally { if (had !== undefined) process.env.AGENT_WORKFORCE_SCAN_ROOTS = had; }
});

test('CONTROL: the sandbox disk is really being scanned', () => {
  /* Without this, every absence above could pass on a scan that found nothing at
     all -- the shape of a test that stopped exercising its subject. */
  const r = scanDisk();
  assert.ok(r.candidates.length >= 3, `only ${r.candidates.length} candidates; the fixture stopped seeding`);
});
