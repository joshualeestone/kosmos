'use strict';
/**
 * kosmos#5612: on Windows nothing wired the DEFAULT Claude account's reporting hooks (install/setup.sh does it on a
 * Mac, accounts.prepare for an added account), so a Windows agent on the default account never reported idle and the
 * community turn, which prompts only agents whose report says idle, skipped every one of them. The board now wires
 * them at start on win32 (accounts.wireDefaultHooks). These run on any OS: the platform is injected.
 *
 *   node --test engine/accounts.wiredefaulthooks-5612.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const accounts = require('./accounts');
const reporthook = require('./reporthook');

/* A home of our own for one test (homeDir() reads AGENT_WORKFORCE_HOME on every call), with a stand-in hook script
   and node, all under the temp root, so the ephemeral-path refusal sees no mismatch (both sides are temp). */
function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5612-'));
  // trust.defaultAgentSettings() reads AGENT_WORKFORCE_CLAUDE_SETTINGS first (other tests set it), so clear it here.
  const saved = { home: process.env.AGENT_WORKFORCE_HOME, settings: process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS };
  process.env.AGENT_WORKFORCE_HOME = home;
  delete process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS;
  t.after(() => {
    if (saved.home === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = saved.home;
    if (saved.settings !== undefined) process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = saved.settings;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const script = path.join(home, 'app', 'engine', 'kosmos-report-hook.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '// stand-in\n');
  const node = path.join(home, 'runtime', 'node.exe');
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(node, '');
  return { home, script, node, settings: path.join(home, '.claude', 'settings.json') };
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('#5612: on win32 the default account gets every reporting hook, in the exec form, and a second run changes nothing', (t) => {
  const s = sandbox(t);
  assert.equal(fs.existsSync(s.settings), false, 'precondition: a fresh machine has no settings file');
  const first = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.deepEqual(first, { wired: true, changed: true, skipped: false });
  const hooks = read(s.settings).hooks;
  for (const event of reporthook.HOOK_EVENTS) {
    const ours = (hooks[event] || []).flatMap((e) => e.hooks || []).filter((h) => h.command === s.node);
    assert.equal(ours.length, 1, `${event}: not wired`);
    assert.deepEqual(ours[0].args, [s.script], `${event}: the script is not the exec-form argument`);
  }
  // The Stop hook is the one that writes idle, which the community turn waits for.
  assert.ok(reporthook.HOOK_EVENTS.includes('Stop'), 'the hook events no longer include Stop');
  const again = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.deepEqual(again, { wired: true, changed: false, skipped: false });
});

test('#5612: a person\'s own hook and settings in the default file survive the wiring', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.dirname(s.settings), { recursive: true });
  const theirs = { type: 'command', command: 'C:\\tools\\mine.exe' };
  fs.writeFileSync(s.settings, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [theirs] }] } }));
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.equal(r.wired, true, JSON.stringify(r));
  const after = read(s.settings);
  assert.equal(after.model, 'opus', 'another setting was dropped');
  const stop = after.hooks.Stop.flatMap((e) => e.hooks || []);
  assert.ok(stop.some((h) => h.command === 'C:\\tools\\mine.exe'), 'the person\'s Stop hook was removed');
  assert.ok(stop.some((h) => h.command === s.node), 'ours was not added beside it');
});

test('#5612: with nothing injected, win32 wires the real script beside the engine (the one the Windows zip ships)', (t) => {
  const s = sandbox(t);
  const r = accounts.wireDefaultHooks({ platform: 'win32', node: s.node });
  assert.equal(r.wired, true, JSON.stringify(r));
  const want = path.resolve(__dirname, 'kosmos-report-hook.js');
  assert.ok(fs.existsSync(want), 'precondition: engine/kosmos-report-hook.js exists');
  const stop = read(s.settings).hooks.Stop.flatMap((e) => e.hooks || []).filter((h) => h.command === s.node);
  assert.deepEqual(stop.map((h) => h.args), [[want]]);
});

