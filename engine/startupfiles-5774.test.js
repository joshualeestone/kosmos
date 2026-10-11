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
// The Homebrew-style folders, pinned to the sandbox so this host's own are not read (review 3).
const USERDIRS = [path.join(SANDBOX, 'brew', 'share', 'zsh', 'site-functions'), path.join(SANDBOX, 'brew', 'share', 'fish', 'vendor_conf.d')];
DEPS.userShellDirs = USERDIRS;

test('#5774 part 2: each shell startup file in the home folder is denied in both layers', () => {
  const dir = agentDir('pilot-rc');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-rc', { ...DEPS, env: ENV0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  // Named here, not only through the exported list (a list the test reads cannot catch a name dropped from it).
  for (const f of ['.zshenv', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.bash_aliases', '.cshrc', '.tcshrc']) assert.ok(setup.SHELL_START_FILES.includes(f), f);
  for (const f of setup.SHELL_START_FILES) {
    const p = path.join(HOME, f);
    assert.ok(editDeniedBy(s.permissions.deny, p).length > 0, `${f}: the file tools can rewrite it`);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, p), `${f}: not in the sandbox denyWrite`);
  }
  // Review 1: fish's whole folder (it autoloads functions and keeps universal variables, PATH among them, there).
  const fish = path.join(HOME, '.config', 'fish');
  for (const f of ['config.fish', 'conf.d/later.fish', 'functions/fish_prompt.fish', 'fish_variables']) {
    assert.ok(editDeniedBy(s.permissions.deny, path.join(fish, f)).length > 0, `fish ${f}`);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(fish, f)), `fish ${f}: not in the sandbox denyWrite`);
  }
  // nushell's XDG folder and its macOS default.
  for (const d of [path.join(HOME, '.config', 'nushell'), path.join(HOME, 'Library', 'Application Support', 'nushell')]) {
    for (const f of ['config.nu', 'env.nu', 'login.nu', 'autoload/x.nu']) assert.ok(editDeniedBy(s.permissions.deny, path.join(d, f)).length > 0, `nushell ${d}/${f}`);
  }
  // Review 1: zsh runs a newer compiled copy in place of a startup file, and compinit loads its dump.
  for (const f of ['.zshenv.zwc', '.zshrc.zwc', '.zcompdump', '.zcompdump-host-5.9', '.zcompdump.zwc']) {
    assert.ok(editDeniedBy(s.permissions.deny, path.join(HOME, f)).length > 0, `${f}`);
  }
  // The conventional XDG folder for zsh's files, set in a file Kosmos may not read.
  assert.ok(editDeniedBy(s.permissions.deny, path.join(HOME, '.config', 'zsh', '.zshrc')).length > 0, '~/.config/zsh/.zshrc');
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
  const dw = readSettings(dir).sandbox.filesystem.denyWrite;
  for (const p of [path.join(zd, '.zshenv'), path.join(zd, '.zshrc'), path.join(zd, '.zshrc.zwc'), benv, shenv]) {
    assert.ok(editDeniedBy(deny, p).length > 0, `${p} not denied to the file tools`);
    assert.ok(sandboxDenies(dw, p), `${p} not in the sandbox denyWrite`);
  }
  // CONTROL: without them in the environment, those paths are not denied.
  const dir2 = agentDir('pilot-rcenv0');
  setup.guardTokenOnlyFolder(dir2, 'pilot-rcenv0', { ...DEPS, env: ENV0 });
  const deny2 = readSettings(dir2).permissions.deny;
  for (const p of [path.join(zd, '.zshenv'), benv, shenv]) assert.deepEqual(editDeniedBy(deny2, p), [], `${p} denied with nothing naming it`);
  // A relative value is read from whatever folder the shell runs in (the agent can choose it): named, so not whole.
  for (const [k, v] of [['BASH_ENV', 'rel.sh'], ['BASH_ENV', 'staging'], ['ENV', './rel.sh'], ['ZDOTDIR', 'reldir']]) {
    const d3 = agentDir('pilot-rcrel-' + k + v.replace(/[^a-z]/g, ''));
    const g3 = setup.guardTokenOnlyFolder(d3, path.basename(d3), { ...DEPS, env: { [k]: v } });
    assert.equal(g3.ok, false, `${k}=${v}: ` + JSON.stringify(g3));
    assert.match(String(g3.because), new RegExp(k));
  }
  // Review 2: ENV=staging is a label, not a file: it does not make the guard not whole (CONTROL: ENV=./rel.sh above does).
  const dl = agentDir('pilot-rclabel');
  assert.equal(setup.guardTokenOnlyFolder(dl, 'pilot-rclabel', { ...DEPS, env: { ENV: 'staging' } }).ok, true);
  // ZDOTDIR naming the home folder itself adds nothing beyond the home files (no duplicate set), and is whole.
  assert.equal(setup.shellStartPaths(HOME, { ZDOTDIR: HOME }).unsafe.length, 0);
});

