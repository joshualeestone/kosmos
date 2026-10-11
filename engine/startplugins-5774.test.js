'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5774 route 5: the token-only guard covers other agents' config homes outside ~/.claude* (from their job files),
 * and the plugin folders three Claude Code variables name (environment and settings env), parsed as 2.1.296 does. The
 * tests assert the CONFIG WRITTEN, as the #4491, #5516 and parts 1 and 2 tests do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'startplugins-5774-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');   // job files go here, never the real LaunchAgents
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd');   // review 1: a Linux job is a systemd unit (jobfixture)
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
const HOME = process.env.AGENT_WORKFORCE_HOME;
const MANAGED = path.join(SANDBOX, 'managed');
// The launch-PATH part is pinned empty, as in configstart-5516.test.js, so this host's PATH is not read.
const LAUNCH_PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), managedDir: MANAGED, managedPrefsDir: null, ...LAUNCH_PIN };   // review 19: no real managed preferences read in tests

function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function writeJson(file, j) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2)); }
function touch(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '#!/bin/sh\n'); }
/* Whether ANY Edit rule in a deny list covers path p, by Claude Code's rule shape (copied from configstart-5516.test.js,
   review 9 there: a control that looks for one literal rule cannot see a glob that denies the same path). */
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
function realOrLeaf(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { /* absent: climb, as the production helper does (review 22) */ }
  let dir = path.dirname(abs); const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir); if (parent === dir) return abs;
    tail.unshift(path.basename(dir)); dir = parent;
  }
}
/* Whether the sandbox's denyWrite covers p (a listed path, or a folder above it). */
function sandboxDenies(dw, p) { const r = realOrLeaf(p); return dw.some((d) => r === d || r.startsWith(d + path.sep)); }

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude-acct'), { recursive: true });

const ENV0 = {};   // no ZDOTDIR, BASH_ENV or ENV unless a test sets one
// The Homebrew-style folders, pinned to the sandbox so this host's own are not read (review 3).
const USERDIRS = [path.join(SANDBOX, 'brew', 'share', 'zsh', 'site-functions'), path.join(SANDBOX, 'brew', 'share', 'fish', 'vendor_conf.d')];
DEPS.userShellDirs = USERDIRS;
DEPS.homebrewPrefixes = [];   // review 12: this host's own Homebrew is not read either (tests that need one pass theirs)
// Review 8: this sandbox lives inside the system temp folder, which the guard treats as a per-run place; the guard is
// given a temp folder of its own that does not hold the sandbox (one test passes another).
DEPS.tmpDir = path.join(SANDBOX, 'tmp-fixed');
fs.mkdirSync(DEPS.tmpDir, { recursive: true });
const create = require('./create');
const jobfix = require('../test-support/jobfixture');   // review 1: the platform's own job file (a plist on macOS, a unit on Linux)

test('#5774 route 5: the plugin folders the three variables name are denied whole, parsed as Claude Code does, from the environment', () => {
  const abs = path.join(SANDBOX, 'pd-abs');
  const env = {
    CLAUDE_CODE_PLUGIN_DIRS: ` ~/pd-home : ${abs} : relative-skipped `,
    CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(SANDBOX, 'cache-abs'),
    CLAUDE_CODE_PLUGIN_SEED_DIR: `~/seed-a${path.delimiter}${path.delimiter}${path.join(SANDBOX, 'seed-b')}`,
  };
  const d = agentDir('pilot-plugenv');
  const g = setup.guardTokenOnlyFolder(d, 'pilot-plugenv', { ...DEPS, env });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(d);
  for (const t of [path.join(HOME, 'pd-home', 'p', 'hooks.json'), path.join(abs, 'p', 'x.js'), path.join(SANDBOX, 'cache-abs', 'p', 'x'), path.join(HOME, 'seed-a', 'x'), path.join(SANDBOX, 'seed-b', 'x')]) {
    assert.ok(editDeniedBy(s.permissions.deny, t).length > 0, `${t}: file tools`);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, t), `${t}: sandbox`);
  }
  assert.ok(!editDeniedBy(s.permissions.deny, path.join(d, 'relative-skipped', 'x')).length, 'a relative CLAUDE_CODE_PLUGIN_DIRS part is skipped by Claude Code, so not denied');
});

test('#5774 route 5: every settings tier\'s value counts (two tiers that disagree are both denied); a folder too wide is named', () => {
  const a = path.join(HOME, '.claude', 'settings.json'), b = path.join(HOME, '.claude-acct', 'settings.json');
  writeJson(a, { env: { CLAUDE_CODE_PLUGIN_DIRS: path.join(SANDBOX, 'tier-a') } });
  writeJson(b, { env: { CLAUDE_CODE_PLUGIN_DIRS: path.join(SANDBOX, 'tier-b') } });
  try {
    const d = agentDir('pilot-plugtiers');
    assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-plugtiers', { ...DEPS, env: ENV0 }).ok, true);
    const deny = readSettings(d).permissions.deny;
    for (const t of ['tier-a', 'tier-b']) assert.ok(editDeniedBy(deny, path.join(SANDBOX, t, 'x')).length > 0, t);
  } finally { fs.rmSync(a, { force: true }); fs.rmSync(b, { force: true }); }
  const d2 = agentDir('pilot-plugwide');
  const g = setup.guardTokenOnlyFolder(d2, 'pilot-plugwide', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: HOME } });
  assert.equal(g.ok, false);
  assert.ok(JSON.stringify(g).includes('too wide'), JSON.stringify(g));
  assert.ok(!editDeniedBy(readSettings(d2).permissions.deny, path.join(d2, 'work.txt')).length, 'the agent\'s own folder was denied');
});

