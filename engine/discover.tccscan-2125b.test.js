'use strict';
/**
 * #3 / #2125: scan() routes the TCC-protected roots through the app-identity hatch instead of
 * walking them in the engine (which re-prompts). This pins the ENGINE half of that seam:
 *   - a tcc:true root is NOT walked in-engine; it is handed to `tccScan` (injectable) instead;
 *   - the hatch's dirs/loose are merged through the SAME folderRow/looseRow detection the walk
 *     uses, so a hatch-found agent is a candidate/importable exactly as a walked one would be;
 *   - a null hatch result (not ready yet) sets scanning:true and adds no tcc rows;
 *   - non-tcc roots keep walking in-engine unchanged, alongside the tcc merge.
 * The stub stands in for the real file-based hatch bridge (defaultTccScan), so this needs no
 * native app or fixture under a real ~/Documents.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const discover = require('./discover');

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tccscan-'));
  fs.mkdirSync(path.join(root, 'walked-agent'), { recursive: true });
  fs.writeFileSync(path.join(root, 'walked-agent', 'CLAUDE.md'), 'You are Walker, a helper.\n');
  return root;
}

// A tcc:true root pointing at a path the engine must NOT walk. The stub ignores it and returns
// canned rows, so if any of those rows appear it can only be via the tccScan merge.
const FAKE_TCC = { dir: '/nonexistent/Documents', maxDepth: 4, tcc: true };

test('a tcc:true root is handed to tccScan, and its dirs/loose merge as candidates/importable', () => {
  const walkRoot = tmpTree();
  let sawRoots = null;
  const stub = (tccRoots) => {
    sawRoots = tccRoots;
    return {
      dirs: [{ dir: '/Users/x/Documents/bob', instr: { file: '/Users/x/Documents/bob/CLAUDE.md', head: 'You are Bob, the doc agent.' } }],
      loose: [{ file: '/Users/x/Downloads/sue.agent.md', head: 'You are Sue, an imported agent.' }],
      bounded: { dirs: false, importable: false, visited: 7 },
    };
  };
  const r = discover.scan({ roots: [{ dir: walkRoot, maxDepth: 3 }, FAKE_TCC], tccScan: stub });
  assert.ok(r && r.ok, 'scan returned ok');
  // The tcc root reached the stub (partitioned out of the walk).
  assert.ok(Array.isArray(sawRoots) && sawRoots.length === 1 && sawRoots[0].dir === FAKE_TCC.dir,
    'tccScan was called with exactly the tcc root');
  // The walked agent is still found (walk unbroken).
  assert.ok(r.candidates.some((c) => /walked-agent$/.test(c.dir) && c.name === 'Walker'),
    'the in-engine walk still found Walker');
  // The hatch-supplied folder + loose rows merged.
  assert.ok(r.candidates.some((c) => c.dir === '/Users/x/Documents/bob' && c.name === 'Bob'),
    'the hatch folder row merged as a candidate (via folderRow)');
  assert.ok(r.importable.some((i) => i.file === '/Users/x/Downloads/sue.agent.md' && i.name === 'Sue'),
    'the hatch loose row merged as importable (via looseRow)');
  assert.strictEqual(r.scanning, false, 'a ready hatch result means scanning:false');
  assert.strictEqual(r.bounded.visited >= 7, true, 'the hatch visited count folds into bounded.visited');
  fs.rmSync(walkRoot, { recursive: true, force: true });
});

test('a null hatch result sets scanning:true and adds no tcc rows, but keeps the walked rows', () => {
  const walkRoot = tmpTree();
  const r = discover.scan({ roots: [{ dir: walkRoot, maxDepth: 3 }, FAKE_TCC], tccScan: () => null });
  assert.strictEqual(r.scanning, true, 'a not-ready hatch means scanning:true');
  assert.ok(r.candidates.some((c) => c.name === 'Walker'), 'the walked agent is still returned');
  assert.ok(!r.candidates.some((c) => /Documents/.test(c.dir)), 'no tcc rows without a hatch result');
  fs.rmSync(walkRoot, { recursive: true, force: true });
});

test('the hatch content gate is folderRow/looseRow: a template head is refused', () => {
  const walkRoot = tmpTree();
  const stub = () => ({
    dirs: [{ dir: '/Users/x/Documents/tmpl', instr: { file: '/Users/x/Documents/tmpl/CLAUDE.md', head: 'This project uses Rust and Postgres.' } }],
    loose: [{ file: '/Users/x/Downloads/readme.md', head: '# A readme\nnotes.' }],
    bounded: {},
  });
  const r = discover.scan({ roots: [{ dir: walkRoot, maxDepth: 3 }, FAKE_TCC], tccScan: stub });
  assert.ok(!r.candidates.some((c) => /tmpl$/.test(c.dir)), 'a non-introducing folder head is not a candidate');
  assert.ok(!r.importable.some((i) => /readme\.md$/.test(i.file)), 'a non-introducing loose head is not importable');
  assert.strictEqual(r.scanning, false);
  fs.rmSync(walkRoot, { recursive: true, force: true });
});

test('no tcc roots (the auto scan) never calls tccScan and reports scanning:false', () => {
  const walkRoot = tmpTree();
  let called = false;
  const r = discover.scan({ roots: [{ dir: walkRoot, maxDepth: 3 }], tccScan: () => { called = true; return null; } });
  assert.strictEqual(called, false, 'tccScan is not called when there are no tcc roots');
  assert.strictEqual(r.scanning, false, 'scanning:false with no tcc roots');
  assert.ok(r.candidates.some((c) => c.name === 'Walker'));
  fs.rmSync(walkRoot, { recursive: true, force: true });
});
