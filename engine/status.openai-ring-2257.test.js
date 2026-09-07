'use strict';

/**
 * #2257: the context ring read "Not yet read" for a running OpenAI/Codex agent
 * (Claude agents showed real context).
 *
 * 🔑 CAUSE — `readContext` reads a Claude `.jsonl` transcript; a Codex agent does
 * not write one, and `status.js` never consulted the Codex ROLLOUT, so the ring
 * had no fill to show and fell back to `notYet` for every OpenAI agent regardless
 * of activity. The fix: `codexsession.read` now returns the used half
 * (`last_token_usage.input_tokens` from the last `token_count` event = current
 * window occupancy), and `readCodexContext` maps it into the standard ring shape.
 *
 * These tests drive `codexsession.read` and the exported `readCodexContext`
 * against a faithful rollout fixture (session_meta + task_started + token_count),
 * modelled on six real gpt-5.6-sol rollouts measured 2026-09-07.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ring2257-')));
const CODEX_HOME = path.join(SB, '.codex');
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
process.env.AGENT_WORKFORCE_CODEX_HOME = CODEX_HOME;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = STORE;

const store = require('./store');
const codexsession = require('./codexsession');
const status = require('./status');

const NAME = 'ben-the-cat';
const WORKDIR = path.join(SB, 'work', 'ben');
fs.mkdirSync(WORKDIR, { recursive: true });

// A faithful rollout: session_meta (launch cwd), task_started (window), then TWO
// token_count events. total_token_usage is CUMULATIVE (climbs); last_token_usage
// is the last turn (occupancy). The ring must use the LAST last_token_usage.
function writeRollout(cwd, window, usedSeq) {
  const day = path.join(CODEX_HOME, 'sessions', '2026', '09', '07');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'rollout-2026-09-07T10-00-00-01a0abcd-0000-7000-8000-000000000001.jsonl');
  const rows = [];
  rows.push({ type: 'session_meta', payload: { session_id: 'sess-2257', cwd, cli_version: '0.9', model_provider: 'openai' } });
  rows.push({ timestamp: '2026-09-07T10:00:01Z', type: 'event_msg', payload: { type: 'task_started', model_context_window: window } });
  let cumulative = 0;
  usedSeq.forEach((used, i) => {
    cumulative += used;
    rows.push({ timestamp: `2026-09-07T10:0${i + 1}:00Z`, type: 'response_item', payload: { type: 'message' } });
    rows.push({ timestamp: `2026-09-07T10:0${i + 1}:01Z`, type: 'event_msg', payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: cumulative, cached_input_tokens: 0, output_tokens: 5, total_tokens: cumulative + 5 },
        last_token_usage: { input_tokens: used, cached_input_tokens: 0, output_tokens: 5, total_tokens: used + 5 },
      },
    } });
  });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

function reset() {
  try { for (const f of fs.readdirSync(path.join(STORE, 'profiles'))) fs.rmSync(path.join(STORE, 'profiles', f)); } catch { /* first run */ }
  fs.rmSync(path.join(CODEX_HOME, 'sessions'), { recursive: true, force: true });
}

test('#2257: codexsession.read fills contextUsed from the LAST token_count (not the cumulative total)', () => {
  reset();
  // Two turns: last prompts 11700 then 12982. total climbs to 24682; occupancy is 12982.
  writeRollout(WORKDIR, 258400, [11700, 12982]);
  const r = codexsession.read(WORKDIR);
  assert.equal(r.found, true, 'the rollout keyed on the launch folder must be found');
  assert.equal(r.contextWindow, 258400, 'the window comes from task_started');
  assert.equal(r.contextUsed, 12982, 'contextUsed is the LAST turn occupancy, not the cumulative total (24682)');
});

test('#2257: readCodexContext maps a Codex rollout to a measured fill %', () => {
  reset();
  writeRollout(WORKDIR, 258400, [12982]);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'openai' });
  const ctx = status.readCodexContext(NAME);
  assert.equal(ctx.tokens, 12982, 'tokens is the measured occupancy');
  assert.equal(ctx.ceiling, 258400, 'ceiling is the measured window');
  assert.equal(ctx.percent, Math.round(12982 / 258400 * 100), 'percent is used/window');
  assert.equal(ctx.ceilingAssumed, false, 'the Codex window is MEASURED, not assumed like Claude');
  assert.equal(ctx.notYet, false, 'a running agent with usage is not "not yet"');
  assert.equal(ctx.confidence, 'structured', 'a read from the rollout is STRUCTURED confidence');
});

test('#2257: no rollout for the folder yields no readout (tokens/percent null), never a wrong number', () => {
  reset();
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'openai' });
  const ctx = status.readCodexContext(NAME);
  assert.equal(ctx.tokens, null, 'no rollout -> no token count');
  assert.equal(ctx.percent, null, 'no rollout -> no fill %');
});

test('#2257: a rollout with a window but no token_count yet is not a wrong number', () => {
  reset();
  // task_started only, no token_count (no completed turn).
  writeRollout(WORKDIR, 258400, []);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'openai' });
  const r = codexsession.read(WORKDIR);
  assert.equal(r.contextWindow, 258400);
  assert.equal(r.contextUsed, null, 'no completed turn -> contextUsed stays null');
  const ctx = status.readCodexContext(NAME);
  assert.equal(ctx.tokens, null, 'a window with no usage is not a fill');
  assert.equal(ctx.percent, null, 'no usage -> no %');
});
