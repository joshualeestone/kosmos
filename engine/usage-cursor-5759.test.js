'use strict';

/**
 * #5759: with every past day frozen (#5363), an open still re-read every transcript written TODAY (about 10 s on the
 * fleet Mac). scanDayCursor reads each of the day's transcripts once and then only what was appended. These tests hold
 * it to one rule: after every change, its answer deep-equals a full read of the same files (scanUsage with the same
 * day), and it reads only the new bytes unless it says it rebuilt.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'usage-cursor-5759-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
const ROOT = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
const DAY = '2026-10-05';
const H = 60 * 60 * 1000;

function reset() {
  fs.rmSync(nodePath.join(ROOT, 'projects'), { recursive: true, force: true });
  usage.resetDayCursor();
  Object.assign(usage.lastDayCursorRun, { rebuilt: null, bytesConsumed: null });   // no test reads the last one's run
}
const P = (rel) => nodePath.join(ROOT, 'projects', rel);
function write(rel, text, mtimeMs) {
  const file = P(rel);
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}
const append = (rel, text) => { fs.appendFileSync(P(rel), text, 'utf8'); return Buffer.byteLength(text); };
const cwdLine = (cwd) => JSON.stringify({ type: 'user', cwd, timestamp: DAY + 'T01:00:00.000Z' }) + '\n';
const row = (id, out, opts = {}) => JSON.stringify({ timestamp: (opts.day || DAY) + 'T10:00:00.000Z', message: { ...(id ? { id } : {}), model: opts.model || 'm', usage: { output_tokens: out, input_tokens: 1 } } }) + '\n';
const full = () => usage.scanUsage({ sinceDay: DAY, untilDay: DAY, mtimeCut: true });

/* The cursor's answer equals a full read of the same files, and says whether it rebuilt. */
async function same(why, { rebuilt, bytes } = {}) {
  const got = await usage.scanDayCursor(DAY);
  const want = await full();
  assert.deepEqual(got, want, why);
  // The keys come in a full read's order too (deepEqual does not compare order).
  for (const k of ['days', 'folders']) assert.deepEqual(Object.keys(got[k][DAY] || {}), Object.keys(want[k][DAY] || {}), why + ': ' + k + ' key order');
  if (rebuilt !== undefined) assert.equal(usage.lastDayCursorRun.rebuilt, rebuilt, why + ': rebuilt');
  if (bytes !== undefined) assert.equal(usage.lastDayCursorRun.bytesConsumed, bytes, why + ': bytes read');
  return got;
}

test('#5759: the first call reads everything; then only appended bytes, with the same answer as a full read', async () => {
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5) + row('a2', 7));
  write('p/b.jsonl', cwdLine('/w/b') + row('b1', 11));
  const first = await same('first call', { rebuilt: true });
  assert.equal(first.days[DAY].m.output_tokens, 23, 'precondition: the fixture has rows to count');
  await same('nothing changed: nothing is read', { rebuilt: false, bytes: 0 });
  const n = append('p/a.jsonl', row('a3', 13));
  const got = await same('one row appended: only its bytes are read', { rebuilt: false, bytes: n });
  assert.equal(got.days[DAY].m.output_tokens, 36);
  assert.equal(got.folders[DAY]['/w/a'].output_tokens, 25, 'the appended row keys to its file\'s first cwd');
});

test('#5759: a half-written last line is left for later; a whole one with no newline yet is read, as a full read does', async () => {
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  await same('start', { rebuilt: true });
  const whole = row('a2', 7);
  const half = whole.slice(0, 30);
  append('p/a.jsonl', half);
  await same('half a line: not counted by either', { rebuilt: false, bytes: 0 });
  const rest = append('p/a.jsonl', whole.slice(30));
  await same('the line finished: counted', { rebuilt: false, bytes: Buffer.byteLength(half) + rest });
  const tail = row('a3', 9).trimEnd();
  append('p/a.jsonl', tail);
  const got = await same('a whole line with no newline yet: counted now', { rebuilt: false, bytes: Buffer.byteLength(tail) });
  assert.equal(got.days[DAY].m.output_tokens, 21);
  append('p/a.jsonl', '\n' + row('a4', 1));
  await same('its newline and another row arrive', { rebuilt: false });
});

