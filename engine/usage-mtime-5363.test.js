'use strict';

/**
 * #5363: Token Usage read every transcript ever written on every open (6.9 minutes on the fleet Mac, 14.8 GB), while
 * only the files written since the window began can hold its rows. A transcript last written more than an hour before
 * the window's first day is now not read; a top-level one still gives its first cwd, because a subagent written today
 * takes its launch folder from it (the trap the card names).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'usage-mtime-5363-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
const ROOT = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
const DAY = '2026-10-05';
const DAY_START = Date.parse(DAY + 'T00:00:00Z');
const H = 60 * 60 * 1000;

function reset() {
  fs.rmSync(nodePath.join(ROOT, 'projects'), { recursive: true, force: true });
  fs.rmSync(usage.USAGE_DIR, { recursive: true, force: true });
}
function write(rel, lines, mtimeMs) {
  const file = nodePath.join(ROOT, 'projects', rel);
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}
const cwdLine = (cwd) => JSON.stringify({ type: 'user', cwd, timestamp: DAY + 'T01:00:00.000Z' });
const row = (id, out, cwd) => JSON.stringify({ timestamp: DAY + 'T10:00:00.000Z', cwd, message: { id, model: 'm', usage: { output_tokens: out } } });

test('#5363: a transcript last written before the window (less the margin) is not read; one inside the margin is', async () => {
  reset();
  // Contrived on purpose: a row INSIDE the window in a file whose mtime is old, so a count of 0 can only mean "not read".
  write('p/old.jsonl', [cwdLine('/w/old'), row('old-1', 7)], DAY_START - 2 * H);
  write('p/margin.jsonl', [cwdLine('/w/margin'), row('margin-1', 5)], DAY_START - H / 2);
  write('p/today.jsonl', [cwdLine('/w/today'), row('today-1', 3)]);
  const { days, folders } = await usage.scanUsage({ sinceDay: DAY, untilDay: DAY });
  assert.equal(days[DAY].m.output_tokens, 8, 'today (3) and the file inside the one-hour margin (5); the older file (7) is not read');
  assert.equal(folders[DAY]['/w/old'], undefined, 'nothing is keyed to the unread file');
  // CONTROL: with no window start (an unbounded scan), every file is read, the old one too.
  const all = await usage.scanUsage({});
  assert.equal(all.days[DAY].m.output_tokens, 15, 'CONTROL: an unbounded scan reads every file');
});

test('#5363 (the trap): a subagent written today takes the launch folder of a parent last written before the window', async () => {
  reset();
  // The parent session: launched in /w/agent, last written two days before the window.
  write('p/sess.jsonl', [cwdLine('/w/agent'), JSON.stringify({ timestamp: '2026-10-03T09:00:00.000Z', message: { id: 'p-1', model: 'm', usage: { output_tokens: 1 } } })], DAY_START - 48 * H);
  // Its subagent, written today, standing in a worktree.
  write('p/sess/subagents/agent-x.jsonl', [cwdLine('/w/agent-worktree'), row('s-1', 11, '/w/agent-worktree')]);
  const { days, folders } = await usage.scanUsage({ sinceDay: DAY, untilDay: DAY });
  assert.equal(days[DAY].m.output_tokens, 11, 'the subagent\'s row is counted');
  assert.deepEqual(Object.keys(folders[DAY]), ['/w/agent'], 'its tokens go to the parent\'s launch folder (a head read of the skipped parent), not the subagent\'s own first cwd');
});

test('#5363: two subagents and a nested one under one skipped parent all take its launch folder (read once, cached)', async () => {
  reset();
  write('p/s2.jsonl', [cwdLine('/w/two')], DAY_START - 48 * H);
  write('p/s2/subagents/agent-a.jsonl', [cwdLine('/w/wt-a'), row('a-1', 1, '/w/wt-a')]);
  write('p/s2/subagents/agent-b.jsonl', [cwdLine('/w/wt-b'), row('b-1', 2, '/w/wt-b')]);
  write('p/s2/subagents/agent-a/subagents/deep.jsonl', [cwdLine('/w/wt-deep'), row('d-1', 4, '/w/wt-deep')]);
  const { days, folders } = await usage.scanUsage({ sinceDay: DAY, untilDay: DAY });
  assert.equal(days[DAY].m.output_tokens, 7);
  assert.deepEqual(Object.keys(folders[DAY]), ['/w/two'], 'every subagent, at any depth, is keyed to the skipped parent');
  assert.equal(folders[DAY]['/w/two'].output_tokens, 7);
});

test('#5363: a skipped parent with no cwd leaves the subagent its own, as a full read would (the lazy head read)', async () => {
  reset();
  write('p/bare.jsonl', [JSON.stringify({ type: 'summary' })], DAY_START - 48 * H);
  write('p/bare/subagents/agent-y.jsonl', [cwdLine('/w/own'), row('y-1', 2, '/w/own')]);
  const { folders } = await usage.scanUsage({ sinceDay: DAY, untilDay: DAY });
  assert.deepEqual(Object.keys(folders[DAY]), ['/w/own']);
});

test('#5363: dedup still holds across a read file and its resumed copy', async () => {
  reset();
  write('p/a.jsonl', [cwdLine('/w/a'), row('same', 4)]);
  write('p/b.jsonl', [cwdLine('/w/b'), row('same', 4)]);
  const { days } = await usage.scanUsage({ sinceDay: DAY, untilDay: DAY });
  assert.equal(days[DAY].m.output_tokens, 4, 'one message, counted once');
});
