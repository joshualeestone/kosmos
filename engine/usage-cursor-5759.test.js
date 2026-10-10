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
  assert.deepEqual(got, await full(), why);
  if (rebuilt !== undefined) assert.equal(usage.lastDayCursorRun.rebuilt, rebuilt, why + ': rebuilt');
  if (bytes !== undefined) assert.equal(usage.lastDayCursorRun.bytesRead, bytes, why + ': bytes read');
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

test('#5759: a seeded random run of appends, new files, duplicates, cwds and half lines always equals a full read', async () => {
  reset();
  let seed = 5759;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const files = ['p/a.jsonl', 'p/k.jsonl', 'q/m.jsonl'];
  for (const f of files) write(f, '');
  const pending = new Map();   // file -> the rest of a half-written line
  let rebuilds = 0;
  for (let step = 0; step < 300; step += 1) {
    const op = rnd(10);
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
  assert.deepEqual([usage.lastDayCursorRun.rebuilt, usage.lastDayCursorRun.bytesRead], [false, 0], 'the second open reads nothing new');
});