test('#5774 part 2 review 1: ZDOTDIR set inside .zshenv (where it usually is) moves zsh to that folder, and it is denied', () => {
  const dir = agentDir('pilot-zdot');
  const zshenv = path.join(HOME, '.zshenv');
  const cases = [['export ZDOTDIR="$HOME/dots/zsh"', path.join(HOME, 'dots', 'zsh')], ["ZDOTDIR='~/zd2'", path.join(HOME, 'zd2')], ['export ZDOTDIR=${XDG_CONFIG_HOME}/zz', path.join(SANDBOX, 'xdg', 'zz')]];
  try {
    cases.forEach(([line, folder], i) => {
      fs.writeFileSync(zshenv, `# a comment\n${line}\n`);
      const d = agentDir('pilot-zdot-' + i);   // a fresh folder per case (the guard keeps rules it wrote before)
      const g = setup.guardTokenOnlyFolder(d, path.basename(d), { ...DEPS, env: { XDG_CONFIG_HOME: path.join(SANDBOX, 'xdg') } });
      assert.equal(g.ok, true, `${line}: ` + JSON.stringify(g));
      assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(folder, '.zshrc')).length > 0, `${line}: ${folder}/.zshrc not denied`);
    });
    // Review 2: a quote in the middle (ZDOTDIR="$HOME"/.zsh) is named, never read as "$HOME" and dropped.
    fs.writeFileSync(zshenv, 'export ZDOTDIR="$HOME"/.zsh\n');
    const gq = setup.guardTokenOnlyFolder(agentDir('pilot-zdotq'), 'pilot-zdotq', { ...DEPS, env: {} });
    assert.equal(gq.ok, false, JSON.stringify(gq));
    assert.match(String(gq.because), /ZDOTDIR/);
    // One it cannot work out is named, so the guard is not whole.
    fs.writeFileSync(zshenv, 'export ZDOTDIR="$SOMETHING/zsh"\n');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-zdot', { ...DEPS, env: {} });
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /ZDOTDIR/);
    // CONTROL: a .zshenv that sets nothing is whole, and the folder above is not denied.
    // (A fresh folder: the guard keeps rules it wrote before, so the one above would still carry them.)
    fs.writeFileSync(zshenv, 'export PATH="$HOME/bin:$PATH"\n');
    const dir0 = agentDir('pilot-zdot0');
    const g0 = setup.guardTokenOnlyFolder(dir0, 'pilot-zdot0', { ...DEPS, env: {} });
    assert.equal(g0.ok, true, JSON.stringify(g0));
    assert.deepEqual(editDeniedBy(readSettings(dir0).permissions.deny, path.join(HOME, 'dots', 'zsh', '.zshrc')), []);
  } finally { fs.rmSync(zshenv, { force: true }); }
});

test('#5774 part 2 review 1: fish and nushell follow XDG_CONFIG_HOME', () => {
  const dir = agentDir('pilot-xdg');
  const xdg = path.join(SANDBOX, 'xdg2');
  setup.guardTokenOnlyFolder(dir, 'pilot-xdg', { ...DEPS, env: { XDG_CONFIG_HOME: xdg } });
  const deny = readSettings(dir).permissions.deny;
  for (const p of [path.join(xdg, 'fish', 'config.fish'), path.join(xdg, 'nushell', 'env.nu'), path.join(xdg, 'zsh', '.zshrc')]) {
    assert.ok(editDeniedBy(deny, p).length > 0, `${p} not denied`);
  }
});