test('#5774 route 5: another agent\'s config home outside ~/.claude*, read from its job file, is covered like any config home', () => {
  const other = path.join(SANDBOX, 'cfg-elsewhere');
  fs.mkdirSync(other, { recursive: true });
  const sib = 'sib-r5';
  fs.mkdirSync(path.join(SANDBOX, 'workers', sib), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(sib), jobfix.jobFor(sib, '/usr/bin/true', '/usr/bin/true', null, other, 'claude'));
  assert.equal((create.readJob(sib) || {}).configDir, other, 'the job file round-trips its config home');
  const d = agentDir('pilot-jobhome');
  const g = setup.guardTokenOnlyFolder(d, 'pilot-jobhome', { ...DEPS, env: ENV0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(d);
  for (const t of [path.join(other, 'settings.json'), path.join(other, 'CLAUDE.md'), path.join(other, 'hooks', 'h.sh')]) {
    assert.ok(editDeniedBy(s.permissions.deny, t).length > 0, `${t}: file tools`);
  }
  assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(other, 'settings.json')), 'settings.json: sandbox');
  fs.rmSync(jobfix.jobPath(sib), { force: true });   // review 3: later tests do not inherit this home
});

test('#5774 route 5 review 1: the startup files, other accounts\' homes, the runner filter, links and too-wide folders', () => {
  const write = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  const zshenv = path.join(HOME, '.zshenv');
  // A shell export reaches the agent's Claude Code through the tmux server's environment.
  write(zshenv, 'export CLAUDE_CODE_PLUGIN_DIRS=$HOME/zplug\n');
  try {
    const d = agentDir('pilot-plugrc');
    assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-plugrc', { ...DEPS, env: ENV0 }).ok, true);
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, 'zplug', 'p', 'h.js')).length > 0, 'a startup-file export');
    write(zshenv, 'export CLAUDE_CODE_PLUGIN_DIRS=$PLUGROOT/x\n');
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-plugrc2'), 'pilot-plugrc2', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false);
    assert.ok(JSON.stringify(g).includes('a plugin folder Kosmos cannot work out'), JSON.stringify(g));
  } finally { fs.rmSync(zshenv, { force: true }); }
  // Another account's home: its relative cache resolves under ITS agent's folder (not known), so only absolute values count.
  const acct = path.join(HOME, '.claude-acct', 'settings.json');
  writeJson(acct, { env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: 'rel-other', CLAUDE_CODE_PLUGIN_SEED_DIR: path.join(SANDBOX, 'abs-other') } });
  try {
    const d = agentDir('pilot-plugother');
    // Review 6: the relative one is NAMED (not silently dropped), so the guard is not whole; the rest is written.
    const g = setup.guardTokenOnlyFolder(d, 'pilot-plugother', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false);
    assert.ok(JSON.stringify(g).includes('rel-other (a relative plugin folder another account'), JSON.stringify(g));
    const deny = readSettings(d).permissions.deny;
    assert.ok(!editDeniedBy(deny, path.join(d, 'rel-other', 'x')).length, 'another account\'s relative value read as this agent\'s');
    assert.ok(editDeniedBy(deny, path.join(SANDBOX, 'abs-other', 'x')).length > 0, 'another account\'s absolute value');
  } finally { fs.rmSync(acct, { force: true }); }
  // A codex agent's job carries CODEX_HOME, not a Claude config home; a job home the rules cannot carry is named.
  const codexHome = path.join(SANDBOX, 'codex-home');
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'sib-codex'), { recursive: true });
  fs.writeFileSync(jobfix.jobPath('sib-codex'), jobfix.jobFor('sib-codex', '/usr/bin/true', '/usr/bin/true', null, codexHome, 'codex'));
  const oddHome = path.join(SANDBOX, 'odd (home)');
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'sib-odd'), { recursive: true });
  fs.writeFileSync(jobfix.jobPath('sib-odd'), jobfix.jobFor('sib-odd', '/usr/bin/true', '/usr/bin/true', null, oddHome, 'claude'));
  try {
    const d = agentDir('pilot-jobfilter');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-jobfilter', { ...DEPS, env: ENV0 });
    assert.ok(JSON.stringify(g).includes('odd (home) (a config home an agent\'s job names'), JSON.stringify(g));
    assert.ok(!editDeniedBy(readSettings(d).permissions.deny, path.join(codexHome, 'settings.json')).length, 'a codex home taken as a Claude config home');
  } finally { fs.rmSync(jobfix.jobPath('sib-odd'), { force: true }); fs.rmSync(jobfix.jobPath('sib-codex'), { force: true }); }
  // A linked plugin folder: its target is denied in both layers.
  const realPlug = path.join(SANDBOX, 'real-plug');
  fs.mkdirSync(realPlug, { recursive: true });
  const linkPlug = path.join(SANDBOX, 'link-plug');
  fs.rmSync(linkPlug, { force: true }); fs.symlinkSync(realPlug, linkPlug);
  const d3 = agentDir('pilot-pluglink');
  assert.equal(setup.guardTokenOnlyFolder(d3, 'pilot-pluglink', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: linkPlug } }).ok, true);
  const s3 = readSettings(d3);
  const target = path.join(fs.realpathSync.native(realPlug), 'x.js');
  assert.ok(editDeniedBy(s3.permissions.deny, target).length > 0, 'the target, file tools');
  assert.ok(sandboxDenies(s3.sandbox.filesystem.denyWrite, target), 'the target, sandbox');
  // A folder holding the temp folder is too wide to deny (the shell writes there). The test's temp folder holds its home,
  // so a separate one is passed, held by a folder that holds neither the home nor the agent.
  const fakeTmp = path.join(SANDBOX, 'tmp-holder', 'T');
  fs.mkdirSync(fakeTmp, { recursive: true });
  const g4 = setup.guardTokenOnlyFolder(agentDir('pilot-plugtmp'), 'pilot-plugtmp', { ...DEPS, tmpDir: fakeTmp, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(SANDBOX, 'tmp-holder') } });
  assert.ok(JSON.stringify(g4).includes('tmp-holder (a plugin folder a Claude Code variable names, too wide'), JSON.stringify(g4));
  // An agents' folder that cannot be read is named, never a silent loss.
  const notDir = path.join(SANDBOX, 'not-a-dir');
  fs.writeFileSync(notDir, 'x');
  const g5 = setup.guardTokenOnlyFolder(agentDir('pilot-noworkers'), 'pilot-noworkers', { ...DEPS, env: ENV0, workersRoot: notDir });
  assert.ok(JSON.stringify(g5).includes('other agents\' config homes are not found'), JSON.stringify(g5));
});