test('#5759: one message in two files counts once, for the file a full read would credit (rebuilding when that moves)', async () => {
  reset();
  write('p/b.jsonl', cwdLine('/w/b') + row('dup', 50));
  await same('start', { rebuilt: true });
  write('p/c.jsonl', cwdLine('/w/c') + row('dup', 50) + row('c1', 1));
  const later = await same('a copy in a file that sorts AFTER the owner: skipped, no rebuild', { rebuilt: false });
  assert.equal(later.folders[DAY]['/w/b'].output_tokens, 50);
  write('p/a.jsonl', cwdLine('/w/a') + row('dup', 50));
  const earlier = await same('a copy in a file that sorts BEFORE the owner: a full read credits it, so the cursor rebuilds', { rebuilt: true });
  assert.equal(earlier.folders[DAY]['/w/a'].output_tokens, 50, 'credited to the first file in sorted order');
  assert.equal(earlier.folders[DAY]['/w/b'], undefined);
  assert.equal(earlier.days[DAY].m.output_tokens, 51, 'counted once');
});

test('#5759: a row with no message id is counted every time it appears, as a full read counts it', async () => {
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row(null, 4));
  await same('start', { rebuilt: true });
  append('p/a.jsonl', row(null, 4));
  const got = await same('the same id-less row again', { rebuilt: false });
  assert.equal(got.days[DAY].m.rows, 2);
});

test('#5759: rows of other days are not counted, and a first cwd written late moves the rows (a rebuild)', async () => {
  reset();
  write('p/a.jsonl', row('y1', 99, { day: '2026-10-04' }) + row('a1', 5));
  const before = await same('no cwd yet: keyed to the empty folder', { rebuilt: true });
  assert.equal(before.folders[DAY][''].output_tokens, 5);
  append('p/a.jsonl', cwdLine('/w/late') + row('a2', 1));
  const after = await same('a first cwd arrives after rows were counted', { rebuilt: true });
  assert.equal(after.folders[DAY]['/w/late'].output_tokens, 6, 'every row of the file goes to its first cwd, as a full read gives');
});

test('#5759: a subagent takes its parent\'s launch folder, an orphan keeps its own, and a parent that gains a cwd rebuilds', async () => {
  reset();
  write('p/sess.jsonl', row('s1', 2));   // the parent records no cwd yet
  write('p/sess/subagents/x.jsonl', cwdLine('/w/worktree') + row('x1', 3));
  const orphan = await same('a parent with no cwd: the subagent is an orphan, keyed to its own first cwd', { rebuilt: true });
  assert.equal(orphan.folders[DAY]['/w/worktree'].output_tokens, 3);
  assert.equal(orphan.folderModels[DAY][''].m.output_tokens, 5, 'and counts for nobody in the scoped split');
  append('p/sess.jsonl', cwdLine('/w/agent'));
  const adopted = await same('the parent\'s cwd arrives', { rebuilt: true });
  assert.equal(adopted.folders[DAY]['/w/agent'].output_tokens, 5, 'parent and subagent both under the parent\'s folder');
  append('p/sess/subagents/x.jsonl', row('x2', 4));
  await same('a later subagent row', { rebuilt: false });
});

test('#5759: a parent last written before the window is head-read once, and its subagent keeps its folder', async () => {
  reset();
  const old = Date.parse(DAY + 'T00:00:00Z') - 3 * H;
  write('p/old.jsonl', cwdLine('/w/agent') + row('o1', 100, { day: '2026-10-03' }), old);
  write('p/old/subagents/y.jsonl', cwdLine('/w/wt') + row('y1', 6));
  const got = await same('the subagent of a skipped parent', { rebuilt: true });
  assert.equal(got.folders[DAY]['/w/agent'].output_tokens, 6);
  append('p/old/subagents/y.jsonl', row('y2', 1));
  await same('another subagent row', { rebuilt: false });
});

