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
DEPS.homebrewPrefixes = [];   // review 12: this host's own Homebrew is not read either (tests that need one pass theirs)

test('#5774 part 2: each shell startup file in the home folder is denied in both layers', () => {
  const dir = agentDir('pilot-rc');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-rc', { ...DEPS, env: ENV0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  // Named here, not only through the exported list (a list the test reads cannot catch a name dropped from it).
  for (const f of ['.zshenv', '.zshrc', '.bashrc', '.bash_profile', '.profile', '.bash_aliases', '.bash_completion', '.cshrc', '.tcshrc']) assert.ok(setup.SHELL_START_FILES.includes(f), f);
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
  assert.equal(setup.shellStartPaths(HOME, { ZDOTDIR: HOME }, { userShellDirs: [], homebrewPrefixes: [] }).unsafe.length, 0);
});

test('#5774 part 2 review 1: ZDOTDIR set inside .zshenv (where it usually is) moves zsh to that folder, and it is denied', () => {
  const dir = agentDir('pilot-zdot');
  const zshenv = path.join(HOME, '.zshenv');
  const cases = [['export ZDOTDIR="$HOME/dots/zsh"', path.join(HOME, 'dots', 'zsh')], ['ZDOTDIR=~/zd2', path.join(HOME, 'zd2')], ['export ZDOTDIR=${XDG_CONFIG_HOME}/zz', path.join(SANDBOX, 'xdg', 'zz')]];
  try {
    cases.forEach(([line, folder], i) => {
      fs.writeFileSync(zshenv, `# a comment\n${line}\n`);
      const d = agentDir('pilot-zdot-' + i);   // a fresh folder per case (the guard keeps rules it wrote before)
      const g = setup.guardTokenOnlyFolder(d, path.basename(d), { ...DEPS, env: { XDG_CONFIG_HOME: path.join(SANDBOX, 'xdg') } });
      assert.equal(g.ok, true, `${line}: ` + JSON.stringify(g));
      assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(folder, '.zshrc')).length > 0, `${line}: ${folder}/.zshrc not denied`);
    });
    // Review 2: a quote in the middle (ZDOTDIR="$HOME"/.zsh) is never read as "$HOME" and dropped. Review 11: it is
    // read whole, part by part, so its real folder is denied (and the guard is whole).
    fs.writeFileSync(zshenv, 'export ZDOTDIR="$HOME"/.zsh\n');
    const dq = agentDir('pilot-zdotq');
    const gq = setup.guardTokenOnlyFolder(dq, 'pilot-zdotq', { ...DEPS, env: {} });
    assert.equal(gq.ok, true, JSON.stringify(gq));
    assert.ok(editDeniedBy(readSettings(dq).permissions.deny, path.join(HOME, '.zsh', '.zshrc')).length > 0, '~/.zsh/.zshrc, the folder "$HOME"/.zsh means');
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

test('#5774 part 2 review 4: dumps that exist are denied by name in both layers; a FIFO .zshenv does not block; a relative XDG is named', () => {
  const zd = path.join(SANDBOX, 'zd-out');
  fs.mkdirSync(zd, { recursive: true });
  fs.writeFileSync(path.join(zd, '.zcompdump-host-5.9'), '');
  const dir = agentDir('pilot-dump');
  setup.guardTokenOnlyFolder(dir, 'pilot-dump', { ...DEPS, env: { ZDOTDIR: zd } });
  const s = readSettings(dir);
  assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(zd, '.zcompdump-host-5.9')), 'an existing dump, to the shell');
  // A FIFO where .zshenv would be: the guard reads regular files only. Review 6: checked in a CHILD process with a
  // timeout, so a regression fails here instead of hanging this run; skipped where there is no mkfifo.
  if (process.platform !== 'win32' && fs.existsSync('/usr/bin/mkfifo')) {
    const fifoHome = path.join(SANDBOX, 'fifo-home');
    fs.mkdirSync(fifoHome, { recursive: true });
    const zshenv = path.join(fifoHome, '.zshenv');
    fs.rmSync(zshenv, { force: true });
    require('child_process').execFileSync('/usr/bin/mkfifo', [zshenv]);
    try {
      const r = require('child_process').spawnSync(process.execPath, ['-e',
        `const s = require(${JSON.stringify(require.resolve('./setup-assistant'))}); s.shellStartPaths(${JSON.stringify(fifoHome)}, {}, { userShellDirs: [], homebrewPrefixes: [] }); console.log('returned');`],
      { encoding: 'utf8', timeout: 20000 });
      assert.ok(!r.error && /returned/.test(r.stdout), 'the guard blocked on a FIFO .zshenv: ' + (r.error ? r.error.code : r.stderr));
    } finally { fs.rmSync(zshenv, { force: true }); }
  }
  const gr = setup.guardTokenOnlyFolder(agentDir('pilot-xdgrel'), 'pilot-xdgrel', { ...DEPS, env: { XDG_CONFIG_HOME: 'cfg' } });
  assert.equal(gr.ok, false, JSON.stringify(gr));
  assert.match(String(gr.because), /XDG_CONFIG_HOME/);
});

