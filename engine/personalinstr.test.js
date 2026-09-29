'use strict';

/* #4446: which agents the Instructions panel tells about a personal instructions file. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { personalInstructions, filesFor } = require('./personalinstr');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personalinstr-4446-'));
  const prev = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = root;
  return {
    root,
    done() {
      if (prev === undefined) delete process.env.AGENT_WORKFORCE_HOME;
      else process.env.AGENT_WORKFORCE_HOME = prev;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/* A create stand-in: the job and the default homes, all under the sandbox. */
function fakeCreate(root, job, profileRunner) {
  return {
    readJob: () => job,
    recordedRunner: () => profileRunner || 'claude',
    defaultAgentCodexHome: () => path.join(root, '.codex'),
    geminiStorageHome: (dir) => (dir ? path.join(dir, '.gemini') : path.join(root, '.gemini')),
    defaultAgentGrokHome: () => path.join(root, '.grok'),
  };
}

test('a default Claude agent with ~/.claude/CLAUDE.md is told; without it, is not', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const create = fakeCreate(s.root, { runner: 'claude', configDir: null });
  assert.strictEqual(personalInstructions('ann', { create }), null, 'no file yet: nothing to say');
  write(path.join(s.root, '.claude', 'CLAUDE.md'), 'Always answer in French.\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Claude Code' });
});

test('a per-account Claude agent reads ITS account dir, not ~/.claude', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const acct = path.join(s.root, '.claude-account-b');
  const create = fakeCreate(s.root, { runner: 'claude', configDir: acct });
  write(path.join(s.root, '.claude', 'CLAUDE.md'), 'default account only\n');
  assert.strictEqual(personalInstructions('ann', { create }), null,
    'the default account file does not load for an agent on another account');
  write(path.join(acct, 'CLAUDE.md'), 'account b\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Claude Code' });
});

test('a symlinked account CLAUDE.md counts, an empty one and a directory do not', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const acct = path.join(s.root, '.claude-account-b');
  fs.mkdirSync(acct, { recursive: true });
  const create = fakeCreate(s.root, { runner: 'claude', configDir: acct });
  write(path.join(s.root, '.claude', 'CLAUDE.md'), '');
  fs.symlinkSync(path.join(s.root, '.claude', 'CLAUDE.md'), path.join(acct, 'CLAUDE.md'));
  assert.strictEqual(personalInstructions('ann', { create }), null, 'an empty file loads nothing');
  write(path.join(s.root, '.claude', 'CLAUDE.md'), 'now it says something\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Claude Code' },
    'the CLI follows the link, so the panel does too');
  const other = fakeCreate(s.root, { runner: 'claude', configDir: path.join(s.root, 'diracct') });
  fs.mkdirSync(path.join(s.root, 'diracct', 'CLAUDE.md'), { recursive: true });
  assert.strictEqual(personalInstructions('ann', { create: other }), null, 'a directory named CLAUDE.md is not a file');
});

test('Codex, Gemini and Grok each report their own file under their own name', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const cases = [
    ['codex', path.join(s.root, '.codex', 'AGENTS.md'), 'Codex'],
    ['gemini', path.join(s.root, '.gemini', 'GEMINI.md'), 'Gemini CLI'],
    ['grok', path.join(s.root, '.grok', 'AGENTS.md'), 'Grok'],
  ];
  for (const [runner, file, tool] of cases) {
    const create = fakeCreate(s.root, { runner, configDir: null });
    assert.strictEqual(personalInstructions('ann', { create }), null, `${runner}: nothing before the file exists`);
    write(file, 'be brief\n');
    assert.deepStrictEqual(personalInstructions('ann', { create }), { tool }, `${runner}: told once it exists`);
  }
});

test('a Grok agent is NOT told about the person\'s CLAUDE.md (that import is off since #4426)', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  write(path.join(s.root, '.claude', 'CLAUDE.md'), 'claude only\n');
  const create = fakeCreate(s.root, { runner: 'grok', configDir: null });
  assert.strictEqual(personalInstructions('ann', { create }), null);
});

test('a per-account Gemini agent looks one level down, where the CLI keeps its files', () => {
  const create = fakeCreate('/r', null);
  assert.deepStrictEqual(filesFor('gemini', '/r/.gemini-work', create), [path.join('/r/.gemini-work', '.gemini', 'GEMINI.md')]);
});

test('Codex: the override file alone is enough, and a per-account agent reads its own home', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const acct = path.join(s.root, '.codex-work');
  const create = fakeCreate(s.root, { runner: 'codex', configDir: acct });
  write(path.join(s.root, '.codex', 'AGENTS.md'), 'default home only\n');
  assert.strictEqual(personalInstructions('ann', { create }), null,
    'the default home does not load for an agent on another account');
  write(path.join(acct, 'AGENTS.override.md'), 'override\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Codex' });
});

test('Grok: a *.md directly in rules/ counts; another extension or a subfolder does not', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const acct = path.join(s.root, '.grok-work');
  const create = fakeCreate(s.root, { runner: 'grok', configDir: acct });
  write(path.join(s.root, '.grok', 'rules', 'style.md'), 'default home only\n');
  write(path.join(acct, 'rules', 'notes.txt'), 'not markdown\n');
  write(path.join(acct, 'rules', 'deep', 'nested.md'), 'a subfolder is not scanned\n');
  write(path.join(acct, 'rules', 'empty.md'), '');
  assert.strictEqual(personalInstructions('ann', { create }), null,
    'the default home, a .txt, a nested .md and an empty .md say nothing');
  write(path.join(acct, 'rules', 'style.md'), 'short answers\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Grok' });
});

test('Antigravity, Muse and an unreadable job answer null; no job falls back to the profile', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  write(path.join(s.root, '.claude', 'CLAUDE.md'), 'x\n');
  write(path.join(s.root, '.codex', 'AGENTS.md'), 'x\n');
  for (const runner of ['antigravity', 'muse']) {
    assert.strictEqual(personalInstructions('ann', { create: fakeCreate(s.root, { runner, configDir: null }) }), null, runner);
  }
  const throwing = { ...fakeCreate(s.root, null, 'codex'), readJob: () => { throw new Error('plist unreadable'); } };
  assert.deepStrictEqual(personalInstructions('ann', { create: throwing }), { tool: 'Codex' },
    'no job read: the profile names the runner, as recordedRunner does elsewhere');
  const broken = { ...fakeCreate(s.root, null), recordedRunner: () => { throw new Error('no profile'); } };
  assert.strictEqual(personalInstructions('ann', { create: broken }), null, 'nothing readable: say nothing, never throw');
});

test('Claude: a *.md in the config dir\'s rules/ counts, in a subfolder too', (t) => {
  const s = sandbox();
  t.after(() => s.done());
  const acct = path.join(s.root, '.claude-account-b');
  const create = fakeCreate(s.root, { runner: 'claude', configDir: acct });
  write(path.join(acct, 'rules', 'notes.txt'), 'not markdown\n');
  assert.strictEqual(personalInstructions('ann', { create }), null, 'no CLAUDE.md and no *.md rule: nothing to say');
  write(path.join(acct, 'rules', 'team', 'style.md'), 'short answers\n');
  assert.deepStrictEqual(personalInstructions('ann', { create }), { tool: 'Claude Code' });
});
