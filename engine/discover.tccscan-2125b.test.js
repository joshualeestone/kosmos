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

test('defaultTccScan bridge: drops a nonce request, merges the matching result, ignores a wrong nonce, consumes on read', () => {
  // Point store.ROOT (a lazy getter reading AGENT_WORKFORCE_DATA) at a temp dir so the real
  // file bridge writes/reads there, not the operator's Application Support.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tccbridge-'));
  const prev = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = dataDir;
  try {
    const store = require('./store');
    fs.mkdirSync(store.ROOT, { recursive: true });   // the bridge writeFileSyncs into store.ROOT
    const reqPath = path.join(store.ROOT, 'scan-request.json');
    const resPath = path.join(store.ROOT, 'scan-result.json');
    const walkRoot = tmpTree();
    const tccRoot = { dir: '/nonexistent/Documents', maxDepth: 4, tcc: true };
    const call = () => discover.scan({ roots: [{ dir: walkRoot, maxDepth: 3 }, tccRoot] }); // NO stub -> defaultTccScan

    // Control nativePresent directly (a11ystatus freezes its FILE path at require, so a temp
    // a11y-status.json cannot steer it; discover calls promptrequest.nativePresent() on the object
    // each time, so patching the method controls the gate. a11ystatus's own freshness is its tests').
    const pr = require('./promptrequest');
    const origNP = pr.nativePresent;
    try {
      // 0) NO native app -> the scan COMPLETES empty (scanning:false), does NOT hang forever, and
      // drops no request (nothing would answer).
      pr.nativePresent = () => false;
      const rNoApp = call();
      assert.strictEqual(rNoApp.scanning, false, 'no native app -> scan completes, not scanning forever');
      assert.ok(!fs.existsSync(reqPath), 'no native app -> no request dropped');

      // App present for the rest.
      pr.nativePresent = () => true;

    // 1) First call: no result yet -> scanning:true, and a nonce request is dropped.
    const r1 = call();
    assert.strictEqual(r1.scanning, true, 'first call: not ready -> scanning:true');
    assert.ok(fs.existsSync(reqPath), 'a scan-request.json was dropped');
    const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    assert.ok(req.req && req.roots.some((x) => x.dir === tccRoot.dir), 'request carries a nonce + the tcc root');

    // 2) A WRONG-nonce result is ignored (still scanning, rows not merged).
    fs.writeFileSync(resPath, JSON.stringify({ ok: true, req: 'WRONG-' + req.req,
      dirs: [{ dir: '/x/Documents/nope', instr: { file: '/x/Documents/nope/CLAUDE.md', head: 'You are Nope.' } }], loose: [], bounded: {} }));
    const rWrong = call();
    assert.strictEqual(rWrong.scanning, true, 'a wrong-nonce result is ignored -> still scanning');
    assert.ok(!rWrong.candidates.some((c) => /nope/.test(c.dir)), 'wrong-nonce rows are not merged');

    // 3) The MATCHING-nonce result merges, and is consumed (unlinked) on read.
    fs.writeFileSync(resPath, JSON.stringify({ ok: true, req: req.req,
      dirs: [{ dir: '/x/Documents/bob', instr: { file: '/x/Documents/bob/CLAUDE.md', head: 'You are Bob.' } }], loose: [], bounded: { visited: 3 } }));
    const rOk = call();
    assert.strictEqual(rOk.scanning, false, 'matching-nonce result -> scanning:false');
    assert.ok(rOk.candidates.some((c) => c.dir === '/x/Documents/bob' && c.name === 'Bob'), 'the matching result merged');
    assert.ok(!fs.existsSync(resPath), 'the result was consumed (unlinked) on read');
    } finally {
      pr.nativePresent = origNP;   // restore the patched gate
    }

    fs.rmSync(walkRoot, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prev;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
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
