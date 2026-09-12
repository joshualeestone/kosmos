'use strict';

/**
 * #2906: the Codex Memory reader must resolve each agent's OWN account home.
 *
 * The status reader runs under the board process's CODEX_HOME. Before this fix
 * `status.readCodexSession` called `codexsession.read(dir)` with no home, so it
 * walked only the board process's sessions tree; a multi-account OpenAI agent,
 * whose rollout lives under its OWN account home, read `found:false` ("Not yet
 * read") even while active. The fix threads the target agent's account home
 * (from its launch job's CODEX_HOME, i.e. `readJob().configDir`, or
 * `defaultAgentCodexHome()` for a default-account agent) into the read, and fails
 * closed rather than ever reading the board's account.
 *
 * The sandbox keeps four DISTINCT homes so a wrong read is detectable:
 *   HOME_BOARD   the board process's own account (codexsession default HOME())
 *   HOME_DEFAULT the default-agent account (defaultAgentCodexHome())
 *   HOME_B/HOME_C two explicit per-agent account homes
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome2906-')));
const HOME_BOARD = path.join(SB, '.codex-board');
const HOME_DEFAULT = path.join(SB, '.codex'); // = AGENT_WORKFORCE_HOME/.codex
const HOME_B = path.join(SB, '.codex-b');
const HOME_C = path.join(SB, '.codex-c');
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });

/* Board HOME() must DIFFER from defaultAgentCodexHome() so test 3 is meaningful.
   codexupdate.defaultHome() reads AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME || HOME/.codex;
   defaultAgentCodexHome() reads AGENT_WORKFORCE_CODEX_HOME || HOME/.codex. So leave
   AGENT_WORKFORCE_CODEX_HOME UNSET, point CODEX_HOME at the board account, and let
   AGENT_WORKFORCE_HOME drive the default-agent account. */
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
process.env.CODEX_HOME = HOME_BOARD;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_DATA = STORE;

const store = require('./store');
const status = require('./status');
const codexsession = require('./codexsession');
const create = require('./create');

const CLAUDE_BIN = path.join(SB, 'claude');
const TMUX_BIN = path.join(SB, 'tmux');

