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
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), ...LAUNCH_PIN };
/* An agent's folder, made as creation makes it: the board-start refresh guards only agents that have one (review 11). */
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
/* Review 9: whether ANY Edit rule in a deny list covers path p, by Claude Code's rule shape (`//` is the root, `*`
   matches within one path segment, `**` any depth, and a rule covers what is under the path it names). A control
   that looks for one literal rule cannot see a glob that denies the same path; this one can. */
function editDeniedBy(deny, p) {
  const abs = path.resolve(p);
  return deny.filter((r) => {
    const m = /^Edit\((.*)\)$/.exec(r);
    if (!m) return false;
    const pat = m[1].replace(/^\/\//, '/');
    const re = '^' + pat.split(/(\*\*|\*)/).map((t) => (t === '**' ? '.*' : t === '*' ? '[^/]*' : t.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('') + '(/.*)?$';
    return new RegExp(re).test(abs);
  });
}
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
function ancestorsAbove(dir) { const out = []; for (let d = path.dirname(path.resolve(dir)); ; d = path.dirname(d)) { out.push(d); if (path.dirname(d) === d) break; } return out; }
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
  const CODE_FILES = ['scheduled_tasks.json', 'launch.json', 'CLAUDE.md', 'AGENTS.md', 'daemon.json', 'loop.md', 'remote-settings.json'];
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
  /* Review 9: asked of EVERY rule, not one literal string. The only rule allowed to cover the agent's own instruction
     files is the sibling glob (which cannot except the agent's own folder; the safe direction), so a rule naming them
     as an ancestor's, by either path, is a red here. */
  const sibGlob = (f) => `Edit(${ruleAbs(path.join(path.dirname(path.resolve(dir)), '*', f))})`;
  for (const own of [path.resolve(dir), ownReal]) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']) {
      const by = editDeniedBy(deny, path.join(own, f));
      assert.ok(by.every((r) => r === sibGlob(f)), 'the agent own ' + f + ' was denied by more than the sibling glob (' + own + '): ' + by.join(', '));
    }
  }
  /* Review 10: the sibling glob also covers the agent's own .claude instruction and code files, which its own rules deny
     anyway: pinned, so the safe direction is asserted rather than assumed. */
  for (const f of [path.join('.claude', 'CLAUDE.md'), path.join('.claude', 'AGENTS.md'), path.join('.claude', 'loop.md'), path.join('.claude', 'launch.json')]) {
    const by = editDeniedBy(deny, path.join(dir, f));
    assert.ok(by.includes(`Edit(${ruleAbs(path.join(dir, f))})`) && by.includes(sibGlob(f)) && by.length === 2, 'the agent own ' + f + ' is denied by ' + by.join(', '));
  }
  // CONTROL, that the matcher can say yes: the agent's own CLAUDE.md IS covered by the sibling glob.
  assert.deepStrictEqual(editDeniedBy(deny, path.join(dir, 'CLAUDE.md')), [sibGlob('CLAUDE.md')], 'CONTROL: the matcher did not see the sibling glob');
  for (const f of ancestors.slice(1).flatMap((d) => ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', path.join('.claude', 'settings.json'), path.join('.claude', 'settings.local.json')].map((x) => path.join(d, x)))) {
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

test('#5516 part 2 (reviews 16 and 17): a folder deep enough to pass the size ceiling through its ancestors still gets a whole guard, with the warning', () => {
  // Review 17: the depth that passes the ceiling depends on how deep the temp folder is and whether it is reached
  // through a link (each ancestor is then denied by both spellings), so levels are added until the warning fires, with
  // a bound, rather than a fixed count. The first level is the control: no warning there.
  const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
  let dir = path.join(SANDBOX, 'deep');
  let g = null;
  let levels = 0;
  for (; levels < 60; levels++) {
    dir = path.join(dir, 'd' + levels + '-xxxxxxx');
    fs.mkdirSync(dir, { recursive: true });
    g = quiet(() => setup.guardTokenOnlyFolder(dir, 'pilot-cfg-deep', DEPS));
    if (levels === 0) assert.equal(g.warning, undefined, 'CONTROL: one level below the sandbox already passed the ceiling: ' + g.warning);
    assert.equal(g.ok, true, 'a deep folder refused the guard at ' + (levels + 1) + ' levels: ' + JSON.stringify(g));
    if (g.warning) break;
  }
  assert.ok(typeof g.warning === 'string' && /past what Kosmos can say the sandbox will take/.test(g.warning), 'sixty levels down still passed the ceiling with no warning: ' + JSON.stringify(g));
  assert.ok(readSettings(dir).permissions.deny.includes(`Edit(${ruleAbs(path.join(path.dirname(dir), '.mcp.json'))})`), 'CONTROL: the ancestors were denied');
});

test('#5516 part 2 (review 17): the fix advice is given only where renaming is the fix', () => {
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-cfg-lookup'), 'pilot-cfg-lookup', { ...DEPS, workersRoot: 42 });
  assert.ok(g.ok === false && /the agents' folder \(it could not be worked out/.test(g.because), 'CONTROL: the failed lookup is named: ' + JSON.stringify(g));
  assert.ok(!/renaming that folder/.test(g.because), 'a failed lookup was told to rename a folder: ' + g.because);
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

test('#5516 part 2 (reviews 8 and 9): sibling agents are denied their members; memory only where no own folder matches', () => {
  const dir = agentDir('pilot-cfg-sib');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-sib', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  const sib = path.join(path.dirname(path.resolve(dir)), 'some-other-agent');
  // Each asked of every rule (review 9), a sibling that need not exist.
  for (const f of ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', path.join('.claude', 'settings.json'), path.join('.claude', 'CLAUDE.md'), path.join('.claude', 'AGENTS.md'), path.join('.claude', 'skills', 'x', 'SKILL.md')]) {
    assert.ok(editDeniedBy(deny, path.join(sib, f)).length, 'a sibling agent ' + f + ' is open to the file tools');
  }
  for (const h of [path.join(HOME, '.claude'), path.join(HOME, '.claude-acct'), path.join(HOME, '.claude-later')]) {
    for (const m of ['agent-memory', 'agent-memory-local']) assert.ok(editDeniedBy(deny, path.join(h, m, 'a', 'MEMORY.md')).length, h + '/' + m + ' is open');
  }
  for (const a of ancestorsAbove(dir)) assert.ok(editDeniedBy(deny, path.join(a, '.claude', 'agent-memory', 'a', 'MEMORY.md')).length, a + ' memory is open');
  // CONTROLS (review 9): the agent's own memory, plans and worktrees stay writable, by NO rule at all.
  for (const f of [path.join('agent-memory', 'a', 'MEMORY.md'), path.join('agent-memory-local', 'a', 'MEMORY.md'), path.join('plans', 'p.md'), path.join('worktrees', 'w', 'f.js')]) {
    for (const own of [path.resolve(dir), fs.realpathSync.native(dir)]) {
      const by = editDeniedBy(deny, path.join(own, '.claude', f));
      assert.deepStrictEqual(by, [], 'the agent own .claude/' + f + ' is denied by ' + by.join(', '));
    }
  }
});

test('#5516 part 2 (review 9): the agent own config home outside ~/.claude* is covered (as creation passes it)', () => {
  // The launch and board-start path reads it from the job, as accountSettingsFile does; that read is not exercised here.
  const own = path.join(SANDBOX, 'elsewhere', 'cfg-home');
  fs.mkdirSync(own, { recursive: true });
  const dir = agentDir('pilot-cfg-ownhome');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-ownhome', { ...DEPS, accountConfigDir: own });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  for (const f of ['settings.json', '.claude.json', 'CLAUDE.md', 'AGENTS.md', path.join('skills', 'x', 'SKILL.md'), path.join('agent-memory', 'a', 'MEMORY.md')]) {
    assert.ok(editDeniedBy(s.permissions.deny, path.join(own, f)).length, 'the agent own config home ' + f + ' is open');
  }
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(path.join(own, 'skills'))), 'its skills folder is open to the shell');
  // CONTROL: without it, nothing covers that home (so the asserts above can fail).
  const dir2 = agentDir('pilot-cfg-nohome');
  assert.equal(setup.guardTokenOnlyFolder(dir2, 'pilot-cfg-nohome', DEPS).ok, true);
  assert.deepStrictEqual(editDeniedBy(readSettings(dir2).permissions.deny, path.join(own, 'settings.json')), [], 'CONTROL: a home not the agent own was covered');
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

test('#5516 part 2 (review 11): a connected agent outside the agents\' folder is not denied its neighbours (they are not agents)', () => {
  const dir = path.join(SANDBOX, 'repos', 'myrepo');
  fs.mkdirSync(dir, { recursive: true });
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-repo', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  for (const f of ['CLAUDE.md', 'AGENTS.md', path.join('.claude', 'settings.json'), path.join('.claude', 'skills', 'x', 'SKILL.md')]) {
    const by = editDeniedBy(deny, path.join(SANDBOX, 'repos', 'other', f));
    assert.deepStrictEqual(by, [], 'a neighbouring repo ' + f + ' is denied by ' + by.join(', '));
  }
  // CONTROL: an agent in the agents' folder is denied its siblings' members (so the asserts above can fail).
  const inside = agentDir('pilot-cfg-in');
  assert.equal(setup.guardTokenOnlyFolder(inside, 'pilot-cfg-in', DEPS).ok, true);
  assert.ok(editDeniedBy(readSettings(inside).permissions.deny, path.join(SANDBOX, 'workers', 'other', 'CLAUDE.md')).length, 'CONTROL: a sibling agent CLAUDE.md is open');
});

test('#5516 part 2 (review 11): a board start that finds a config gap beside a PATH gap records it over an older ok line', () => {
  const name = 'pilot-cfg-both';
  const dir = agentDir(name);
  const home2 = path.join(SANDBOX, 'home-r11');
  const odd = path.join(SANDBOX, 'Drive (P)', 'skills');
  fs.mkdirSync(odd, { recursive: true });
  fs.mkdirSync(path.join(home2, '.claude'), { recursive: true });
  fs.symlinkSync(odd, path.join(home2, '.claude', 'skills'));
  const stateDir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  const seed = () => fs.writeFileSync(path.join(stateDir, name + '.json'), JSON.stringify({ ok: true, at: 't-launch' }));
  const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
  seed();
  const r = quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home2, panePath: 'relative/bin', boardStart: true }));
  assert.ok(/^the PATH this agent starts with/.test(r.because) && /could not be covered/.test(r.because), 'CONTROL: both reasons, the PATH one first: ' + r.because);
  assert.notEqual(setup.readGuardState()[name].at, 't-launch', 'the config gap was hidden behind the PATH reason (the older ok line kept)');
  // CONTROL: the PATH reason alone still leaves the launch's line (it is what the running agent has).
  seed();
  const r2 = quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, panePath: 'relative/bin', boardStart: true }));
  assert.ok(r2.ok === false && typeof r2.pathReason === 'string' && r2.otherReason === null, 'CONTROL: the PATH reason alone: ' + JSON.stringify(r2));
  assert.equal(setup.readGuardState()[name].at, 't-launch', 'a PATH-only board start replaced the launch line');
});

