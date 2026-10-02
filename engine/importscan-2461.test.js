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
const COMPLETE = { scanning: false, importable: [{ file: DL }, { file: HOME }] };
const PARTIAL = { scanning: true, importable: [{ file: HOME }] };   // the hatch asked again, not answered yet
const DL2 = '/Users/p/Downloads/second.md';
const COMPLETE2 = { scanning: false, importable: [{ file: DL }, { file: DL2 }, { file: HOME }] };
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
    keepMs: 15 * 60000,
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
  const { s, clock } = rig([COMPLETE, { scanning: false, importable: [{ file: HOME }] }]);
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

test('the remembered complete scan expires after keepMs', () => {
  const { s, clock } = rig([COMPLETE, PARTIAL]);
  s.get();
  clock.t += 15 * 60000 + 1;
  assert.equal(s.known(DL), false, 'an offer older than the keep window is not honoured');
  assert.equal(s.known(HOME), true, 'control: a file the partial scan itself has is still a member');
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
