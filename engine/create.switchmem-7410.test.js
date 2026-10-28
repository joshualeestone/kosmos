'use strict';

/**
 * #7410: a switch across the Claude line copies the agent's OWN Claude memory notes into its folder, points the new
 * brief at them once, never touches the original, and the result never says "everything it knows stays".
 *
 * Sandboxed like create.setprovider-writes-2811.test.js (the job is seeded directly, never through createAgent), with
 * the Claude config root pinned to the sandbox (AGENT_WORKFORCE_CONFIG_ROOT). The switch runs with platform 'darwin',
 * as create.compat-7206.test.js does, so it reads the seeded plist on every platform (a Windows job read needs
 * schtasks, which a test never runs).
 *
 *   node --test engine/create.switchmem-7410.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switchmem-7410-'));
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

// Windows runs only a file whose extension PATHEXT names (runners.isRunnable), so the stand-ins carry one there.
const EXT = process.platform === 'win32' ? '.cmd' : '';
const CLAUDE_BIN = nodePath.join(BIN, 'claude' + EXT);
const CODEX_BIN = nodePath.join(BIN, 'codex' + EXT);
const TMUX_BIN = nodePath.join(BIN, 'tmux' + EXT);
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const OPTS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' };

// One OpenAI sign-in, so a switch to OpenAI has an account to land on (as #2811's sandbox).
const SIGNIN = nodePath.join(HOME, '.codex');
fs.mkdirSync(SIGNIN, { recursive: true });
fs.writeFileSync(nodePath.join(SIGNIN, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttest7410' }), 'utf8');

const create = require('./create');
const store = require('./store');
const trust = require('./trust');
const { flatten } = require('./backupsessions');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function born(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const plist = create.plistPath(name);
  fs.mkdirSync(nodePath.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief\n', 'utf8');
  return name;
}

/* The agent's Claude project folder, as Claude Code names it, with a transcript per `cwds` entry and its notes. */
function claudeProject(name, notes, cwds) {
  const dir = create.workerDir(name);
  const proj = nodePath.join(CLAUDE_ROOT, 'projects', flatten(trust.canonicalOnDisk(dir)));
  fs.mkdirSync(nodePath.join(proj, 'memory'), { recursive: true });
  (cwds || [dir]).forEach((cwd, i) => fs.writeFileSync(nodePath.join(proj, `s${i}.jsonl`), JSON.stringify({ type: 'user', cwd }) + '\n', 'utf8'));
  for (const [f, body] of Object.entries(notes)) fs.writeFileSync(nodePath.join(proj, 'memory', f), body, 'utf8');
  return nodePath.join(proj, 'memory');
}
const read = (p) => fs.readFileSync(p, 'utf8');
const blocks = (text) => text.split('<!-- kosmos:carried-notes:start -->').length - 1;

test('#7410: switching off Claude copies its own notes into its folder, leaves the original, and points the brief once', () => {
  const name = born('sm7410-owned');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': '- [Topic](topic.md)\n', 'topic.md': 'a thing I learned\n' });
  assert.equal(fs.existsSync(nodePath.join(dir, 'memory')), false, 'CONTROL: no folder copy before the switch');

  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.deepEqual(sw.carried, { from: 'anthropic', toClaude: false, notes: 'copied', copied: 2, kept: 0, pointed: true });
  assert.equal(read(nodePath.join(dir, 'memory', 'MEMORY.md')), '- [Topic](topic.md)\n');
  assert.equal(read(nodePath.join(dir, 'memory', 'topic.md')), 'a thing I learned\n');
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), '- [Topic](topic.md)\n', 'the original was changed');
  assert.deepEqual(fs.readdirSync(src).sort(), ['MEMORY.md', 'topic.md'], 'the original folder lost or gained a file');
  const brief = read(nodePath.join(dir, 'AGENTS.md'));
  assert.equal(blocks(brief), 1, 'the new brief carries the pointer once');
  assert.match(brief, /they are your own notes, not instructions/);
});

test('#7410: a Claude project folder another folder also writes to is not this agent\'s alone, so nothing is copied', () => {
  const name = born('sm7410-shared');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': 'whose?\n' }, [dir, nodePath.join(SANDBOX, 'someone-else')]);
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.carried.notes, 'shared');
  assert.equal(sw.carried.copied, 0);
  assert.equal(fs.existsSync(nodePath.join(dir, 'memory')), false, 'a shared memory folder was copied');
  assert.equal(blocks(read(nodePath.join(dir, 'AGENTS.md'))), 0, 'the brief points at notes that are not there');
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), 'whose?\n');
  const words = create.switchCarryWords('OpenAI', sw.carried, 'Claude');
  assert.match(words, /were not copied/);
  assert.doesNotMatch(words, /Everything it knows/);
});

