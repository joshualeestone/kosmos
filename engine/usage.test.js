'use strict';

/**
 * Tests for the usage engine (#853): real per-model, per-day token totals,
 * not the point-in-time context-window reading `readContext` answers.
 *
 * Node's built-in runner, no dependencies: node --test engine/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING `./usage`: it requires `./status` and `./store`
// at module load, both of which read these env vars at load time too (the
// same gotcha status.test.js documents for itself).
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'usage-test-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'claude');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');

const ROOT = process.env.AGENT_WORKFORCE_CONFIG_ROOT;

function projectDir(name) {
  const dir = nodePath.join(ROOT, 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function usageRow({ timestamp, model, usage: u, isSidechain }) {
  return JSON.stringify({
    timestamp,
    isSidechain: !!isSidechain,
    sessionId: 'sess',
    message: { model, usage: u },
  });
}

// Clears whatever a previous test wrote into the sandboxed projects/ tree and
// frozen-day cache, so each test's fixture is the only thing scanUsage sees.
function resetSandbox() {
  fs.rmSync(nodePath.join(ROOT, 'projects'), { recursive: true, force: true });
  fs.rmSync(usage.USAGE_DIR, { recursive: true, force: true });
}

test('a normal session transcript is counted, bucketed by day and model', async () => {
  resetSandbox();
  const dir = projectDir('proj-a');
  fs.writeFileSync(
    nodePath.join(dir, 'sessA.jsonl'),
    usageRow({ timestamp: '2026-08-20T10:00:00.000Z', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1 } }) + '\n',
    'utf8',
  );
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-20', untilDay: '2026-08-20' });
  assert.deepEqual(days['2026-08-20']['claude-sonnet-5'], { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1, rows: 1 });
});

test('a subagent transcript nested under <sessionId>/subagents/ is counted too', async () => {
  resetSandbox();
  const dir = projectDir('proj-b');
  const subDir = nodePath.join(dir, 'sessB', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(
    nodePath.join(subDir, 'agent-xyz.jsonl'),
    usageRow({ timestamp: '2026-08-21T09:00:00.000Z', model: 'claude-opus-5', usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, isSidechain: true }) + '\n',
    'utf8',
  );
  fs.writeFileSync(nodePath.join(subDir, 'agent-xyz.meta.json'), JSON.stringify({ agentType: 'general-purpose' }), 'utf8');
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-21', untilDay: '2026-08-21' });
  assert.equal(days['2026-08-21']['claude-opus-5'].input_tokens, 50, 'the subagent transcript was not reached');
  // The .meta.json sidecar carries no usage and must not be parsed as one.
  assert.equal(Object.keys(days['2026-08-21']).length, 1);
});

test('a nested sub-subagent (spawnDepth 2) is found by the recursive walk', async () => {
  resetSandbox();
  const dir = projectDir('proj-c');
  const nested = nodePath.join(dir, 'sessC', 'subagents', 'agent-parent', 'subagents');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    nodePath.join(nested, 'agent-child.jsonl'),
    usageRow({ timestamp: '2026-08-22T09:00:00.000Z', model: 'claude-fable-5', usage: { input_tokens: 7, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, isSidechain: true }) + '\n',
    'utf8',
  );
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-22', untilDay: '2026-08-22' });
  assert.equal(days['2026-08-22']['claude-fable-5'].input_tokens, 7, 'a sub-subagent nested two levels deep was not found');
});

test('a .jsonl in a sibling directory that is NOT named subagents/ is not walked', async () => {
  resetSandbox();
  const dir = projectDir('proj-c2');
  // A session directory with a subagents/ tree, exactly like real fixtures.
  fs.mkdirSync(nodePath.join(dir, 'sessC2', 'subagents'), { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, 'sessC2', 'subagents', 'agent-real.jsonl'),
    usageRow({ timestamp: '2026-08-22T10:00:00.000Z', model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + '\n',
    'utf8',
  );
  // A directory that sits at the SAME level as a session directory but is
  // not one -- real machines carry these (e.g. `memory/`,
  // `memory.pre-merge-.../`, per the challenge-loop review that found this).
  // A stray usage-shaped .jsonl landing in one must not be silently folded in.
  fs.mkdirSync(nodePath.join(dir, 'memory', 'nested'), { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, 'memory', 'nested', 'stray.jsonl'),
    usageRow({ timestamp: '2026-08-22T10:00:01.000Z', model: 'claude-opus-5', usage: { input_tokens: 999999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + '\n',
    'utf8',
  );
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-22', untilDay: '2026-08-22' });
  assert.equal(days['2026-08-22']['claude-sonnet-5'].input_tokens, 1, 'the real subagents/ transcript was not found');
  assert.equal(days['2026-08-22']['claude-opus-5'], undefined, 'a .jsonl in a non-subagents/ sibling directory was walked and counted');
});

test('a synthetic row (Claude Code\'s own placeholder usage) is excluded', async () => {
  resetSandbox();
  const dir = projectDir('proj-d');
  const lines = [
    usageRow({ timestamp: '2026-08-23T09:00:00.000Z', model: '<synthetic>', usage: { input_tokens: 999999, output_tokens: 999999, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    usageRow({ timestamp: '2026-08-23T09:00:01.000Z', model: 'claude-sonnet-5', usage: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
  ];
  fs.writeFileSync(nodePath.join(dir, 'sessD.jsonl'), lines.join('\n') + '\n', 'utf8');
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-23', untilDay: '2026-08-23' });
  assert.equal(Object.keys(days['2026-08-23']).length, 1, 'the synthetic row\'s model must not appear at all');
  assert.equal(days['2026-08-23']['claude-sonnet-5'].input_tokens, 3);
});

test('a day boundary is decided by the row\'s own UTC timestamp, not file mtime or scan time', async () => {
  resetSandbox();
  const dir = projectDir('proj-e');
  const lines = [
    usageRow({ timestamp: '2026-08-24T23:59:59.999Z', model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    usageRow({ timestamp: '2026-08-25T00:00:00.000Z', model: 'claude-sonnet-5', usage: { input_tokens: 2, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
  ];
  fs.writeFileSync(nodePath.join(dir, 'sessE.jsonl'), lines.join('\n') + '\n', 'utf8');
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-24', untilDay: '2026-08-25' });
  assert.equal(days['2026-08-24']['claude-sonnet-5'].input_tokens, 1);
  assert.equal(days['2026-08-25']['claude-sonnet-5'].input_tokens, 2);
});

test('a malformed line does not abort the rest of the file', async () => {
  resetSandbox();
  const dir = projectDir('proj-f');
  const lines = [
    '{"not": "valid json',
    usageRow({ timestamp: '2026-08-26T09:00:00.000Z', model: 'claude-sonnet-5', usage: { input_tokens: 9, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
  ];
  fs.writeFileSync(nodePath.join(dir, 'sessF.jsonl'), lines.join('\n') + '\n', 'utf8');
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-26', untilDay: '2026-08-26' });
  assert.equal(days['2026-08-26']['claude-sonnet-5'].input_tokens, 9, 'the well-formed line after a bad one was lost');
});

test('the four buckets stay separate through the whole pipeline: a blended sum would be absurd, the real fields are not', async () => {
  resetSandbox();
  const dir = projectDir('proj-g');
  fs.writeFileSync(
    nodePath.join(dir, 'sessG.jsonl'),
    usageRow({ timestamp: '2026-08-27T09:00:00.000Z', model: 'claude-opus-5', usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50000, cache_read_input_tokens: 9000000 } }) + '\n',
    'utf8',
  );
  const { days } = await usage.scanUsage({ sinceDay: '2026-08-27', untilDay: '2026-08-27' });
  const b = days['2026-08-27']['claude-opus-5'];
  assert.equal(b.input_tokens, 1000);
  assert.equal(b.output_tokens, 200);
  assert.equal(b.cache_creation_input_tokens, 50000);
  assert.equal(b.cache_read_input_tokens, 9000000);
  // Each bucket is exactly what was written -- nothing here pre-sums them.
});

test('dailyUsageByModel freezes a past day to disk and does not rescan it', async () => {
  resetSandbox();
  const dir = projectDir('proj-h');
  const day = '2020-01-01'; // safely in the past, never "today"
  fs.writeFileSync(
    nodePath.join(dir, 'sessH.jsonl'),
    usageRow({ timestamp: `${day}T09:00:00.000Z`, model: 'claude-sonnet-5', usage: { input_tokens: 11, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + '\n',
    'utf8',
  );
  // Wide enough to reach a fixed past date (2020-01-01) from whenever this
  // test runs. dailyUsageByModel clamps to MAX_DAYS (3650) internally --
  // this value is within that clamp on purpose, so the test exercises the
  // real cache path rather than the clamp itself.
  const wideEnough = 3000;
  const first = await usage.dailyUsageByModel(wideEnough);
  assert.ok(fs.existsSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`)), 'the completed day was not frozen to disk');
  // Remove the source transcript entirely; a correct cache must not need it again.
  fs.rmSync(nodePath.join(dir, 'sessH.jsonl'));
  const second = await usage.dailyUsageByModel(wideEnough);
  assert.equal(second.byDay[day]['claude-sonnet-5'].input_tokens, 11, 'a frozen day was rescanned instead of read from cache');
  assert.deepEqual(first.byDay[day], second.byDay[day]);
});

test('a frozen day written before the dedup fix is IGNORED, not trusted', async () => {
  /* 🛑 THE HALF A FORWARD-ONLY FIX WOULD HAVE MISSED. Deduplicating by message
     id corrects the COMPUTATION, and a completed day is never rescanned once
     frozen -- so without invalidation the fix would produce a correct number for
     today sitting on top of past days still about TEN TIMES too large. That
     reads as working, which is exactly why nothing would have caught it.
     Measured before the fix: 2026-08-26 froze at 141,311,212 output tokens; a
     deduplicated scan of the same day gives 13,883,244. */
  resetSandbox();
  const dir = projectDir('proj-stale');
  const day = '2020-02-02';
  fs.writeFileSync(
    nodePath.join(dir, 'sessStale.jsonl'),
    usageRow({ timestamp: `${day}T09:00:00.000Z`, model: 'claude-sonnet-5', usage: { input_tokens: 7, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + '\n',
    'utf8',
  );
  fs.mkdirSync(usage.USAGE_DIR, { recursive: true });
  fs.writeFileSync(
    nodePath.join(usage.USAGE_DIR, `${day}.json`),
    JSON.stringify({ 'claude-sonnet-5': { input_tokens: 999999, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } }),
    'utf8',
  );
  const got = await usage.dailyUsageByModel(3000);
  assert.equal(got.byDay[day]['claude-sonnet-5'].input_tokens, 7,
    'an old-format frozen file was trusted, so every pre-fix day would stay inflated');
  /* Control: the same call DOES write and then trust the new-format file, so
     this cannot pass merely because caching stopped working altogether. */
  assert.ok(fs.existsSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`)), 'the day was not re-frozen in the new format');
});

test('dailyUsageByModel reports the config roots it read, every call', async () => {
  resetSandbox();
  const result = await usage.dailyUsageByModel(1);
  assert.ok(Array.isArray(result.rootsRead) && result.rootsRead.length >= 1, 'rootsRead must name at least the sandboxed root');
});

test('an absurdly large days value (an HTTP caller passing ?days=999999999999) is clamped, not a crash', async () => {
  resetSandbox();
  // Before the clamp, a large enough `days` overflowed Date's own range and
  // threw RangeError out of toISOString() -- this is that exact bug, pinned.
  await assert.doesNotReject(usage.dailyUsageByModel(999999999999));
  const result = await usage.dailyUsageByModel(-5); // a negative or zero value must not underflow into nothing useful either
  assert.ok(Object.keys(result.byDay).length >= 1);
});

/**
 * ⚠️ THE REGRESSION THIS PINS: the first version of this module used
 * fs.readFileSync/fs.readdirSync throughout, which blocks Node's single
 * event loop for the whole scan -- a stats page polling /api/usage would
 * have stalled EVERY other route (agent status polling included) while it
 * ran. Found in challenge-loop review, fixed by converting the read path
 * to fs.promises.
 *
 * Called DIRECTLY here, not through server.js/fetch(): an earlier version
 * of this test went through a real HTTP round-trip and passed even
 * against a fully fs.*Sync-reverted copy of this module, because the
 * socket I/O of fetch() itself gives a 1ms timer plenty of chances to
 * fire regardless of what the handler does -- a check that could not
 * fail. Measured directly (no HTTP layer) instead: a fully-sync copy
 * showed 0 ticks over 19ms; this real code shows dozens over a
 * comparable window. That is the actual, discriminating signal.
 */
test('a scan across many transcript files yields to the event loop (does not block it)', async () => {
  resetSandbox();
  const dir = projectDir('proj-many');
  const today = '2026-08-28';
  for (let f = 0; f < 80; f += 1) {
    const lines = [];
    for (let i = 0; i < 200; i += 1) {
      lines.push(usageRow({ timestamp: `${today}T09:00:00.000Z`, model: 'claude-sonnet-5', usage: { input_tokens: i, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
    }
    fs.writeFileSync(nodePath.join(dir, `sess-${f}.jsonl`), lines.join('\n') + '\n', 'utf8');
  }
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  try {
    await usage.scanUsage({ sinceDay: today, untilDay: today });
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks > 0, `a 1ms timer never fired during the scan (${ticks} ticks) -- the read path is blocking the event loop synchronously`);
});

// ---- #2617: tokens per agent, keyed by the folder a session ran in ----

function cwdRow({ timestamp, id, cwd, output }) {
  return JSON.stringify({
    timestamp, cwd, sessionId: 'sess',
    message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

test('#2617: the scan splits the same rows by folder, once per message', async () => {
  resetSandbox();
  const dir = projectDir('proj-f');
  fs.writeFileSync(nodePath.join(dir, 's.jsonl'), [
    cwdRow({ timestamp: '2026-08-21T10:00:00.000Z', id: 'a', cwd: '/w/ann', output: 10 }),
    cwdRow({ timestamp: '2026-08-21T10:00:01.000Z', id: 'a', cwd: '/w/ann', output: 10 }), // the same message restated
  ].join('\n') + '\n', 'utf8');
  fs.writeFileSync(nodePath.join(dir, 't.jsonl'),
    cwdRow({ timestamp: '2026-08-21T11:00:00.000Z', id: 'b', cwd: '/w/bob', output: 7 }) + '\n', 'utf8');
  const { days, folders } = await usage.scanUsage({ sinceDay: '2026-08-21', untilDay: '2026-08-21' });
  assert.equal(folders['2026-08-21']['/w/ann'].output_tokens, 10, 'a restated message was counted twice in the folder split');
  assert.equal(folders['2026-08-21']['/w/bob'].output_tokens, 7);
  // The folder split and the model total are one population, so they agree.
  assert.equal(days['2026-08-21']['claude-sonnet-5'].output_tokens, 17);
});

test('#2617: byAgent gives an agent its own folder only, names the rest, and never picks between sharers', () => {
  const B = (out) => ({ input_tokens: 0, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 });
  const byDay = { d1: { m: { ...B(100), rows: 7 } } };
  const byFolder = { d1: {
    '/w/ann': B(40),
    '/w/ann/sub': B(5),   // a subfolder is not the agent's own folder
    '/w/annex': B(3),     // a prefix-sharing sibling that is no agent's
    '/w/bob': B(20),
    '/w/pair': B(9),      // two agents recorded on one folder
    '/home/me': B(15),
  } };
  const agents = [
    { name: 'ann', shown: 'Ann', dir: '/w/ann' },
    { name: 'bob', dir: '/w/bob' },
    { name: 'p1', dir: '/w/pair' }, { name: 'p2', dir: '/w/pair' },
    { name: 'gone', shown: 'Gone', dir: null },
  ];
  const out = usage.byAgent({ byDay, byFolder }, agents, (p) => p);
  const by = Object.fromEntries(out.agents.map((a) => [a.name, a]));
  assert.equal(by.ann.output_tokens, 40, 'only the agent\'s own folder is its, not a subfolder or a sibling');
  assert.equal(by.ann.shown, 'Ann');
  assert.equal(by.bob.shown, 'bob', 'a missing shown name falls back to the name');
  assert.equal(by.p1, undefined, 'a shared folder was handed to one of its agents');
  assert.equal(by.p2, undefined, 'a shared folder was handed to one of its agents');
  assert.equal(out.shared.output_tokens, 9, 'a folder two agents share must be stated as shared');
  assert.equal(out.elsewhere.output_tokens, 5 + 3 + 15);
  assert.equal(out.unattributed.output_tokens, 100 - 92);
  assert.equal(out.overcount.output_tokens, 0);
  assert.deepEqual(out.agents.map((a) => a.name), ['ann', 'bob'], 'agents are ordered by output, largest first');
  assert.equal(by.gone, undefined, 'an agent with no folder cannot own tokens');
});

test('#2617: a day short and a day over do not cancel: each is reported', () => {
  const B = (out) => ({ input_tokens: 0, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 });
  const byDay = { d1: { m: B(10) }, d2: { m: B(10) } };
  const byFolder = { d1: { '/x': B(4) }, d2: { '/x': B(16) } };
  const out = usage.byAgent({ byDay, byFolder }, [], (p) => p);
  assert.equal(out.unattributed.output_tokens, 6, 'the short day went missing');
  assert.equal(out.overcount.output_tokens, 6, 'the over day was clamped away');
});

test('#2617: byAgent matches a folder spelled through a link to the same real folder', () => {
  const real = fs.mkdtempSync(nodePath.join(SANDBOX, 'real-'));
  const link = nodePath.join(SANDBOX, 'link-' + nodePath.basename(real));
  fs.symlinkSync(real, link);
  const B = { input_tokens: 0, output_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 };
  // The agent's folder is recorded through the link; the session recorded the real path.
  const out = usage.byAgent({ byDay: { d: { m: B } }, byFolder: { d: { [fs.realpathSync(real)]: B } } }, [{ name: 'ann', dir: link }]);
  assert.equal((out.agents[0] || {}).output_tokens, 11, 'two spellings of one real folder were not matched: ' + JSON.stringify(out));
});

test('#2617: a day already frozen per model keeps its total; its folder split is filled and frozen', async () => {
  resetSandbox();
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.mkdirSync(usage.USAGE_DIR, { recursive: true });
  // The frozen total says 99; the transcripts left on disk only hold 7.
  const frozen = { 'claude-sonnet-5': { input_tokens: 0, output_tokens: 99, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 9 } };
  fs.writeFileSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`), JSON.stringify(frozen), 'utf8');
  const dir = projectDir('proj-z');
  fs.writeFileSync(nodePath.join(dir, 's.jsonl'),
    cwdRow({ timestamp: `${day}T10:00:00.000Z`, id: 'z', cwd: '/w/ann', output: 7 }) + '\n', 'utf8');
  const r = await usage.dailyUsageByModel(2);
  assert.equal(r.byDay[day]['claude-sonnet-5'].output_tokens, 99, 'the frozen per-model total was overwritten by a rescan');
  assert.equal(r.byFolder[day]['/w/ann'].output_tokens, 7);
  const frozenFolders = JSON.parse(fs.readFileSync(nodePath.join(usage.USAGE_DIR, `${day}.folders.v1.json`), 'utf8'));
  assert.equal(frozenFolders['/w/ann'].output_tokens, 7, 'the folder split was not frozen with its contents');
  assert.equal(JSON.parse(fs.readFileSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`), 'utf8'))['claude-sonnet-5'].output_tokens, 99,
    'the frozen per-model file on disk was rewritten');
  const a = usage.byAgent(r, [{ name: 'ann', dir: '/w/ann' }], (p) => p);
  assert.equal(a.unattributed.output_tokens, 92, 'the pruned gap must be reported as unattributed');
});

test('#2617: an unreadable frozen file is rescanned, not fatal', async () => {
  resetSandbox();
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.mkdirSync(usage.USAGE_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`), '{not json', 'utf8');
  fs.writeFileSync(nodePath.join(usage.USAGE_DIR, `${day}.folders.v1.json`), '[]', 'utf8'); // JSON, but not a map
  const dir = projectDir('proj-bad');
  fs.writeFileSync(nodePath.join(dir, 's.jsonl'),
    cwdRow({ timestamp: `${day}T10:00:00.000Z`, id: 'q', cwd: '/w/ann', output: 5 }) + '\n', 'utf8');
  const r = await usage.dailyUsageByModel(2);
  assert.equal(r.byDay[day]['claude-sonnet-5'].output_tokens, 5, 'a malformed frozen total was not rescanned');
  assert.equal(r.byFolder[day]['/w/ann'].output_tokens, 5, 'a malformed frozen folder split was not rescanned');
});

