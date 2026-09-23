'use strict';

/* #3296: engine/geminisettings.js (the auth pre-seed + report-hook merge) and
   bin/gemini-report-bridge.js (the event -> report mapping). */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const geminisettings = require('./geminisettings');
const bridge = require('../bin/gemini-report-bridge');

const BRIDGE = '/opt/kosmos/app/bin/gemini-report-bridge.js';

function tmpSettings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemsettings-'));
  return { dir, file: path.join(dir, 'settings.json') };
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('a fresh settings.json gets the auth pre-seed and all five report hooks', () => {
  const { file } = tmpSettings();
  const r = geminisettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, true);
  assert.equal(r.changed, true);
  const s = readJSON(file);
  assert.equal(s.security.auth.selectedType, 'gemini-api-key');
  for (const ev of geminisettings.HOOK_EVENTS) {
    assert.ok(Array.isArray(s.hooks[ev]), `${ev} missing`);
    assert.ok(s.hooks[ev].some((d) => d.hooks.some((h) => h.type === 'command' && h.command.includes('gemini-report-bridge'))),
      `${ev} not pointed at the bridge`);
  }
  // The command is the posix shell form running node against the bridge.
  assert.equal(s.hooks.AfterAgent[0].hooks[0].command, `node "${BRIDGE}"`);
});

test('a second run is a no-op (idempotent)', () => {
  const { file } = tmpSettings();
  geminisettings.ensurePrepared(file, BRIDGE);
  const before = fs.readFileSync(file, 'utf8');
  const r = geminisettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, true);
  assert.equal(r.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a no-op run must not rewrite the file');
});

test('a person\'s own settings and non-ours hooks are preserved (merge, never clobber)', () => {
  const { file } = tmpSettings();
  fs.writeFileSync(file, JSON.stringify({
    theme: 'dark',
    security: { auth: { enforcedType: 'gemini-api-key' }, sandbox: true },
    hooks: { AfterAgent: [{ hooks: [{ type: 'command', command: 'my-own-thing' }] }] },
  }, null, 2));
  const r = geminisettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.changed, true);
  const s = readJSON(file);
  assert.equal(s.theme, 'dark', 'a top-level key was lost');
  assert.equal(s.security.sandbox, true, 'a sibling security key was lost');
  assert.equal(s.security.auth.enforcedType, 'gemini-api-key', 'a sibling auth key was lost');
  assert.equal(s.security.auth.selectedType, 'gemini-api-key', 'the pre-seed was not added');
  // Our hook is ADDED beside the person's, not on top of it.
  const cmds = s.hooks.AfterAgent.flatMap((d) => d.hooks.map((h) => h.command));
  assert.ok(cmds.includes('my-own-thing'), 'the person\'s own AfterAgent hook was clobbered');
  assert.ok(cmds.some((c) => c.includes('gemini-report-bridge')), 'ours was not added beside it');
});

test('an entry of ours aimed at an OLD bridge path is repointed, not doubled', () => {
  const { file } = tmpSettings();
  const old = '/old/path/gemini-report-bridge.js';
  fs.writeFileSync(file, JSON.stringify({
    hooks: { AfterAgent: [{ hooks: [{ type: 'command', command: `node "${old}"` }] }] },
  }, null, 2));
  const r = geminisettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.changed, true);
  const s = readJSON(file);
  const cmds = s.hooks.AfterAgent.flatMap((d) => d.hooks.map((h) => h.command));
  assert.ok(cmds.includes(`node "${BRIDGE}"`), 'the stale entry was not repointed to the new bridge');
  assert.ok(!cmds.some((c) => c.includes(old)), 'the stale bridge path was left behind (doubled)');
});

test('an unparseable settings file is left alone', () => {
  const { file } = tmpSettings();
  fs.writeFileSync(file, '{ this is not json');
  const before = fs.readFileSync(file, 'utf8');
  const r = geminisettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, false);
  assert.match(r.because, /could not be read as JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'an unparseable file must not be overwritten');
});

test('an ephemeral bridge path is refused for a durable settings file (#1582 class)', () => {
  // A durable settings file (a real HOME, not under temp) must not be pointed at
  // a bridge inside the temp root, which vanishes when a release cut ends.
  const durable = path.join(os.homedir(), '.gemini-3296-test-should-not-write', 'settings.json');
  const ephemeralBridge = path.join(os.tmpdir(), 'cut-sandbox', 'gemini-report-bridge.js');
  const r = geminisettings.ensurePrepared(durable, ephemeralBridge);
  assert.equal(r.prepared, false);
  assert.match(r.because, /ephemeral/);
  assert.ok(!fs.existsSync(durable), 'nothing should have been written to the durable path');
});

test('a bridge path with a shell-hostile character is refused', () => {
  const { file } = tmpSettings();
  const r = geminisettings.ensurePrepared(file, '/x/"; rm -rf ~/gemini-report-bridge.js');
  assert.equal(r.prepared, false);
  assert.match(r.because, /characters we will not embed/);
});

// ---- bin/gemini-report-bridge.js: the event -> report mapping ----

test('the bridge maps each gemini lifecycle event to the right state', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'SessionStart', source: 'startup' }).state, 'started');
  assert.equal(bridge.reportFor({ hook_event_name: 'BeforeAgent', prompt: 'hi' }).state, 'working');
  assert.equal(bridge.reportFor({ hook_event_name: 'Notification', message: 'needs edit' }).state, 'needs_you');
  assert.equal(bridge.reportFor({ hook_event_name: 'AfterAgent', prompt_response: 'done' }).state, 'idle');
  assert.equal(bridge.reportFor({ hook_event_name: 'SessionEnd', reason: 'quit' }).state, 'stopped');
});

test('the bridge ignores an unobserved event rather than guessing', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'BeforeTool', tool_name: 'x' }), null);
  assert.equal(bridge.reportFor({ hook_event_name: 'Stop' }), null); // gemini rejects "Stop"; we never map it
  assert.equal(bridge.reportFor({}), null);
  assert.equal(bridge.reportFor(null), null);
});

test('idle carries the last words; needs_you always carries a non-empty reason', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'AfterAgent', prompt_response: 'the answer' }).text, 'the answer');
  assert.equal(bridge.reportFor({ hook_event_name: 'AfterAgent' }).text, '');
  // needs_you with no message still gets a reason (the route refuses an empty one).
  assert.ok(bridge.reportFor({ hook_event_name: 'Notification' }).text.length > 0);
  assert.equal(bridge.reportFor({ hook_event_name: 'Notification', message: 'confirm exec' }).text, 'confirm exec');
});
