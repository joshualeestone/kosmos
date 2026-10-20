'use strict';
/**
 * kosmos#6713: a board started from a source checkout or a worktree that adds or reconnects an account in the REAL
 * home must leave that account's Claude settings alone (its hooks and statusline would name its own throwaway
 * engine). An installed board, and any sandboxed board, still writes them.
 *
 *   node --test engine/installroot-6713.test.js
 *
 * Posix only as written: the stand-in real home is made by setting HOME, which os.homedir() reads on a Mac or Linux
 * but not on Windows (USERPROFILE). Do not add it to tools/windows-tests.js without changing that.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const installroot = require('./installroot');
const accounts = require('./accounts');
const allowance = require('./allowance');

/* HOME is what os.homedir() reads here, so a temp HOME with no AGENT_WORKFORCE_HOME is a stand-in REAL home. */
function realHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6713-'));
  const saved = { home: process.env.HOME, awh: process.env.AGENT_WORKFORCE_HOME };
  process.env.HOME = home;
  delete process.env.AGENT_WORKFORCE_HOME;
  t.after(() => {
    process.env.HOME = saved.home;
    if (saved.awh === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = saved.awh;
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test('#6713: installRoot on a Mac layout: both files two up from the engine, or null', () => {
  const home = '/Users/x';
  const root = '/Users/x/.local/share/kosmos';
  const have = (set) => (f) => set.has(f);
  const both = new Set([root + '/runtime/bin/node', root + '/app/server.js']);
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root, exists: have(both) }), root);
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root, exists: have(new Set([root + '/app/server.js'])) }), null, 'no bundled node: not installed');
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root, exists: have(new Set([root + '/runtime/bin/node'])) }), null, 'no app/server.js: not installed');
  const sb = '/tmp/sb/home';
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root: sb, exists: have(new Set([sb + '/runtime/bin/node', sb + '/app/server.js'])) }), null,
    'a full bundle under another KOSMOS_HOME is a test install, not the installed Kosmos (as setup.sh write_install_config)');
  assert.equal(installroot.installRoot({ platform: 'win32', root: 'C:\\K', exists: have(new Set(['C:\\K\\runtime\\node.exe', 'C:\\K\\app\\server.js'])) }), 'C:\\K', 'win32 asks win32board.bundleRoot');
});

test('#6713: measured on this computer: this worktree is not an installed Kosmos, and the real install is', (t) => {
  assert.equal(installroot.installRoot({ platform: 'darwin' }), null, 'a source checkout or worktree has neither file two up from its engine');
  const real = path.join(os.homedir(), '.local', 'share', 'kosmos');
  if (process.platform !== 'darwin' || !fs.existsSync(path.join(real, 'app', 'server.js'))) { t.skip('no installed Kosmos on this computer'); return; }
  assert.equal(installroot.installRoot({ platform: 'darwin', root: real }), real, 'the installed layout (measured on two Macs) is recognised');
});

test('#6713: leaveAlone skips only a non-installed board writing into the real home', () => {
  const home = '/Users/x';
  const file = '/Users/x/.claude-account-b/settings.json';
  assert.equal(installroot.leaveAlone(file, { home, env: {}, installRoot: null }), installroot.NOT_INSTALLED);
  assert.equal(installroot.leaveAlone(file, { home, env: {}, installRoot: '/Users/x/.local/share/kosmos' }), null, 'CONTROL: installed writes');
  assert.equal(installroot.leaveAlone('/tmp/sandbox/.claude-account-b/settings.json', { home, env: { AGENT_WORKFORCE_HOME: '/tmp/sandbox' }, installRoot: null }), null, 'a file outside the home is never gated');
  assert.equal(installroot.leaveAlone(file, { home, env: { AGENT_WORKFORCE_HOME: '/Users' }, installRoot: null }), installroot.NOT_INSTALLED, 'a "sandbox" above the home is not a sandbox');
  assert.equal(installroot.leaveAlone(file, { home, env: { AGENT_WORKFORCE_HOME: '/tmp/sandbox' }, installRoot: null }), installroot.NOT_INSTALLED, 'but never a real-home file, sandbox or not');
  assert.equal(installroot.leaveAlone('/Users/x/sb/.claude-account-b/settings.json', { home, env: { AGENT_WORKFORCE_HOME: '/Users/x/sb' }, installRoot: null }), null, 'a sandbox inside the home writes its own folders');
  assert.equal(installroot.leaveAlone(file, { home, env: { AGENT_WORKFORCE_HOME: '/Users/x' }, installRoot: null }), installroot.NOT_INSTALLED, 'a "sandbox" that is the home is the real home');
  assert.equal(installroot.leaveAlone('/tmp/elsewhere/settings.json', { home, env: {}, installRoot: null }), null, 'a file outside the home is not the real home');
  assert.match(installroot.leaveAlone(file, { home, env: {}, root: '/r', exists: () => { throw new Error('io'); } }), /could not tell/, 'a check that fails leaves it alone');
});