test('#5774 route 5 review 2: "$HOME/a:$HOME/b" is read part by part; a runner inside a plugin folder a variable names is covered by its deny', () => {
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, `export CLAUDE_CODE_PLUGIN_DIRS="$HOME/pa${path.delimiter}$HOME/pb"\n`);
  try {
    const d = agentDir('pilot-twohomes');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-twohomes', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    for (const n of ['pa', 'pb']) assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, n, 'x')).length > 0, n);
  } finally { fs.rmSync(zshenv, { force: true }); }
  // A hook that runs a package program inside a plugin folder: named as a package runner unless that folder is denied whole.
  const plug = path.join(SANDBOX, 'dev-plug');
  const tool = path.join(plug, 'node_modules', '.bin', 'tool');
  touch(tool);
  const st = path.join(HOME, '.claude', 'settings.json');
  writeJson(st, { hooks: { Stop: [{ hooks: [{ type: 'command', command: tool }] }] } });
  try {
    const d = agentDir('pilot-plugrunner');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-plugrunner', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: plug } });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(plug, 'node_modules', 'x.js')).length > 0, 'the plugin folder');
  } finally { fs.rmSync(st, { force: true }); }
});

test('#5774 route 5 review 2: a plugin folder that is (or holds) a config home is too wide to deny: Claude Code writes there', () => {
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-plughome'), 'pilot-plughome', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(HOME, '.claude-acct') } });
  assert.equal(g.ok, false);
  assert.ok(JSON.stringify(g).includes('.claude-acct (a plugin folder a Claude Code variable names, too wide'), JSON.stringify(g));
});

