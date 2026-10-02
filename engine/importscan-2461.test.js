'use strict';
/* kosmos#2461: "Add to Kosmos" on a found agent file said "that file is not one we found on this computer
   to import". The file was offered by a COMPLETE import scan; the add came after the 30 s cache expired, the
   re-scan came back PARTIAL (the scan hatch's answer for Downloads/Documents/Desktop is consumed on read, so
   it must be asked again), and the file was not in it.

     node --test engine/importscan-2461.test.js
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportScan } = require('./importscan');

const DL = '/Users/p/Downloads/pip.md';        // a file only the hatch (a protected folder) can see
const HOME = '/Users/p/agents/plain.agent.md'; // a file the plain roots see on every scan
const COMPLETE = { scanning: false, bounded: { visited: 40 }, importable: [{ file: DL }, { file: HOME }] };
const PARTIAL = { scanning: true, importable: [{ file: HOME }] };   // the hatch asked again, not answered yet
const DL2 = '/Users/p/Downloads/second.md';
const COMPLETE2 = { scanning: false, bounded: { visited: 40 }, importable: [{ file: DL }, { file: DL2 }, { file: HOME }] };
// discover's give-up: the hatch's answer went stale, so the scan is "complete" with none of those folders' rows
const GAVE_UP = { scanning: false, bounded: { tccUnavailable: true }, importable: [{ file: HOME }] };
// cut off at MAX_IMPORTABLE: a new plain-folder file pushed the Downloads ones past the cap
const CAPPED = { scanning: false, bounded: { importable: true }, importable: [{ file: HOME }, { file: '/Users/p/agents/new.agent.md' }] };

/* A scan that plays back a sequence, and a clock the test moves. */
function rig(answers, opts) {
  const clock = { t: 1000000 };
  let i = 0;
  const calls = [];
  const s = createImportScan(Object.assign({
    scan: () => { calls.push(clock.t); const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return a; },
    now: () => clock.t,
    cacheMs: 30000,
  }, opts || {}));
  return { s, clock, calls };
}

test('the reported case: offered by a complete scan, added 45 s later while the re-scan is partial', () => {
  const { s, clock, calls } = rig([COMPLETE, PARTIAL]);
  assert.ok(s.get().importable.some((c) => c.file === DL), 'control: the list offered the Downloads file');
  clock.t += 45000;
  assert.equal(s.known(DL), true, 'the file the list offered can be added');
  assert.equal(calls.length, 2, 'control: the cache had expired and the add re-scanned (partial)');
});

test('within the cache window the cached complete scan answers, with no new scan', () => {
  const { s, clock, calls } = rig([COMPLETE, PARTIAL]);
  s.get();
  clock.t += 10000;
  assert.equal(s.known(DL), true);
  assert.equal(calls.length, 1);
});

test('a fresh FULL scan without the file is believed: the file is gone', () => {
  const { s, clock } = rig([COMPLETE, { scanning: false, bounded: { visited: 40 }, importable: [{ file: HOME }] }]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), false, 'an older offer does not bring back a deleted file');
});

test('a scan that cannot run refuses, as before, even with a complete scan remembered', () => {
  const { s, clock } = rig([COMPLETE, new Error('scan blew up')]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), false);
});

test('review 2: no time limit: a list left open over lunch still adds', () => {
  const { s, clock } = rig([COMPLETE, PARTIAL]);
  s.get();
  clock.t += 3 * 3600000;   // three hours, a closed lid included
  assert.equal(s.known(DL), true, 'still on screen, still addable');
  assert.equal(s.known(HOME), true, 'control: a file the partial scan itself has');
});

test('review 2: a full scan that lacks a file forgets it, so a later partial scan does not bring it back', () => {
  const { s, clock } = rig([COMPLETE, { scanning: false, bounded: { visited: 40 }, importable: [{ file: HOME }] }, PARTIAL]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), false, 'the full scan proves it gone');
  clock.t += 45000;
  assert.equal(s.known(DL), false, 'and the partial scan after it does not revive the offer');
});

test('review 2: a scan that walked nothing (discover refused the sandbox) is not full', () => {
  const { isFull } = require('./importscan');
  assert.equal(isFull({ ok: true, candidates: [], importable: [], bounded: { depth: false, dirs: false, count: false, visited: 0, importable: false } }), false);
  const { s, clock } = rig([COMPLETE, { ok: true, scanning: undefined, importable: [], bounded: { visited: 0, importable: false } }]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), true, 'nothing walked proves nothing gone');
});