test('#5774 part 2 review 3: XDG_CONFIG_HOME set in .zshenv is followed; ~/.config is kept when the environment names another', () => {
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, 'export XDG_CONFIG_HOME=$HOME/.cfg\nexport ZDOTDIR=$XDG_CONFIG_HOME/zsh\n');
  try {
    const dir = agentDir('pilot-xdgz');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-xdgz', { ...DEPS, env: { XDG_CONFIG_HOME: path.join(SANDBOX, 'elsewhere') } });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    for (const p of [path.join(HOME, '.cfg', 'zsh', '.zshrc'), path.join(HOME, '.cfg', 'fish', 'config.fish'),
      path.join(HOME, '.config', 'fish', 'config.fish'), path.join(HOME, '.config', 'nushell', 'env.nu'), path.join(SANDBOX, 'elsewhere', 'fish', 'config.fish')]) {
      assert.ok(editDeniedBy(s.permissions.deny, p).length > 0, `${p} not denied`);
      assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, p), `${p} not in the sandbox denyWrite`);
    }
    assert.ok(editDeniedBy(s.permissions.deny, path.join(HOME, '.cfg', 'zsh', '.zcompdump-host')).length > 0, "the ZDOTDIR's completion dump");
  } finally { fs.rmSync(zshenv, { force: true }); }
});

test("#5774 part 2 review 3: a ZDOTDIR's own .zshenv that moves it again is followed; an empty ZDOTDIR is the default", () => {
  const first = path.join(SANDBOX, 'zfirst');
  const second = path.join(SANDBOX, 'zsecond');
  fs.mkdirSync(first, { recursive: true });
  fs.writeFileSync(path.join(first, '.zshenv'), `ZDOTDIR=${second}\n`);
  const dir = agentDir('pilot-z2');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-z2', { ...DEPS, env: { ZDOTDIR: first } });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(second, '.zshrc')).length > 0, 'the second folder');
  // CONTROL: without the first folder's .zshenv naming it, the second is not denied.
  fs.rmSync(path.join(first, '.zshenv'));
  const dir0 = agentDir('pilot-z20');
  setup.guardTokenOnlyFolder(dir0, 'pilot-z20', { ...DEPS, env: { ZDOTDIR: first } });
  assert.deepEqual(editDeniedBy(readSettings(dir0).permissions.deny, path.join(second, '.zshrc')), []);
  // ZDOTDIR= (empty) unsets it: whole, nothing named.
  assert.equal(setup.guardTokenOnlyFolder(agentDir('pilot-zempty'), 'pilot-zempty', { ...DEPS, env: { ZDOTDIR: '' } }).ok, true);
});

test('#5774 part 2 review 3: a link inside a folder denied whole (GNU Stow) has its target denied', () => {
  const real = path.join(SANDBOX, 'stow', 'config.fish');
  touch(real);
  const link = path.join(HOME, '.config', 'fish', 'config.fish');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(real, link);
  try {
    const dir = agentDir('pilot-stow');
    setup.guardTokenOnlyFolder(dir, 'pilot-stow', { ...DEPS, env: ENV0 });
    const s = readSettings(dir);
    const target = fs.realpathSync.native(real);
    assert.ok(editDeniedBy(s.permissions.deny, target).length > 0, 'the stowed target, to the file tools');
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, target), 'the stowed target, to the shell');
    assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(SANDBOX, 'stow', 'other.fish')), [], 'CONTROL: an unlinked file beside it');
  } finally { fs.rmSync(link, { force: true }); }
});

test('#5774 part 2 review 3: user-writable startup folders outside the home (Homebrew-style) are denied where they exist', () => {
  fs.mkdirSync(USERDIRS[0], { recursive: true });   // zsh site-functions exists; fish vendor_conf.d does not
  const dir = agentDir('pilot-brew');
  setup.guardTokenOnlyFolder(dir, 'pilot-brew', { ...DEPS, env: ENV0 });
  const s = readSettings(dir);
  assert.ok(editDeniedBy(s.permissions.deny, path.join(USERDIRS[0], '_git')).length > 0, 'a completion function');
  assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(USERDIRS[0], '_git')));
  assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(USERDIRS[1], 'x.fish')), [], 'a folder that does not exist gets no rule');
  // The list for the real host names both prefixes.
  assert.ok(setup.USER_WRITABLE_SHELL_DIRS.includes('/opt/homebrew/share/zsh/site-functions'));
});
