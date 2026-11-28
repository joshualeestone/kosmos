'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9180: `kosmos feedback pull` fetched every report one at a time, and every one again on each pull, printing
 * nothing until it ended. Drives the REAL feedbackpull.pull with an injected transport (as feedbackpull.test.js does):
 * a second pull into the same folder fetches nothing, a changed or deleted report is fetched again, --all fetches all,
 * several fetches run at once while the files are written in list order, and a long pull reports progress.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const NO_POSIX_MODES = require('../test-support/skip-on-win32').skipOnWin32('it checks POSIX file modes, which Windows does not keep');   // kosmos#8378

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbackpull-9180-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
const fp = require('./feedbackpull');

const TOKEN = 'vercel_blob_rw_testtoken';
const REC = (install, date, body) => ({ install, date, generated_at: date + 'T12:00:00.000Z', consent: { given: true, version: 'v1' }, body });
// A store: each blob has the shape the listing gives (pathname, url, uploadedAt, size). `gets` counts every GET.
function makeStore(records, { delayMs = 0 } = {}) {
  const st = { gets: [], inFlight: 0, maxInFlight: 0, byUrl: {}, blobs: [] };
  st.put = (pathname, rec, uploadedAt) => {
    const url = 'https://blob.example/' + pathname;
    const text = JSON.stringify(rec);
    st.byUrl[url] = text;
    st.blobs = st.blobs.filter((b) => b.pathname !== pathname).concat([{ url, pathname, uploadedAt, size: text.length }]);
  };
  records.forEach((r, i) => st.put('feedback/x' + i + '.json', r, '2026-11-26T00:00:0' + (i % 10) + '.000Z'));
  st.transport = {
    list: async () => st.blobs.slice(),
    get: async (u) => {
      st.gets.push(u);
      st.inFlight += 1; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      st.inFlight -= 1;
      return st.byUrl[u];
    },
  };
  return st;
}
test.afterEach(() => fp.setTransport(null));

test('a second pull into the same folder fetches nothing again, and says the reports are already here', async () => {
  const dir = path.join(SB, 'again');
  const st = makeStore([REC('a', '2026-11-25', 'one'), REC('b', '2026-11-25', 'two'), REC('c', '2026-11-26', 'three')]);
  fp.setTransport(st.transport);
  const first = await fp.pull(dir, { token: TOKEN });
  assert.equal(first.ok, true); assert.equal(first.written, 3);
  assert.equal(st.gets.length, 3, 'fixture: the first pull fetched each report once');
  const second = await fp.pull(dir, { token: TOKEN });
  assert.equal(second.ok, true);
  // Review 1: one read back of a report already here (the token check when nothing is new), never a re-fetch of all.
  assert.equal(st.gets.length, 4, 'the second pull fetched reports the folder already held: ' + st.gets.length);
  assert.equal(st.gets[3], st.gets[0], 'the check read was not of a report already listed');
  assert.equal(second.written, 0); assert.equal(second.alreadyHere, 3);
  assert.match(fp.summaryLines(second)[0], /^pulled 0 report\(s\), 3 already here to /, fp.summaryLines(second)[0]);
  assert.ok(fs.existsSync(fp.indexPath(dir)), 'fixture: the folder has its index');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => !n.endsWith('.md')), [], 'the pull left something other than reports in the folder');
});

