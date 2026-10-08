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
  const before = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = home;
  t.after(() => {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = before;
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
  const wire = src.indexOf("require('./engine/accounts').wireDefaultHooks()");
  assert.ok(migrate > 0, 'the anchor moved: communityswitch.migrate() is not in server.js');
  assert.ok(wire > migrate && wire - migrate < 1200, 'server.js does not wire the default hooks right after the community switch step');
});
