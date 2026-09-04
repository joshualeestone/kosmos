'use strict';
/**
 * #1652 (reopened): the disk scan must find LOOSE IMPORTABLE agent files (an agent .md
 * a person downloaded or was sent, to bring in via the import flow), not only folders
 * that contain a `CLAUDE.md`. Josh placed sample agent files across Documents/Downloads
 * and a work folder on a fresh install and the scan found none: it read only
 * `<dir>/CLAUDE.md` and skipped Downloads/Desktop entirely.
 *
 * 🛑 EVERY TEST IS SANDBOXED AND NEVER TOUCHES A REAL DIRECTORY, same contract as
 * discover.scan-1938.test.js. All fixtures live under one mkdtemp root; `scan({roots})`
 * is pointed at it, so `os.homedir()` is never walked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-import-1652-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const DISK = path.join(SB, 'disk');
const AGENT = (who, role) => `# You are ${who}, a ${role}.\n\nInstructions for ${who}.\n`;

/** Write a file under the scan disk, creating parents. Returns its absolute path. */
function put(rel, body) {
  const abs = path.join(DISK, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/** Scan one root (default: the whole disk deep). */
function scan(roots, extra) {
  return discover.scan({ roots: roots || [{ dir: DISK, maxDepth: 6 }], ...(extra || {}) });
}

const files = (r) => (r.importable || []).map((c) => c.file);
const dirs = (r) => (r.candidates || []).map((c) => c.dir);

test('#1652: a loose agent .md with an ARBITRARY name is found by CONTENT, in importable', () => {
  const f = put('proj/susan.md', AGENT('Susan', 'project manager'));
  const r = scan();
  assert.ok(files(r).includes(f), 'the loose agent file was not found by content');
  const row = r.importable.find((c) => c.file === f);
  assert.equal(row.name, 'Susan', 'the imported identity name was not parsed');
  assert.equal(row.role, 'project manager', 'the role was not parsed');
  assert.match(row.preview, /You are Susan/, 'the preview does not carry the file head');
  // And it is NOT a connect candidate (a loose file is import material, not a folder).
  assert.ok(!dirs(r).includes(path.dirname(f)), 'a loose file wrongly produced a connect-folder candidate');
});

test('#1652: CLAUDE.md and AGENTS.md are NOT importable rows (they are folder-agent markers)', () => {
  const dir = path.join(DISK, 'folderagent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), AGENT('FolderClaude', 'builder'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), AGENT('FolderCodex', 'coder'));
  const r = scan();
  for (const f of files(r)) {
    assert.ok(!f.endsWith('CLAUDE.md'), 'a CLAUDE.md leaked into importable');
    assert.ok(!f.endsWith('AGENTS.md'), 'an AGENTS.md leaked into importable');
  }
  // The CLAUDE.md folder IS still a connect candidate (unchanged behaviour).
  assert.ok(dirs(r).includes(dir), 'the CLAUDE.md folder stopped being a connect candidate');
});

test('#1652: a non-agent .md (no "You are") is refused, same content gate as the connect scan', () => {
  const f = put('proj/notes.md', '# Meeting notes\n\nnothing about an agent here\n');
  const r = scan();
  assert.ok(!files(r).includes(f), 'a plain markdown note was wrongly offered as importable');
});

test('#1652: an importOnly root (Downloads-shape) yields importable FILES but no connect FOLDER', () => {
  // A shared agent file dropped in Downloads, and (unusually) a CLAUDE.md folder there too.
  const dl = path.join(SB, 'Downloads-shape');
  fs.mkdirSync(dl, { recursive: true });
  const loose = path.join(dl, 'don.md');
  fs.writeFileSync(loose, AGENT('Don', 'researcher'));
  const folder = path.join(dl, 'ran-here');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), AGENT('RanHere', 'helper'));

  const r = scan([{ dir: dl, maxDepth: 1, importOnly: true }]);
  assert.ok(files(r).includes(loose), 'the loose file in an importOnly root was not offered');
  assert.equal(r.candidates.length, 0, 'an importOnly root wrongly produced a connect candidate');
});

test('#1652: importable is bounded by MAX_IMPORTABLE, and the bound is reported', () => {
  // Spread across 4 folders of 20 so the per-dir cap (40) never fires; only the
  // total MAX_IMPORTABLE (60) can stop it, which is what this test pins.
  const manyRoot = path.join(SB, 'manyroot');
  for (let d = 0; d < 4; d += 1) {
    const sub = path.join(manyRoot, `dir${d}`);
    fs.mkdirSync(sub, { recursive: true });
    for (let i = 0; i < 20; i += 1) {
      fs.writeFileSync(path.join(sub, `agent-${d}-${i}.md`), AGENT(`Agent${d}x${i}`, 'worker'));
    }
  }
  const r = scan([{ dir: manyRoot, maxDepth: 2 }]);
  assert.equal(r.importable.length, 60, 'MAX_IMPORTABLE did not cap the importable list at 60');
  assert.equal(r.bounded.importable, true, 'the importable cap was hit but not reported in bounded');
});

test('#1652: MAX_MD_PER_DIR reads a folder short over readdir order, and flags bounded.importable', () => {
  // 45 agent files in ONE folder: the per-dir cap (40) fires before the total cap (60),
  // so the folder is read short. The honesty claim is that this is NOT silent -- the
  // screen must be able to say "there may be more", i.e. bounded.importable is set.
  const many = path.join(SB, 'perdir');
  fs.mkdirSync(many, { recursive: true });
  for (let i = 0; i < 45; i += 1) {
    fs.writeFileSync(path.join(many, `a-${i}.md`), AGENT(`Perdir${i}`, 'worker'));
  }
  const r = scan([{ dir: many, maxDepth: 1 }]);
  assert.equal(r.importable.length, 40, 'the per-folder read cap did not stop at MAX_MD_PER_DIR');
  assert.equal(r.bounded.importable, true, 'a folder read short must set bounded.importable (the documented honesty claim)');
});

test('#1652: the whole-walk read budget (maxMdReads) bounds importable and flags the truncation', () => {
  // Two folders of 5 agent files; a maxMdReads override of 6 stops mid-walk, so only
  // some are collected and bounded.importable says there may be more. The override is the
  // testable seam for the default MAX_MD_READS (3000), which is impractical to fixture.
  const root = path.join(SB, 'readbudget');
  for (const d of ['x', 'y']) {
    const sub = path.join(root, d);
    fs.mkdirSync(sub, { recursive: true });
    for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(sub, `r-${i}.md`), AGENT(`Rb${d}${i}`, 'worker'));
  }
  const r = scan([{ dir: root, maxDepth: 2 }], { maxMdReads: 6 });
  assert.ok(r.importable.length <= 6, 'maxMdReads did not bound the number of files read/collected');
  assert.ok(r.importable.length > 0, 'the read budget stopped collection entirely (should collect up to the budget)');
  assert.equal(r.bounded.importable, true, 'hitting the read budget must set bounded.importable');
});