test('#5759: an unreadable skipped parent with two subagents counts as one unreadable file, as a full read counts it', async (t) => {
  reset();
  const old = Date.parse(DAY + 'T00:00:00Z') - 3 * H;
  const parent = write('p/locked.jsonl', cwdLine('/w/agent'), old);
  write('p/locked/subagents/one.jsonl', cwdLine('/w/wt1') + row('u1', 1));
  write('p/locked/subagents/two.jsonl', cwdLine('/w/wt2') + row('u2', 2));
  fs.chmodSync(parent, 0o000);
  fs.utimesSync(parent, new Date(old), new Date(old));
  t.after(() => { try { fs.chmodSync(parent, 0o644); } catch { /* removed */ } });
  const got = await same('both subagents read, the parent head-read once and failed', { rebuilt: true });
  assert.equal(got.unreadable, 1, 'one unreadable file, not one per subagent');
});

test('#5759: a file that shrank, was replaced or vanished makes the cursor rebuild, never keep a stale count', async () => {
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5) + row('a2', 7));
  write('p/b.jsonl', cwdLine('/w/b') + row('b1', 11));
  await same('start', { rebuilt: true });
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  await same('a shrank', { rebuilt: true });
  const replacement = P('p/b.new');
  fs.writeFileSync(replacement, cwdLine('/w/b2') + row('b1', 11) + row('b2', 2) + row('b3', 3), 'utf8');
  fs.renameSync(replacement, P('p/b.jsonl'));
  await same('b replaced by a longer file (another inode)', { rebuilt: true });
  fs.rmSync(P('p/b.jsonl'));
  const got = await same('b deleted', { rebuilt: true });
  assert.equal(got.folders[DAY]['/w/b2'], undefined);
});

test('#5759: a file truncated and rewritten LONGER on the same inode is caught by its seam, never read from the middle', async () => {
  reset();
  const f = write('p/a.jsonl', cwdLine('/w/g') + row('g1', 5));
  await same('start', { rebuilt: true });
  const ino = fs.statSync(f).ino;
  fs.writeFileSync(f, cwdLine('/w/g2') + row('g2', 9) + row('g3', 9), 'utf8');   // truncate, then write: same inode
  assert.equal(fs.statSync(f).ino, ino, 'precondition: the same inode');
  const got = await same('rewritten longer', { rebuilt: true });
  assert.equal(got.folders[DAY]['/w/g2'].output_tokens, 18);
  // A same-size rewrite inside the seam (the last row) is caught the same way: the mtime moved and the seam differs.
  const now = fs.readFileSync(f, 'utf8');
  const at = now.lastIndexOf('"output_tokens":9');
  fs.writeFileSync(f, now.slice(0, at) + '"output_tokens":8' + now.slice(at + '"output_tokens":9'.length), 'utf8');
  fs.utimesSync(f, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  await same('a same-size rewrite of the last row', { rebuilt: true });
});

test('#5759 (the stated bound): a same-size rewrite BEFORE the seam is not seen until the next rebuild', async () => {
  reset();
  const f = write('p/a.jsonl', cwdLine('/w/g') + row('g1', 5) + row('g2', 9) + row('g3', 9));
  await same('start', { rebuilt: true });
  const now = fs.readFileSync(f, 'utf8');
  const at = now.indexOf('"output_tokens":5');
  fs.writeFileSync(f, now.slice(0, at) + '"output_tokens":4' + now.slice(at + '"output_tokens":5'.length), 'utf8');
  const got = await usage.scanDayCursor(DAY);
  assert.equal(got.days[DAY].m.output_tokens, 23, 'the cursor keeps the old count (writers append; this is the plan\'s weakest premise)');
  assert.equal((await full()).days[DAY].m.output_tokens, 22, 'CONTROL: a full read sees the rewrite');
});

test('#5759: a file that becomes unreadable after it was read is dropped and counted unreadable, as a full read does', async (t) => {
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  const b = write('p/b.jsonl', cwdLine('/w/b') + row('b1', 7));
  await same('start', { rebuilt: true });
  fs.chmodSync(b, 0o000);
  t.after(() => { try { fs.chmodSync(b, 0o644); } catch { /* removed */ } });
  const got = await same('b cannot be opened now, its size unchanged', { rebuilt: true });
  assert.equal(got.unreadable, 1);
  assert.equal(got.folders[DAY]['/w/b'], undefined);
  const e = write('p/e.jsonl', '');
  fs.chmodSync(e, 0o000);
  t.after(() => { try { fs.chmodSync(e, 0o644); } catch { /* removed */ } });
  const two = await same('an empty new file that cannot be opened');
  assert.equal(two.unreadable, 2);
});

test('#5759: a skipped parent that becomes unreadable leaves its subagent an orphan, as a full read does', async (t) => {
  reset();
  const old = Date.parse(DAY + 'T00:00:00Z') - 3 * H;
  const parent = write('p/old.jsonl', cwdLine('/w/agent'), old);
  write('p/old/subagents/y.jsonl', cwdLine('/w/wt') + row('y1', 6));
  const before = await same('start', { rebuilt: true });
  assert.equal(before.folders[DAY]['/w/agent'].output_tokens, 6);
  fs.chmodSync(parent, 0o000);
  fs.utimesSync(parent, new Date(old), new Date(old));
  t.after(() => { try { fs.chmodSync(parent, 0o644); } catch { /* removed */ } });
  const after = await same('the parent cannot be head-read now', { rebuilt: true });
  assert.equal(after.folders[DAY]['/w/wt'].output_tokens, 6, 'its own first cwd, as an orphan');
});

test('#5759: a new file that sorts earlier puts its keys first, as a full read orders them', async () => {
  reset();
  write('p/k.jsonl', cwdLine('/w/k') + row('k1', 2, { model: 'zeta' }));
  await same('start', { rebuilt: true });
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 3, { model: 'alpha' }));
  const got = await same('an earlier-sorting file read incrementally', { rebuilt: false });
  assert.deepEqual(Object.keys(got.days[DAY]), ['alpha', 'zeta']);
  assert.deepEqual(Object.keys(got.folders[DAY]), ['/w/a', '/w/k']);
});

