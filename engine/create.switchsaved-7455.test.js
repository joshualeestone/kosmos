'use strict';

/**
 * #7455: a provider switch that is saved but could not be restarted. The route says it is still running as before; for
 * a switch that loses its conversation it must also say, in the future tense, what the NEXT start will cost.
 * switchPendingWords builds that from the same `carried` fact switchCarryWords uses, and (round 1) through the SAME
 * notes clause (switchNotesWords), so the two answers cannot disagree about the notes. A handoff is offered only when
 * the old session is known to be still up (the route passes remove.js's stillRunning). For a switch that keeps its
 * conversation (carried null) it adds nothing.
 *
 * Every `carried` here comes from the real carryClaudeNotes in a sandbox (as create.switchmem-7410.test.js does), with
 * the job seeded as setProvider would find it, so the fixture is the shape the route is handed. The route itself is
 * driven over HTTP in server.switch-account-1373.test.js (#7455 tests there), which cannot run on Windows.
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
const trust = require('./trust');
const { flatten } = require('./backupsessions');

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
/* Its Claude notes, where Claude Code keeps them, with a transcript of its own beside them (create.switchmem-7410). */
function claudeNotes(name, notes) {
  const dir = create.workerDir(name);
  const proj = nodePath.join(CLAUDE_ROOT, 'projects', flatten(trust.canonicalOnDisk(dir)));
  fs.mkdirSync(nodePath.join(proj, 'memory'), { recursive: true });
  for (const [f, body] of Object.entries(notes)) fs.writeFileSync(nodePath.join(proj, 'memory', f), body, 'utf8');
  fs.writeFileSync(nodePath.join(proj, 's0.jsonl'), JSON.stringify({ type: 'user', cwd: dir }) + '\n', 'utf8');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(nodePath.join(proj, 's0.jsonl'), later, later);
}
// newBrief null: the pointer is not written, as when the instructions cannot be (copied but not pointed).
const carry = (name, fromRunner, toRunner, from, to) => create.carryClaudeNotes(name, { runner: fromRunner }, toRunner, null, from, to);

