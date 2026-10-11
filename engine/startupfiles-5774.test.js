'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5774 part 2: the token-only guard denies the home folder's shell startup files, in both layers, links followed
 * (zsh, bash, fish, $ZDOTDIR, the file $BASH_ENV or $ENV names). Shells started outside the sandbox read them. The
 * tests assert the CONFIG WRITTEN, as the #4491, #5516 and part 1 tests do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'startupfiles-5774-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
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
  const abs = path.resolve(p); let dir = path.dirname(abs); const tail = [path.basename(abs)];
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

test('#5774 part 2: each shell startup file in the home folder is denied in both layers', () => {
  const dir = agentDir('pilot-rc');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-rc', { ...DEPS, env: ENV0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  for (const f of setup.SHELL_START_FILES) {
    const p = path.join(HOME, f);
    assert.ok(editDeniedBy(s.permissions.deny, p).length > 0, `${f}: the file tools can rewrite it`);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, p), `${f}: not in the sandbox denyWrite`);
  }
  const fish = path.join(HOME, '.config', 'fish');
  assert.ok(editDeniedBy(s.permissions.deny, path.join(fish, 'config.fish')).length > 0, 'fish config.fish');
  assert.ok(editDeniedBy(s.permissions.deny, path.join(fish, 'conf.d', 'later.fish')).length > 0, "a file fish reads from conf.d, even one not there yet");
  for (const f of ['config.nu', 'env.nu']) assert.ok(editDeniedBy(s.permissions.deny, path.join(HOME, '.config', 'nushell', f)).length > 0, `nushell ${f}`);
  // CONTROL: an ordinary file in the home folder, and one in the agent's own folder, stay writable.
  for (const p of [path.join(HOME, 'notes.txt'), path.join(HOME, '.zshrc.bak'), path.join(dir, '.zshrc')]) {
    assert.deepEqual(editDeniedBy(s.permissions.deny, p), [], `${p} was denied`);
  }
});

test('#5774 part 2: a linked dotfile has its target denied too (a dotfiles repo is what gets written)', () => {
  const dir = agentDir('pilot-rclink');
  const real = path.join(SANDBOX, 'dotfiles', 'zshrc');
  touch(real);
  const link = path.join(HOME, '.zshrc');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(real, link);
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-rclink', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    const target = fs.realpathSync.native(real);
    assert.ok(editDeniedBy(s.permissions.deny, target).length > 0, 'the file tools can rewrite the linked target');
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, target), 'the shell can rewrite the linked target');
    // CONTROL: the next file in the same repo, which nothing links, is not denied.
    assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(SANDBOX, 'dotfiles', 'README')), []);
  } finally { fs.rmSync(link, { force: true }); }
});

test('#5774 part 2: $ZDOTDIR, $BASH_ENV and $ENV are read from the environment the agent runs with', () => {
  const dir = agentDir('pilot-rcenv');
  const zd = path.join(SANDBOX, 'zdot');
  const benv = path.join(SANDBOX, 'benv.sh');
  const shenv = path.join(SANDBOX, 'shenv.sh');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-rcenv', { ...DEPS, env: { ZDOTDIR: zd, BASH_ENV: benv, ENV: shenv } });
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  for (const p of [path.join(zd, '.zshenv'), path.join(zd, '.zshrc'), benv, shenv]) assert.ok(editDeniedBy(deny, p).length > 0, `${p} not denied`);
  // CONTROL: without them in the environment, those paths are not denied.
  const dir2 = agentDir('pilot-rcenv0');
  setup.guardTokenOnlyFolder(dir2, 'pilot-rcenv0', { ...DEPS, env: ENV0 });
  const deny2 = readSettings(dir2).permissions.deny;
  for (const p of [path.join(zd, '.zshenv'), benv, shenv]) assert.deepEqual(editDeniedBy(deny2, p), [], `${p} denied with nothing naming it`);
  // A relative value is read from whatever folder the shell runs in (the agent can choose it): named, so not whole.
  const dir3 = agentDir('pilot-rcrel');
  const g3 = setup.guardTokenOnlyFolder(dir3, 'pilot-rcrel', { ...DEPS, env: { BASH_ENV: 'rel.sh' } });
  assert.equal(g3.ok, false, JSON.stringify(g3));
  assert.match(String(g3.because), /BASH_ENV/);
});
