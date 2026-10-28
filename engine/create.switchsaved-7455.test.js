'use strict';

/**
 * #7455: a provider switch that is saved but could not be restarted. The route says it is still running as before; for
 * a switch that loses its conversation it must also say, in the future tense, that the NEXT start will not bring the
 * conversation across. switchPendingWords builds that from the same `carried` fact switchCarryWords uses, so the two
 * cannot disagree; for a switch that keeps its conversation (carried null) it adds nothing.
 *
 * The `carried` states come from the real carryClaudeNotes in a sandbox (as create.switchwords-7445.test.js does), with
 * the job seeded as setProvider would find it, so the fixture is the shape the route is handed. The route itself is
 * driven over HTTP in server.switch-account-1373.test.js (#7455 test there), which cannot run on Windows.
 *
 *   node --test engine/create.switchsaved-7455.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switchsaved-7455-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
const CLAUDE_ROOT = nodePath.join(SANDBOX, 'claude-root');
for (const d of [HOME, BIN, CLAUDE_ROOT, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'launch', 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CLAUDE_ROOT;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const create = require('./create');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
/* The agent as setProvider would find it: its job (plist), its profile and its brief. */
function born(name, runner, provider) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const plist = create.plistPath(name);
  fs.mkdirSync(nodePath.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, runner), 'utf8');
  store.writeProfile(name, { provider });
  fs.writeFileSync(nodePath.join(create.workerDir(name), runner === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'), '# brief for this agent, long enough to keep\n', 'utf8');
  return name;
}
const carry = (name, fromRunner, toRunner, from, to) => create.carryClaudeNotes(name, { runner: fromRunner }, toRunner, null, from, to);

const FUTURE = (label, from) => `When it next starts, its conversation will not come across: ${label} will not be able to read what it said on ${from}, `
  + 'and anything it only remembered from talking will be lost. To keep what it is doing, ask it to write a handoff before then. ';

test('#7455: every switch that loses its conversation says, in the future tense, what the next start will cost', () => {
  const cases = [
    ['Claude -> OpenAI', carry(born('ss7455-c2o', 'claude', 'anthropic'), 'claude', 'codex', 'anthropic', 'openai'), 'OpenAI', 'Claude'],
    ['OpenAI -> Claude', carry(born('ss7455-o2c', 'codex', 'openai'), 'codex', 'claude', 'openai', 'anthropic'), 'Claude', 'OpenAI'],
    ['OpenAI -> Gemini', carry(born('ss7455-o2g', 'codex', 'openai'), 'codex', 'gemini', 'openai', 'google'), 'Gemini', 'OpenAI'],
    ['Claude -> DeepSeek', carry(born('ss7455-c2d', 'claude', 'anthropic'), 'claude', 'claude', 'anthropic', 'deepseek'), 'DeepSeek', 'Claude'],
  ];
  for (const [what, carried, label, from] of cases) {
    assert.ok(carried, what + ': CONTROL: the carry says this switch loses its conversation');
    const w = create.switchPendingWords(label, carried, from);
    assert.equal(w, FUTURE(label, from), what);
    // The future tense is the point: the agent has not moved yet ("still running as before" sits beside it).
    assert.doesNotMatch(w, /\bcannot read\b|\bis lost\b|\bit is\.|Everything it knows/, what + ': present tense, or the restarted sentence');
    assert.doesNotMatch(w, /—/, what + ': an em dash');
  }
});

test('#7455: a switch that keeps its conversation adds nothing, so the restart-failed answer stays exactly as it was', () => {
  const keep = carry(born('ss7455-o2q', 'codex', 'openai'), 'codex', 'codex', 'openai', 'alibaba');
  assert.equal(keep, null, 'CONTROL: OpenAI -> Qwen keeps its conversation (one Codex home, #7445)');
  assert.equal(create.switchPendingWords('Qwen', keep, null), '');
  assert.equal(create.switchPendingWords('OpenAI', null, 'Qwen'), '');
});

test('#7455: the pending sentence and the restarted sentence come from the same fact and name the same providers', () => {
  const carried = carry(born('ss7455-same', 'codex', 'openai'), 'codex', 'gemini', 'openai', 'google');
  const now = create.switchCarryWords('Gemini', carried, 'OpenAI');
  const later = create.switchPendingWords('Gemini', carried, 'OpenAI');
  assert.match(now, /Gemini cannot read what it said on OpenAI\./);
  assert.match(later, /Gemini will not be able to read what it said on OpenAI,/);
  // Both say the conversation is lost exactly when the other does, for the same `carried`.
  for (const c of [null, carried]) assert.equal(/Everything it knows/.test(create.switchCarryWords('X', c, 'Y')), create.switchPendingWords('X', c, 'Y') === '');
  // An unknown provider it left is named the same way in both.
  assert.match(create.switchCarryWords('Gemini', carried, null), /what it said on its previous provider\./);
  assert.match(create.switchPendingWords('Gemini', carried, null), /what it said on its previous provider,/);
});