test('#2617: a session that cd-s into a worktree stays with the folder it was launched in', async () => {
  resetSandbox();
  const dir = projectDir('proj-cd');
  fs.writeFileSync(nodePath.join(dir, 's.jsonl'), [
    JSON.stringify({ type: 'summary', summary: 'no cwd on this line' }),
    cwdRow({ timestamp: '2026-08-22T10:00:00.000Z', id: 'c1', cwd: '/w/ann', output: 3 }),
    cwdRow({ timestamp: '2026-08-22T10:05:00.000Z', id: 'c2', cwd: '/work/repo-branch', output: 8 }),
  ].join('\n') + '\n', 'utf8');
  const { folders } = await usage.scanUsage({ sinceDay: '2026-08-22', untilDay: '2026-08-22' });
  assert.equal(folders['2026-08-22']['/w/ann'].output_tokens, 11, 'work after a cd left the agent it belongs to');
  assert.equal(folders['2026-08-22']['/work/repo-branch'], undefined);
});

test('#2617: a corrupt frozen total does not throw away a good frozen folder split', async () => {
  resetSandbox();
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.mkdirSync(usage.USAGE_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(usage.USAGE_DIR, `${day}.v2.json`), '{not json', 'utf8');
  const good = { '/w/ann': { input_tokens: 0, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 5 } };
  fs.writeFileSync(nodePath.join(usage.USAGE_DIR, `${day}.folders.v1.json`), JSON.stringify(good), 'utf8');
  // Only part of that day survives on disk now.
  const dir = projectDir('proj-part');
  fs.writeFileSync(nodePath.join(dir, 's.jsonl'),
    cwdRow({ timestamp: `${day}T10:00:00.000Z`, id: 'p', cwd: '/w/ann', output: 2 }) + '\n', 'utf8');
  const r = await usage.dailyUsageByModel(2);
  assert.equal(r.byFolder[day]['/w/ann'].output_tokens, 50, 'the good frozen folder split was replaced by a thinner rescan');
  assert.equal(JSON.parse(fs.readFileSync(nodePath.join(usage.USAGE_DIR, `${day}.folders.v1.json`), 'utf8'))['/w/ann'].output_tokens, 50);
  assert.equal(r.byDay[day]['claude-sonnet-5'].output_tokens, 2, 'the corrupt total was not rescanned');
});