test('#5774 route 5 review 3: the append idiom is read; a backtick is named; ~/.claude above the agent is that home\'s tier; the 50-home cap; the per-pass cache is used', () => {
  const zshrc = path.join(HOME, '.zshrc');
  const K = 'CLAUDE_CODE_PLUGIN_DIRS';
  for (const [body, want] of [[`export ${K}="$${K}${path.delimiter}$HOME/app1"\n`, 'app1'], [`export ${K}="\${${K}:+$${K}${path.delimiter}}$HOME/app2"\n`, 'app2']]) {
    fs.writeFileSync(zshrc, body);
    try {
      const d = agentDir(`pilot-append-${want}`);
      const g = setup.guardTokenOnlyFolder(d, path.basename(d), { ...DEPS, env: ENV0 });
      assert.equal(g.ok, true, `${body}: ${JSON.stringify(g)}`);
      assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, want, 'x')).length > 0, want);
    } finally { fs.rmSync(zshrc, { force: true }); }
  }
  fs.writeFileSync(zshrc, `export ${K}=\`echo /opt/p\`\n`);
  try {
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-backtick'), 'pilot-backtick', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false);
    assert.ok(JSON.stringify(g).includes('a plugin folder Kosmos cannot work out'), JSON.stringify(g));
  } finally { fs.rmSync(zshrc, { force: true }); }
  // An agents' folder INSIDE the home, so ~/.claude/settings.json is also read as a folder-above tier: for an agent on
  // another account it is that home's tier, so its relative cache folder is not read as this agent's.
  const workersIn = path.join(HOME, 'workers-r5');
  const d = path.join(workersIn, 'pilot-onacct');
  fs.mkdirSync(d, { recursive: true });
  const homeSt = path.join(HOME, '.claude', 'settings.json');
  writeJson(homeSt, { env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: 'relcache' } });
  try {
    const gA = setup.guardTokenOnlyFolder(d, 'pilot-onacct', { ...DEPS, env: ENV0, workersRoot: workersIn, accountConfigDir: path.join(HOME, '.claude-acct') });
    assert.ok(!editDeniedBy(readSettings(d).permissions.deny, path.join(d, 'relcache', 'x')).length, 'the default home\'s relative cache read as this agent\'s');
    // Review 7: the positive arm: it was READ, as another account's (named), not missed.
    assert.ok(JSON.stringify(gA).includes('relcache (a relative plugin folder another account'), JSON.stringify(gA));
  } finally { fs.rmSync(homeSt, { force: true }); }
  // More than 50 config homes outside ~/.claude* from jobs: the rest are named.
  const many = Array.from({ length: 51 }, (_, i) => path.join(SANDBOX, 'many-homes', `h${i}`));
  const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-manyhomes'), 'pilot-manyhomes', { ...DEPS, env: ENV0, agentConfigDirs: many });
  assert.ok(JSON.stringify(g2).includes('more than 50 outside'), JSON.stringify(g2));
  // The pass's cache is used: a home seeded there is covered without any job file naming it.
  const seeded = path.join(SANDBOX, 'seeded-home');
  const cache = new Map([[`#5774 route 5 job homes ${path.resolve(DEPS.workersRoot)}\0${DEPS.platform}`, [seeded]]]);   // review 13: keyed by platform too
  const d3 = agentDir('pilot-cache');
  setup.guardTokenOnlyFolder(d3, 'pilot-cache', { ...DEPS, env: ENV0, launchCache: cache });
  assert.ok(editDeniedBy(readSettings(d3).permissions.deny, path.join(seeded, 'settings.json')).length > 0, 'the cached job homes were not used');
});