test('#5516 part 2 (review 11): a folder above the agent, reached through a link, that the rules cannot carry is named', () => {
  const real = path.join(SANDBOX, 'Real (X)');
  fs.mkdirSync(path.join(real, 'workers', 'pilot-cfg-lnanc'), { recursive: true });
  fs.symlinkSync(real, path.join(SANDBOX, 'lnkx'));
  const dir = path.join(SANDBOX, 'lnkx', 'workers', 'pilot-cfg-lnanc');
  const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
  const g = quiet(() => setup.guardTokenOnlyFolder(dir, 'pilot-cfg-lnanc', DEPS));
  assert.equal(g.ok, false, 'an uncarriable resolved ancestor read as a whole guard');
  assert.match(String(g.because), /Real \(X\) \(a folder above the agent whose path the permission rules cannot carry\)/, 'the ancestor is not named: ' + g.because);
  // The rest of the guard was still written (review 7's rule).
  assert.ok(readSettings(dir).permissions.deny.length > 20, 'the guard was not written');
});


test('#5516 part 2 (review 11): an own config home the rules cannot carry is named, and the rest of the guard is written', () => {
  const own = path.join(SANDBOX, 'Cfg (Beta)');
  fs.mkdirSync(own, { recursive: true });
  const dir = agentDir('pilot-cfg-oddhome');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-cfg-oddhome', { ...DEPS, accountConfigDir: own });
  assert.equal(g.ok, false, 'an uncarriable own home read as a whole guard');
  assert.match(String(g.because), /Cfg \(Beta\) \(the agent's own config home/, 'the own home is not named: ' + g.because);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')) && readSettings(dir).permissions.deny.length > 20, 'the rest of the guard was not written');
});