test('#2617: one message in two transcripts is credited to the lexically first transcript', async () => {
  /* Pins the rule the sort in scanUsage implements. It goes red if the order
     is reversed; it cannot catch the sort being deleted on a filesystem that
     already lists names in order (APFS does). */
  resetSandbox();
  const dir = projectDir('proj-dup');
  fs.writeFileSync(nodePath.join(dir, 'b.jsonl'),
    cwdRow({ timestamp: '2026-08-23T10:00:00.000Z', id: 'same', cwd: '/w/bob', output: 9 }) + '\n', 'utf8');
  fs.writeFileSync(nodePath.join(dir, 'a.jsonl'),
    cwdRow({ timestamp: '2026-08-23T10:00:00.000Z', id: 'same', cwd: '/w/ann', output: 9 }) + '\n', 'utf8');
  const { folders } = await usage.scanUsage({ sinceDay: '2026-08-23', untilDay: '2026-08-23' });
  assert.equal(folders['2026-08-23']['/w/ann'].output_tokens, 9, 'the sorted-first transcript did not win the dedup');
  assert.equal(folders['2026-08-23']['/w/bob'], undefined, 'one message was counted in two folders');
});

test('#2617: a subagent transcript is its parent session\'s work, wherever it started', async () => {
  resetSandbox();
  const dir = projectDir('proj-sub');
  fs.writeFileSync(nodePath.join(dir, 'sess.jsonl'),
    cwdRow({ timestamp: '2026-08-24T10:00:00.000Z', id: 'p1', cwd: '/w/ann', output: 2 }) + '\n', 'utf8');
  const subDir = nodePath.join(dir, 'sess', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  // The subagent was spawned while the parent stood in a worktree.
  fs.writeFileSync(nodePath.join(subDir, 'agent-1.jsonl'),
    cwdRow({ timestamp: '2026-08-24T10:01:00.000Z', id: 's1', cwd: '/work/repo-branch', output: 30 }) + '\n', 'utf8');
  // A subagent's own subagent (spawnDepth 2) is still the top-level session's.
  const deep = nodePath.join(subDir, 'agent-1', 'subagents');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(nodePath.join(deep, 'agent-1a.jsonl'),
    cwdRow({ timestamp: '2026-08-24T10:03:00.000Z', id: 's3', cwd: '/work/other', output: 100 }) + '\n', 'utf8');
  // A subagent with no parent transcript on disk keeps its own first cwd.
  const orphan = nodePath.join(dir, 'gone', 'subagents');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(nodePath.join(orphan, 'agent-2.jsonl'),
    cwdRow({ timestamp: '2026-08-24T10:02:00.000Z', id: 's2', cwd: '/w/bob', output: 4 }) + '\n', 'utf8');
  const { folders } = await usage.scanUsage({ sinceDay: '2026-08-24', untilDay: '2026-08-24' });
  assert.equal(folders['2026-08-24']['/w/ann'].output_tokens, 132, 'a subagent\'s tokens, at depth 1 or 2, left its session\'s agent');
  assert.equal(folders['2026-08-24']['/work/repo-branch'], undefined);
  assert.equal(folders['2026-08-24']['/work/other'], undefined, 'a depth-2 subagent kept its own folder');
  assert.equal(folders['2026-08-24']['/w/bob'].output_tokens, 4);
});

test('#2617: byAgentAsync resolves folders without a synchronous realpath and splits the same way', async () => {
  const real = fs.mkdtempSync(nodePath.join(SANDBOX, 'areal-'));
  const link = nodePath.join(SANDBOX, 'alink-' + nodePath.basename(real));
  fs.symlinkSync(real, link);
  const B = { input_tokens: 0, output_tokens: 13, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 };
  const result = { byDay: { d: { m: { ...B, output_tokens: 20 } } }, byFolder: { d: { [fs.realpathSync(real)]: B, '/gone/elsewhere': { ...B, output_tokens: 7 } } } };
  const agents = [{ name: 'ann', dir: link }];
  const nativeWas = fs.realpathSync.native;
  const plainWas = fs.realpathSync;
  let syncCalls = 0;
  const counted = (fn) => (...a) => { syncCalls += 1; return fn(...a); };
  fs.realpathSync = counted(plainWas);
  fs.realpathSync.native = counted(nativeWas);
  let out;
  try { out = await usage.byAgentAsync(result, agents); } finally { fs.realpathSync = plainWas; plainWas.native = nativeWas; }
  assert.equal(syncCalls, 0, 'byAgentAsync made a synchronous realpath call');
  assert.equal((out.agents[0] || {}).output_tokens, 13, 'the link and its target did not match');
  assert.equal(out.elsewhere.output_tokens, 7, 'a folder that is gone must still be counted, as elsewhere');
  assert.deepEqual(out, usage.byAgent(result, agents), 'the async split disagrees with the sync one');
});