test('#5774 route 5 review 4: a quoted ~ is read; the startup files are read once per pass; the folder cap; the own home by either spelling; linked agent folders; a job home that is the home', () => {
  const zshrc = path.join(HOME, '.zshrc');
  fs.writeFileSync(zshrc, 'export CLAUDE_CODE_PLUGIN_DIRS="~/qplug"\n');
  try {
    const d = agentDir('pilot-qtilde');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-qtilde', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, 'qplug', 'x')).length > 0, 'a quoted ~');
  } finally { fs.rmSync(zshrc, { force: true }); }
  // The pass's cache of the startup files' values is used: two agents in one pass, the file changed between them, and
  // the second still sees the first read (review 8: the key is the files themselves, so it is not seeded by hand).
  const cache = new Map();
  fs.writeFileSync(zshrc, `export CLAUDE_CODE_PLUGIN_DIRS=${path.join(SANDBOX, 'first-read')}\n`);
  try {
    setup.guardTokenOnlyFolder(agentDir('pilot-filecache0'), 'pilot-filecache0', { ...DEPS, env: ENV0, launchCache: cache });
    fs.writeFileSync(zshrc, `export CLAUDE_CODE_PLUGIN_DIRS=${path.join(SANDBOX, 'second-read')}\n`);
    const d1 = agentDir('pilot-filecache');
    setup.guardTokenOnlyFolder(d1, 'pilot-filecache', { ...DEPS, env: ENV0, launchCache: cache });
    assert.ok(editDeniedBy(readSettings(d1).permissions.deny, path.join(SANDBOX, 'first-read', 'x')).length > 0, 'the cached startup-file values were not used');
  } finally { fs.rmSync(zshrc, { force: true }); }
  // More than 50 plugin folders: the rest are named.
  const many = Array.from({ length: 51 }, (_, i) => path.join(SANDBOX, 'many-plugs', `p${i}`)).join(path.delimiter);
  const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-manyplugs'), 'pilot-manyplugs', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: many } });
  assert.ok(JSON.stringify(g2).includes('(more than 50)'), JSON.stringify(g2));
  // The agent's own home passed by its other spelling (/private/var against /var) is still its own: its relative cache counts.
  const acctReal = fs.realpathSync.native(path.join(HOME, '.claude-acct'));
  const st = path.join(HOME, '.claude-acct', 'settings.json');
  writeJson(st, { env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: 'ownrel' } });
  try {
    const d = agentDir('pilot-ownspelling');
    setup.guardTokenOnlyFolder(d, 'pilot-ownspelling', { ...DEPS, env: ENV0, accountConfigDir: acctReal });
    // Read as this agent's own (a relative cache resolves inside its folder, which review 7 names rather than denies whole).
    const g = setup.guardTokenOnlyFolder(d, 'pilot-ownspelling', { ...DEPS, env: ENV0, accountConfigDir: acctReal });
    assert.ok(JSON.stringify(g).includes(path.join(d, 'ownrel') + ' (a plugin folder a Claude Code variable names, inside the agent'), JSON.stringify(g));
  } finally { fs.rmSync(st, { force: true }); }
  // The same at the scan itself, where the guard's own home list cannot hide it: homes in one spelling, ownHome in the other.
  writeJson(st, { env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: 'ownrel2' } });
  try {
    const d = agentDir('pilot-ownspelling2');
    const r = require('./startcommands').startCommandScripts(d, { homes: [path.join(HOME, '.claude-acct')], home: HOME, ownHome: acctReal, platform: 'darwin', managedDir: MANAGED });
    assert.ok(r.envPluginDirs.includes(path.join(d, 'ownrel2')), `the own home's relative cache: ${JSON.stringify(r.envPluginDirs)}`);
  } finally { fs.rmSync(st, { force: true }); }
  // A linked agent folder in the agents' folder: its job's home is found; a job home that is the home itself is named.
  const realAgent = path.join(SANDBOX, 'real-agent-r4');
  fs.mkdirSync(realAgent, { recursive: true });
  const linked = path.join(SANDBOX, 'workers', 'linked-r4');
  fs.rmSync(linked, { force: true }); fs.symlinkSync(realAgent, linked);
  const linkedHome = path.join(SANDBOX, 'linked-home-r4');
  fs.writeFileSync(jobfix.jobPath('linked-r4'), jobfix.jobFor('linked-r4', '/usr/bin/true', '/usr/bin/true', null, linkedHome, 'claude'));
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'homejob-r4'), { recursive: true });
  fs.writeFileSync(jobfix.jobPath('homejob-r4'), jobfix.jobFor('homejob-r4', '/usr/bin/true', '/usr/bin/true', null, HOME, 'claude'));
  try {
    const d = agentDir('pilot-linkedagent');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-linkedagent', { ...DEPS, env: ENV0 });
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(linkedHome, 'settings.json')).length > 0, 'a linked agent folder\'s job home');
    assert.ok(JSON.stringify(g).includes('which is the root or the home folder itself'), JSON.stringify(g));
  } finally { for (const n of ['linked-r4', 'homejob-r4']) fs.rmSync(jobfix.jobPath(n), { force: true }); fs.rmSync(linked, { force: true }); }
});

test('#5774 route 5 review 5: Kosmos\'s data is too wide as production runs (no deps.dataRoot); the prepend idiom; covered folders spend no budget; a job home holding the agent', () => {
  const noData = { ...DEPS };
  delete noData.dataRoot;   // as production calls it
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-datawide'), 'pilot-datawide', { ...noData, env: { CLAUDE_CODE_PLUGIN_DIRS: store.ROOT } });
  assert.ok(JSON.stringify(g).includes('too wide'), JSON.stringify(g));
  const zshrc = path.join(HOME, '.zshrc');
  const K = 'CLAUDE_CODE_PLUGIN_DIRS';
  fs.writeFileSync(zshrc, `export ${K}="$HOME/pre\${${K}:+${path.delimiter}$${K}}"\n`);
  try {
    const d = agentDir('pilot-prepend');
    const g2 = setup.guardTokenOnlyFolder(d, 'pilot-prepend', { ...DEPS, env: ENV0 });
    assert.equal(g2.ok, true, JSON.stringify(g2));
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, 'pre', 'x')).length > 0, 'the prepend idiom');
  } finally { fs.rmSync(zshrc, { force: true }); }
  // 51 folders all inside a folder already denied whole (a config home's plugins): no cap.
  const inside = Array.from({ length: 51 }, (_, i) => path.join(HOME, '.claude', 'plugins', `c${i}`)).join(path.delimiter);
  const g3 = setup.guardTokenOnlyFolder(agentDir('pilot-coveredplugs'), 'pilot-coveredplugs', { ...DEPS, env: { [K]: inside } });
  assert.ok(!JSON.stringify(g3).includes('(more than 50)'), JSON.stringify(g3));
  assert.ok(editDeniedBy(readSettings(agentDir('pilot-coveredplugs')).permissions.deny, path.join(HOME, '.claude', 'plugins', 'c0', 'x')).length > 0, 'the folders were seen (and covered)');
  // A job home that holds this agent's folder only elsewhere (the agents' folder itself) is covered as any home; review 8
  // narrowed the refusal to one whose code folders would cover the agent (tested in review 8's test).
  const d4 = agentDir('pilot-holdsme');
  const g4 = setup.guardTokenOnlyFolder(d4, 'pilot-holdsme', { ...DEPS, env: ENV0, agentConfigDirs: [path.join(SANDBOX, 'workers')] });
  assert.ok(!JSON.stringify(g4).includes('would cover this agent'), JSON.stringify(g4));
});

