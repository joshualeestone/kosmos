'use strict';

/**
 * #4416 (challenge-loop iteration 5): after Kosmos switches a Codex agent's model, its card must not name the OLD
 * model. Codex writes its rollout lazily (on the first turn, measured), so until then the newest rollout for the
 * folder is the previous session's. status.readCodexSession drops the model of a rollout last written before the
 * job file, and keeps everything else.
 *
 * Sandbox shape copied from status.codex-account-home-2906.test.js: every root the reader touches points into SB,
 * including AGENT_WORKFORCE_LAUNCH, so no plist lands in the real ~/Library/LaunchAgents.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codexswitch4416-')));
const HOME_B = path.join(SB, '.codex-b');
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
process.env.CODEX_HOME = path.join(SB, '.codex-board');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_DATA = STORE;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const store = require('./store');
const status = require('./status');
const create = require('./create');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function codexAgentWithRollout(name, model) {
  const wd = path.join(SB, 'work', name);
  fs.mkdirSync(wd, { recursive: true });
  store.writeProfile(name, { dir: wd, provider: 'openai' });
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  const plist = create.plistPath(name);
  assert.ok(plist.startsWith(SB), 'the job is written inside the sandbox');
  fs.writeFileSync(plist, create.plistFor(name, path.join(SB, 'claude'), path.join(SB, 'tmux'), null, HOME_B, 'codex'), 'utf8');
  const day = path.join(HOME_B, 'sessions', '2026', '09', '28');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-09-28T10-00-00-${name}.jsonl`);
  const rows = [
    { type: 'session_meta', timestamp: '2026-09-28T10:00:00.000Z', payload: { session_id: 's-' + name, cwd: wd, cli_version: '0.149.1', model_provider: 'openai' } },
    { type: 'turn_context', timestamp: '2026-09-28T10:00:01.000Z', payload: { model } },
  ];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { plist, file };
}

test('#4416: a rollout written BEFORE the job (a model switch, no turn since) does not name the model', { skip: process.platform === 'win32' }, () => {
  const { plist, file } = codexAgentWithRollout('switched', 'gpt-5.6-sol');
  const t = Date.now() / 1000;
  fs.utimesSync(file, t - 120, t - 120);   // the old session's last turn
  fs.utimesSync(plist, t - 10, t - 10);    // setModel rewrote the job after it
  const sess = status.readCodexSession('switched');
  assert.equal(sess.found, true, 'the rollout is still read (the ring needs it)');
  assert.equal(sess.model, null, 'the old session named the old model and the card would have said it');
});

test('#4416: a rollout written AFTER the job names the model (control: the normal case)', { skip: process.platform === 'win32' }, () => {
  const { plist, file } = codexAgentWithRollout('steady', 'gpt-5.6-sol');
  const t = Date.now() / 1000;
  fs.utimesSync(plist, t - 120, t - 120);
  fs.utimesSync(file, t - 10, t - 10);
  assert.equal(status.readCodexSession('steady').model, 'gpt-5.6-sol');
});
