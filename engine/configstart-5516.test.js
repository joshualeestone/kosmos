'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5516 part 2: the token-only guard denies, in both layers, what Claude Code's own config names to start outside the
 * sandbox at the agent's next start: each config home's .claude.json (and the first account's ~/.claude.json), the
 * agent folder's .mcp.json, and each config home's plugins folder. These tests assert the CONFIG WRITTEN, as the #4491
 * tests do; that Claude Code still writes its own state with these denies in place was measured by hand (the plan).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'configstart-5516-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

// store.ROOT is AGENT_WORKFORCE_DATA + '/Kosmos'; that is where board.token and the token-only list live,
// and what guardTokenOnlyFolder defaults dataRoot to in production (called with no deps).
fs.mkdirSync(store.ROOT, { recursive: true });
// runner/runnerOf: the guard is a Claude Code settings file, so it now refuses an unnamed or non-Claude runner
// (#4491 review WARNING 1); these tests name Claude unless they test that refusal.
/* #5516 review 21: the launch-PATH part of the guard is pinned empty here, so these tests do not read this host's real
   PATH, fixed folders or install (engine/launchpath-5516.test.js tests that part). */
const LAUNCH_PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ...LAUNCH_PIN };
/* An agent's folder, made as creation makes it: the board-start refresh guards only agents that have one (review 11). */
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function realOrLeaf(p) {
  const abs = path.resolve(p); let dir = path.dirname(abs); const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir); if (parent === dir) return abs;
    tail.unshift(path.basename(dir)); dir = parent;
  }
}
const HOME = process.env.AGENT_WORKFORCE_HOME;
// Two config homes, as an install with a second account has: ~/.claude and ~/.claude-acct.
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude-acct'), { recursive: true });

test('#5516 part 2: both layers deny each config home .claude.json, the agent .mcp.json and each plugins folder', () => {
  const dir = agentDir('pilot-cfg');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  const deny = s.permissions.deny;
  const dw = s.sandbox.filesystem.denyWrite;
  /* Read from the installed Claude Code (grep -a its binary under ~/.local/share/claude/versions/<v> for ".config.json",
     `.claude${`, ".mcp.json"); re-derive this list when Claude Code changes it.
     The CLASS, pinned (review 1): the global config by each name Claude Code 2.1.296 gives it, beside the home and in
     each config home; the legacy .config.json it reads instead when present; .mcp.json in the folder and every
     ancestor. A member missing from the guard is a red here, not a silent gap. */
  const SFX = ['', '-staging-oauth', '-local-oauth', '-custom-oauth'];
  const homes = [path.join(HOME, '.claude'), path.join(HOME, '.claude-acct')];
  const ancestors = [];
  for (let d = path.resolve(dir); ; d = path.dirname(d)) { ancestors.push(d); if (path.dirname(d) === d) break; }
  const files = [
    ...SFX.flatMap((x) => [path.join(HOME, `.claude${x}.json`), ...homes.map((h) => path.join(h, `.claude${x}.json`))]),
    ...homes.map((h) => path.join(h, '.config.json')),
    path.join(dir, '.mcp.json'),
  ];
  // Review 2: the ancestors' .mcp.json go to the file tools only (the shell cannot write there; the profile has a size limit).
  for (const d of ancestors.slice(1)) {
    const f = path.join(d, '.mcp.json');
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools');
    assert.ok(!s.sandbox.filesystem.denyWrite.includes(realOrLeaf(f)), f + ' went into the sandbox profile');
  }
  assert.ok(ancestors.length >= 3 && ancestors.includes('/'), 'CONTROL: the ancestor walk reached the root');
  for (const f of files) {
    assert.ok(deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools');
    assert.ok(dw.includes(realOrLeaf(f)), f + ' is not denied to the shell');
  }
  for (const d of homes.flatMap((h) => ['plugins', 'skills', 'agents', 'commands'].map((x) => path.join(h, x)))) {
    assert.ok(deny.includes(`Edit(${ruleAbs(d)}/**)`), d + ' is not denied to the file tools');
    assert.ok(dw.includes(realOrLeaf(d)), d + ' is not denied to the shell');
  }
  // A config home made after the guard was written: the permission-layer globs.
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', '.claude.json'))})`), 'no glob for a later home .claude.json');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', 'plugins'))}/**)`), 'no glob for a later home plugins folder');
  for (const x of ['skills', 'agents', 'commands']) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', x))}/**)`), 'no glob for a later home ' + x + ' folder');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', '.config.json'))})`), 'no glob for a later home legacy config');
  // CONTROL: the config homes themselves are not denied whole (Claude Code keeps its runtime state there).
  for (const h of [path.join(HOME, '.claude'), path.join(HOME, '.claude-acct')]) {
    assert.ok(!dw.includes(realOr(h)), h + ' was denied whole to the shell');
    assert.ok(!deny.includes(`Edit(${ruleAbs(h)}/**)`), h + ' was denied whole to the file tools');
  }
});

test('#5516 part 2 (review 1): off darwin the file-tool rules are written all the same, with no sandbox block', () => {
  const dir = agentDir('pilot-cfg-linux');
  setup.guardTokenOnlyFolder(dir, 'pilot-cfg-linux', { ...DEPS, platform: 'linux' });
  const s = readSettings(dir);
  assert.equal(s.sandbox, undefined, 'CONTROL: no sandbox block off darwin');
  for (const f of [path.join(HOME, '.claude.json'), path.join(HOME, '.claude', '.config.json'), path.join(dir, '.mcp.json')]) {
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools off darwin');
  }
});

test('#5516 part 2 (review 2): with many account homes the guard stays whole (inside the sandbox size ceiling)', () => {
  for (let i = 0; i < 10; i++) fs.mkdirSync(path.join(HOME, '.claude-acct' + i), { recursive: true });
  const dir = agentDir('pilot-cfg-many');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-many', DEPS);
  assert.equal(g.ok, true, 'twelve config homes tripped the guard: ' + JSON.stringify(g));
  assert.ok(readSettings(dir).permissions.deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-acct9', '.config.json'))})`), 'CONTROL: the new homes were seen');
});