test('#5774 route 5 review 7: the plugins inside the folders the variables name are read (a dev plugin\'s hook, a cache\'s installed plugin); a folder inside the agent\'s own is named; an own home listed first is not re-judged', () => {
  // A dev plugin root in CLAUDE_CODE_PLUGIN_DIRS whose hook runs a script outside the plugin folder.
  const dev = path.join(SANDBOX, 'devplug-r7');
  const outside = path.join(SANDBOX, 'tools-r7', 'start.sh');
  touch(outside);
  writeJson(path.join(dev, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `bash ${outside}` }] }] } });
  // A plugin cache holding an installed plugin, whose own hook runs another outside script.
  const cache = path.join(SANDBOX, 'cache-r7');
  const inst = path.join(SANDBOX, 'inst-r7');
  const outside2 = path.join(SANDBOX, 'tools-r7', 'other.sh');
  touch(outside2);
  writeJson(path.join(cache, 'installed_plugins.json'), { plugins: { 'p@m': [{ installPath: inst }] } });
  writeJson(path.join(inst, 'hooks', 'hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${outside2}` }] }] } });
  const d = agentDir('pilot-devplug');
  const g = setup.guardTokenOnlyFolder(d, 'pilot-devplug', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: dev, CLAUDE_CODE_PLUGIN_CACHE_DIR: cache } });
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(d).permissions.deny;
  assert.ok(editDeniedBy(deny, outside).length > 0, 'a dev plugin\'s hook script outside its folder');
  assert.ok(editDeniedBy(deny, outside2).length > 0, 'a cached plugin\'s hook script');
  assert.ok(editDeniedBy(deny, path.join(inst, 'x.js')).length > 0, 'the cached plugin\'s own folder');
  // A plugin folder inside the agent's own folder is named, not denied whole.
  const d2 = agentDir('pilot-ownplug');
  const g2 = setup.guardTokenOnlyFolder(d2, 'pilot-ownplug', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: path.join(d2, 'myplugin') } });
  assert.ok(JSON.stringify(g2).includes('inside the agent\'s own folder, so Kosmos does not deny it whole'), JSON.stringify(g2));
  assert.ok(!editDeniedBy(readSettings(d2).permissions.deny, path.join(d2, 'myplugin', 'x.js')).length, 'the agent\'s own plugin folder was denied');
  // The agent's own home (which holds its folder) comes back through its own job: skipped as listed, not named.
  const outer = path.join(SANDBOX, 'outer-r7');
  const d3 = path.join(outer, 'agent');
  fs.mkdirSync(d3, { recursive: true });
  // Review 9: placed so the refusal WOULD fire (the agent under its own home's skills/ member): only the early "already
  // listed" skip keeps it from being named, so this can fail.
  const d3b = path.join(outer, 'skills', 'agent');
  fs.mkdirSync(d3b, { recursive: true });
  const g3 = setup.guardTokenOnlyFolder(d3b, 'pilot-outer', { ...DEPS, env: ENV0, accountConfigDir: outer, agentConfigDirs: [outer] });
  assert.ok(!JSON.stringify(g3).includes('would cover this agent'), JSON.stringify(g3));
});

test('#5774 route 5 review 8: a plugin folder inside the temp folder is named (a per-run place); a job home is refused only when its code folders would cover this agent\'s folder', () => {
  const tmpPlug = path.join(DEPS.tmpDir, 'run-123', 'plug');
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-tmpplug'), 'pilot-tmpplug', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_DIRS: tmpPlug } });
  assert.ok(JSON.stringify(g).includes('inside the temp folder: a per-run place'), JSON.stringify(g));
  // A home that merely contains the agents' folder elsewhere is covered; one whose skills/ folder is the agent's is named.
  const holder = path.join(SANDBOX, 'holder-r8');
  const d1 = path.join(holder, 'work', 'agent');
  fs.mkdirSync(d1, { recursive: true });
  const g1 = setup.guardTokenOnlyFolder(d1, 'pilot-holder', { ...DEPS, env: ENV0, agentConfigDirs: [holder] });
  assert.ok(!JSON.stringify(g1).includes('would cover this agent'), JSON.stringify(g1));
  assert.ok(editDeniedBy(readSettings(d1).permissions.deny, path.join(holder, 'settings.json')).length > 0, 'the holding home is covered');
  const holder2 = path.join(SANDBOX, 'holder2-r8');
  const d2 = path.join(holder2, 'skills', 'agent');
  fs.mkdirSync(d2, { recursive: true });
  const g2 = setup.guardTokenOnlyFolder(d2, 'pilot-holder2', { ...DEPS, env: ENV0, agentConfigDirs: [holder2] });
  assert.ok(JSON.stringify(g2).includes('whose code folders would cover this agent'), JSON.stringify(g2));
});