test('#5774 part 2 review 4: a FOLDER linked inside fish (Stow folding) has its contents denied', () => {
  const realDir = path.join(SANDBOX, 'stowdir', 'functions');
  fs.mkdirSync(realDir, { recursive: true });
  touch(path.join(realDir, 'fish_prompt.fish'));
  const link = path.join(HOME, '.config', 'fish', 'functions');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(realDir, link);
  try {
    const dir = agentDir('pilot-stowdir');
    setup.guardTokenOnlyFolder(dir, 'pilot-stowdir', { ...DEPS, env: ENV0 });
    const s = readSettings(dir);
    const inside = path.join(fs.realpathSync.native(realDir), 'fish_prompt.fish');
    assert.ok(editDeniedBy(s.permissions.deny, inside).length > 0, 'a file inside the linked folder, to the file tools');
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, inside), 'and to the shell');
    assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(SANDBOX, 'stowdir', 'README')), [], 'CONTROL: beside the linked folder');
  } finally { fs.rmSync(link, { force: true }); }
});

test('#5774 part 2 review 5: Homebrew links into its Cellar give ONE stable Cellar rule, never versioned paths (they would pile up)', () => {
  const pre = path.join(SANDBOX, 'hb');
  const sf = path.join(pre, 'share', 'zsh', 'site-functions');
  fs.mkdirSync(sf, { recursive: true });
  const v1 = path.join(pre, 'Cellar', 'tool', '1.0', 'share', 'zsh', 'site-functions', '_tool');
  touch(v1);
  fs.rmSync(path.join(sf, '_tool'), { force: true });
  fs.symlinkSync(v1, path.join(sf, '_tool'));
  const deps = { ...DEPS, env: ENV0, userShellDirs: [sf], homebrewPrefixes: [pre] };
  const dir = agentDir('pilot-cellar');
  setup.guardTokenOnlyFolder(dir, 'pilot-cellar', deps);
  let s = readSettings(dir);
  assert.deepEqual(s.permissions.deny.filter((r) => r.includes('/1.0/')), [], 'a versioned Cellar path became a rule');
  assert.deepEqual(s.sandbox.filesystem.denyWrite.filter((r) => r.includes('/1.0/')), [], 'a versioned Cellar path in denyWrite');
  // brew upgrade: the link now points at 2.0. Still no versioned path, and the new target is covered by the one rule.
  const v2 = path.join(pre, 'Cellar', 'tool', '2.0', 'share', 'zsh', 'site-functions', '_tool');
  touch(v2);
  fs.rmSync(path.join(sf, '_tool'));
  fs.symlinkSync(v2, path.join(sf, '_tool'));
  setup.guardTokenOnlyFolder(dir, 'pilot-cellar', deps);
  s = readSettings(dir);
  assert.deepEqual(s.permissions.deny.filter((r) => /\/[12]\.0\//.test(r)), [], 'versioned paths piled up over an upgrade');
  assert.ok(editDeniedBy(s.permissions.deny, fs.realpathSync.native(v2)).length > 0, 'the upgraded target, to the file tools');
  assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, v2), 'and to the shell');
  // CONTROL: a folder with no Cellar link adds no Cellar rule.
  const dir0 = agentDir('pilot-cellar0');
  setup.guardTokenOnlyFolder(dir0, 'pilot-cellar0', { ...DEPS, env: ENV0, homebrewPrefixes: [pre] });
  assert.deepEqual(editDeniedBy(readSettings(dir0).permissions.deny, fs.realpathSync.native(v2)), []);
});