/** Write a rollout under `home` for launch folder `cwd`. `used` null = no completed turn. */
function writeRolloutIn(home, cwd, used, window) {
  const day = path.join(home, 'sessions', '2026', '09', '12');
  fs.mkdirSync(day, { recursive: true });
  const rows = [
    { type: 'session_meta', timestamp: '2026-09-12T10:00:00.000Z',
      payload: { session_id: `s-${path.basename(home)}-${used}`, cwd, cli_version: '0.149.0', model_provider: 'openai' } },
    { type: 'event_msg', timestamp: '2026-09-12T10:00:01.000Z',
      payload: { type: 'task_started', model_context_window: window } },
  ];
  if (used != null) {
    rows.push({ type: 'response_item', timestamp: '2026-09-12T10:00:02.000Z', payload: { type: 'message' } });
    rows.push({ type: 'event_msg', timestamp: '2026-09-12T10:00:03.000Z',
      payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: used, total_tokens: used + 5 },
        last_token_usage: { input_tokens: used, total_tokens: used + 5 } } } });
  }
  /* Deterministic per (home, cwd): one rollout file per session, so re-writing the
     same session with a completed turn OVERWRITES it (test 7), matching how a real
     rollout is a single appended-to file rather than a new file per turn. Distinct
     homes and distinct workdirs still get distinct files. */
  const file = path.join(day, `rollout-2026-09-12T10-00-00-${path.basename(home)}-${path.basename(cwd)}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

/** Give `name` a resolvable workdir (profile) and a codex launch job (configDir = its account home, or null). */
function codexAgent(name, workdir, configDir) {
  fs.mkdirSync(workdir, { recursive: true });
  store.writeProfile(name, { dir: workdir, provider: 'openai' });
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(
    create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'codex'),
    'utf8',
  );
}

test('#2906/1: an explicit account home reads only that home, never the board process account', () => {
  const wd = path.join(SB, 'work', 'beta');
  codexAgent('beta', wd, HOME_B);
  writeRolloutIn(HOME_B, wd, 44504, 258400);      // the truth, under beta's own account
  writeRolloutIn(HOME_BOARD, wd, 99999, 258400);  // a decoy at the SAME workdir in the board account
  const ctx = status.readCodexContext('beta');
  assert.equal(ctx.tokens, 44504, 'read beta account (B), not the board account decoy');
  assert.equal(ctx.notYet, false);
});

test('#2906/2: two Codex agents on separate homes each get their own usage in one snapshot', () => {
  const wg = path.join(SB, 'work', 'gamma');
  const wd = path.join(SB, 'work', 'delta');
  codexAgent('gamma', wg, HOME_B);
  codexAgent('delta', wd, HOME_C);
  writeRolloutIn(HOME_B, wg, 11111, 258400);
  writeRolloutIn(HOME_C, wd, 22222, 258400);
  assert.equal(status.readCodexContext('gamma').tokens, 11111, 'gamma reads HOME_B');
  assert.equal(status.readCodexContext('delta').tokens, 22222, 'delta reads HOME_C');
});

test('#2906/3: a null-configDir agent resolves through defaultAgentCodexHome(), not the board CODEX_HOME', () => {
  // Guard the premise: the board home and the default-agent home are genuinely different.
  assert.notEqual(create.defaultAgentCodexHome(), HOME_BOARD, 'test needs distinct board vs default homes');
  const wd = path.join(SB, 'work', 'echo');
  codexAgent('echo', wd, null);                    // default-account agent
  writeRolloutIn(HOME_DEFAULT, wd, 33333, 258400); // truth under the default-agent account
  writeRolloutIn(HOME_BOARD, wd, 88888, 258400);   // decoy under the board account
  const ctx = status.readCodexContext('echo');
  assert.equal(ctx.tokens, 33333, 'read defaultAgentCodexHome(), not the board CODEX_HOME');
});

test('#2906/4: a missing or malformed launch job FAILS CLOSED and never reads the board account', () => {
  // No plist at all -> readJob returns null.
  const wd = path.join(SB, 'work', 'foxtrot');
  fs.mkdirSync(wd, { recursive: true });
  store.writeProfile('foxtrot', { dir: wd, provider: 'openai' });
  writeRolloutIn(HOME_BOARD, wd, 77777, 258400);   // a real rollout in the board account
  const ctx = status.readCodexContext('foxtrot');
  assert.equal(ctx.tokens, null, 'no job -> no leak of the board account rollout');

  // A malformed plist (readJob refuses it) -> also fail closed.
  const wm = path.join(SB, 'work', 'malformed');
  fs.mkdirSync(wm, { recursive: true });
  store.writeProfile('malformed', { dir: wm, provider: 'openai' });
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(create.plistPath('malformed'), '<plist/>', 'utf8');
  writeRolloutIn(HOME_BOARD, wm, 66666, 258400);
  assert.equal(status.readCodexContext('malformed').tokens, null, 'malformed job -> no board-account leak');
});

test('#2906/5: backward compatibility - codexsession.read with no home keeps the process-default home', () => {
  const wd = path.join(SB, 'work', 'compat');
  fs.mkdirSync(wd, { recursive: true });
  writeRolloutIn(HOME_BOARD, wd, 55500, 258400);   // under the process default (board) home
  const r = codexsession.read(wd);                 // no home arg
  assert.equal(r.found, true, 'the default home is still read when no home is passed');
  assert.equal(r.contextUsed, 55500);
  // And an explicit home reads that one instead.
  const r2 = codexsession.read(wd, HOME_B);
  assert.equal(r2.found, false, 'an explicit empty home does not fall back to the default');
});

test('#2906/6: no cross-account bleed - same workdir metadata in two non-board homes reads only the agent account', () => {
  const wd = path.join(SB, 'work', 'golf');
  codexAgent('golf', wd, HOME_B);
  writeRolloutIn(HOME_B, wd, 55555, 258400);       // golf's own account
  writeRolloutIn(HOME_C, wd, 66666, 258400);       // an identical-workdir rollout in ANOTHER account
  assert.equal(status.readCodexContext('golf').tokens, 55555, 'read HOME_B only, never HOME_C');
});

test('#2906/7: a matched rollout with no token count is "not yet measured", then gains usage after a turn', () => {
  const wd = path.join(SB, 'work', 'hotel');
  codexAgent('hotel', wd, HOME_B);
  writeRolloutIn(HOME_B, wd, null, 258400);        // matched, but no completed turn
  const before = status.readCodexContext('hotel');
  assert.equal(before.tokens, null, 'found but unmeasured -> no wrong number');
  assert.equal(before.notYet, true, 'a matched-but-unmeasured session is the legitimate not-yet state');
  // First completed turn arrives (a fresh rollout with usage, newer name).
  writeRolloutIn(HOME_B, wd, 12345, 258400);
  const after = status.readCodexContext('hotel');
  assert.equal(after.tokens, 12345, 'usage appears once a turn completes');
  assert.equal(after.notYet, false);
});
