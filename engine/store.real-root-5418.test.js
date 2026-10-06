'use strict';
/**
 * kosmos#5418: a test process never gets this machine's real data root. Each arm runs a child
 * node with a controlled environment and only reads store.ROOT (nothing is written; the legacy
 * migration is off in every arm).
 *
 *   node --test engine/store.real-root-5418.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STORE = path.join(__dirname, 'store.js');
const SANDBOX_VARS = ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_HOME', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_RUN', 'KOSMOS_ALLOW_REAL_ROOT'];

function rootIn(extra) {
  const env = Object.assign({}, process.env);
  for (const k of SANDBOX_VARS) delete env[k];
  env.HOME = os.userInfo().homedir;   // the real home, unless an arm points it elsewhere
  env.KOSMOS_NO_LEGACY_MIGRATION = '1';
  Object.assign(env, extra);
  const r = spawnSync(process.execPath, ['-e', 'try { process.stdout.write("ROOT=" + require(' + JSON.stringify(STORE) + ').ROOT) } catch (e) { process.stdout.write("THREW=" + e.message) }'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const realRoot = () => require('./store').dataRootFor(process.platform, os.userInfo().homedir, { APPDATA: process.env.APPDATA });

test('#5418: a node --test process with no sandbox is refused the real root, by name', () => {
  const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8' });
  assert.match(out, /^THREW=store: a test process resolved this machine's REAL data root/, out);
  assert.match(out, /#5418/);
});

test('#5418: a tools/run-tests.sh process (KOSMOS_TEST_RUN=1) with no sandbox is refused too', () => {
  assert.match(rootIn({ KOSMOS_TEST_RUN: '1' }), /^THREW=/);
});

test('#5418: a sandboxed test process gets its sandbox (AGENT_WORKFORCE_DATA, or AGENT_WORKFORCE_HOME)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-'));
  try {
    assert.equal(rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_DATA: tmp }), 'ROOT=' + path.join(tmp, require('./store').APP));
    assert.match(rootIn({ NODE_TEST_CONTEXT: 'child-v8', AGENT_WORKFORCE_HOME: tmp }), new RegExp('^ROOT=' + tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418: a test that sandboxes by pointing HOME elsewhere is NOT refused (the real home comes from the user database)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr5418-home-'));
  try {
    const out = rootIn({ NODE_TEST_CONTEXT: 'child-v8', HOME: tmp });
    assert.match(out, /^ROOT=/, out);
    assert.ok(!out.includes(os.userInfo().homedir + path.sep), out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('#5418 control: outside a test process the real root is returned as before', () => {
  assert.equal(rootIn({}), 'ROOT=' + realRoot());
});

test('#5418 control: KOSMOS_ALLOW_REAL_ROOT=1 lets a test process read the real root on purpose', () => {
  assert.equal(rootIn({ NODE_TEST_CONTEXT: 'child-v8', KOSMOS_ALLOW_REAL_ROOT: '1' }), 'ROOT=' + realRoot());
});