test('#5759: with the mtime put back, the size and the inode still catch a shrink and a replacement', async () => {
  reset();
  // A whole-second mtime, so putting it back is exact (a Date drops the sub-millisecond part a real mtime has).
  const whole = Math.floor(Date.now() / 1000) * 1000 - 60000;
  const f = write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5) + row('a2', 7), whole);
  await same('start', { rebuilt: true });
  const m1 = new Date(whole);
  fs.truncateSync(f, Buffer.byteLength(cwdLine('/w/a') + row('a1', 5)));
  fs.utimesSync(f, m1, m1);   // the seam is never read back when neither the size grew nor the mtime moved
  await same('shrunk, mtime restored: the size check', { rebuilt: true });
  const tailRow = row('t1', 1);
  const g = write('p/b.jsonl', cwdLine('/w/b') + row('b1', 30) + tailRow, whole);
  await same('b read', { rebuilt: false });
  const m2 = new Date(whole);
  const other = P('p/b.other');
  fs.writeFileSync(other, cwdLine('/w/z') + row('b1', 20) + tailRow, 'utf8');   // same size, same last bytes
  assert.equal(fs.statSync(other).size, fs.statSync(g).size, 'precondition: the same size');
  fs.utimesSync(other, m2, m2);
  fs.renameSync(other, g);
  await same('replaced by another file, same size, seam and mtime: the inode check', { rebuilt: true });
});

test('#5759: a transcript too big to decode is counted unreadable, never thrown out of the call', async (t) => {
  reset();
  const saved = { ...usage.CURSOR_LIMITS };
  t.after(() => Object.assign(usage.CURSOR_LIMITS, saved));
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  write('p/huge.jsonl', cwdLine('/w/huge') + row('HUGE', 9));
  // As Node does past its longest string: the decode of that file throws (the full read's readFile would fail too).
  usage.CURSOR_LIMITS.decode = (b) => { const t = b.toString('utf8'); if (t.includes('HUGE')) throw new RangeError('ERR_STRING_TOO_LONG'); return t; };
  const got = await usage.scanDayCursor(DAY);
  assert.equal(got.unreadable, 1, 'the big file is unreadable, as a full read counts it');
  assert.deepEqual(Object.keys(got.folders[DAY]), ['/w/a'], 'the other file is still counted');
  // A file over the full read's 2 GiB limit is unreadable too, before any read.
  Object.assign(usage.CURSOR_LIMITS, saved);
  reset();
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  usage.CURSOR_LIMITS.maxReadBytes = 10;
  assert.equal((await usage.scanDayCursor(DAY)).unreadable, 1);
});

