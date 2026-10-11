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
  create.writePlistFile(create.plistPath(sib), create.plistFor(sib, '/usr/bin/true', '/usr/bin/true', null, other, 'claude'));
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
