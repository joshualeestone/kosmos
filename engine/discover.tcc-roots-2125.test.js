'use strict';
/**
 * kosmos#2125: the disk scan must NOT enter the TCC-protected home folders
 * (Documents, Downloads, Desktop). On a fresh macOS user, deep-walking ~/Documents
 * fired a macOS "would like to access your Documents folder" prompt (and denying it
 * BROKE the first-run scan) -- the regression Josh reported. The fix drops those
 * folders from the default scan roots AND adds Documents to SCAN_SKIP so the shallow
 * $HOME walk cannot descend into it either.
 *
 * 🛑 SANDBOXED: never touches a real directory. Fixtures live under one mkdtemp root.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tcc-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const DISK = path.join(SB, 'disk');
function onDisk(rel, claudeMd) {
  const dir = path.join(DISK, rel);
  fs.mkdirSync(dir, { recursive: true });
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  return dir;
}
const dirsOf = (r) => ((r && r.candidates) || []).map((c) => c.dir);
const AGENT = 'You are **Probe**, a project manager.\n\nMore text so the head reads.\n';

test('#2125: a folder named Documents is SKIPPED by the walk (SCAN_SKIP), so its agents are not surfaced', () => {
  // A real agent folder nested under a "Documents" directory: before the fix the
  // walk descended into Documents and surfaced it (the read that fires the TCC
  // prompt on the real ~/Documents); now Documents is in SCAN_SKIP.
  const hidden = onDisk('Documents/agentdir', AGENT);
  // CONTROL: an identical agent under a normal parent IS surfaced, so the test can
  // fail in the dangerous direction (proves the walk works and only Documents skips).
  const found = onDisk('work/agentdir', AGENT);
  const r = discover.scan({ roots: [{ dir: DISK, maxDepth: 6 }] });
  const found_dirs = dirsOf(r);
  assert.ok(!found_dirs.includes(hidden), 'an agent under a Documents/ folder was surfaced; SCAN_SKIP does not exclude Documents');
  assert.ok(found_dirs.includes(found), 'CONTROL: the agent under work/ was NOT surfaced, so the test is not vacuously passing');
});

test('#2125: Downloads and Desktop are likewise skipped by name', () => {
  const dl = onDisk('Downloads/agentdir', AGENT);
  const dt = onDisk('Desktop/agentdir', AGENT);
  const ok = onDisk('projects/agentdir', AGENT);
  const found_dirs = dirsOf(discover.scan({ roots: [{ dir: DISK, maxDepth: 6 }] }));
  assert.ok(!found_dirs.includes(dl), 'an agent under Downloads/ was surfaced');
  assert.ok(!found_dirs.includes(dt), 'an agent under Desktop/ was surfaced');
  assert.ok(found_dirs.includes(ok), 'CONTROL: the agent under projects/ was NOT surfaced');
});

test('#2125: defaultScanRoots() names NONE of the TCC-protected home folders', () => {
  const bases = discover.defaultScanRoots().map((r) => path.basename(r.dir));
  for (const tcc of ['Documents', 'Downloads', 'Desktop']) {
    assert.ok(!bases.includes(tcc), `defaultScanRoots still includes ~/${tcc}, which fires a TCC prompt on a fresh install`);
  }
  // CONTROL: the standard code parents ARE still scanned, so discovery is not gutted.
  for (const ok of ['work', 'projects', 'dev', 'src', 'code', 'repos']) {
    assert.ok(bases.includes(ok), `defaultScanRoots dropped ~/${ok}, a standard agent/code location`);
  }
});