test('#5774 route 5 review 9: a plugin installed inside a cache folder is covered by it (no versioned rule); a ~user value in a startup file is named', () => {
  const cache = path.join(SANDBOX, 'pcache-r9');
  const inst = path.join(cache, 'cache', 'mkt', 'p', '1.2.3');
  fs.mkdirSync(inst, { recursive: true });
  writeJson(path.join(cache, 'installed_plugins.json'), { plugins: { 'p@mkt': [{ installPath: inst }] } });
  const d = agentDir('pilot-cacheinside');
  assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-cacheinside', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache } }).ok, true);
  const s = readSettings(d);
  assert.ok(![...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].some((r) => r.includes(path.join('mkt', 'p', '1.2.3'))), 'a versioned plugin path was listed');
  assert.ok(editDeniedBy(s.permissions.deny, path.join(inst, 'x.js')).length > 0, 'the plugin, through its cache folder');
  const zshrc = path.join(HOME, '.zshrc');
  fs.writeFileSync(zshrc, 'export CLAUDE_CODE_PLUGIN_DIRS=~bob/p\n');
  try {
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-tildeuser'), 'pilot-tildeuser', { ...DEPS, env: ENV0 });
    assert.ok(JSON.stringify(g).includes('a plugin folder Kosmos cannot work out'), JSON.stringify(g));
  } finally { fs.rmSync(zshrc, { force: true }); }
});


test('#5774 route 5 review 10: a job file that exists but cannot be read is named; a relative config home in a job is named', () => {
  const sib = 'sib-badjob';
  fs.mkdirSync(path.join(SANDBOX, 'workers', sib), { recursive: true });
  const jp = jobfix.jobPath(sib);
  fs.rmSync(jp, { recursive: true, force: true });
  fs.mkdirSync(jp, { recursive: true });   // a folder where the job file should be: it cannot be read as a job
  try {
    // Linux and Windows readers say why; on macOS the guard sees the file is there yet reads as no job. Named either way.
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-badjob'), 'pilot-badjob', { ...DEPS, env: ENV0 });
    assert.ok(JSON.stringify(g).includes(`the job of the agent ${sib}`), JSON.stringify(g));
  } finally { fs.rmSync(jp, { recursive: true, force: true }); }
  const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-relhome'), 'pilot-relhome', { ...DEPS, env: ENV0, agentConfigDirs: ['rel/home'] });
  assert.ok(JSON.stringify(g2).includes('rel/home (a config home an agent\'s job names, not a full path'), JSON.stringify(g2));
});

test('#5774 route 5 review 11: the default-if-unset idioms ${K:-x} and ${K:=x} read as x', () => {
  const zshrc = path.join(HOME, '.zshrc');
  const K = 'CLAUDE_CODE_PLUGIN_CACHE_DIR';
  for (const [form, n] of [[`\${${K}:-$HOME/dflt1}`, 'dflt1'], [`\${${K}:=$HOME/dflt2}`, 'dflt2']]) {
    fs.writeFileSync(zshrc, `export ${K}=${form}\n`);
    try {
      const d = agentDir(`pilot-${n}`);
      const g = setup.guardTokenOnlyFolder(d, path.basename(d), { ...DEPS, env: ENV0 });
      assert.equal(g.ok, true, `${form}: ${JSON.stringify(g)}`);
      assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, n, 'x')).length > 0, form);
    } finally { fs.rmSync(zshrc, { force: true }); }
  }
});

test('#5774 route 5 review 11: on Linux a MASKED agent unit is no job (not a failure); an unreadable unit is named', () => {
  const lj = require('./linuxjob');
  const masked = 'sib-masked';
  const broken = 'sib-brokenunit';
  for (const n of [masked, broken]) fs.mkdirSync(path.join(SANDBOX, 'workers', n), { recursive: true });
  const mp = lj.unitPath(masked), bp = lj.unitPath(broken);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.rmSync(mp, { recursive: true, force: true }); fs.symlinkSync('/dev/null', mp);
  fs.rmSync(bp, { recursive: true, force: true }); fs.mkdirSync(bp);   // a folder where the unit file should be
  try {
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-linuxjobs'), 'pilot-linuxjobs', { ...DEPS, platform: 'linux', env: ENV0 });
    const said = JSON.stringify(g);
    assert.ok(!said.includes(`the job of the agent ${masked}`), `a masked unit was named: ${said}`);
    assert.ok(said.includes(`the job of the agent ${broken}`), `an unreadable unit was not named: ${said}`);
  } finally { fs.rmSync(mp, { force: true }); fs.rmSync(bp, { recursive: true, force: true }); }
});