test('#5774 part 2 review 5: a link scan cut short is named; a linked folder gets a /** rule; ${XDG_CONFIG_HOME:-...} is understood', () => {
  // More links than the scan follows: named, so not whole.
  const many = path.join(SANDBOX, 'many', 'fish');
  fs.mkdirSync(many, { recursive: true });
  for (let i = 0; i < 510; i++) { const l = path.join(many, `l${i}.fish`); if (!fs.existsSync(l)) fs.symlinkSync('/dev/null', l); }
  const gm = setup.guardTokenOnlyFolder(agentDir('pilot-many'), 'pilot-many', { ...DEPS, env: ENV0, userShellDirs: [many] });
  assert.equal(gm.ok, false, JSON.stringify(gm));
  assert.match(String(gm.because), /links inside the shell startup folders/);
  // A linked folder: its rule is a whole-folder one, not a bare path.
  const realDir = path.join(SANDBOX, 'stow2', 'functions');
  fs.mkdirSync(realDir, { recursive: true });
  const link = path.join(HOME, '.config', 'fish', 'functions');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(realDir, link);
  try {
    const dir = agentDir('pilot-dirrule');
    setup.guardTokenOnlyFolder(dir, 'pilot-dirrule', { ...DEPS, env: ENV0 });
    const real = fs.realpathSync.native(realDir);
    assert.ok(readSettings(dir).permissions.deny.some((r) => r.endsWith(`${real}/**)`)), 'no /** rule for the linked folder');
  } finally { fs.rmSync(link, { force: true }); }
  // The common default form, for both variables: whole, and the folder it means is covered.
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, 'export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"\nexport ZDOTDIR="${XDG_CONFIG_HOME:-$HOME/.config}/zsh"\n');
  try {
    const dir = agentDir('pilot-default');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-default', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(HOME, '.config', 'zsh', '.zshrc')).length > 0);
  } finally { fs.rmSync(zshenv, { force: true }); }
});

test('#5774 part 2 review 5: the conventional zsh folder, when something sets ZDOTDIR to it, has its own .zshenv read', () => {
  const conv = path.join(HOME, '.config', 'zsh');
  const further = path.join(SANDBOX, 'zfurther');
  fs.mkdirSync(conv, { recursive: true });
  fs.writeFileSync(path.join(conv, '.zshenv'), `ZDOTDIR=${further}\n`);
  try {
    const dir = agentDir('pilot-conv');
    setup.guardTokenOnlyFolder(dir, 'pilot-conv', { ...DEPS, env: { ZDOTDIR: conv } });
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(further, '.zshrc')).length > 0, 'the folder the conventional one moves to');
  } finally { fs.rmSync(path.join(conv, '.zshenv'), { force: true }); }
});

test('#5774 part 2 review 6: a link to the home or to a folder holding the agent is named, never denied whole; indented assignments are not read', () => {
  // A link inside fish's folder pointing at the home: no <home>/** rule; named.
  const fishDir = path.join(HOME, '.config', 'fish');
  fs.mkdirSync(fishDir, { recursive: true });
  const l1 = path.join(fishDir, 'home-link');
  fs.rmSync(l1, { force: true });
  fs.symlinkSync(HOME, l1);
  try {
    const dir = agentDir('pilot-broad');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-broad', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /too wide to deny/);
    const homeReal = fs.realpathSync.native(HOME);
    assert.ok(!readSettings(dir).permissions.deny.some((r) => r.endsWith(`${homeReal}/**)`)), 'the home folder was denied whole');
    assert.deepEqual(editDeniedBy(readSettings(dir).permissions.deny, path.join(dir, 'work.md')), [], "the agent's own file was denied");
  } finally { fs.rmSync(l1, { force: true }); }
  // An XDG folder whose fish is a link to the folder that holds the agents: named; the agent's work stays writable.
  const xdg = path.join(SANDBOX, 'xdg-broad');
  fs.mkdirSync(xdg, { recursive: true });
  const l2 = path.join(xdg, 'fish');
  fs.rmSync(l2, { force: true });
  fs.symlinkSync(path.join(SANDBOX, 'workers'), l2);
  const dir2 = agentDir('pilot-broad2');
  const g2 = setup.guardTokenOnlyFolder(dir2, 'pilot-broad2', { ...DEPS, env: { XDG_CONFIG_HOME: xdg } });
  assert.equal(g2.ok, false, JSON.stringify(g2));
  assert.deepEqual(editDeniedBy(readSettings(dir2).permissions.deny, path.join(dir2, 'work.md')), [], "the agent's own file was denied");
  // Indented: inside a here-document or a function, not evaluated, so not read (and not a reason to be not whole).
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, 'cat <<EOF\n  ZDOTDIR=$(mystery)\nEOF\nf() {\n  export ZDOTDIR=/somewhere/odd\n}\n');
  try {
    const dir3 = agentDir('pilot-indent');
    const g3 = setup.guardTokenOnlyFolder(dir3, 'pilot-indent', { ...DEPS, env: ENV0 });
    assert.equal(g3.ok, true, JSON.stringify(g3));
    assert.deepEqual(editDeniedBy(readSettings(dir3).permissions.deny, '/somewhere/odd/.zshrc'), []);
  } finally { fs.rmSync(zshenv, { force: true }); }
});

