'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
/**
 * kosmos#6548: remote.json (the account's email and this computer's device ids) is written owner-only, whatever the
 * umask, and a file left readable by an earlier version is owner-only again after the next save.
 * Sandboxed data root and a FAKE tunnel program before the require; nothing reaches a network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-remote-6548-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = nodePath.join(SANDBOX, 'not-enrolled');
fs.mkdirSync(STATE, { recursive: true });
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;   // not enrolled, so the switch starts no tunnel
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
fs.writeFileSync(FAKE_BIN, "#!/usr/bin/env node\nprocess.stdout.write('{}\\n');\n", { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;

const remote = require('./remote');
const modeOf = (f) => fs.statSync(f).mode & 0o777;

test('#6548: a save writes remote.json owner-only even under a permissive umask', { skip: process.platform === 'win32' }, () => {
  const old = process.umask(0o000);   // the widest umask: a mode-less open would land rw-rw-rw-
  try {
    assert.equal(remote.setOn(true).ok, true);
  } finally { process.umask(old); }
  assert.equal(modeOf(remote.FILE), 0o600, 'remote.json is owner-only');
});

test('#6548: a remote.json an earlier version left readable is owner-only after the next save', { skip: process.platform === 'win32' }, () => {
  fs.chmodSync(remote.FILE, 0o644);
  assert.equal(modeOf(remote.FILE), 0o644, 'CONTROL: the file starts readable by others');
  assert.equal(remote.setOn(false).ok, true);
  assert.equal(modeOf(remote.FILE), 0o600, 'the next save makes it owner-only');
});