test('#5612: it takes the settings file lock that trust.preacceptBypass takes, so the two writers cannot drop each other', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.dirname(s.settings), { recursive: true });
  fs.mkdirSync(s.settings + '.lock');   // a writer holding it (a fresh lock, not a stale one)
  const wait = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '100';   // withFileLock's wait seam: refuse after 0.1 s, not 2 s
  t.after(() => {
    if (wait === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = wait;
    fs.rmSync(s.settings + '.lock', { recursive: true, force: true });
  });
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.equal(r.wired, false, JSON.stringify(r));
  assert.match(String(r.because), /another writer/);
  assert.equal(r.busy, true, 'a held lock is not marked busy, so the board would not try again');
  assert.equal(fs.existsSync(s.settings), false, 'it wrote while another writer held the lock');
});

test('#5612: a settings folder that refuses the lock file is a plain refusal, not busy (so the board does not retry it)', (t) => {
  // A read-only folder is how this refusal is planted, and it binds neither root nor Windows: skip there, saying so.
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
    t.skip('a read-only folder does not refuse mkdir for root or on Windows');
    return;
  }
  const s = sandbox(t);
  const dir = path.dirname(s.settings);
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o555);   // the lock folder cannot be made inside it: EACCES, which withFileLock does not wait on
  t.after(() => { try { fs.chmodSync(dir, 0o755); } catch { /* the sandbox may already be gone */ } });
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.equal(r.wired, false, JSON.stringify(r));
  assert.equal(r.busy, false, 'a refusal that will repeat was marked busy, so the board would retry it for nothing');
  assert.match(String(r.because), /refused the lock file/);
});

test('#5612: a settings folder that cannot be made is a fixed sentence that names no path', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.dirname(s.settings), 'a file where the .claude folder goes');
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node });
  assert.equal(r.wired, false, JSON.stringify(r));
  assert.notEqual(r.busy, true);
  assert.equal(String(r.because).includes(s.home), false, 'the reason leaks the home folder path');
});

test('#5612: a retry with waitMs 0 refuses a held lock at once (it never blocks a serving board), as busy', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.dirname(s.settings), { recursive: true });
  fs.mkdirSync(s.settings + '.lock');
  t.after(() => fs.rmSync(s.settings + '.lock', { recursive: true, force: true }));
  const started = Date.now();
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: s.script, node: s.node, waitMs: 0 });
  assert.equal(r.busy, true, JSON.stringify(r));
  assert.ok(Date.now() - started < 500, 'waitMs 0 still waited for the lock');
});

test('#5612: with no script it refuses before making any folder', (t) => {
  const s = sandbox(t);
  accounts.wireDefaultHooks({ platform: 'win32', script: null, node: s.node });
  assert.equal(fs.existsSync(path.dirname(s.settings)), false, 'a refusal made the .claude folder anyway');
});

test('#5612: off Windows it does nothing (setup.sh owns the Mac), and writes no file', (t) => {
  const s = sandbox(t);
  for (const platform of ['darwin', 'linux']) {
    const r = accounts.wireDefaultHooks({ platform, script: s.script, node: s.node });
    assert.equal(r.skipped, true, platform);
    assert.equal(r.wired, false, platform);
  }
  assert.equal(fs.existsSync(s.settings), false, 'a non-Windows run wrote the settings file');
});

test('#5612: with no hook script on the machine it refuses, with a reason, and never throws', (t) => {
  const s = sandbox(t);
  const r = accounts.wireDefaultHooks({ platform: 'win32', script: null, node: s.node });
  assert.equal(r.wired, false);
  assert.equal(r.skipped, false);
  assert.match(String(r.because), /script/);
  assert.equal(fs.existsSync(s.settings), false);
});

test('#5612: the board calls it on its real start path (beside the community switch\'s one-time step)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const migrate = src.indexOf('communityswitch.migrate();');
  const wire = src.indexOf('accounts.wireDefaultHooks(');
  assert.ok(src.includes('wireDefaultHooksTry(5);'), 'the board does not start the wiring (with its retries)');
  assert.ok(migrate > 0, 'the anchor moved: communityswitch.migrate() is not in server.js');
  assert.ok(wire > migrate, 'server.js does not wire the default hooks after the community switch step');
});
