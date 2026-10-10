'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5516 part 2: the token-only guard denies what Claude Code's own config names to start outside the sandbox at the
 * agent's next start, or reads as instructions: the global config by every name and its legacy file, the project
 * server file in the folder and above it, the config homes' code and instruction members, and the agent's own .claude
 * (see tokenOnlySettingsRules for which layer carries each). These tests assert the CONFIG WRITTEN, as the #4491
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
  const CODE_DIRS = ['plugins', 'skills', 'agents', 'commands', 'hooks', 'workflows', 'routines', 'rules', 'output-styles', 'cowork_plugins', 'local', 'jobs', 'daemon', 'mcp-skill-archives', 'ide'];
  const CODE_FILES = ['scheduled_tasks.json', 'launch.json', 'CLAUDE.md', 'daemon.json', 'loop.md', 'remote-settings.json'];
  const homes = [path.join(HOME, '.claude'), path.join(HOME, '.claude-acct')];
  const ancestors = [];
  for (let d = path.resolve(dir); ; d = path.dirname(d)) { ancestors.push(d); if (path.dirname(d) === d) break; }
  const files = [
    ...SFX.flatMap((x) => [path.join(HOME, `.claude${x}.json`), ...homes.map((h) => path.join(h, `.claude${x}.json`))]),
    ...homes.map((h) => path.join(h, '.config.json')),
    ...homes.flatMap((h) => CODE_FILES.map((f) => path.join(h, f))),
    path.join(dir, '.mcp.json'),
  ];
  // Review 2: the ancestors' .mcp.json go to the file tools only (the shell cannot write there; the profile has a size limit).
  // Review 7: the agent's own files are never denied as an ancestor's, by its given OR its resolved path (the test runs
  // under the temp folder, whose path on macOS runs through a link, so the resolved chain is exercised here).
  const ownReal = fs.realpathSync.native(dir);
  for (const own of [path.resolve(dir), ownReal]) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md']) assert.ok(!deny.includes(`Edit(${ruleAbs(path.join(own, f))})`), 'the agent own ' + f + ' was denied as an ancestor file (' + own + ')');
  }
  for (const f of ancestors.slice(1).flatMap((d) => ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'settings.json'), path.join('.claude', 'settings.local.json')].map((x) => path.join(d, x)))) {
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools');
    assert.ok(!s.sandbox.filesystem.denyWrite.includes(realOrLeaf(f)), f + ' went into the sandbox profile');
  }
  assert.ok(ancestors.length >= 3 && ancestors.includes('/'), 'CONTROL: the ancestor walk reached the root');
  for (const f of files) {
    assert.ok(deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools');
    assert.ok(dw.includes(realOrLeaf(f)), f + ' is not denied to the shell');
  }
  for (const d of homes.flatMap((h) => CODE_DIRS.map((x) => path.join(h, x)))) {
    assert.ok(deny.includes(`Edit(${ruleAbs(d)}/**)`), d + ' is not denied to the file tools');
    assert.ok(dw.includes(realOrLeaf(d)), d + ' is not denied to the shell');
  }
  // A config home made after the guard was written: the permission-layer globs.
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', '.claude.json'))})`), 'no glob for a later home .claude.json');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', 'plugins'))}/**)`), 'no glob for a later home plugins folder');
  for (const x of CODE_DIRS) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', x))}/**)`), 'no glob for a later home ' + x + ' folder');
  // Review 3: every global-config name for a later home, not only the plain one.
  for (const x of SFX) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', `.claude${x}.json`))})`), 'no glob for a later home .claude' + x + '.json');
  // Reviews 3 and 4: the code and instruction members of the agent's own .claude, to the file tools.
  for (const x of CODE_DIRS) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude', x))}/**)`), 'the agent own .claude/' + x + ' is open to the file tools');
  for (const f of CODE_FILES) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude', f))})`), 'the agent own .claude/' + f + ' is open');
  // Review 5: a .claude in a folder ABOVE the agent holds the same members, read for every agent below.
  for (const a of ancestors.slice(1)) {
    for (const x of CODE_DIRS) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(a, '.claude', x))}/**)`), a + '/.claude/' + x + ' is open to the file tools');
    for (const f of CODE_FILES) assert.ok(deny.includes(`Edit(${ruleAbs(path.join(a, '.claude', f))})`), a + '/.claude/' + f + ' is open to the file tools');
  }
  // CONTROL: not the folder whole, so its plans and worktrees stay writable to its tools.
  assert.ok(!deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude'))}/**)`), 'the agent own .claude is denied whole (its plans and worktrees with it)');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude-*', '.config.json'))})`), 'no glob for a later home legacy config');
  // CONTROL: the config homes themselves are not denied whole (Claude Code keeps its runtime state there).
  for (const h of [path.join(HOME, '.claude'), path.join(HOME, '.claude-acct')]) {
    assert.ok(!dw.includes(realOr(h)), h + ' was denied whole to the shell');
    assert.ok(!deny.includes(`Edit(${ruleAbs(h)}/**)`), h + ' was denied whole to the file tools');
  }
});

test('#5516 part 2 (review 1): off darwin the file-tool rules are written all the same, with no sandbox block', () => {
  const dir = agentDir('pilot-cfg-linux');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-linux', { ...DEPS, platform: 'linux' });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  assert.equal(s.sandbox, undefined, 'CONTROL: no sandbox block off darwin');
  for (const f of [path.join(HOME, '.claude.json'), path.join(HOME, '.claude', '.config.json'), path.join(dir, '.mcp.json')]) {
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(f)})`), f + ' is not denied to the file tools off darwin');
  }
});

test('#5516 part 2 (review 2): with many account homes the guard stays whole (inside the sandbox size ceiling)', () => {
  const home = path.join(path.dirname(HOME), 'home-many');   // its own home (review 3), so no later test sees these
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  for (let i = 0; i < 12; i++) fs.mkdirSync(path.join(home, '.claude-acct' + i), { recursive: true });
  const dir = agentDir('pilot-cfg-many');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-many', { ...DEPS, home });
  assert.equal(g.ok, true, 'thirteen config homes tripped the guard: ' + JSON.stringify(g));
  // Review 5: the guard says ok WITH a warning past the profile ceiling; no warning is what this test is for.
  assert.equal(g.warning, undefined, 'thirteen config homes passed the sandbox size ceiling: ' + g.warning);
  assert.ok(readSettings(dir).permissions.deny.includes(`Edit(${ruleAbs(path.join(home, '.claude-acct11', '.config.json'))})`), 'CONTROL: the new homes were seen');
});

test('#5516 part 2 (review 3): a config home code folder that is a link has its target denied in both layers', () => {
  const home = path.join(path.dirname(HOME), 'home-link');
  const target = path.join(path.dirname(HOME), 'shared-skills');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, path.join(home, '.claude', 'skills'));
  const dir = agentDir('pilot-cfg-link');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-link', { ...DEPS, home });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  const real = fs.realpathSync.native(target);
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(home, '.claude', 'skills'))}/**)`), 'CONTROL: the link itself is named');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(real)}/**)`), 'the link target is open to the file tools');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(real), 'the link target is open to the shell');
});

test('#5516 part 2 (review 5): a link to a path the rule syntax cannot carry is named, and the guard is not whole', () => {
  const home = path.join(path.dirname(HOME), 'home-oddlink');
  const target = path.join(path.dirname(HOME), 'Drive (Personal)', 'skills');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, path.join(home, '.claude', 'skills'));
  const dir = agentDir('pilot-cfg-odd');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-odd', { ...DEPS, home });
  assert.equal(g.ok, false, 'an uncovered link target read as a whole guard');
  assert.match(String(g.because), /Drive \(Personal\)/, 'the reason does not name the link target: ' + g.because);
  // Review 7: the rest of the guard is still written, and the sandbox carries the target the permission syntax cannot.
  assert.match(String(g.because), /the rest of the guard is in place/);
  const s = readSettings(dir);
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(home, '.claude', 'CLAUDE.md'))})`), 'the rest of the guard was not written');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(fs.realpathSync.native(target)), 'the uncarriable target is missing from the sandbox layer too');
});

test('#5516 part 2 (review 6): a config home that is a link has its absent members named by their real path', () => {
  const base = path.join(path.dirname(HOME), 'home-linked');
  const real = path.join(path.dirname(HOME), 'real-account-home');
  fs.mkdirSync(path.join(base, '.claude'), { recursive: true });
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(base, '.claude-linked'));
  const dir = agentDir('pilot-cfg-linkedhome');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-linkedhome', { ...DEPS, home: base });
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  const rreal = fs.realpathSync.native(real);
  for (const f of ['daemon.json', 'scheduled_tasks.json', '.config.json']) {
    assert.ok(!fs.existsSync(path.join(real, f)), 'CONTROL: ' + f + ' does not exist yet');
    assert.ok(deny.includes(`Edit(${ruleAbs(path.join(base, '.claude-linked', f))})`), 'CONTROL: the link-side name of ' + f);
    assert.ok(deny.includes(`Edit(${ruleAbs(path.join(rreal, f))})`), 'the real path of an absent ' + f + ' is open to the file tools');
  }
});

test('#5516 part 2 (review 8): sibling agents are denied their members, and memory folders where they reach other agents', () => {
  const dir = agentDir('pilot-cfg-sib');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-sib', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  const base = path.dirname(path.resolve(dir));
  for (const f of ['.mcp.json', 'CLAUDE.md', path.join('.claude', 'settings.json'), path.join('.claude', 'CLAUDE.md')]) {
    assert.ok(deny.includes(`Edit(${ruleAbs(path.join(base, '*', f))})`), 'a sibling agent ' + f + ' is open to the file tools');
  }
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(base, '*', '.claude', 'skills'))}/**)`), 'a sibling agent skills folder is open');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(base, '*', '.claude', 'agent-memory'))}/**)`), 'a sibling agent memory is open');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(HOME, '.claude', 'agent-memory'))}/**)`), 'a config home agent memory is open');
  // CONTROL: the agent's own memory stays writable to its own tools.
  assert.ok(!deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude', 'agent-memory'))}/**)`), 'the agent own memory was denied');
});

test('#5516 part 2 (review 8): a folder above the agent that the rules cannot carry makes the guard refuse, saying why', () => {
  const dir = path.join(path.dirname(HOME), 'App (Beta)', 'workers', 'pilot-cfg-odd-anc');
  fs.mkdirSync(dir, { recursive: true });
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-odd-anc', DEPS);
  // A folder above with such a character puts it in the agent's own path too, so the guard's own rules cannot be written
  // either: it refuses on that (the folder-path reason), which is the honest answer. The ancestor-only naming is for a
  // RESOLVED ancestor path that differs from the given one (a link), where the agent's own rules still hold.
  assert.equal(g.ok, false, 'an uncarriable ancestor read as a whole guard');
  assert.match(String(g.because), /cannot carry/, 'the refusal does not say why: ' + g.because);
});