test('#5774 part 2 review 7: ${ZDOTDIR:-...} is understood; a busy folder with no links stays whole; home dumps are not named one by one', () => {
  const zshenv = path.join(HOME, '.zshenv');
  const envZd = path.join(SANDBOX, 'zd-env7');
  fs.writeFileSync(zshenv, 'export ZDOTDIR="${ZDOTDIR:-$HOME/.config/zsh}"\n');
  try {
    const dir = agentDir('pilot-zdflt');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-zdflt', { ...DEPS, env: { ZDOTDIR: envZd } });
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    for (const p of [path.join(envZd, '.zshrc'), path.join(HOME, '.config', 'zsh', '.zshrc')]) assert.ok(editDeniedBy(deny, p).length > 0, `${p} (one arm) not denied`);
  } finally { fs.rmSync(zshenv, { force: true }); }
  // Hundreds of plain files (a fish plugin manager's functions) and no links: the scan budget counts links, so whole.
  const busy = path.join(SANDBOX, 'busy', 'fish', 'functions');
  fs.mkdirSync(busy, { recursive: true });
  for (let i = 0; i < 600; i++) { const f = path.join(busy, `f${i}.fish`); if (!fs.existsSync(f)) fs.writeFileSync(f, ''); }
  const gb = setup.guardTokenOnlyFolder(agentDir('pilot-busy'), 'pilot-busy', { ...DEPS, env: ENV0, userShellDirs: [path.dirname(busy)] });
  assert.equal(gb.ok, true, JSON.stringify(gb));
  // A dump in the home folder: covered by the glob for the file tools, never listed by name (no pile-up over upgrades).
  const dump = path.join(HOME, '.zcompdump-myhost-5.9');
  fs.writeFileSync(dump, '');
  try {
    const dir = agentDir('pilot-homedump');
    setup.guardTokenOnlyFolder(dir, 'pilot-homedump', { ...DEPS, env: ENV0 });
    const s = readSettings(dir);
    assert.ok(editDeniedBy(s.permissions.deny, dump).length > 0, 'the glob covers it');
    assert.ok(!s.permissions.deny.some((r) => r.includes('zcompdump-myhost')), 'listed by name in the rules');
    assert.ok(!s.sandbox.filesystem.denyWrite.some((r) => r.includes('zcompdump-myhost')), 'listed by name in denyWrite');
  } finally { fs.rmSync(dump, { force: true }); }
});

test('#5774 part 2 review 7: a Caskroom target gives one stable Caskroom rule; only the Cellar or Caskroom hit is denied', () => {
  const pre = path.join(SANDBOX, 'hb7');
  const other = path.join(SANDBOX, 'hb7other');
  fs.mkdirSync(path.join(other, 'Cellar'), { recursive: true });
  const sf = path.join(pre, 'share', 'zsh', 'site-functions');
  fs.mkdirSync(sf, { recursive: true });
  const v = path.join(pre, 'Caskroom', 'cask', '9.1', 'completion.zsh');
  touch(v);
  fs.rmSync(path.join(sf, '_cask'), { force: true });
  fs.symlinkSync(v, path.join(sf, '_cask'));
  const dir = agentDir('pilot-cask');
  setup.guardTokenOnlyFolder(dir, 'pilot-cask', { ...DEPS, env: ENV0, userShellDirs: [sf], homebrewPrefixes: [pre, other] });
  const s = readSettings(dir);
  assert.deepEqual(s.permissions.deny.filter((r) => r.includes('/9.1/')), [], 'a versioned Caskroom path became a rule');
  assert.ok(editDeniedBy(s.permissions.deny, fs.realpathSync.native(v)).length > 0, 'the cask target is covered');
  assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(fs.realpathSync.native(path.join(other, 'Cellar')), 'x')), [], "a Cellar nothing points into was denied");
});

test('#5774 part 2 review 8: dumps under the home (the conventional ~/.config/zsh) are not named; links into a Cellar spend no budget', () => {
  const conv = path.join(HOME, '.config', 'zsh');
  fs.mkdirSync(conv, { recursive: true });
  const dump = path.join(conv, '.zcompdump-myhost-5.9');
  fs.writeFileSync(dump, '');
  try {
    const dir = agentDir('pilot-convdump');
    setup.guardTokenOnlyFolder(dir, 'pilot-convdump', { ...DEPS, env: ENV0 });
    const s = readSettings(dir);
    assert.ok(editDeniedBy(s.permissions.deny, dump).length > 0, 'the glob covers it');
    assert.ok(!s.sandbox.filesystem.denyWrite.some((r) => r.includes('zcompdump-myhost')), 'named in denyWrite (piles up over upgrades)');
  } finally { fs.rmSync(dump, { force: true }); }
  // 510 links, all into a Cellar: one stable rule covers them, so the budget is not spent and the guard stays whole.
  const pre = path.join(SANDBOX, 'hb8');
  const sf = path.join(pre, 'share', 'zsh', 'site-functions');
  fs.mkdirSync(sf, { recursive: true });
  for (let i = 0; i < 510; i++) {
    const t = path.join(pre, 'Cellar', `f${i}`, '1.0', '_f');
    if (!fs.existsSync(t)) touch(t);
    const l = path.join(sf, `_f${i}`);
    if (!fs.existsSync(l)) fs.symlinkSync(t, l);
  }
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-cellarmany'), 'pilot-cellarmany', { ...DEPS, env: ENV0, userShellDirs: [sf], homebrewPrefixes: [pre] });
  assert.equal(g.ok, true, JSON.stringify(g));
});

