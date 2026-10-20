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

const { spawnSync } = require('node:child_process');
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
    if (saved.home === undefined) delete process.env.HOME; else process.env.HOME = saved.home;
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
  const firm = '/System/Volumes/Data' + real;
  if (fs.existsSync(firm)) assert.equal(installroot.installRoot({ platform: 'darwin', root: firm }), firm, 'the default root under another spelling is still the default, by identity');
});

test('#6713: the refusal pins its wording, and promises no later setup', () => {
  assert.doesNotMatch(installroot.NOT_INSTALLED, /another install|will set|later/);
  assert.equal(installroot.NOT_INSTALLED, 'this board is not the installed Kosmos (a source checkout, a worktree or a test install), so it leaves this account\'s Claude settings alone');
});

test('#6713: installRoot on a real folder layout uses identity: the default root, spelled through a link, is the default', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6713-ir-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, '.local', 'share', 'kosmos');
  fs.mkdirSync(path.join(root, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'bin', 'node'), '');
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '');
  const link = path.join(home, 'kosmos-link');
  fs.symlinkSync(root, link);
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root: link }), link, 'a link to the default root is the default root');
  const other = path.join(home, 'other');
  fs.mkdirSync(path.join(other, 'runtime', 'bin'), { recursive: true }); fs.mkdirSync(path.join(other, 'app'), { recursive: true });
  fs.writeFileSync(path.join(other, 'runtime', 'bin', 'node'), ''); fs.writeFileSync(path.join(other, 'app', 'server.js'), '');
  assert.equal(installroot.installRoot({ platform: 'darwin', home, root: other }), null, 'CONTROL: the same layout elsewhere is not');
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

test('#6713: an account folder that is a link into the real home is in the real home, even spelled under a sandbox', (t) => {
  const home = realHome(t);
  const real = path.join(home, '.claude-account-f6713');
  fs.mkdirSync(real, { recursive: true });
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6713-sbl-'));
  t.after(() => fs.rmSync(sb, { recursive: true, force: true }));
  fs.symlinkSync(real, path.join(sb, '.claude-account-f6713'));
  const file = path.join(sb, '.claude-account-f6713', 'settings.json');
  assert.equal(installroot.leaveAlone(file, { env: { AGENT_WORKFORCE_HOME: sb }, installRoot: null }), installroot.NOT_INSTALLED, 'where the link leads decides');
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
  // Through the real gate (no leaveAlone injected), the sandbox's own settings file takes the statusline.
  const sf = path.join(sandbox, '.claude-account-j6713', 'settings.json');
  fs.mkdirSync(path.dirname(sf), { recursive: true }); fs.writeFileSync(sf, '{}\n');
  const node = path.join(home, 'node'); fs.writeFileSync(node, '');
  const script = path.join(home, 'kosmos-statusline.js'); fs.writeFileSync(script, '');
  assert.equal(allowance.ensureStatusLine(sf, { node, script }).wired, true, 'the real gate lets a sandbox write its own statusline');
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

/* setup.sh's hooks block, run as setup.sh runs it: the program between its heredoc markers, under the bundle's node,
   with a stand-in real HOME and no AGENT_WORKFORCE_HOME. The bundle is built in the installed layout at `kh`. */
function setupHooksProgram() {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const start = sh.indexOf("<<'HOOKSEOF'");
  assert.ok(start > 0, 'the hook block moved in setup.sh');
  const body = sh.slice(sh.indexOf('\n', start) + 1);
  return body.slice(0, body.indexOf('\nHOOKSEOF\n'));
}
function bundleAt(kh) {
  const eng = path.join(kh, 'app', 'engine');
  fs.mkdirSync(eng, { recursive: true });
  for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.js') && !f.endsWith('.test.js')) fs.copyFileSync(path.join(__dirname, f), path.join(eng, f));
  fs.writeFileSync(path.join(kh, 'app', 'server.js'), '// stand-in\n');
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(kh, 'runtime', 'bin', 'node'), '');   // only its presence is checked (installRoot)
  fs.mkdirSync(path.join(kh, 'app', 'bin'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'install', 'kosmos-report-hook.sh'), path.join(kh, 'app', 'bin', 'kosmos-report-hook.sh'));
}
function runSetupHooks(home, kh) {
  const env = { ...process.env, HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'data') };
  delete env.AGENT_WORKFORCE_HOME;
  // This node runs it (a copied Homebrew node cannot load its library); the copy in the bundle is there for the layout check.
  return spawnSync(process.execPath, ['-', kh], { input: setupHooksProgram(), encoding: 'utf8', env });
}