test('#5774 route 5 review 13: a config home that is a link to something absent has its target covered; an indented export is named; a per-run cache lists no versioned plugin', () => {
  // A base under the REAL sandbox path: the temp folder is itself a link on macOS, so every path there reads as linked.
  const base = path.join(fs.realpathSync.native(SANDBOX), 'r13');
  fs.mkdirSync(base, { recursive: true });
  const target = path.join(base, 'nowhere', 'x');   // absent, and so is its parent
  const dangle = path.join(base, 'dangle-home');
  fs.symlinkSync(target, dangle);
  const d = agentDir('pilot-danglehome');
  setup.guardTokenOnlyFolder(d, 'pilot-danglehome', { ...DEPS, env: ENV0, agentConfigDirs: [dangle] });
  const s = readSettings(d);
  for (const t of [path.join(target, 'settings.json'), path.join(target, 'hooks', 'h.sh')]) {
    assert.ok(editDeniedBy(s.permissions.deny, t).length > 0, `${t}: file tools, by the place the link points to`);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, t), `${t}: sandbox`);
  }
  // The link's own spelling stays denied (the dangerous case of listing the target INSTEAD of the link).
  assert.ok(editDeniedBy(s.permissions.deny, path.join(dangle, 'settings.json')).length > 0, 'the link itself, file tools');
  // Control: a live linked home adds no second spelling of its target (its members resolve through it).
  const liveT = path.join(base, 'live-target');
  fs.mkdirSync(liveT, { recursive: true });
  const live = path.join(base, 'live-home');
  fs.symlinkSync(liveT, live);
  const d2 = agentDir('pilot-livehome');
  setup.guardTokenOnlyFolder(d2, 'pilot-livehome', { ...DEPS, env: ENV0, agentConfigDirs: [live] });
  assert.ok(sandboxDenies(readSettings(d2).sandbox.filesystem.denyWrite, path.join(liveT, 'settings.json')), 'a live link: covered through it');

  // An indented export (an if-block) is named, not missed; an indented COMMENT naming it is not.
  const zshrc = path.join(HOME, '.zshrc');
  fs.writeFileSync(zshrc, 'if [ -d ~/devplug ]; then\n  export CLAUDE_CODE_PLUGIN_DIRS=/opt/devplug-indented\nfi\n');
  try {
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-indented'), 'pilot-indented', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.ok(JSON.stringify(g).includes('CLAUDE_CODE_PLUGIN_DIRS (set on an indented line'), JSON.stringify(g));
    fs.writeFileSync(zshrc, 'if true; then\n  # CLAUDE_CODE_PLUGIN_DIRS=/opt/old was here\nfi\n');
    const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-indentcomment'), 'pilot-indentcomment', { ...DEPS, env: ENV0 });
    assert.ok(!JSON.stringify(g2).includes('set on an indented line'), JSON.stringify(g2));
  } finally { fs.rmSync(zshrc, { force: true }); }

  // A cache inside the temp folder is refused, and the plugin installed in it is not listed by its version.
  const cache = path.join(DEPS.tmpDir, 'run-r13', 'cache');
  const inst = path.join(cache, 'cache', 'mkt', 'p', '9.9.9');
  fs.mkdirSync(inst, { recursive: true });
  writeJson(path.join(cache, 'installed_plugins.json'), { plugins: { 'p@mkt': [{ installPath: inst }] } });
  const d3 = agentDir('pilot-tmpcache');
  const g3 = setup.guardTokenOnlyFolder(d3, 'pilot-tmpcache', { ...DEPS, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache } });
  assert.equal(g3.ok, false, JSON.stringify(g3));
  assert.ok(JSON.stringify(g3).includes('inside the temp folder: a per-run place'), JSON.stringify(g3));
  const s3 = readSettings(d3);
  assert.ok(![...s3.permissions.deny, ...s3.sandbox.filesystem.denyWrite].some((r) => r.includes('9.9.9')), 'a versioned plugin path was listed');
});

test('#5774 route 5 review 14: a startup file that is there but cannot be read, or is past the size limit, is named', () => {
  const zshrc = path.join(HOME, '.zshrc');
  try {
    fs.writeFileSync(zshrc, 'export CLAUDE_CODE_PLUGIN_DIRS=/opt/hidden-plug\n');
    fs.chmodSync(zshrc, 0o000);
    const g = setup.guardTokenOnlyFolder(agentDir('pilot-unreadrc'), 'pilot-unreadrc', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.ok(JSON.stringify(g).includes('a shell startup file that could not be read'), JSON.stringify(g));
    fs.chmodSync(zshrc, 0o644);
    fs.writeFileSync(zshrc, '#'.repeat(4194305));
    const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-bigrc'), 'pilot-bigrc', { ...DEPS, env: ENV0 });
    assert.ok(JSON.stringify(g2).includes('a shell startup file larger than Kosmos reads'), JSON.stringify(g2));
    // Control: a readable one within the limit is read, and not named.
    fs.writeFileSync(zshrc, 'export FOO=1\n');
    const g3 = setup.guardTokenOnlyFolder(agentDir('pilot-okrc'), 'pilot-okrc', { ...DEPS, env: ENV0 });
    assert.ok(!JSON.stringify(g3).includes('a shell startup file'), JSON.stringify(g3));
  } finally { try { fs.chmodSync(zshrc, 0o644); } catch { /* gone */ } fs.rmSync(zshrc, { force: true }); }
});