const KINDS = () => [
  ['Claude -> OpenAI', carry(born('ss7455-c2o', 'claude', 'anthropic'), 'claude', 'codex', 'anthropic', 'openai'), 'OpenAI', 'Claude'],
  ['OpenAI -> Claude', carry(born('ss7455-o2c', 'codex', 'openai'), 'codex', 'claude', 'openai', 'anthropic'), 'Claude', 'OpenAI'],
  ['OpenAI -> Gemini', carry(born('ss7455-o2g', 'codex', 'openai'), 'codex', 'gemini', 'openai', 'google'), 'Gemini', 'OpenAI'],
  ['Claude -> DeepSeek', carry(born('ss7455-c2d', 'claude', 'anthropic'), 'claude', 'claude', 'anthropic', 'deepseek'), 'DeepSeek', 'Claude'],
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('#7455: still running: the next restart loses the conversation, in the future tense, and a handoff is offered', () => {
  for (const [what, carried, label, from] of KINDS()) {
    assert.ok(carried, what + ': CONTROL: the carry says this switch loses its conversation');
    const w = create.switchPendingWords(label, carried, from, true);
    assert.match(w, new RegExp('^When it restarts, its conversation will not come across: ' + esc(label)
      + ' will not be able to read what it said on ' + esc(from) + '\\. '), what);
    assert.match(w, /will be lost\./, what + ': what it remembered from talking, in the future');
    assert.match(w, /To keep what it is doing, ask it to write a handoff before it restarts\. $/, what + ': the handoff ends it');
    assert.doesNotMatch(w, /\bcannot read\b|\bis lost\b|\bit is\.|Everything it knows/, what + ': present tense, or the restarted sentence');
    assert.doesNotMatch(w, /—/, what + ': an em dash');
  }
});

test('#7455 round 1: not known to be running: it starts on the new provider without this conversation, and no handoff is promised', () => {
  for (const [what, carried, label, from] of KINDS()) {
    for (const stillRunning of [false, undefined]) {
      const w = create.switchPendingWords(label, carried, from, stillRunning);
      assert.match(w, new RegExp('^When it next starts, it will start on ' + esc(label) + ' without this conversation: '
        + esc(label) + ' will not be able to read what it said on ' + esc(from) + '\\. '), what);
      assert.doesNotMatch(w, /handoff|still running/, what + ': a handoff nobody can ask for, or a running agent it is not');
      assert.match(w, /will be lost\./, what);
      assert.doesNotMatch(w, /\bis lost\b/, what);
    }
  }
});

test('#7455 round 1: the pending answer says the same notes facts as the restarted one, for each kind', () => {
  // rootChange: Claude -> DeepSeek, its Claude notes stay behind.
  const root = carry(born('ss7455-n-root', 'claude', 'anthropic'), 'claude', 'claude', 'anthropic', 'deepseek');
  assert.match(create.switchPendingWords('DeepSeek', root, 'Claude', false), /Its saved notes stay behind with Claude and do not come across\. /);
  // between: the runner's own notes stay behind there.
  const between = carry(born('ss7455-n-between', 'codex', 'openai'), 'codex', 'gemini', 'openai', 'google');
  assert.match(create.switchPendingWords('Gemini', between, 'OpenAI', true), /Any notes OpenAI saved for it stay behind there\. /);
  // copied but not pointed: tell it where they are.
  const cName = born('ss7455-n-copied', 'claude', 'anthropic');
  claudeNotes(cName, { 'MEMORY.md': 'a thing it learned\n' });
  const copied = carry(cName, 'claude', 'codex', 'anthropic', 'openai');
  assert.deepEqual([copied.notes, copied.pointed], ['copied', false], 'CONTROL: copied and not pointed');
  assert.match(create.switchPendingWords('OpenAI', copied, 'Claude', true),
    /Its saved notes are copied into its folder, and anything it only remembered from talking will be lost\. Its instructions do not mention them yet, so tell it they are in memory\/claude-notes\/ in its folder\. /);
  // failed: it had notes and none landed (all over 1 MB), never "it had no saved notes".
  const fName = born('ss7455-n-failed', 'claude', 'anthropic');
  claudeNotes(fName, { 'huge.md': 'x'.repeat(1024 * 1024 + 1) });
  const failed = carry(fName, 'claude', 'codex', 'anthropic', 'openai');
  assert.equal(failed.notes, 'failed', 'CONTROL: the copy failed');
  const fw = create.switchPendingWords('OpenAI', failed, 'Claude', false);
  assert.match(fw, /It had saved notes, but none were copied: one was left out \(not a plain file, over 1 MB, or changed since its own last conversation\)\. They are still where Claude keeps them\. Anything it only remembered from talking will be lost\. /);
  assert.doesNotMatch(fw, /no saved notes/);
  // One clause for both answers: the restarted answer's notes, with only the tense of what is lost changed.
  for (const c of [root, between, copied, failed]) {
    const now = create.switchCarryWords('X', c, 'Y').split('cannot read what it said on Y. ')[1];
    const later = create.switchPendingWords('X', c, 'Y', false).split('will not be able to read what it said on Y. ')[1];
    assert.equal(later, now.split(' is lost.').join(' will be lost.'), JSON.stringify(c));
  }
});

test('#7455: a switch that keeps its conversation adds nothing, so the restart-failed answer stays exactly as it was', () => {
  const keep = carry(born('ss7455-o2q', 'codex', 'openai'), 'codex', 'codex', 'openai', 'alibaba');
  assert.equal(keep, null, 'CONTROL: OpenAI -> Qwen keeps its conversation (one Codex home, #7445)');
  for (const stillRunning of [true, false]) {
    assert.equal(create.switchPendingWords('Qwen', keep, null, stillRunning), '');
    assert.equal(create.switchPendingWords('OpenAI', null, 'Qwen', stillRunning), '');
  }
});

test('#7455: the pending and restarted answers come from the same fact and name the same providers', () => {
  const carried = carry(born('ss7455-same', 'codex', 'openai'), 'codex', 'gemini', 'openai', 'google');
  for (const c of [null, carried]) assert.equal(/Everything it knows/.test(create.switchCarryWords('X', c, 'Y')), create.switchPendingWords('X', c, 'Y', true) === '');
  // An unknown provider it left is named the same way in both.
  assert.match(create.switchCarryWords('Gemini', carried, null), /what it said on its previous provider\./);
  assert.match(create.switchPendingWords('Gemini', carried, null, false), /what it said on its previous provider\./);
});
