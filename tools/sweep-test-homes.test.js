'use strict';
/**
 * kosmos#5418: tools/sweep-test-homes.sh removes only throwaway test homes whose process is gone.
 * Every arm runs the script with TMPDIR pointed at a fresh scratch folder, never the real one.
 *
 *   node --test tools/sweep-test-homes.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'sweep-test-homes.sh');
const store = require('../engine/store');

/* A pid no process has: above the usual pid range, and checked dead before use. */
function deadPid() {
  for (let p = 4194000; p < 4194300; p++) { try { process.kill(p, 0); } catch (e) { if (e.code === 'ESRCH') return p; } }
  throw new Error('no free pid found for the dead-process arm');
}

test('#5418: the sweep removes a dead process\'s throwaway and keeps a live one, a malformed name and anything else', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep5418-'));
  try {
    const dead = path.join(tmp, store.TEST_HOME_PREFIX + deadPid() + '-AAAAAA');
    const live = path.join(tmp, store.TEST_HOME_PREFIX + process.pid + '-BBBBBB');
    const junk = path.join(tmp, store.TEST_HOME_PREFIX + 'notapid');
    const other = path.join(tmp, 'other-folder');
    for (const d of [dead, live, junk, other]) fs.mkdirSync(path.join(d, 'Library'), { recursive: true });
    const r = spawnSync('bash', [SCRIPT], { env: Object.assign({}, process.env, { TMPDIR: tmp }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(dead), false, 'the dead process\'s throwaway was kept');
    assert.equal(fs.existsSync(live), true, 'a live process\'s throwaway was removed');
    assert.equal(fs.existsSync(junk), true, 'a name with no pid was removed');
    assert.equal(fs.existsSync(other), true, 'a folder outside the prefix was removed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: the sweep\'s prefix is the store\'s TEST_HOME_PREFIX', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, new RegExp('^PREFIX=' + store.TEST_HOME_PREFIX + '$', 'm'));
});

test('#5418: tools/run-tests.sh runs the sweep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'run-tests.sh'), 'utf8');
  assert.match(src, /^bash "\$REPO\/tools\/sweep-test-homes\.sh"$/m);
});