test('a report re-sent (a new object), a report whose file was deleted, and --all are fetched again', async () => {
  const dir = path.join(SB, 'changed');
  const st = makeStore([REC('a', '2026-11-25', 'one'), REC('b', '2026-11-25', 'two'), REC('c', '2026-11-26', 'three')]);
  fp.setTransport(st.transport);
  assert.equal((await fp.pull(dir, { token: TOKEN })).written, 3);
  // The collect route keeps one record per (install, date): a re-send is a new blob, and the old one is deleted.
  st.blobs = st.blobs.filter((b) => b.pathname !== 'feedback/x0.json');
  st.put('feedback/x9.json', REC('a', '2026-11-25', 'one, corrected'), '2026-11-26T09:00:00.000Z');
  fs.rmSync(path.join(dir, '2026-11-25__b.md'));
  st.gets.length = 0;
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true);
  assert.deepEqual(st.gets.map((u) => u.replace(/^.*\//, '')).sort(), ['x1.json', 'x9.json'], 'fetched: ' + st.gets.join(', '));
  assert.match(fs.readFileSync(path.join(dir, '2026-11-25__a.md'), 'utf8'), /one, corrected/, 'the re-sent report was not saved');
  assert.ok(fs.existsSync(path.join(dir, '2026-11-25__b.md')), 'the deleted report file was not fetched back');
  // Same path, a new upload time: the key carries it, so it is fetched (a store that overwrote in place).
  st.put('feedback/x2.json', REC('c', '2026-11-26', 'three, again'), '2026-11-26T10:00:00.000Z');
  st.gets.length = 0;
  await fp.pull(dir, { token: TOKEN });
  assert.deepEqual(st.gets.map((u) => u.replace(/^.*\//, '')), ['x2.json'], 'a report changed in place was not fetched again');
  st.gets.length = 0;
  const all = await fp.pull(dir, { token: TOKEN, all: true });
  assert.equal(st.gets.length, 3, '--all did not fetch every report');
  assert.equal(all.written, 3);
});

test('an index pointing outside the folder, or unreadable, is not trusted', async () => {
  const dir = path.join(SB, 'badindex');
  const st = makeStore([REC('a', '2026-11-25', 'one')]);
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  const key = Object.keys(JSON.parse(fs.readFileSync(fp.indexPath(dir), 'utf8')))[0];
  const outside = path.join(SB, 'elsewhere.md');
  fs.writeFileSync(outside, 'x');
  fs.rmSync(path.join(dir, '2026-11-25__a.md'));
  fs.writeFileSync(fp.indexPath(dir), JSON.stringify({ [key]: '../elsewhere.md' }));
  st.gets.length = 0;
  await fp.pull(dir, { token: TOKEN });
  assert.deepEqual(st.gets.map((u) => u.replace(/^.*\//, '')), ['x0.json'], 'an index naming a file outside the folder skipped the fetch: ' + st.gets.join(', '));
  assert.ok(fs.existsSync(path.join(dir, '2026-11-25__a.md')), 'the report was not fetched back into the folder');   // review 2: not the token check's read
  fs.writeFileSync(fp.indexPath(dir), '{not json');
  st.gets.length = 0;
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true); assert.equal(st.gets.length, 1, 'an unreadable index was not treated as empty');
});

test('several reports are fetched at once, and files are written in list order', async () => {
  const dir = path.join(SB, 'parallel');
  const recs = [];
  for (let i = 0; i < 20; i++) recs.push(REC('i' + i, '2026-11-25', 'r' + i));
  // Two same-day blobs of ONE install (the collect route's brief write-then-delete window): the LATER in list order wins,
  // as the one-at-a-time loop gave, even when the earlier one's fetch finishes last.
  recs.push(REC('dup', '2026-11-26', 'first'), REC('dup', '2026-11-26', 'second'));
  const st = makeStore(recs, { delayMs: 15 });
  const slowFirst = st.transport.get;
  st.transport.get = async (u) => (u.endsWith('/x20.json') ? new Promise((r) => setTimeout(() => r(slowFirst(u)), 80)) : slowFirst(u));
  fp.setTransport(st.transport);
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true); assert.equal(r.written, 22);
  assert.ok(st.maxInFlight > 1, 'reports were fetched one at a time (' + st.maxInFlight + ' at once)');
  assert.ok(st.maxInFlight <= fp.FETCH_AT_ONCE, 'more than the limit at once: ' + st.maxInFlight);
  assert.match(fs.readFileSync(path.join(dir, '2026-11-26__dup.md'), 'utf8'), /second/, 'list order did not decide the same-day pair');
});

test('a long pull reports progress, and a progress callback that throws does not fail the pull', async () => {
  const dir = path.join(SB, 'progress');
  const recs = [];
  for (let i = 0; i < 12; i++) recs.push(REC('p' + i, '2026-11-25', 'r' + i));
  const st = makeStore(recs, { delayMs: 30 });
  fp.setTransport(st.transport);
  const seen = [];
  const r = await fp.pull(dir, { token: TOKEN, progressEveryMs: 0, onProgress: (p) => { seen.push(p); throw new Error('a broken printer'); } });
  assert.equal(r.ok, true); assert.equal(r.written, 12);
  assert.ok(seen.length >= 2, 'progress was not reported while the pull ran: ' + seen.length);
  assert.deepEqual([seen[0].fetched, seen[0].toFetch], [0, 12], 'the first line did not come at once, before any fetch');
  assert.ok(seen.slice(1).every((p, i) => p.fetched >= seen[i].fetched && p.fetched < 12), 'progress went backwards, or repeated the end the summary says');
  // A second pull with nothing to fetch says nothing until its summary.
  seen.length = 0;
  await fp.pull(dir, { token: TOKEN, progressEveryMs: 0, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, 0, 'a pull with nothing to fetch printed progress');
  assert.match(fp.progressLine({ fetched: 0, toFetch: 12, alreadyHere: 0, total: 12 }), /^pulling feedback: 0 of 12 read\.\.\.$/);
  assert.match(fp.progressLine({ fetched: 2, toFetch: 5, alreadyHere: 7, total: 12 }), /^pulling feedback: 2 of 5 read \(7 already here\)\.\.\.$/);
  // Review 4: failed reads are named, never counted as fetched.
  assert.match(fp.progressLine({ fetched: 4, failed: 3, toFetch: 9, alreadyHere: 0, total: 9 }), /^pulling feedback: 4 of 9 read, 3 could not be\.\.\.$/);
});

test('the CLI entry takes --all and prints progress on stderr, the summary on stdout', async () => {
  const dir = path.join(SB, 'cli');
  const st = makeStore([REC('a', '2026-11-25', 'one')]);
  fp.setTransport(st.transport);
  const out = []; const err = [];
  const ow = process.stdout.write; const ew = process.stderr.write;
  // Only the pull's own lines are kept; anything else (the test runner's report) goes through.
  process.stdout.write = function (s, ...rest) { if (/^(pulled |no reports|note: )/.test(String(s))) { out.push(String(s)); return true; } return ow.call(this, s, ...rest); };
  process.stderr.write = function (s, ...rest) { if (/^pulling feedback: /.test(String(s))) { err.push(String(s)); return true; } return ew.call(this, s, ...rest); };
  let rc1, rc2;
  try {
    rc1 = await fp.runCli(['--dir', dir], { token: TOKEN });
    rc2 = await fp.runCli(['--dir', dir, '--all'], { token: TOKEN });
  } finally { process.stdout.write = ow; process.stderr.write = ew; }
  assert.equal(rc1, 0); assert.equal(rc2, 0);
  assert.equal(st.gets.length, 2, '--all on the CLI did not fetch again');
  assert.equal(out.filter((l) => /^pulled /.test(l)).length, 2, out.join(''));
});

test('a listing that does not say when a report was uploaded is always fetched (a path rewritten in place stays fresh)', async () => {
  const dir = path.join(SB, 'nodate');
  const st = makeStore([REC('a', '2026-11-25', 'one')]);
  st.blobs = st.blobs.map(({ uploadedAt, ...b }) => b);
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  st.byUrl[st.blobs[0].url] = JSON.stringify(REC('a', '2026-11-25', 'one, rewritten'));
  st.gets.length = 0;
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(st.gets.length, 1, 'a report with no upload time was skipped');
  assert.equal(r.written, 1);
  assert.match(fs.readFileSync(path.join(dir, '2026-11-25__a.md'), 'utf8'), /one, rewritten/);
});

test('review 1: two same-day objects of one install, the OLDER written last, then the older deleted: the next pull fixes the file', async () => {
  const dir = path.join(SB, 'dupstale');
  const st = makeStore([]);
  // List order is by store path, not upload time: the newer report sorts first.
  st.put('feedback/a-new.json', REC('dup', '2026-11-26', 'the newer report'), '2026-11-26T10:00:00.000Z');
  st.put('feedback/b-old.json', REC('dup', '2026-11-26', 'the older report'), '2026-11-26T09:00:00.000Z');
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  assert.match(fs.readFileSync(path.join(dir, '2026-11-26__dup.md'), 'utf8'), /the older report/, 'fixture: list order left the older one in the file');
  st.blobs = st.blobs.filter((b) => b.pathname !== 'feedback/b-old.json');   // the collect route deletes the older object
  st.gets.length = 0;
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true);
  assert.deepEqual(st.gets.map((u) => u.replace(/^.*\//, '')), ['a-new.json'], 'the surviving report was skipped though the file held the other one');
  assert.match(fs.readFileSync(path.join(dir, '2026-11-26__dup.md'), 'utf8'), /the newer report/, 'the file kept the deleted report');
});

test('review 1: a token that can no longer read fails the pull, even when every report is already here', async () => {
  const dir = path.join(SB, 'noread');
  const st = makeStore([REC('a', '2026-11-25', 'one'), REC('b', '2026-11-25', 'two')]);
  fp.setTransport(st.transport);
  assert.equal((await fp.pull(dir, { token: TOKEN })).ok, true);
  const realGet = st.transport.get;
  st.transport.get = async () => { throw new Error('blob get HTTP 403'); };
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, false, 'a pull that could read nothing passed as a success');
  assert.match(r.because, /^no report could be read: reading back one already in .* to check the token was refused: blob get HTTP 403\. The token may no longer have read access/, r.because);
  // Some new, every new one refused, others already here: still a failure.
  st.transport.get = realGet;
  st.put('feedback/x7.json', REC('c', '2026-11-26', 'three'), '2026-11-26T07:00:00.000Z');
  st.transport.get = async () => { throw new Error('blob get HTTP 403'); };
  const p = await fp.pull(dir, { token: TOKEN });
  assert.equal(p.ok, false, 'reports already here hid a pull whose every read was refused');
  assert.match(p.because, /2 already here, and none of the new ones \(1\) could be pulled: /, p.because);
  // CONTROL: the same folder with a working read is fine, and a malformed new report beside held ones does not fail it.
  st.transport.get = realGet;
  st.byUrl[st.blobs.find((b) => b.pathname === 'feedback/x7.json').url] = 'not json';
  const ok = await fp.pull(dir, { token: TOKEN });
  assert.equal(ok.ok, true, 'a malformed report beside ones already here failed the pull: ' + ok.because);
});

test('review 1: the index is private to this user', { skip: NO_POSIX_MODES }, async () => {
  const dir = path.join(SB, 'private');
  fp.setTransport(makeStore([REC('a', '2026-11-25', 'one')]).transport);
  await fp.pull(dir, { token: TOKEN });
  assert.equal(fs.statSync(fp.indexPath(dir)).mode & 0o077, 0, 'the index can be read by others: ' + (fs.statSync(fp.indexPath(dir)).mode & 0o777).toString(8));
});

test('review 2: the token check tries the next held report on a non-refused error, and never fails a healthy pull', async () => {
  const dir = path.join(SB, 'checknext');
  const st = makeStore([REC('a', '2026-11-25', 'one'), REC('b', '2026-11-25', 'two')]);
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  const realGet = st.transport.get;
  // The first held report was deleted from the store since the listing (the collect route's re-send): a 404.
  st.transport.get = async (u) => { st.gets.push(u); if (u.endsWith('/x0.json')) throw new Error('blob GET HTTP 404'); return realGet(u); };
  st.gets.length = 0;
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true, 'one deleted report failed a healthy pull: ' + r.because);
  assert.equal(r.checkNote, '', 'a check that read the next report still left a note');
  // Every held report errors, but none is a refusal: still a success, saying the check could not be made.
  st.transport.get = async () => { throw new Error('socket hang up'); };
  const n = await fp.pull(dir, { token: TOKEN });
  assert.equal(n.ok, true, 'a blip failed the pull: ' + n.because);
  assert.ok(fp.summaryLines(n).some((l) => /^note: could not read a report back to check the token \(socket hang up\)/.test(l)), fp.summaryLines(n).join(' | '));
});

test('review 2: only url-less new reports beside held ones still runs the token check; a save that fails beside held ones fails', async () => {
  const dir = path.join(SB, 'nourl');
  const st = makeStore([REC('a', '2026-11-25', 'one')]);
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  st.blobs.push({ pathname: 'feedback/nourl.json', uploadedAt: '2026-11-26T05:00:00.000Z', size: 3 });   // no url
  st.transport.get = async () => { throw new Error('blob get HTTP 401'); };
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, false, 'a pull that read nothing passed although its token was refused');
  assert.match(r.because, /was refused: blob get HTTP 401/, r.because);
  // A new report that reads but cannot be SAVED here, beside one already here: a failure, naming the save.
  const d2 = path.join(SB, 'nosave');
  const s2 = makeStore([REC('a', '2026-11-25', 'one')]);
  fp.setTransport(s2.transport);
  await fp.pull(d2, { token: TOKEN });
  s2.put('feedback/x5.json', REC('b', '2026-11-26', 'two'), '2026-11-26T05:00:00.000Z');
  fs.mkdirSync(path.join(d2, '2026-11-26__b.md'));   // a folder where the report must go: the save fails
  const w = await fp.pull(d2, { token: TOKEN });
  assert.equal(w.ok, false, 'a failed save beside a report already here passed as success');
  assert.match(w.because, /1 already here, and none of the new ones \(1\) could be pulled: /, w.because);
});

test('review 2: a pull stopped after writing a report but before its last index save leaves a re-fetch, never a wrong skip', async () => {
  const dir = path.join(SB, 'crash');
  const st = makeStore([]);
  st.put('feedback/b-old.json', REC('dup', '2026-11-26', 'the older report'), '2026-11-26T09:00:00.000Z');
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });   // the folder holds the older report, indexed
  st.put('feedback/a-new.json', REC('dup', '2026-11-26', 'the newer report'), '2026-11-26T10:00:00.000Z');
  // Every index save after the first one in this pull fails, as a pull killed between the report write and its last
  // index save would leave things (the report written, the index as it was saved before the write).
  const sw = require('./securewrite');
  const real = sw.writeSecret;
  let indexWrites = 0;
  sw.writeSecret = (file, ...rest) => {
    if (file === fp.indexPath(dir) && ++indexWrites > 1) throw Object.assign(new Error('killed'), { code: 'EKILLED' });
    return real.call(sw, file, ...rest);
  };
  try { await fp.pull(dir, { token: TOKEN }); } finally { sw.writeSecret = real; }
  assert.match(fs.readFileSync(path.join(dir, '2026-11-26__dup.md'), 'utf8'), /the newer report/, 'fixture: the new report was written over the held one');
  const saved = JSON.parse(fs.readFileSync(fp.indexPath(dir), 'utf8'));
  assert.deepEqual(Object.keys(saved).filter((k) => saved[k] === '2026-11-26__dup.md'), [], 'the index still names an object as saved in a file that was rewritten: ' + JSON.stringify(saved));
});

test('review 4: progress during a pull whose reads are refused names them as failed', async () => {
  const dir = path.join(SB, 'progfail');
  const recs = []; for (let i = 0; i < 6; i++) recs.push(REC('f' + i, '2026-11-25', 'r' + i));
  const st = makeStore(recs, { delayMs: 20 });
  st.transport.get = async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error('blob get HTTP 403'); };
  fp.setTransport(st.transport);
  const seen = [];
  const r = await fp.pull(dir, { token: TOKEN, progressEveryMs: 0, onProgress: (p) => seen.push(p) });
  assert.equal(r.ok, false);
  assert.ok(seen.length >= 2, 'fixture: progress was reported');
  const last = seen[seen.length - 1];
  assert.ok(last.failed > 0 && last.failed === last.fetched, 'refused reads were not counted as failed: ' + JSON.stringify(last));
  assert.match(fp.progressLine(last), /, \d+ could not be/, fp.progressLine(last));
});

test('review 4: held reports the listing gives no url for: the summary says the token check was not made', async () => {
  const dir = path.join(SB, 'heldnourl');
  const st = makeStore([REC('a', '2026-11-25', 'one')]);
  fp.setTransport(st.transport);
  await fp.pull(dir, { token: TOKEN });
  st.blobs = st.blobs.map(({ url, ...b }) => b);   // the same objects, listed without a url
  const r = await fp.pull(dir, { token: TOKEN });
  assert.equal(r.ok, true);
  assert.equal(r.alreadyHere, 1, 'fixture: the report is held');
  assert.ok(fp.summaryLines(r).some((l) => /^note: no report could be read back to check the token \(the listing gave no url\)/.test(l)), fp.summaryLines(r).join(' | '));
});
