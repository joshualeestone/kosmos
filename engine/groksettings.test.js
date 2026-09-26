'use strict';

/* #3391: engine/groksettings.js (the report-hook file writer for a grok agent) and
   bin/grok-report-bridge.js (the event -> report mapping). Grok has no auth pre-seed
   (the env key suffices) and its hooks live in a file WE own, so this is simpler than
   the gemini pair: an idempotent write of our own file, never a merge into a shared
   one. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const groksettings = require('./groksettings');
const bridge = require('../bin/grok-report-bridge');

const BRIDGE = '/opt/kosmos/app/bin/grok-report-bridge.js';

function tmpHookFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groksettings-'));
  return { dir, file: path.join(dir, 'hooks', 'kosmos-report-bridge.json') };
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('a fresh hook file gets every report event wired to the bridge', () => {
  const { file } = tmpHookFile();
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, true);
  assert.equal(r.changed, true);
  const s = readJSON(file);
  for (const ev of groksettings.HOOK_EVENTS) {
    assert.ok(Array.isArray(s.hooks[ev]), `${ev} missing`);
    assert.ok(s.hooks[ev].some((d) => d.hooks.some((h) => h.type === 'command' && h.command.includes('grok-report-bridge'))),
      `${ev} not pointed at the bridge`);
  }
  // The command is the posix shell form running node against the bridge.
  assert.equal(s.hooks.Stop[0].hooks[0].command, `node "${BRIDGE}"`);
});

test('CLAUDE.md #5: the writer\'s HOOK_EVENTS equal the bridge\'s mapped events, by shape', () => {
  // Two derivations of one fact (which events fire the bridge, and which events the
  // bridge maps to a state). Drift would silently drop a report or wire a dead hook.
  const writerEvents = [...groksettings.HOOK_EVENTS].sort();
  const bridgeEvents = Object.keys(bridge.STATE_FOR_EVENT).sort();
  assert.deepEqual(writerEvents, bridgeEvents,
    'groksettings.HOOK_EVENTS and grok-report-bridge STATE_FOR_EVENT keys have drifted');
});

test('a second run is a no-op (idempotent by content)', () => {
  const { file } = tmpHookFile();
  groksettings.ensurePrepared(file, BRIDGE);
  const before = fs.readFileSync(file, 'utf8');
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, true);
  assert.equal(r.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a no-op run must not rewrite the file');
});

test('our own file at a STALE bridge path is rewritten to the current one', () => {
  const { file } = tmpHookFile();
  const old = '/old/path/grok-report-bridge.js';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${old}"` }] }] } }, null, 2) + '\n');
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.changed, true);
  const s = readJSON(file);
  const cmds = s.hooks.Stop.flatMap((d) => d.hooks.map((h) => h.command));
  assert.ok(cmds.includes(`node "${BRIDGE}"`), 'the stale entry was not repointed to the new bridge');
  assert.ok(!cmds.some((c) => c.includes(old)), 'the stale bridge path was left behind');
});

test('a file at our path that is NOT ours (no bridge marker) is left alone', () => {
  const { file } = tmpHookFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const theirs = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-own-thing' }] }] } }, null, 2);
  fs.writeFileSync(file, theirs);
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, false);
  assert.match(r.because, /not ours/);
  assert.equal(fs.readFileSync(file, 'utf8'), theirs, 'someone else\'s file at that path must not be overwritten');
});

test('a valid-JSON ARRAY or PRIMITIVE at our path is NOT ours and is left alone (#3391 iter3)', () => {
  // The ownership guard confirms our marker POSITIVELY; a valid-JSON array or a bare
  // primitive is not a plain object, so an "is it a plain object? then check marker"
  // shape would fall through to the rewrite and clobber it. Pin that it does not.
  for (const body of ['[1,2,3]', '"just a string"', '42', 'true', 'null']) {
    const { file } = tmpHookFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    const r = groksettings.ensurePrepared(file, BRIDGE);
    assert.equal(r.prepared, false, `${body} at our path must be refused, not overwritten`);
    assert.match(r.because, /not ours/);
    assert.equal(fs.readFileSync(file, 'utf8'), body, `${body} must be left byte-for-byte alone`);
  }
});

test('an UNPARSEABLE file at our path is left alone, not overwritten (never-clobber over self-heal)', () => {
  const { file } = tmpHookFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const garbage = '{ this is not json';
  fs.writeFileSync(file, garbage);
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.prepared, false, 'we cannot confirm an unparseable file is ours, so it is left alone');
  assert.match(r.because, /not ours/);
  assert.equal(fs.readFileSync(file, 'utf8'), garbage, 'an unparseable file must not be overwritten');
});

test('an absent bridge path is refused', () => {
  const { file } = tmpHookFile();
  const r = groksettings.ensurePrepared(file, null);
  assert.equal(r.prepared, false);
  assert.match(r.because, /not on this machine/);
  assert.ok(!fs.existsSync(file), 'nothing should have been written');
});

test('an ephemeral bridge path is refused for a durable hook file (#1582 class)', () => {
  const durable = path.join(os.homedir(), '.grok-3391-test-should-not-write', 'hooks', 'kosmos-report-bridge.json');
  const ephemeralBridge = path.join(os.tmpdir(), 'cut-sandbox', 'grok-report-bridge.js');
  const r = groksettings.ensurePrepared(durable, ephemeralBridge);
  assert.equal(r.prepared, false);
  assert.match(r.because, /ephemeral/);
  assert.ok(!fs.existsSync(durable), 'nothing should have been written to the durable path');
});

test('a bridge path with a shell-hostile character is refused', () => {
  const { file } = tmpHookFile();
  const r = groksettings.ensurePrepared(file, '/x/"; rm -rf ~/grok-report-bridge.js');
  assert.equal(r.prepared, false);
  assert.match(r.because, /characters we will not embed/);
});

test('the file mode is preserved across a rewrite of our own file', () => {
  const { file } = tmpHookFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // seed an OURS file (has the marker) at a stale path, mode 600, so the rewrite path runs
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/old/grok-report-bridge.js"' }] }] } }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600); // defeat umask so the precondition is exact
  const r = groksettings.ensurePrepared(file, BRIDGE);
  assert.equal(r.changed, true, 'the rewrite must have happened (stale path -> current)');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the mode was not carried onto the rewritten file');
});

test('a dangling symlink is refused rather than replaced', () => {
  const { dir, file } = tmpHookFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const link = path.join(dir, 'hooks', 'link.json');
  fs.symlinkSync(path.join(dir, 'hooks', 'does-not-exist.json'), link);
  const r = groksettings.ensurePrepared(link, BRIDGE);
  assert.equal(r.prepared, false);
  assert.match(r.because, /link pointing at nothing/);
  assert.ok(!fs.existsSync(path.join(dir, 'hooks', 'does-not-exist.json')),
    'a dangling symlink target must not be created (that would sever someone\'s arrangement)');
});

// ---- bin/grok-report-bridge.js: the event -> report mapping ----

test('the bridge maps each grok lifecycle event to the right state', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'SessionStart', source: 'new' }).state, 'started');
  assert.equal(bridge.reportFor({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }).state, 'working');
  assert.equal(bridge.reportFor({ hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'done' }).state, 'idle');
  assert.equal(bridge.reportFor({ hook_event_name: 'StopCancelled', reason: 'user_interrupt' }).state, 'idle');
  assert.equal(bridge.reportFor({ hook_event_name: 'StopFailure', reason: 'api_error' }).state, 'idle');
  assert.equal(bridge.reportFor({ hook_event_name: 'SessionEnd', reason: 'quit' }).state, 'stopped');
});

test('the bridge ignores an unmapped event rather than guessing', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'PreToolUse', tool_name: 'run_terminal_command' }), null);
  assert.equal(bridge.reportFor({ hook_event_name: 'PostToolUse' }), null);
  // #4006: Notification is ignored too; under --always-approve it is the turn-end wait, not a permission prompt.
  assert.equal(bridge.reportFor({ hook_event_name: 'Notification', message: 'Waiting for your next prompt' }), null);
  assert.equal(bridge.reportFor({}), null);
  assert.equal(bridge.reportFor(null), null);
});

test('idle carries the last words (lastAssistantMessage)', () => {
  assert.equal(bridge.reportFor({ hook_event_name: 'Stop', lastAssistantMessage: 'the answer' }).text, 'the answer');
  assert.equal(bridge.reportFor({ hook_event_name: 'Stop' }).text, '', 'an interrupted/failed turn carries no last words, which is correct');
  assert.equal(bridge.reportFor({ hook_event_name: 'StopCancelled' }).text, '');
});

test('buildBody carries auto:true for every state and reads from_pane from env (#1456)', () => {
  for (const state of ['started', 'working', 'idle', 'needs_you', 'stopped']) {
    const body = bridge.buildBody(state, 'x', { TMUX_PANE: '%9' });
    assert.equal(body.auto, true, `${state} without auto:true lets a turn ending erase a deliberate blocked (#1456)`);
    assert.equal(body.from_pane, '%9');
  }
});