test('#1652: the sandbox-refusal return carries the importable shape too (no undefined for a consumer)', () => {
  // A bare scan() with no explicit roots and no SCAN_ROOTS env refuses (the sandbox
  // guard), and its return must be the SAME shape as a real walk -- including the
  // #1652 additions -- so PR2's UI can iterate `importable` without a shape check.
  const had = process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  delete process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  try {
    const r = discover.scan();
    assert.deepEqual(r.candidates, [], 'the refusal walked something');
    assert.ok(Array.isArray(r.importable), 'importable is missing on the refusal path (consumer would get undefined)');
    assert.deepEqual(r.importable, [], 'importable should be empty on refusal');
    assert.equal(r.bounded.importable, false, 'bounded.importable is missing/true on the refusal path');
  } finally {
    if (had !== undefined) process.env.AGENT_WORKFORCE_SCAN_ROOTS = had;
    else delete process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  }
});

test('#1652: the connect candidates array still works and is not polluted by loose files', () => {
  // A clean root with one CLAUDE.md folder and one loose file.
  const root = path.join(SB, 'mixed');
  const folder = path.join(root, 'agentdir');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), AGENT('Connectable', 'pm'));
  const loose = path.join(root, 'loose.md');
  fs.writeFileSync(loose, AGENT('Loose', 'writer'));

  const r = scan([{ dir: root, maxDepth: 3 }]);
  assert.ok(dirs(r).includes(folder), 'the CLAUDE.md folder was not a connect candidate');
  assert.ok(!dirs(r).includes(root), 'the loose file made its parent (which has no CLAUDE.md) a connect candidate');
  assert.ok(!dirs(r).includes(loose), 'the loose file itself leaked into the connect candidates');
  assert.ok(files(r).includes(loose), 'the loose file was not importable');
});