test('#5774 part 2 review 9: braced defaults (${XDG_CONFIG_HOME:-${HOME}/.config}) are read; a read-only store target is not listed', () => {
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, 'export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"\nexport ZDOTDIR="${XDG_CONFIG_HOME:-${HOME}/.config}/zsh"\n');
  try {
    const dir = agentDir('pilot-nested');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-nested', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    assert.deepEqual([...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].filter((r) => /[{}]/.test(r)), [], 'a path with a brace was written');
    assert.ok(editDeniedBy(s.permissions.deny, path.join(HOME, '.config', 'zsh', '.zshrc')).length > 0);
  } finally { fs.rmSync(zshenv, { force: true }); }
  // A dotfile linked into a read-only store (home-manager's /nix/store/<hash>-...): its target is not listed, since it
  // protects nothing and the hash changes at every switch. CONTROL: the earlier linked-dotfile test (a writable repo).
  const store = path.join(SANDBOX, 'nixstore', 'abc123-home-manager-files');
  const target = path.join(store, 'zshrc');
  touch(target);
  fs.chmodSync(target, 0o444);
  fs.chmodSync(store, 0o555);
  const link = path.join(HOME, '.zshrc');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
  try {
    const dir = agentDir('pilot-nix');
    // Review 13: a test cannot make a root-owned store, so it says which targets are read-only.
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-nix', { ...DEPS, env: ENV0, readOnlyTarget: (p) => p.includes('abc123-home-manager-files') });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    assert.ok(![...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].some((r) => r.includes('abc123-home-manager-files')), 'a read-only store path was listed');
    // Review 10: the LINK itself stays denied to the file tools (a tool that replaces the link would write a new ~/.zshrc).
    assert.ok(s.permissions.deny.some((r) => r.endsWith(`${link})`) || r.endsWith(`${fs.realpathSync.native(HOME)}/.zshrc)`)), '~/.zshrc itself was dropped');
  } finally {
    fs.rmSync(link, { force: true });
    fs.chmodSync(store, 0o755);
  }
});

test('#5774 part 2 review 10: a Homebrew under any prefix gets the one stable Cellar rule', () => {
  const pre = path.join(SANDBOX, 'linuxbrew');
  const sf = path.join(pre, 'share', 'zsh', 'site-functions');
  fs.mkdirSync(sf, { recursive: true });
  const v = path.join(pre, 'Cellar', 'tool', '3.2', 'share', '_tool');
  touch(v);
  fs.rmSync(path.join(sf, '_tool'), { force: true });
  fs.symlinkSync(v, path.join(sf, '_tool'));
  const dir = agentDir('pilot-anyprefix');
  setup.guardTokenOnlyFolder(dir, 'pilot-anyprefix', { ...DEPS, env: ENV0, userShellDirs: [sf], homebrewPrefixes: [] });
  const s = readSettings(dir);
  assert.deepEqual([...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].filter((r) => r.includes('/3.2/')), [], 'a versioned path from an unlisted prefix');
  assert.ok(editDeniedBy(s.permissions.deny, fs.realpathSync.native(v)).length > 0, 'its Cellar rule covers the target');
});

