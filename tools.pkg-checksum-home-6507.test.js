'use strict';

/**
 * #6507: tools/test-pkg-checksum-1670.sh went red on one Mac only. Two of its arms ran the postinstall block with the
 * REAL $HOME, and that Mac's own Kosmos (0.7.57) has the installed checker, so the block handed off to it; a Mac on an
 * older install passed. The test now sandboxes HOME for the whole run. This runs that test with HOME pointed at a decoy
 * home holding a checker-capable install, which is exactly the condition it missed, and expects it still to pass.
 *
 *   node --test tools.pkg-checksum-home-6507.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAC = process.platform === 'darwin' || 'the .pkg postinstall test is macOS-only';

test('the .pkg checksum test passes even when the person running it has a Kosmos install with the checker', { skip: MAC === true ? false : MAC, timeout: 240000 }, () => {
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6507-decoy-home-'));
  try {
    const k = path.join(decoy, '.local', 'share', 'kosmos');
    fs.mkdirSync(path.join(k, 'app', 'engine'), { recursive: true });
    fs.mkdirSync(path.join(k, 'runtime', 'bin'), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(k, 'runtime', 'bin', 'node'));
    fs.writeFileSync(path.join(k, 'app', 'package.json'), JSON.stringify({ version: '9.9.9' }) + '\n');
    fs.copyFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), path.join(k, 'app', 'engine', 'manifest-verify.js'));
    // The decoy must be one the postinstall WOULD hand off to, or this proves nothing.
    assert.match(fs.readFileSync(path.join(k, 'app', 'engine', 'manifest-verify.js'), 'utf8'), /run-setup/);
    const r = spawnSync('/bin/bash', [path.join(__dirname, 'tools', 'test-pkg-checksum-1670.sh')], {
      encoding: 'utf8', env: { ...process.env, HOME: decoy }, timeout: 230000,
    });
    assert.equal(r.status, 0, (r.stdout + r.stderr).split('\n').filter((l) => /^FAIL/.test(l)).join('\n') || r.stdout.slice(-2000));
    assert.match(r.stdout, /all checks passed/);
  } finally {
    fs.rmSync(decoy, { recursive: true, force: true });
  }
});
