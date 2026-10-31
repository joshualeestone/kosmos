'use strict';
/**
 * kosmos#4903 S5: engine/cloudmachine.js says a board is a Kosmos cloud machine only on Linux, and only when the
 * installer's latch (an empty regular file named `hosted` in the tunnel's state dir) is there.
 *
 *   node --test engine/cloudmachine-4903.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isCloudMachine, LATCH } = require('./cloudmachine');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudmachine-4903-'));

test('a Linux board with the installer\'s latch is a cloud machine; without it, it is not', () => {
  const d = dir();
  assert.equal(isCloudMachine({ platform: 'linux', stateDir: d }), false, 'CONTROL: no latch');
  fs.writeFileSync(path.join(d, LATCH), '', { mode: 0o600 });
  assert.equal(isCloudMachine({ platform: 'linux', stateDir: d }), true);
});

test('a Mac or a PC is never a cloud machine, latch or not', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, LATCH), '');
  assert.equal(isCloudMachine({ platform: 'darwin', stateDir: d }), false);
  assert.equal(isCloudMachine({ platform: 'win32', stateDir: d }), false);
});

test('only a regular file counts: a symlink or a folder named like the latch does not', () => {
  const d = dir();
  const real = path.join(dir(), 'elsewhere');
  fs.writeFileSync(real, '');
  fs.symlinkSync(real, path.join(d, LATCH));
  assert.equal(isCloudMachine({ platform: 'linux', stateDir: d }), false, 'a symlink was taken for the latch');
  const d2 = dir();
  fs.mkdirSync(path.join(d2, LATCH));
  assert.equal(isCloudMachine({ platform: 'linux', stateDir: d2 }), false, 'a folder was taken for the latch');
});

test('with no state dir given it reads the tunnel\'s own (AGENT_WORKFORCE_TUNNEL_STATE), as kosmos-tunnel does', () => {
  const d = dir();
  const prev = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = d;
  try {
    assert.equal(isCloudMachine({ platform: 'linux' }), false, 'CONTROL: no latch there yet');
    fs.writeFileSync(path.join(d, LATCH), '');
    assert.equal(isCloudMachine({ platform: 'linux' }), true);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_STATE; else process.env.AGENT_WORKFORCE_TUNNEL_STATE = prev;
  }
});

test('review 2: emptying the tunnel\'s state dir (Remove, or a fresh sign-in) keeps the latch, and only the latch of ours', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, LATCH), '');
  fs.writeFileSync(path.join(d, 'mac_id'), 'mac-1');
  fs.writeFileSync(path.join(d, 'identity.key'), 'k');
  const prev = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = d;
  try {
    require('./remote').clearStateDir([]);
    assert.equal(fs.existsSync(path.join(d, LATCH)), true, 'the latch went with the identity: the box would stop being a cloud machine for good');
    assert.equal(fs.existsSync(path.join(d, 'mac_id')), false, 'CONTROL: the identity was not cleared');
    assert.equal(fs.existsSync(path.join(d, 'identity.key')), false, 'CONTROL: the key was not cleared');
    assert.equal(isCloudMachine({ platform: 'linux' }), true);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_STATE; else process.env.AGENT_WORKFORCE_TUNNEL_STATE = prev;
  }
});