test('#5774 part 2 review 11: a linked PARENT (Stow-folded ~/.config, a linked ZDOTDIR) has its real files denied; a read-only ~/.bashrc is kept', () => {
  // ~/.config linked whole into a dotfiles repo: fish's real folder there is denied to the file tools.
  const cfgReal = path.join(SANDBOX, 'dotfiles11', 'config');
  fs.mkdirSync(path.join(cfgReal, 'fish'), { recursive: true });
  const cfg = path.join(HOME, '.config');
  const saved = path.join(SANDBOX, 'config-saved-11');
  const had = fs.existsSync(cfg);
  if (had) fs.renameSync(cfg, saved);
  fs.symlinkSync(cfgReal, cfg);
  try {
    const dir = agentDir('pilot-parent');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-parent', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(fs.realpathSync.native(cfgReal), 'fish', 'config.fish')).length > 0, 'the real fish folder under a linked ~/.config');
  } finally { fs.rmSync(cfg); if (had) fs.renameSync(saved, cfg); }
  // ZDOTDIR=$HOME/.zsh with ~/.zsh linked into a repo: the real .zshrc is denied.
  const zReal = path.join(SANDBOX, 'dots11', 'zsh');
  fs.mkdirSync(zReal, { recursive: true });
  const zLink = path.join(HOME, '.zsh');
  fs.rmSync(zLink, { force: true });
  fs.symlinkSync(zReal, zLink);
  const zshenv = path.join(HOME, '.zshenv');
  fs.writeFileSync(zshenv, 'export ZDOTDIR=$HOME/.zsh\n');
  try {
    const dir = agentDir('pilot-zlink');
    setup.guardTokenOnlyFolder(dir, 'pilot-zlink', { ...DEPS, env: ENV0 });
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(fs.realpathSync.native(zReal), '.zshrc')).length > 0, 'the real .zshrc under a linked ZDOTDIR');
  } finally { fs.rmSync(zshenv, { force: true }); fs.rmSync(zLink, { force: true }); }
  // A read-only ~/.bashrc (not a link) is still denied: the home folder is writable, so it could be replaced.
  const rc = path.join(HOME, '.bashrc');
  fs.writeFileSync(rc, '');
  fs.chmodSync(rc, 0o444);
  try {
    const dir = agentDir('pilot-robashrc');
    setup.guardTokenOnlyFolder(dir, 'pilot-robashrc', { ...DEPS, env: ENV0 });
    const s = readSettings(dir);
    // The file tools' rule is what matters (the shell cannot write the home folder). In this sandbox the home is under
    // /var, a link to /private/var, so the path counts as linked and a read-only one is denied to the file tools only.
    assert.ok(editDeniedBy(s.permissions.deny, rc).length > 0, 'a read-only ~/.bashrc was dropped');
  } finally { fs.chmodSync(rc, 0o644); fs.rmSync(rc, { force: true }); }
});

test('#5774 part 2 review 11: joined quoting ("$HOME"/.zsh) is read; a quoted ~ is named; a read-only linked folder gets /**', () => {
  const zshenv = path.join(HOME, '.zshenv');
  try {
    fs.writeFileSync(zshenv, 'export ZDOTDIR="$HOME"/.zq\n');
    const d1 = agentDir('pilot-joined');
    const g1 = setup.guardTokenOnlyFolder(d1, 'pilot-joined', { ...DEPS, env: ENV0 });
    assert.equal(g1.ok, true, JSON.stringify(g1));
    assert.ok(editDeniedBy(readSettings(d1).permissions.deny, path.join(HOME, '.zq', '.zshrc')).length > 0);
    fs.writeFileSync(zshenv, 'export ZDOTDIR="~/.zq"\n');   // zsh leaves a quoted ~ literal: a relative folder
    const g2 = setup.guardTokenOnlyFolder(agentDir('pilot-qtilde'), 'pilot-qtilde', { ...DEPS, env: ENV0 });
    assert.equal(g2.ok, false, JSON.stringify(g2));
  } finally { fs.rmSync(zshenv, { force: true }); }
  // fish's folder linked whole into a read-only store: a /** rule on the link, not a bare one.
  const store = path.join(SANDBOX, 'nix11', 'h-fish');
  fs.mkdirSync(store, { recursive: true });
  fs.chmodSync(store, 0o555);
  const xdg = path.join(SANDBOX, 'xdg11');
  fs.mkdirSync(xdg, { recursive: true });
  const link = path.join(xdg, 'fish');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(store, link);
  try {
    const dir = agentDir('pilot-rodir');
    setup.guardTokenOnlyFolder(dir, 'pilot-rodir', { ...DEPS, env: { XDG_CONFIG_HOME: xdg }, readOnlyTarget: (p) => p.includes('h-fish') });
    const deny = readSettings(dir).permissions.deny;
    assert.ok(deny.some((r) => r.endsWith(`${link}/**)`)), 'no /** rule for the read-only linked folder');
    assert.ok(!deny.some((r) => r.includes('h-fish')), 'the store path itself was listed');
  } finally { fs.chmodSync(store, 0o755); fs.rmSync(link, { force: true }); }
});

