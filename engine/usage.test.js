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
  assert.ok(fs.existsSync(nodePath.join(usage.USAGE_DIR, `${day}.json`)), 'the completed day was not frozen to disk');
  // Remove the source transcript entirely; a correct cache must not need it again.
  fs.rmSync(nodePath.join(dir, 'sessH.jsonl'));
  const second = await usage.dailyUsageByModel(wideEnough);
  assert.equal(second.byDay[day]['claude-sonnet-5'].input_tokens, 11, 'a frozen day was rescanned instead of read from cache');
  assert.deepEqual(first.byDay[day], second.byDay[day]);
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
