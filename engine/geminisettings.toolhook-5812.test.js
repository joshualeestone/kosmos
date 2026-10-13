'use strict';
/* #5812: the gemini settings carry one TOOL hook as well, BeforeTool with matcher write_file|replace, running the same
 * bridge as the five lifecycle hooks, written with the same merge-only, idempotent, repoint-if-moved rules.
 *   node --test engine/geminisettings.toolhook-5812.test.js */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gs = require('./geminisettings');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs5812-'));
let n = 0;
const fresh = () => path.join(TMP, 'h' + (n++), 'settings.json');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const BRIDGE = '/opt/k/bin/gemini-report-bridge.js';

test('a fresh settings file gets the BeforeTool hook with its matcher, beside the five lifecycle hooks', () => {
  const f = fresh();
  assert.equal(gs.ensurePrepared(f, BRIDGE).prepared, true);
  const h = read(f).hooks;
  assert.deepEqual(h.BeforeTool, [{ matcher: '^(write_file|replace)$', hooks: [{ type: 'command', command: 'node "' + BRIDGE + '"' }] }]);
  for (const e of gs.HOOK_EVENTS) assert.equal(h[e].length, 1, e + ' still has exactly one entry');
  assert.equal(h[gs.HOOK_EVENTS[0]][0].matcher, undefined, 'the lifecycle hooks carry no matcher');
});

test('a second run changes nothing', () => {
  const f = fresh();
  gs.ensurePrepared(f, BRIDGE);
  const before = fs.readFileSync(f, 'utf8');
  assert.equal(gs.ensurePrepared(f, BRIDGE).changed, false);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('a moved bridge repoints the tool hook too', () => {
  const f = fresh();
  gs.ensurePrepared(f, BRIDGE);
  assert.equal(gs.ensurePrepared(f, '/new/place/bin/gemini-report-bridge.js').changed, true);
  const t = read(f).hooks.BeforeTool;
  assert.equal(t.length, 1);
  assert.equal(t[0].hooks[0].command, 'node "/new/place/bin/gemini-report-bridge.js"');
  assert.equal(t[0].matcher, '^(write_file|replace)$');
});

test('ours with no matcher (it would start the bridge for every tool) is replaced, once', () => {
  const f = fresh();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ hooks: { BeforeTool: [
    { hooks: [{ type: 'command', command: 'node "' + BRIDGE + '"' }] },
    { hooks: [{ type: 'command', command: 'node "' + BRIDGE + '"' }] },
  ] } }));
  assert.equal(gs.ensurePrepared(f, BRIDGE).changed, true);
  assert.deepEqual(read(f).hooks.BeforeTool, [{ matcher: '^(write_file|replace)$', hooks: [{ type: 'command', command: 'node "' + BRIDGE + '"' }] }]);
});

test('a person\'s own BeforeTool hook is kept beside ours', () => {
  const f = fresh();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const theirs = { matcher: 'run_shell_command', hooks: [{ type: 'command', command: '/usr/local/bin/my-guard' }] };
  fs.writeFileSync(f, JSON.stringify({ hooks: { BeforeTool: [theirs] } }));
  gs.ensurePrepared(f, BRIDGE);
  const t = read(f).hooks.BeforeTool;
  assert.deepEqual(t[0], theirs, 'theirs untouched, first');
  assert.equal(t.length, 2);
  assert.equal(t[1].matcher, '^(write_file|replace)$');
  assert.equal(gs.ensurePrepared(f, BRIDGE).changed, false, 'and the next run leaves both alone');
});

test('on win32 the tool hook uses the PowerShell form, like the lifecycle hooks', () => {
  const f = fresh();
  gs.ensurePrepared(f, 'C:\\K\\bin\\gemini-report-bridge.js', { platform: 'win32', node: 'C:\\K\\runtime\\node.exe' });
  const h = read(f).hooks;
  assert.equal(h.BeforeTool[0].hooks[0].command, h.SessionStart[0].hooks[0].command);
  assert.equal(h.BeforeTool[0].hooks[0].command, "& 'C:\\K\\runtime\\node.exe' 'C:\\K\\bin\\gemini-report-bridge.js'");
});

test('ONE entry of ours with the wrong matcher, or none, is corrected (it would start the bridge for other tools)', () => {
  for (const wrong of [undefined, 'run_shell_command', 'write_file']) {
    const f = fresh();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const entry = { hooks: [{ type: 'command', command: 'node "' + BRIDGE + '"' }] };
    if (wrong) entry.matcher = wrong;
    fs.writeFileSync(f, JSON.stringify({ hooks: { BeforeTool: [entry] } }));
    assert.equal(gs.ensurePrepared(f, BRIDGE).changed, true, String(wrong));
    assert.equal(read(f).hooks.BeforeTool[0].matcher, '^(write_file|replace)$', String(wrong));
  }
});