test('#5774 part 2 review 12: a DANGLING link inside a startup folder has its would-be target denied', () => {
  const fishDir = path.join(HOME, '.config', 'fish', 'conf.d');
  fs.mkdirSync(fishDir, { recursive: true });
  const target = path.join(SANDBOX, 'later-dotfiles', 'fish', 'x.fish');   // not there yet
  const link = path.join(fishDir, 'x.fish');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
  try {
    const dir = agentDir('pilot-dangling');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-dangling', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    assert.ok(!fs.existsSync(target), 'precondition: the target does not exist');
    assert.ok(editDeniedBy(s.permissions.deny, target).length > 0 || editDeniedBy(s.permissions.deny, realOrLeaf(target)).length > 0, 'the agent could create the target the link runs');
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, target), 'and the shell could');
  } finally { fs.rmSync(link, { force: true }); }
});

test('#5774 part 2 review 13: dangling chains and relative links in linked folders resolve to the real would-be target; a 0444 file of the user is still denied; := and - defaults are read', () => {
  // A relative dangling link inside a linked folder (Stow): the target is read from the folder's REAL location.
  const dot = path.join(SANDBOX, 'dot13');
  fs.mkdirSync(path.join(dot, 'fish'), { recursive: true });
  const rel = path.join(dot, 'fish', 'x.fish');
  fs.rmSync(rel, { force: true });
  fs.symlinkSync('../extra/x.fish', rel);   // dot13/extra/x.fish, not there yet
  // A two-hop dangling chain: y.fish -> mid -> final/y.fish (absent).
  const mid = path.join(SANDBOX, 'mid13');
  fs.rmSync(mid, { force: true });
  fs.symlinkSync(path.join(SANDBOX, 'final13', 'y.fish'), mid);
  const two = path.join(dot, 'fish', 'y.fish');
  fs.rmSync(two, { force: true });
  fs.symlinkSync(mid, two);
  const xdg = path.join(SANDBOX, 'xdg13');
  fs.mkdirSync(xdg, { recursive: true });
  const fishLink = path.join(xdg, 'fish');
  fs.rmSync(fishLink, { force: true });
  fs.symlinkSync(path.join(dot, 'fish'), fishLink);
  try {
    const dir = agentDir('pilot-dangle13');
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-dangle13', { ...DEPS, env: { XDG_CONFIG_HOME: xdg } });
    assert.equal(g.ok, true, JSON.stringify(g));
    const dw = readSettings(dir).sandbox.filesystem.denyWrite;
    assert.ok(sandboxDenies(dw, path.join(dot, 'extra', 'x.fish')), "the relative link's real would-be target");
    assert.ok(sandboxDenies(dw, path.join(SANDBOX, 'final13', 'y.fish')), "the two-hop chain's final target");
  } finally { fs.rmSync(fishLink, { force: true }); }
  // A target the user owns, made 0444 in a folder they can write: they can chmod it back, so it is still denied in both layers.
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const rodot = path.join(SANDBOX, 'rodot13', 'bashrc');
    touch(rodot);
    fs.chmodSync(rodot, 0o444);
    const link = path.join(HOME, '.bashrc');
    fs.rmSync(link, { force: true });
    fs.symlinkSync(rodot, link);
    try {
      const dir = agentDir('pilot-own444');
      setup.guardTokenOnlyFolder(dir, 'pilot-own444', { ...DEPS, env: ENV0 });
      const s = readSettings(dir);
      assert.ok(editDeniedBy(s.permissions.deny, fs.realpathSync.native(rodot)).length > 0, "the user's own 0444 target, to the file tools");
      assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, rodot), 'and to the shell');
    } finally { fs.rmSync(link, { force: true }); fs.chmodSync(rodot, 0o644); }
  }
  // := and - defaults: whole, and the folder they mean is covered.
  const zshenv = path.join(HOME, '.zshenv');
  for (const line of ['export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:=$HOME/.config}"', 'export ZDOTDIR="${ZDOTDIR-$HOME/.zd13}"']) {
    fs.writeFileSync(zshenv, line + '\n');
    try {
      const g = setup.guardTokenOnlyFolder(agentDir('pilot-ops13'), 'pilot-ops13', { ...DEPS, env: ENV0 });
      assert.equal(g.ok, true, `${line}: ` + JSON.stringify(g));
    } finally { fs.rmSync(zshenv, { force: true }); }
  }
  // ~/.ssh/rc, run by sshd outside any sandbox.
  const d = agentDir('pilot-sshrc');
  setup.guardTokenOnlyFolder(d, 'pilot-sshrc', { ...DEPS, env: ENV0 });
  assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, '.ssh', 'rc')).length > 0, '~/.ssh/rc');
});