test('a path no scan ever returned is never a member, partial or not', () => {
  const { s, clock } = rig([COMPLETE, PARTIAL]);
  s.get();
  assert.equal(s.known('/etc/passwd'), false);
  clock.t += 45000;
  assert.equal(s.known('/etc/passwd'), false);
  assert.equal(s.known(''), false);
  assert.equal(s.known(null), false);
});

test('a partial scan is never cached, and offers only the rows it has', () => {
  const { s, clock, calls } = rig([PARTIAL, PARTIAL, COMPLETE]);
  assert.equal(s.get().scanning, true);
  assert.equal(s.known(DL), false, 'no complete scan yet: the Downloads file is not offered');
  assert.equal(calls.length, 2, 'the partial was not cached: the check scanned again');
  assert.equal(s.warm(), null, 'nothing warm while only partial scans have run');
  clock.t += 1000;
  assert.equal(s.known(DL), true, 'once a complete scan lands it is offered');
  assert.equal(s.warm(), COMPLETE);
  clock.t += 30000;
  assert.equal(s.warm(), null, 'warm is the cache window only, never the keep window');
});

test('the add route checks membership through importScan.known, not the bare fresh scan', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("pathname === '/api/agent-import-file'");
  assert.ok(at > 0, 'the add route moved; re-anchor this test');
  const route = src.slice(at, src.indexOf('that file is not one we found on this computer to import', at));
  assert.match(route, /importScan\.known\(file\)/, 'the add route must use the membership that survives a partial re-scan');
  assert.doesNotMatch(route, /getImportScan\(\)/, 'and not the bare fresh scan the defect came from');
});

test('review 1: a SECOND add, after the hatch gave up, is still accepted (adding down the list)', () => {
  const { s, clock } = rig([COMPLETE2, PARTIAL, GAVE_UP]);
  s.get();                                   // the list paints at 0 with both Downloads files
  clock.t += 45000;
  assert.equal(s.known(DL), true, 'the first add, on a partial re-scan');
  clock.t += 40000;                          // 85 s: the hatch's new answer is stale, its request given up
  assert.equal(s.known(DL2), true, 'the second add, on a scan that is "complete" but never reached Downloads');
  clock.t += 120000;                         // and later still, on another partial
  assert.equal(s.known(DL2), true, 'a scan that reached no Downloads did not erase what the list offered');
});

test('a scan cut off at the cap does not prove an offered file gone', () => {
  const { s, clock } = rig([COMPLETE, CAPPED]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), true);
});

test('a file first offered by a capped or gave-up scan is still a member later', () => {
  const { s, clock } = rig([{ ...CAPPED, importable: [...CAPPED.importable, { file: DL }] }, PARTIAL]);
  s.get();
  clock.t += 45000;
  assert.equal(s.known(DL), true, 'the list showed it, so it can be added');
});

test('isFull: only complete, every folder reached, and not cut off', () => {
  const { isFull } = require('./importscan');
  assert.equal(isFull(COMPLETE), true, 'control');
  assert.equal(isFull(PARTIAL), false);
  assert.equal(isFull(GAVE_UP), false);
  assert.equal(isFull(CAPPED), false);
  assert.equal(isFull(null), false);
});

/* isFull against REAL discover.scan results, so a renamed or unfolded flag in discover reds here rather
   than silently making a gave-up or capped scan "full" (review 2). The tcc root is handed to an injected
   tccScan, as engine/discover.tccscan-2125b.test.js does. */
test('isFull on real discover.scan results: gave-up, not ready, capped, and a clean control', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const discover = require('./discover');
  const { isFull } = require('./importscan');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'importscan-2461-'));
  try {
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(root, 'a' + i + '.agent.md'), 'You are Agent ' + i + ', a helper.\n');
    const TCC = { dir: '/nonexistent/Downloads', maxDepth: 1, tcc: true };
    const roots = [{ dir: root, maxDepth: 2 }, TCC];
    const hatchOk = () => ({ dirs: [], loose: [{ file: '/Users/x/Downloads/sue.agent.md', head: 'You are Sue, an imported agent.' }], bounded: { dirs: false, importable: false, visited: 3 } });
    const clean = discover.scan({ roots, tccScan: hatchOk });
    assert.ok(clean.importable.length >= 4, 'control: the walk and the hatch both offered files');
    assert.equal(isFull(clean), true, 'control: a clean scan is full');
    assert.equal(isFull(discover.scan({ roots, tccScan: () => null })), false, 'the hatch not ready (partial)');
    assert.equal(isFull(discover.scan({ roots, tccScan: () => ({ dirs: [], loose: [], bounded: { tccUnavailable: true } }) })), false, 'the hatch gave up');
    assert.equal(isFull(discover.scan({ roots, tccScan: hatchOk, maxMdReads: 1 })), false, 'cut off by the read budget');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