test('#5759: a known file that grows past the longest string is read again from the start', async (t) => {
  reset();
  const saved = { ...usage.CURSOR_LIMITS };
  t.after(() => Object.assign(usage.CURSOR_LIMITS, saved));
  write('p/a.jsonl', cwdLine('/w/a') + row('a1', 5));
  await same('start', { rebuilt: true });
  usage.CURSOR_LIMITS.maxStringBytes = fs.statSync(P('p/a.jsonl')).size + 10;
  append('p/a.jsonl', row('a2', 7));
  await same('grown past the limit: a rebuild, where the whole-file decode decides', { rebuilt: true });
});

test('#5759: a seeded random run of appends, new files, duplicates, cwds and half lines always equals a full read', async () => {
  reset();
  // mulberry32 (32-bit integer arithmetic, Math.imul): a multiply-mod in doubles loses its low bits and gave only even
  // ops here, so three of the cases below never ran. Seeded, so a failure replays.
  let seed = 5759;
  const rnd = (n) => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) % n;
  };
  const fired = new Set();
  const files = ['p/a.jsonl', 'p/k.jsonl', 'q/m.jsonl'];
  for (const f of files) write(f, '');
  const pending = new Map();   // file -> the rest of a half-written line
  let rebuilds = 0;
  for (let step = 0; step < 300; step += 1) {
    const op = rnd(10);
    fired.add(op);
    let f = files[rnd(files.length)];
    if (pending.has(f) && op < 8) { append(f, pending.get(f)); pending.delete(f); }
    else if (op < 5) append(f, row(rnd(4) ? 'id' + rnd(40) : null, 1 + rnd(50), { model: rnd(3) ? 'm' : 'n', day: rnd(8) ? DAY : '2026-10-04' }));
    else if (op === 5) append(f, cwdLine('/w/' + rnd(5)));
    else if (op === 6 && !pending.has(f)) { const line = row('h' + rnd(40), 3); append(f, line.slice(0, 25)); pending.set(f, line.slice(25)); }
    else if (op === 7 && files.length < 12) {
      f = rnd(2) ? 'p/' + String.fromCharCode(97 + rnd(26)) + step + '.jsonl' : 'p/a/subagents/s' + step + '.jsonl';
      if (!files.includes(f)) { files.push(f); write(f, (rnd(2) ? cwdLine('/w/n' + step) : '') + row('id' + rnd(40), 2)); }
    } else if (op === 8 && !pending.has(f)) append(f, row('id' + rnd(40), 1));
    await same('step ' + step);
    if (usage.lastDayCursorRun.rebuilt) rebuilds += 1;
  }
  assert.deepEqual([...fired].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'every kind of step ran');
  assert.ok(files.length > 3 && files.some((f) => f.includes('/subagents/')), 'new files and a subagent were made: ' + files.join(' '));
  assert.ok(rebuilds < 150, 'most steps were incremental reads, not rebuilds (' + rebuilds + ' of 300)');
});

test('#5759: dailyUsageByModel reads today through the cursor when today is the only missing day', async () => {
  reset();
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = (id, out) => JSON.stringify({ timestamp: today + 'T00:00:01.000Z', message: { id, model: 'm', usage: { output_tokens: out } } }) + '\n';
  write('p/t.jsonl', JSON.stringify({ type: 'user', cwd: '/w/t' }) + '\n' + todayRow('t1', 8));
  const one = await usage.dailyUsageByModel(1);
  assert.equal(one.byDay[today].m.output_tokens, 8);
  assert.equal(usage.lastDayCursorRun.rebuilt, true, 'the first open reads the day');
  const two = await usage.dailyUsageByModel(1);
  assert.deepEqual(two.byDay[today], one.byDay[today]);
  assert.deepEqual([usage.lastDayCursorRun.rebuilt, usage.lastDayCursorRun.bytesConsumed], [false, 0], 'the second open reads nothing new');
});