test('#5774 part 2 review 14: one-line conditional forms are read; a read-only target linked INSIDE a startup folder is not listed', () => {
  const zshenv = path.join(HOME, '.zshenv');
  const forms = [['[[ -z $ZDOTDIR ]] && export ZDOTDIR=$HOME/.zc1', '.zc1'], ['typeset -x ZDOTDIR=$HOME/.zc2', '.zc2'],
    ['export A=1 ZDOTDIR=$HOME/.zc3', '.zc3'], [': ${ZDOTDIR:=$HOME/.zc4}', '.zc4']];
  try {
    forms.forEach(([line, folder], i) => {
      fs.writeFileSync(zshenv, line + '\n');
      const d = agentDir('pilot-oneline' + i);
      const g = setup.guardTokenOnlyFolder(d, path.basename(d), { ...DEPS, env: ENV0 });
      assert.equal(g.ok, true, `${line}: ` + JSON.stringify(g));
      assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(HOME, folder, '.zshrc')).length > 0, `${line}: ${folder} not denied`);
    });
    // CONTROL: a comment that mentions it is not read.
    fs.writeFileSync(zshenv, '# export ZDOTDIR=$HOME/.zc5\n');
    const d5 = agentDir('pilot-oneline5');
    setup.guardTokenOnlyFolder(d5, 'pilot-oneline5', { ...DEPS, env: ENV0 });
    assert.deepEqual(editDeniedBy(readSettings(d5).permissions.deny, path.join(HOME, '.zc5', '.zshrc')), []);
  } finally { fs.rmSync(zshenv, { force: true }); }
  // home-manager links a file inside fish's folder into a read-only store: the store path is not listed.
  const fishDir = path.join(HOME, '.config', 'fish');
  fs.mkdirSync(fishDir, { recursive: true });
  const storeFile = path.join(SANDBOX, 'nix14', 'h1-config.fish');
  touch(storeFile);
  const link = path.join(fishDir, 'config14.fish');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(storeFile, link);
  try {
    const dir = agentDir('pilot-inside14');
    setup.guardTokenOnlyFolder(dir, 'pilot-inside14', { ...DEPS, env: ENV0, readOnlyTarget: (p) => p.includes('h1-config.fish') });
    const s = readSettings(dir);
    assert.ok(![...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].some((r) => r.includes('h1-config.fish')), 'a read-only store path inside a startup folder was listed');
    assert.ok(editDeniedBy(s.permissions.deny, link).length > 0, "the link itself, by its folder's rule");
  } finally { fs.rmSync(link, { force: true }); }
});

test('#5774 part 2 review 15: ${0:A:h} is .zshenv\'s real folder; a read-only file in a read-only folder is read-only even if owned; data folders and ~/.ssh/config', () => {
  const repo = path.join(SANDBOX, 'repo15');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'zshenv'), 'export ZDOTDIR=${0:A:h}\n');
  const zshenv = path.join(HOME, '.zshenv');
  fs.rmSync(zshenv, { force: true });
  fs.symlinkSync(path.join(repo, 'zshenv'), zshenv);
  try {
    const d = agentDir('pilot-selfdir');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-selfdir', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(d).permissions.deny, path.join(fs.realpathSync.native(repo), '.zshrc')).length > 0, 'the repo folder');
  } finally { fs.rmSync(zshenv, { force: true }); }
  // A single-user Nix store: the user's own 0444 file in a 0555 folder is read-only (no chmod reaches it from either layer).
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const store = path.join(SANDBOX, 'nixu15', 'h-fish');
    const f = path.join(store, 'config15.fish');
    touch(f); fs.chmodSync(f, 0o444); fs.chmodSync(store, 0o555);
    const fishDir = path.join(HOME, '.config', 'fish');
    fs.mkdirSync(fishDir, { recursive: true });
    const link = path.join(fishDir, 'config15.fish');
    fs.rmSync(link, { force: true }); fs.symlinkSync(f, link);
    try {
      const d = agentDir('pilot-nixuser');
      setup.guardTokenOnlyFolder(d, 'pilot-nixuser', { ...DEPS, env: ENV0 });
      const s = readSettings(d);
      assert.ok(![...s.permissions.deny, ...s.sandbox.filesystem.denyWrite].some((r) => r.includes('config15.fish') && r.includes('nixu15')), 'a user-owned read-only store path was listed');
    } finally { fs.rmSync(link, { force: true }); fs.chmodSync(store, 0o755); }
  }
  const d2 = agentDir('pilot-data15');
  setup.guardTokenOnlyFolder(d2, 'pilot-data15', { ...DEPS, env: ENV0 });
  const deny = readSettings(d2).permissions.deny;
  for (const p of [path.join(HOME, '.local', 'share', 'fish', 'vendor_conf.d', 'x.fish'), path.join(HOME, '.local', 'share', 'bash-completion', 'completions', 'git'), path.join(HOME, '.ssh', 'config')]) {
    assert.ok(editDeniedBy(deny, p).length > 0, `${p} not denied`);
  }
});