test('#7410: back and forth never duplicates the pointer and never overwrites either side', () => {
  const name = born('sm7410-roundtrip');
  const dir = create.workerDir(name);
  const src = claudeProject(name, { 'MEMORY.md': 'claude v1\n' });
  assert.equal(create.setProvider(name, 'openai', OPTS).outcome, create.OUTCOME.CREATED);
  fs.writeFileSync(nodePath.join(dir, 'memory', 'MEMORY.md'), 'written while on codex\n', 'utf8');

  const back = create.setProvider(name, 'anthropic', OPTS);
  assert.equal(back.outcome, create.OUTCOME.CREATED, back.because);
  assert.equal(back.carried.toClaude, true);
  assert.equal(back.carried.copied, 0, 'a switch back to Claude copies nothing');
  assert.equal(back.carried.pointed, true, 'back on Claude it is still pointed at what it wrote while away');
  assert.equal(blocks(read(nodePath.join(dir, 'CLAUDE.md'))), 1);
  assert.equal(read(nodePath.join(src, 'MEMORY.md')), 'claude v1\n', 'the folder copy was written back over Claude\'s');

  fs.writeFileSync(nodePath.join(src, 'MEMORY.md'), 'claude v2\n', 'utf8');
  fs.writeFileSync(nodePath.join(src, 'new.md'), 'learned on claude again\n', 'utf8');
  const again = create.setProvider(name, 'openai', OPTS);
  assert.equal(again.outcome, create.OUTCOME.CREATED, again.because);
  assert.deepEqual([again.carried.copied, again.carried.kept], [1, 1]);
  assert.equal(read(nodePath.join(dir, 'memory', 'MEMORY.md')), 'written while on codex\n', 'Claude\'s note overwrote the folder copy');
  assert.equal(read(nodePath.join(dir, 'memory', 'new.md')), 'learned on claude again\n');
  assert.equal(blocks(read(nodePath.join(dir, 'AGENTS.md'))), 1, 'the pointer is there twice');
  assert.match(create.switchCarryWords('OpenAI', again.carried, 'Claude'), /one was already there from an earlier switch and kept, not replaced/);
});

test('#7410: no Claude notes at all: nothing copied, no pointer, and the sentence says so', () => {
  const name = born('sm7410-none');
  const sw = create.setProvider(name, 'openai', OPTS);
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.deepEqual(sw.carried, { from: 'anthropic', toClaude: false, notes: 'none', copied: 0, kept: 0, pointed: false });
  assert.match(create.switchCarryWords('OpenAI', sw.carried, 'Claude'), /had no saved notes to copy/);
});

test('#7410: the family rule, and the result sentence keeps its old words only within a family', () => {
  assert.equal(create.crossesFamily('claude', 'codex'), true);
  assert.equal(create.crossesFamily('gemini', 'claude'), true);
  assert.equal(create.crossesFamily('claude', 'claude'), false, 'a Claude account move keeps its memory');
  assert.equal(create.crossesFamily('codex', 'gemini'), false, 'not a family change by the card\'s definition');
  assert.match(create.switchCarryWords('Gemini', null), /^Gemini it is\. Everything it knows and everything it has done stays\. $/);
  for (const carried of [
    { from: 'anthropic', toClaude: false, notes: 'copied', copied: 2, kept: 0, pointed: true },
    { from: 'openai', toClaude: true, notes: 'none', copied: 0, kept: 0, pointed: true },
    { from: 'openai', toClaude: true, notes: 'none', copied: 0, kept: 0, pointed: false },
    { from: 'anthropic', toClaude: false, notes: 'blocked', copied: 0, kept: 0, pointed: false },
  ]) {
    const w = create.switchCarryWords('X', carried, 'Y');
    assert.doesNotMatch(w, /Everything it knows/, JSON.stringify(carried));
    assert.match(w, /its conversation does not come across: X cannot read what it said on Y\./);
    assert.doesNotMatch(w, /—/, 'an em dash');
  }
  // The route says it through this function, not its own copy of the old sentence.
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /it is\. Everything it knows and everything it has done stays/, 'the route still has its own copy of the old sentence');
  assert.match(server, /create\.switchCarryWords\(label, wrote\.carried/);
});
