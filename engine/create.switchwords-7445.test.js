'use strict';

/**
 * #7445: a switch between two runners that are not Claude Code (Codex to Gemini, Gemini to Grok, ...) loses the
 * conversation, so the result sentence says so and never says everything it knows stays. OpenAI <-> Qwen is one
 * runner in one private Codex home (codexruntime.forSession, #4592), so it keeps the old sentence. The Claude cases
 * (#7410) keep their exact result shape and words.
 *
 * Sandboxed like create.switchmem-7410.test.js (platform 'darwin', so the seeded plist is read on every platform and
 * no schtasks runs).
 *
 *   node --test engine/create.switchwords-7445.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switchwords-7445-'));
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

const EXT = process.platform === 'win32' ? '.cmd' : '';
const CLAUDE_BIN = nodePath.join(BIN, 'claude' + EXT);
const CODEX_BIN = nodePath.join(BIN, 'codex' + EXT);
const TMUX_BIN = nodePath.join(BIN, 'tmux' + EXT);
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const OPTS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' };

const SIGNIN = nodePath.join(HOME, '.codex');
fs.mkdirSync(SIGNIN, { recursive: true });
fs.writeFileSync(nodePath.join(SIGNIN, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttest7445' }), 'utf8');

const create = require('./create');
const store = require('./store');
const codexruntime = require('./codexruntime');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function born(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const plist = create.plistPath(name);
  fs.mkdirSync(nodePath.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief for this agent\n', 'utf8');
  return name;
}
const notesDir = (name) => nodePath.join(create.workerDir(name), 'memory', 'claude-notes');
const OLD = /^(\w+) it is\. Everything it knows and everything it has done stays\. $/;

// Every non-Claude runner pair the switch menu can produce, by provider.
const OTHERS = [['openai', 'codex'], ['google', 'gemini'], ['xai', 'grok'], ['antigravity', 'antigravity'], ['meta', 'muse']];

test('#7445: every switch between two different runners that are not Claude Code loses the conversation', () => {
  for (const [fp, fr] of OTHERS) {
    for (const [tp, tr] of OTHERS) {
      if (fp === tp) continue;
      assert.equal(create.providerRunner(fp), fr); assert.equal(create.providerRunner(tp), tr);
      assert.equal(create.switchLosesConversation(fr, tr, fp, tp), true, fp + ' -> ' + tp);
    }
    // Qwen runs on Codex too: a switch from it to any other non-Claude runner loses it the same way.
    if (fr !== 'codex') {
      assert.equal(create.switchLosesConversation('codex', fr, 'alibaba', fp), true, 'alibaba -> ' + fp);
      assert.equal(create.switchLosesConversation(fr, 'codex', fp, 'alibaba'), true, fp + ' -> alibaba');
    }
  }
});

test('#7445: OpenAI <-> Qwen keeps it (one Codex home), and the #7410 rule is unchanged around it (controls)', () => {
  assert.equal(create.switchLosesConversation('codex', 'codex', 'openai', 'alibaba'), false, 'OpenAI -> Qwen');
  assert.equal(create.switchLosesConversation('codex', 'codex', 'alibaba', 'openai'), false, 'Qwen -> OpenAI');
  // The evidence for that call: the agent's Codex home is keyed on the agent, not on the account it signs in with.
  assert.equal(codexruntime.forAgent('sw7445-one'), codexruntime.forAgent('sw7445-one'));
  assert.ok(!/\.codex|kosmos-qwen/.test(nodePath.basename(codexruntime.forAgent('sw7445-one'))), 'the home is not an account folder');
  assert.equal(create.switchLosesConversation('gemini', 'gemini', 'google', 'google'), false, 'same provider is not a switch');
  assert.equal(create.switchLosesConversation('claude', 'codex', 'anthropic', 'openai'), true);
  assert.equal(create.switchLosesConversation('gemini', 'claude', 'google', 'anthropic'), true);
  assert.equal(create.switchLosesConversation('claude', 'claude', 'anthropic', 'deepseek'), true);
  assert.equal(create.switchLosesConversation('claude', 'claude', 'anthropic', 'anthropic'), false);
});

test('#7445: Codex -> Gemini copies nothing and returns its own state; the sentence says the conversation does not come across', () => {
  const name = born('sw7445-cg');
  const r = create.carryClaudeNotes(name, { runner: 'codex' }, 'gemini', null, 'openai', 'google');
  assert.deepEqual(r, { from: 'openai', toClaude: false, rootChange: false, notes: 'none-kept-by-runner', copied: 0, kept: 0, skipped: 0, occupied: 0, failed: 0, pointed: false, between: true });
  assert.equal(fs.existsSync(notesDir(name)), false, 'something was copied');
  const w = create.switchCarryWords('Gemini', r, 'OpenAI');
  assert.equal(w, 'Gemini it is. It keeps its name, its instructions and its files, but its conversation does not come across: '
    + 'Gemini cannot read what it said on OpenAI. Anything it only remembered from talking is lost. ');
  assert.doesNotMatch(w, /Everything it knows|Claude|stay behind|copied/);
  assert.doesNotMatch(w, /—/, 'an em dash');
});

test('#7445: notes an earlier switch left in its folder stay pointed at, and are said; a pointer with nothing behind it is taken out', () => {
  const name = born('sw7445-pointed');
  const dir = create.workerDir(name);
  fs.mkdirSync(notesDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(notesDir(name), 'MEMORY.md'), 'kept from Claude days\n', 'utf8');
  const pj = require('./projects');
  const brief = nodePath.join(dir, 'AGENTS.md');
  fs.renameSync(nodePath.join(dir, 'CLAUDE.md'), brief);
  store.writeProfile(name, { provider: 'openai' });
  // A real-length brief: the instructions writer refuses one under 20 characters.
  fs.writeFileSync(brief, pj.spliceBlock('# brief for this agent, long enough to keep\n', 'pointer', pj.CARRIED_NOTES_START, pj.CARRIED_NOTES_END), 'utf8');
  const g = create.carryClaudeNotes(name, { runner: 'codex' }, 'grok', brief, 'openai', 'xai');
  assert.equal(g.between, true);
  assert.equal(g.notes, 'none-kept-by-runner');
  assert.equal(g.pointed, true, 'the notes in its folder lost their pointer');
  assert.equal(fs.readFileSync(brief, 'utf8').split(pj.CARRIED_NOTES_START).length - 1, 1, 'the pointer is there once');
  assert.match(create.switchCarryWords('Grok', g, 'OpenAI'),
    /Grok cannot read what it said on OpenAI\. The notes in its folder stay there for it to read, and anything it only remembered from talking is lost\. $/);
  assert.equal(fs.readFileSync(nodePath.join(notesDir(name), 'MEMORY.md'), 'utf8'), 'kept from Claude days\n', 'a note was changed');

  // Nothing real behind the pointer: it is taken out, and the sentence does not mention notes.
  fs.rmSync(notesDir(name), { recursive: true, force: true });
  const gone = create.carryClaudeNotes(name, { runner: 'codex' }, 'grok', brief, 'openai', 'xai');
  assert.equal(gone.pointed, false);
  assert.equal(fs.readFileSync(brief, 'utf8').includes(pj.CARRIED_NOTES_START), false, 'a pointer to nothing was left in');
  assert.doesNotMatch(create.switchCarryWords('Grok', gone, 'OpenAI'), /notes in its folder/);
});

test('#7445: the Claude cases keep their exact shape (no between field) and words', () => {
  const off = create.carryClaudeNotes(born('sw7445-claude-off'), { runner: 'claude' }, 'codex', null, 'anthropic', 'openai');
  assert.equal('between' in off, false);
  assert.equal(off.notes, 'none');
  assert.match(create.switchCarryWords('OpenAI', off, 'Claude'), /had no saved notes to copy/);
  const back = create.carryClaudeNotes(born('sw7445-claude-back'), { runner: 'gemini' }, 'claude', null, 'google', 'anthropic');
  assert.equal('between' in back, false);
  assert.equal(back.toClaude, true);
  const ds = create.carryClaudeNotes(born('sw7445-ds'), { runner: 'claude' }, 'claude', null, 'anthropic', 'deepseek');
  assert.deepEqual([ds.rootChange, ds.notes, 'between' in ds], [true, 'stayed', false]);
  assert.match(create.switchCarryWords('DeepSeek', ds, 'Claude'), /Its saved notes stay behind with Claude/);
});

test('#7445: a switch that keeps the conversation keeps the old sentence', () => {
  assert.equal(create.carryClaudeNotes(born('sw7445-qwen'), { runner: 'codex' }, 'codex', null, 'openai', 'alibaba'), null);
  assert.match(create.switchCarryWords('Qwen', null), OLD);
  assert.match(create.switchCarryWords('OpenAI', null, 'Qwen'), OLD);
});

test('#7445: end to end, Claude -> OpenAI -> Gemini says the conversation does not come across on the second switch too', () => {
  const name = born('sw7445-e2e');
  const first = create.setProvider(name, 'openai', OPTS);
  assert.equal(first.outcome, create.OUTCOME.CREATED, first.because);
  const GEMINI_BIN = nodePath.join(BIN, 'gemini' + EXT);
  fs.writeFileSync(GEMINI_BIN, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const sw = create.setProvider(name, 'google', { ...OPTS, geminiBin: GEMINI_BIN });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.ok(sw.carried, 'Codex -> Gemini came back as a switch that keeps its conversation');
  assert.equal(sw.carried.between, true);
  assert.equal(sw.carried.from, 'openai');
  const w = create.switchCarryWords('Gemini', sw.carried, 'OpenAI');
  assert.match(w, /its conversation does not come across: Gemini cannot read what it said on OpenAI\./);
  assert.doesNotMatch(w, /Everything it knows/);
});