test('#5516 part 2 (review 13): a board start replaces only the non-PATH part of a launch line, and clears it once fixed', () => {
  const name = 'pilot-cfg-merge';
  const dir = agentDir(name);
  const home3 = path.join(SANDBOX, 'home-r13');
  const odd = path.join(SANDBOX, 'Box (P)', 'skills');
  fs.mkdirSync(odd, { recursive: true });
  fs.mkdirSync(path.join(home3, '.claude'), { recursive: true });
  const link = path.join(home3, '.claude', 'skills');
  fs.symlinkSync(odd, link);
  const stateDir = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, name + '.json');
  const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
  const launchPath = 'the PATH this agent starts with has an entry Kosmos could not cover (/launch-only/bin)';
  // 1. The launch found a PATH gap; a board start (with its own, different PATH gap) finds a config gap.
  fs.writeFileSync(file, JSON.stringify({ ok: false, because: launchPath + '; the rest of the guard is in place', pathReason: launchPath, at: 't-launch' }));
  quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home3, panePath: 'relative/bin', boardStart: true }));
  let line = setup.readGuardState()[name];
  assert.ok(line.ok === false && line.at !== 't-launch', 'the config gap was not recorded: ' + JSON.stringify(line));
  assert.ok(line.because.includes('/launch-only/bin'), 'the launch PATH gap was dropped: ' + line.because);
  assert.ok(!line.because.includes('relative/bin'), 'the board PATH was shown as the agent own: ' + line.because);
  assert.ok(/could not be covered \(.*Box \(P\)/.test(line.because), 'the config gap is not named: ' + line.because);
  assert.ok(/renaming that folder so its name has none of \( \) \[ \] \{ \} \* \? ! or \\/.test(line.because), 'the refusal does not say how to fix it (review 15): ' + line.because);
  // 2. The person fixes the link: the next board start clears the config part and keeps the launch's PATH part.
  fs.unlinkSync(link);
  quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home3, boardStart: true }));
  line = setup.readGuardState()[name];
  assert.ok(line.ok === false && line.because.includes('/launch-only/bin') && !/could not be covered \(/.test(line.because) && !line.otherReason, 'the fixed config gap stayed, or the PATH part went: ' + JSON.stringify(line));
  // 3. With no PATH part from the launch, a fixed gap reads ok again.
  fs.writeFileSync(file, JSON.stringify({ ok: false, because: 'x; the rest of the guard is in place', otherReason: 'x', at: 't-launch' }));
  quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home3, boardStart: true }));
  assert.equal(setup.readGuardState()[name].ok, true, 'a fixed config gap with no PATH part did not read ok');
  // 4. A launch's size warning is kept when the board start rewrites the line and has none of its own (review 15).
  fs.writeFileSync(file, JSON.stringify({ ok: false, because: launchPath + '; the rest of the guard is in place', pathReason: launchPath, warning: 'launch-size', at: 't-launch' }));
  fs.symlinkSync(odd, link);
  quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home3, boardStart: true }));
  line = setup.readGuardState()[name];
  assert.ok(line.at !== 't-launch' && line.warning === 'launch-size', 'the launch size warning was dropped: ' + JSON.stringify(line));
  fs.unlinkSync(link);
  // CONTROL: nothing changed in the non-PATH part, so the launch line is left as it is.
  fs.writeFileSync(file, JSON.stringify({ ok: false, because: launchPath + '; the rest of the guard is in place', pathReason: launchPath, at: 't-launch' }));
  quiet(() => setup.guardTokenOnlyFolder(dir, name, { ...DEPS, home: home3, panePath: 'relative/bin', boardStart: true }));
  assert.equal(setup.readGuardState()[name].at, 't-launch', 'a board start with only its own PATH gap rewrote the launch line');
});
