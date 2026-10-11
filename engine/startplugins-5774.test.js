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
const create = require('./create');
const jobfix = require('../test-support/jobfixture');   // review 1: the platform's own job file (a plist on macOS, a unit on Linux)

test('#5774 route 5: the plugin folders the three variables name are denied whole, parsed as Claude Code does, from the environment', () => {
  const abs = path.join(SANDBOX, 'pd-abs');
  const env = {
    CLAUDE_CODE_PLUGIN_DIRS: ` ~/pd-home : ${abs} : relative-skipped `,
    CLAUDE_CODE_PLUGIN_CACHE_DIR: 'cache-rel',
    CLAUDE_CODE_PLUGIN_SEED_DIR: `~/seed-a${path.delimiter}${path.delimiter}${path.join(SANDBOX, 'seed-b')}`,
  };
  const d = agentDir('pilot-plugenv');
  const g = setup.guardTokenOnlyFolder(d, 'pilot-plugenv', { ...DEPS, env });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(d);
  for (const t of [path.join(HOME, 'pd-home', 'p', 'hooks.json'), path.join(abs, 'p', 'x.js'), path.join(d, 'cache-rel', 'p', 'x'), path.join(HOME, 'seed-a', 'x'), path.join(SANDBOX, 'seed-b', 'x')]) {
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
    assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-plugother', { ...DEPS, env: ENV0 }).ok, true);
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
