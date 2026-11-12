'use strict';
/**
 * kosmos#8378: pins engine/tunnelcommand.js, the one place that says how the connector is started. A JavaScript
 * stand-in (a path ending in .js or .cjs, any case) runs as this node with the script first; any other path, a real
 * connector binary included, is started exactly as given. Runs on every host.
 */
require('../test-support/tmpscope');   // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { tunnelCommand } = require('./tunnelcommand');

const ARGS = ['mac-request', '--coordinator', 'https://coord.example.test/kosmos', '--state-dir', '/tmp/a b/remote'];

test('kosmos#8378: a .js connector runs as this node, with the script first and the arguments after it, unchanged', () => {
  const script = path.join('/tmp', 'fake-kosmos-tunnel.js');
  assert.deepStrictEqual(tunnelCommand(script, ARGS), { file: process.execPath, args: [script, ...ARGS] });
});

test('kosmos#8378: .JS and .cjs (and .CJS) are scripts too', () => {
  for (const script of ['C:\\Users\\x\\fake-kosmos-tunnel.JS', '/tmp/fake-kosmos-tunnel.cjs', '/tmp/fake-kosmos-tunnel.CJS']) {
    assert.deepStrictEqual(tunnelCommand(script, ARGS), { file: process.execPath, args: [script, ...ARGS] }, script);
  }
});

test('kosmos#8378: a script with no arguments runs as this node with only the script', () => {
  assert.deepStrictEqual(tunnelCommand('/tmp/t.js'), { file: process.execPath, args: ['/tmp/t.js'] });
});

test('kosmos#8378: a real connector (no extension, or .exe) is started as given: the same file and the same arguments array', () => {
  for (const bin of ['/Applications/Kosmos/app/bin/kosmos-tunnel', 'kosmos-tunnel', 'C:\\Kosmos\\app\\bin\\kosmos-tunnel.exe', '/tmp/kosmos-tunnel.json', '/tmp/kosmos.js-tunnel']) {
    const got = tunnelCommand(bin, ARGS);
    assert.strictEqual(got.file, bin, bin);
    assert.strictEqual(got.args, ARGS, `${bin}: the arguments must be the very array given, not a copy`);
  }
});

test('kosmos#8378: a .js stand-in really starts through tunnelCommand and receives its arguments (on Windows too)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnelcmd-8378-'));
  try {
    const script = path.join(dir, 'fake-kosmos-tunnel.js');
    fs.writeFileSync(script, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const cmd = tunnelCommand(script, ['capabilities', '--state-dir', 'a b']);
    const out = execFileSync(cmd.file, cmd.args, { encoding: 'utf8', windowsHide: true });
    assert.deepStrictEqual(JSON.parse(out), ['capabilities', '--state-dir', 'a b']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