test('#6713: setup.sh from a bundle at the default place wires the real home (exit 0); from anywhere else it leaves it alone (exit 20)', (t) => {
  const home = realHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '{}\n');
  const elsewhere = path.join(home, 'elsewhere', 'kosmos');
  bundleAt(elsewhere);
  const off = runSetupHooks(home, elsewhere);
  assert.equal(off.status, 20, 'every target left alone: exit 20. ' + off.stderr);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{}\n', 'neither hooks nor statusline were written');
  const def = path.join(home, '.local', 'share', 'kosmos');
  bundleAt(def);
  const on = runSetupHooks(home, def);
  assert.equal(on.status, 0, 'CONTROL: the default-place bundle wires. ' + on.stderr);
  assert.match(fs.readFileSync(settings, 'utf8'), /kosmos-report-hook/, 'CONTROL: the hooks were written');
  assert.match(fs.readFileSync(settings, 'utf8'), /kosmos-statusline\.js/, 'CONTROL: and the weekly statusline (an installed board still gets it)');
});

test('#6713: setup.sh says, for exit 20, that the home was left alone, and never promises another install sets it up', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const a = sh.indexOf('case "${_hooks_rc:-0}" in');
  assert.ok(a > 0, 'the message block moved in setup.sh');
  const block = sh.slice(a, sh.indexOf('\nesac', a) + 5);
  const say = (rc) => spawnSync('/bin/sh', ['-c', 'info() { echo "$*"; }; _hooks_rc=' + rc + '\n' + block], { encoding: 'utf8' }).stdout;
  assert.match(say(20), /leaves the Claude settings in your home alone/);
  assert.match(say(21), /those in your real home were left/);
  assert.doesNotMatch(say(21), /unreadable/, 'a mixed run says nothing was unreadable');
  assert.match(say(21), /some agent settings carry the reporting hook/, 'exit 21 claims nothing about where the wired ones are');
  assert.match(say(22), /unreadable/); assert.match(say(22), /your real home were left alone/, 'exit 22 says both');
  for (const rc of [20, 21, 22]) assert.doesNotMatch(say(rc), /another install|will set|later/, 'exit ' + rc + ' promises no later setup');
  assert.match(say(0), /report what they are doing themselves/, 'CONTROL: exit 0 keeps its line');
});

/* The hooks block with its leaveAlone replaced by `stub` (JS source of a function), to reach the mixed and throwing cases. */
function runSetupHooksWith(home, kh, stub) {
  const line = "leaveAlone = require(path.join(kosmosHome, 'app', 'engine', 'installroot.js')).leaveAlone;";
  const prog = setupHooksProgram();
  assert.ok(prog.includes(line), 'the leaveAlone line moved in setup.sh');
  const env = { ...process.env, HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'data') };
  delete env.AGENT_WORKFORCE_HOME;
  return spawnSync(process.execPath, ['-', kh], { input: prog.replace(line, 'leaveAlone = ' + stub + ';'), encoding: 'utf8', env });
}
function homeWithAccount(t) {
  const home = realHome(t);
  const def = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(def), { recursive: true }); fs.writeFileSync(def, '{}\n');
  const dir = path.join(home, '.claude-account-g6713');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@example.invalid' } }));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}\n');
  const kh = path.join(home, '.local', 'share', 'kosmos'); bundleAt(kh);
  return { home, kh, def, acct: path.join(dir, 'settings.json') };
}

test('#6713: setup.sh with some targets left alone and the rest wired exits 21, not 0, 1 or 20', (t) => {
  const { home, kh, def, acct } = homeWithAccount(t);
  const r = runSetupHooksWith(home, kh, '(f) => (f.includes(".claude-account-g6713") ? "left alone" : null)');
  assert.equal(r.status, 21, 'a mixed run with nothing refused: exit 21. ' + r.stderr);
  assert.match(fs.readFileSync(def, 'utf8'), /kosmos-report-hook/, 'the target not left alone was wired');
  assert.doesNotMatch(fs.readFileSync(acct, 'utf8'), /kosmos-report-hook/, 'the one left alone has no hooks (its statusline is ensureStatusLine\'s own gate)');
  const all = runSetupHooksWith(home, kh, '() => null');
  assert.equal(all.status, 0, 'CONTROL: two targets, none left alone, exits 0. ' + all.stderr);
});