test('#6713: a source board adding an account in the real home leaves its settings byte for byte as they were, and says why', (t) => {
  const home = realHome(t);
  const named = accounts.dirForLabel('b6713');
  assert.ok(named.ok, 'the account folder can be named');
  fs.mkdirSync(named.dir, { recursive: true });
  const settings = path.join(named.dir, 'settings.json');
  const before = '{\n  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "/installed/kosmos-report-hook.js" } ] } ] }\n}\n';
  fs.writeFileSync(settings, before);
  assert.ok(named.dir.startsWith(home), 'the account is in the stand-in real home');
  const r = accounts.prepare('b6713');
  assert.equal(r.ok, true);
  assert.equal(r.hooksWired, false);
  assert.equal(r.hooksBecause, installroot.NOT_INSTALLED);
  assert.equal(r.weeklyWired, false);
  assert.equal(r.weeklyBecause, installroot.NOT_INSTALLED);
  assert.equal(fs.readFileSync(settings, 'utf8'), before, 'the installed Kosmos\'s wiring is untouched, byte for byte');
});

test('#6713: the real home under another spelling (a link to it) is still the real home: no sandbox, nothing written', (t) => {
  const home = realHome(t);
  const alias = home + '-alias';
  fs.symlinkSync(home, alias);
  t.after(() => fs.rmSync(alias, { force: true }));
  const file = path.join(alias, '.claude-account-e6713', 'settings.json');
  assert.equal(installroot.leaveAlone(file, { env: { AGENT_WORKFORCE_HOME: alias }, installRoot: null }), installroot.NOT_INSTALLED,
    'AGENT_WORKFORCE_HOME naming the home by another path is not a sandbox, and a file spelled through it is in the home');
  assert.equal(installroot.leaveAlone(file, { env: { AGENT_WORKFORCE_HOME: alias }, installRoot: '/x' }), null, 'CONTROL: installed writes');
});

test('#6713: CONTROL: the same prepare in a sandbox INSIDE the real home still wires the hooks (the sandbox rule, not only "outside the home")', (t) => {
  const home = realHome(t);
  const sandbox = path.join(home, 'sb');
  fs.mkdirSync(sandbox, { recursive: true });
  process.env.AGENT_WORKFORCE_HOME = sandbox;   // realHome's t.after restores it
  const r = accounts.prepare('c6713');
  assert.equal(r.ok, true);
  assert.notEqual(r.hooksBecause, installroot.NOT_INSTALLED, 'not refused for the install rule');
  assert.equal(r.hooksWired, true, 'a sandboxed board wires its own sandbox account');
  assert.equal(r.hooksBecause, null);
  assert.notEqual(r.weeklyBecause, installroot.NOT_INSTALLED, 'nor is the statusline refused for the install rule');
});

test('#6713: the Settings route\'s writer (ensureStatusLine) is gated the same way, and an explicit go-ahead still writes', (t) => {
  const home = realHome(t);
  const dir = path.join(home, '.claude-account-d6713');
  fs.mkdirSync(dir, { recursive: true });
  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, '{}\n');
  const refused = allowance.ensureStatusLine(settings);
  assert.equal(refused.wired, false);
  assert.equal(refused.because, installroot.NOT_INSTALLED);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{}\n');
  const node = path.join(home, 'node'); fs.writeFileSync(node, '');
  const script = path.join(home, 'kosmos-statusline.js'); fs.writeFileSync(script, '');
  const wrote = allowance.ensureStatusLine(settings, { leaveAlone: null, node, script });
  assert.equal(wrote.wired, true, 'CONTROL: with the install check passed, the same call writes');
  assert.match(fs.readFileSync(settings, 'utf8'), /kosmos-statusline\.js/);
});
