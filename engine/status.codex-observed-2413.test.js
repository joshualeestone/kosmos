'use strict';

/*
 * kosmos#2413 (Phase 1) -- snapshot() records the last observed real Codex call as an
 * OpenAI observation, so the account badge can positively confirm a working
 * ChatGPT-subscription (codex chatgpt-mode) sign-in that checkLive can only ever leave
 * grey ("not checked live"). Two guarantees this pins, and they are the whole point:
 *
 *   1. The observation is PROVIDER-QUALIFIED (PROVIDER.OPENAI), never PROVIDER.ANTHROPIC.
 *      A codex agent on the default home records configDir=null, which accountForAgent
 *      maps to the DEFAULT CLAUDE account; without the provider tag its `ok` would green
 *      a Claude account it has nothing to do with.
 *
 *   2. The `ok` is recorded from a WITNESSED ROLLOUT COMPLETION (a token_count carrying
 *      real last_token_usage), NOT from pane WORKING. A dead-credential 401 reconnect
 *      loop scrapes as WORKING too (#2790 fixture), so greening WORKING would false-green
 *      a dead sign-in -- the #874 harm. A stale completion greys again on its own.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codex-observed-2413-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, 'codex-home');
for (const d of [process.env.AGENT_WORKFORCE_DATA, process.env.AGENT_WORKFORCE_WORKERS,
  process.env.AGENT_WORKFORCE_CODEX_HOME]) fs.mkdirSync(d, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const create = require('./create');
const observed = require('./observed');
const subscription = require('./subscription');

// Neutralise authprobe's real `claude auth status` subprocess (only a named-ours
// auth_failed CLAUDE pane kicks it; our panes are codex + working, so this is belt-and-braces).
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));

test.beforeEach(() => observed._clearForTest());
test.after(() => {
  fleet.restore();
  subscription.setRunner(null);
  observed._clearForTest();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* Write a codex rollout for `name`'s launch folder, whose last token_count completed at
   `completedAt` (epoch ms). meta.cwd is set to the SAME path create.workerDir(name)
   resolves, and the dir is created on disk so canonicalOnDisk folds identically on both
   sides (the #2417 match rule). */
function writeRollout(name, completedAt) {
  const wd = create.workerDir(name);
  assert.ok(wd, 'workerDir refused the name ' + name);
  fs.mkdirSync(wd, { recursive: true });
  const day = path.join(process.env.AGENT_WORKFORCE_CODEX_HOME, 'sessions', '2026', '09', '11');
  fs.mkdirSync(day, { recursive: true });
  const rows = [
    { type: 'session_meta', timestamp: '2026-09-11T10:00:00.000Z',
      payload: { session_id: 's-' + name, cwd: wd, cli_version: '0.149.0', model_provider: 'openai' } },
    { type: 'event_msg', timestamp: '2026-09-11T10:00:01.000Z',
      payload: { type: 'task_started', model_context_window: 272000 } },
    { type: 'event_msg', timestamp: new Date(completedAt).toISOString(),
      payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: 20000, total_tokens: 20005 },
        last_token_usage: { input_tokens: 11700, total_tokens: 11705 } } } },
  ];
  fs.writeFileSync(path.join(day, 'rollout-2026-09-11T10-00-00-' + name + '.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return wd;
}

test('codexLastCompletionAt returns the completion timestamp, and null when a folder has no completed turn', () => {
  const at = Date.parse('2026-09-11T10:00:39.000Z');
  writeRollout('codexresolve', at);
  assert.equal(status.codexLastCompletionAt('codexresolve'), at,
    'the completion timestamp did not resolve through create.workerDir -> codexsession.read');
  // A different agent with no rollout at all -> null (the badge then stays grey, the safe direction).
  assert.equal(status.codexLastCompletionAt('codexnever'), null);
});

test('a codex WORKING pane with a FRESH rollout completion records an OpenAI ok (never a Claude one)', () => {
  writeRollout('codexok', Date.now() - 30 * 1000); // 30s ago: well inside the 5-min freshness window
  const board = fleet.install([fleet.agent('codexok', { runner: 'codex', state: 'working' })]);
  assert.equal(board.card('codexok').state, 'working', 'fixture is not in the would-record state, so the assertion is vacuous');
  assert.equal((observed.read(observed.PROVIDER.OPENAI, 'codexok') || {}).outcome, observed.OUTCOME.OK,
    'a working codex agent with a fresh witnessed completion did not record an OpenAI ok: ' + JSON.stringify(observed.all()));
  assert.equal(observed.read(observed.PROVIDER.ANTHROPIC, 'codexok'), null,
    'the codex ok leaked onto the ANTHROPIC provider -- the cross-provider false-green this feature removes');
  // Stamped at the completion time, not "now", so verdict greys it on its own once the completion ages out.
  const rec = observed.read(observed.PROVIDER.OPENAI, 'codexok');
  assert.ok(rec.at <= Date.now() && Date.now() - rec.at < 5 * 60 * 1000);
});

test('#2413 perf: a codex pane reads its rollout ONCE per snapshot, not twice (shared read)', () => {
  // codexsession.read walks the sessions tree to match by workdir, so the observation arm
  // and the context ring must NOT each derive it. snapshot() reads it once (readCodexSession)
  // and threads the same session into both. Guards against a future edit re-splitting the read.
  writeRollout('codexonce', Date.now() - 30 * 1000);
  const codexsession = require('./codexsession');
  const orig = codexsession.read;
  let reads = 0;
  codexsession.read = (dir) => { reads += 1; return orig(dir); };
  try {
    fleet.install([fleet.agent('codexonce', { runner: 'codex', state: 'working' })]);
  } finally {
    codexsession.read = orig;
  }
  assert.equal(reads, 1,
    'the rollout was read ' + reads + ' times for one codex pane in one snapshot; the observation arm and the context ring must share a single read');
});

test('a codex WORKING pane with a STALE rollout completion records NOTHING (self-heals, no permanent green)', () => {
  writeRollout('codexstale', Date.now() - 10 * 60 * 1000); // 10 min ago: past the 5-min freshness window
  const board = fleet.install([fleet.agent('codexstale', { runner: 'codex', state: 'working' })]);
  assert.equal(board.card('codexstale').state, 'working', 'fixture is not in the would-record state, so the assertion is vacuous');
  assert.equal(observed.read(observed.PROVIDER.OPENAI, 'codexstale'), null,
    'a stale completion kept greening the sign-in -- exactly the permanent green over a possibly-dead credential (#874) this arm exists to avoid: ' + JSON.stringify(observed.all()));
});