test('#6713: setup.sh leaves a target alone when its rule throws, instead of wiring it or dying', (t) => {
  const { home, kh, def, acct } = homeWithAccount(t);
  const r = runSetupHooksWith(home, kh, '() => { throw new Error("boom"); }');
  assert.equal(r.status, 20, 'every target left alone: exit 20. ' + r.stderr);
  assert.doesNotMatch(fs.readFileSync(def, 'utf8'), /kosmos-report-hook/);
  assert.doesNotMatch(fs.readFileSync(acct, 'utf8'), /kosmos-report-hook/);
});

test('#6713: after a run that left anything alone (20, 21, 22) setup.sh does not claim a status line', (t) => {
  const home = realHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { command: 'node /x/kosmos-statusline.js' } }));
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const a = sh.indexOf('_sl_home="${AGENT_WORKFORCE_HOME:-$HOME}"');
  assert.ok(a > 0, 'the status-line message block moved in setup.sh');
  const block = sh.slice(a, sh.indexOf('\nfi\n', a) + 4);
  const env = { ...process.env, HOME: home }; delete env.AGENT_WORKFORCE_HOME;
  const say = (rc) => spawnSync('/bin/sh', ['-c', 'info() { echo "$*"; }; _hooks_rc=' + rc + '\n' + block], { encoding: 'utf8', env }).stdout;
  for (const rc of [20, 21, 22]) assert.doesNotMatch(say(rc), /status line/, 'exit ' + rc + ' may have skipped the files it scans, so it claims nothing');
  assert.match(say(0), /status line of their own carry Kosmos/, 'CONTROL: exit 0 with the line present says so');
});

test('#6713: a filesystem that reports inode 0 for every folder does not make a sandbox the home', (t) => {
  const home = realHome(t);
  const sb = path.join(home, 'sb'); fs.mkdirSync(sb);
  const file = path.join(sb, '.claude-account-h6713', 'settings.json');
  const real = fs.statSync;
  fs.statSync = (p, o) => { const s = real(p, o); if (o && o.bigint) s.ino = 0n; return s; };
  t.after(() => { fs.statSync = real; });
  assert.equal(installroot.leaveAlone(file, { home, env: { AGENT_WORKFORCE_HOME: sb }, installRoot: null }), null, 'the sandbox writes its own folders');
  assert.equal(installroot.leaveAlone(path.join(home, '.claude', 'settings.json'), { home, env: { AGENT_WORKFORCE_HOME: sb }, installRoot: null }), installroot.NOT_INSTALLED, 'CONTROL: the real home is still left alone');
});

test('#6713: setup.sh with a target refused and another left alone exits 22, not 1', (t) => {
  const { home, kh, def } = homeWithAccount(t);
  fs.writeFileSync(def, 'not json\n');   // an unreadable settings file is refused, and left as it is
  const r = runSetupHooksWith(home, kh, '(f) => (f.includes(".claude-account-g6713") ? "left alone" : null)');
  assert.equal(r.status, 22, 'refused and left alone: exit 22. ' + r.stderr);
  assert.equal(fs.readFileSync(def, 'utf8'), 'not json\n');
  const only = runSetupHooksWith(home, kh, '() => null');
  assert.equal(only.status, 1, 'CONTROL: refused with nothing left alone is still exit 1. ' + only.stderr);
});

test('#6713: ensureStatusLine takes a reason string or null for leaveAlone; anything else leaves the file alone', (t) => {
  const home = realHome(t);
  const settings = path.join(home, '.claude-account-i6713', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true }); fs.writeFileSync(settings, '{}\n');
  const node = path.join(home, 'node'); fs.writeFileSync(node, '');
  const script = path.join(home, 'kosmos-statusline.js'); fs.writeFileSync(script, '');
  const r = allowance.ensureStatusLine(settings, { leaveAlone: () => null, node, script });
  assert.equal(r.wired, false); assert.equal(typeof r.because, 'string', 'the reason is a sentence, never the function');
  assert.equal(fs.readFileSync(settings, 'utf8'), '{}\n');
});

test('#6713: setup.sh fails closed when the bundle it just extracted cannot load the rule', (t) => {
  const home = realHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true }); fs.writeFileSync(settings, '{}\n');
  const kh = path.join(home, '.local', 'share', 'kosmos');
  bundleAt(kh);
  fs.writeFileSync(path.join(kh, 'app', 'engine', 'installroot.js'), 'throw new Error("broken module");\n');
  const r = runSetupHooks(home, kh);
  assert.equal(r.status, 20, 'nothing wired: exit 20. ' + r.stderr);
  assert.doesNotMatch(fs.readFileSync(settings, 'utf8'), /kosmos-report-hook/, 'the hooks were not written');
});
