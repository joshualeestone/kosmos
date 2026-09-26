'use strict';

/*
 * kosmos#3605 -- a test can never write a job file into the operator's real
 * ~/Library/LaunchAgents. On 2026-09-24 a suite from a checkout that predated
 * #3011 leaked five codex* plists; another branch's run was blamed by the
 * after-the-fact guard, and launchd loaded the five at the next login.
 * create.js now refuses the write itself under `node --test`.
 *
 * NO ARM HERE WRITES TO THE REAL FOLDER, even if the refusal is broken: the
 * write arm swaps fs.writeFileSync for a recorder first, so a broken guard shows
 * up as a recorded write, never as a file in launchd's folder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-launch-refuse-3605-'));
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');

const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('./create');

test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const REAL = path.join(os.userInfo().homedir, 'Library', 'LaunchAgents');
const UNDER_TEST = { NODE_TEST_CONTEXT: 'child-v8' };

test('#3605: this file itself runs with NODE_TEST_CONTEXT set (the premise the guard keys on)', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test must set NODE_TEST_CONTEXT, or the guard never arms');
});

test('#3605: the real dir is the account home from the password database, not $HOME', () => {
  const saved = process.env.HOME;
  process.env.HOME = SANDBOX;
  try {
    assert.equal(create.realLaunchAgentsDir(), REAL);
    assert.notEqual(create.realLaunchAgentsDir(), path.join(SANDBOX, 'Library', 'LaunchAgents'));
  } finally { process.env.HOME = saved; }
});

test('#3605: under test, a write into the real LaunchAgents is refused with a named cause', () => {
  assert.throws(
    () => create.refuseRealLaunchWriteUnderTest(path.join(REAL, 'com.kosmos.agent.x.plist'), UNDER_TEST),
    (e) => /#3605/.test(e.message) && /AGENT_WORKFORCE_LAUNCH/.test(e.message));
  // A non-normalised spelling of the same folder is still the same folder.
  assert.throws(() => create.refuseRealLaunchWriteUnderTest(
    path.join(REAL, '..', 'LaunchAgents', 'com.kosmos.agent.x.plist'), UNDER_TEST));
});

test('#3605: a sandboxed write under test is allowed, and so is a real write outside tests', () => {
  assert.doesNotThrow(() => create.refuseRealLaunchWriteUnderTest(
    path.join(SANDBOX, 'LaunchAgents', 'com.kosmos.agent.x.plist'), UNDER_TEST));
  // A board (no NODE_TEST_CONTEXT) installs into the real folder; the guard must not touch that.
  assert.doesNotThrow(() => create.refuseRealLaunchWriteUnderTest(
    path.join(REAL, 'com.kosmos.agent.x.plist'), {}));
});

test('#3605: writePlistFile refuses BEFORE writing (recorder, no real write possible)', () => {
  const written = [];
  const orig = fs.writeFileSync;
  fs.writeFileSync = (file) => { written.push(String(file)); };
  try {
    assert.throws(() => create.writePlistFile(path.join(REAL, 'com.kosmos.agent.x.plist'), '<plist/>'), /#3605/);
    assert.deepEqual(written, [], 'the refusal must come before any write');
    // Control: the same call into the sandbox DOES reach the writer, so the recorder can see a write.
    create.writePlistFile(path.join(SANDBOX, 'LaunchAgents', 'com.kosmos.agent.x.plist'), '<plist/>');
    assert.equal(written.length, 1);
  } finally { fs.writeFileSync = orig; }
});

test('#3605: every plist write in create.js goes through writePlistFile', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.equal((src.match(/fs\.writeFileSync\(\s*plistPath\(/g) || []).length, 0,
    'a direct fs.writeFileSync(plistPath(...)) bypasses the #3605 refusal');
  assert.ok((src.match(/writePlistFile\(plistPath\(/g) || []).length >= 3,
    'the three install/rewrite sites must write through writePlistFile');
  assert.equal((src.match(/fs\.mkdirSync\(agentsDir\(\)/g) || []).length, 0,
    'mkdir of the LaunchAgents dir must happen inside writePlistFile, after the #3605 refusal');
});

test('#3605 (the card\'s ask): the LaunchAgents dir is resolved at CALL time, not at require', () => {
  const saved = process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'A');
    assert.equal(path.dirname(create.plistPath('zed')), path.join(SANDBOX, 'A'));
    process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'B');
    assert.equal(path.dirname(create.plistPath('zed')), path.join(SANDBOX, 'B'));
  } finally { process.env.AGENT_WORKFORCE_LAUNCH = saved; }
});

/* The preload (test-support/launch-guard.js) is what stops the ~sixty tests that write
   job files THEMSELVES. It runs in a fresh child whose fs writers are recorders installed
   BEFORE the guard wraps them, so even a broken guard records a write rather than making one. */
test('#3605 preload: refuses every wrapped writer and deleter into the real LaunchAgents, before the call, and passes others through', () => {
  const { execFileSync } = require('node:child_process');
  const guard = path.join(__dirname, '..', 'test-support', 'launch-guard.js');
  const script = `
    const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require('node:url');
    const seen = [];
    const SYNC = ['writeFileSync','appendFileSync','copyFileSync','renameSync','symlinkSync','linkSync','rmSync','unlinkSync',
      'cpSync','truncateSync','createWriteStream','rmdirSync','mkdirSync'];
    const CB = ['writeFile','appendFile','copyFile','rename','symlink','link','rm','unlink','cp','truncate','rmdir'];
    const PR = ['writeFile','appendFile','copyFile','rename','symlink','link','rm','unlink','cp','truncate','rmdir'];
    fs.openSync = (...a) => { seen.push('openSync:' + a[1]); };
    fs.promises.open = async (...a) => { seen.push('p.open:' + a[1]); };
    fs.open = (...a) => { seen.push('open:' + typeof a[1]); };
    for (const n of SYNC) fs[n] = () => { seen.push(n); };
    for (const n of CB) fs[n] = (...a) => { seen.push('cb.' + n); };
    for (const n of PR) fs.promises[n] = async () => { seen.push('p.' + n); };
    require(${JSON.stringify(guard)});
    const REAL = ${JSON.stringify(REAL)}, SAFE = ${JSON.stringify(path.join(SANDBOX, 'LaunchAgents'))};
    const R = path.join(REAL, 'com.kosmos.agent.p.plist'), S = path.join(SAFE, 'com.kosmos.agent.p.plist');
    const out = {};
    const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = /#3605/.test(e.message) ? 'refused' : 'other:' + e.message; } };
    // Destination index per method: the real path goes where that method WRITES.
    const DEST1 = new Set(['copyFileSync','renameSync','symlinkSync','linkSync','copyFile','rename','symlink','link','cpSync','cp']);
    for (const n of SYNC) tryIt(n, () => DEST1.has(n) ? fs[n]('/nope', R) : fs[n](R, 'x'));
    for (const n of CB) tryIt('cb.' + n, () => DEST1.has(n) ? fs[n]('/nope', R, () => {}) : fs[n](R, () => {}));
    tryIt('rmFolderItself', () => fs.rmSync(REAL, { recursive: true, force: true }));
    tryIt('cpIntoFolder', () => fs.cpSync('/nope', REAL, { recursive: true }));
    tryIt('openWrite', () => fs.openSync(R, 'w'));
    tryIt('openAppendNum', () => fs.openSync(R, fs.constants.O_WRONLY | fs.constants.O_APPEND));
    tryIt('openRead', () => fs.openSync(R, 'r'));
    tryIt('mkdirFolder', () => fs.mkdirSync(REAL, { recursive: true }));
    tryIt('mkdirNested', () => fs.mkdirSync(path.join(REAL, 'a', 'b'), { recursive: true }));
    tryIt('rmAncestor', () => fs.rmSync(path.dirname(REAL), { recursive: true, force: true }));
    tryIt('rmHome', () => fs.rmSync(path.dirname(path.dirname(REAL)), { recursive: true, force: true }));
    tryIt('cpOntoAncestor', () => fs.cpSync('/nope', path.dirname(REAL), { recursive: true }));
    tryIt('unlinkSibling', () => fs.unlinkSync(path.join(path.dirname(REAL), 'other.plist')));
    tryIt('rmSandboxTree', () => fs.rmSync(SAFE, { recursive: true, force: true }));
    tryIt('openDefault', () => fs.openSync(R));
    tryIt('openCallbackOnly', () => fs.open(R, () => {}));
    tryIt('caseVariant', () => fs.writeFileSync(path.join(path.dirname(REAL), 'launchagents', 'p.plist'), 'x'));
    tryIt('fileUrl', () => fs.writeFileSync(pathToFileURL(R), 'x'));
    tryIt('renameFromReal', () => fs.renameSync(R, S));
    tryIt('sandbox', () => fs.writeFileSync(S, 'x'));
    Promise.all(PR.map((n) => (DEST1.has(n) ? fs.promises[n]('/nope', R) : fs.promises[n](R, 'x')).then(
      () => { out['p.' + n] = 'allowed'; }, (e) => { out['p.' + n] = /#3605/.test(e.message) ? 'refused' : 'other'; })))
      .then(() => Promise.all([
        fs.promises.open(R, 'a').then(() => { out['p.openAppend'] = 'allowed'; }, (e) => { out['p.openAppend'] = /#3605/.test(e.message) ? 'refused' : 'other'; }),
        fs.promises.open(R, 'r').then(() => { out['p.openRead'] = 'allowed'; }, () => { out['p.openRead'] = 'refused'; }),
      ]))
      .then(() => process.stdout.write(JSON.stringify({ out, seen })));
  `;
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const res = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const ALLOWED = ['renameFromReal', 'sandbox', 'openRead', 'openDefault', 'p.openRead', 'openCallbackOnly',
    'unlinkSibling', 'rmSandboxTree'];
  const refused = Object.keys(res.out).filter((k) => !ALLOWED.includes(k));
  if (process.platform !== 'darwin') refused.splice(refused.indexOf('caseVariant'), 1);
  for (const k of refused) assert.equal(res.out[k], 'refused', `${k} must be refused`);
  assert.equal(res.out.renameFromReal, 'allowed', 'moving a file OUT of the real folder is not a write into it');
  assert.equal(res.out.sandbox, 'allowed');
  assert.equal(res.out.unlinkSibling, 'allowed', 'a file beside the folder (not in it, not a tree delete) is not a target');
  assert.equal(res.out.rmSandboxTree, 'allowed', 'a recursive delete of a sandbox is not an ancestor of the real folder');
  for (const k of ['openRead', 'openDefault', 'p.openRead', 'openCallbackOnly']) assert.equal(res.out[k], 'allowed', `a read-only open (${k}) is not a write`);
  // Only the allowed calls reached the underlying function: every refusal came BEFORE the call.
  const expectSeen = ['renameSync', 'writeFileSync', 'openSync:r', 'openSync:undefined', 'p.open:r', 'open:function',
    'unlinkSync', 'rmSync'];
  if (process.platform !== 'darwin') expectSeen.unshift('writeFileSync');
  assert.deepEqual(res.seen.sort(), expectSeen.sort());
});

test('#3605: the preload and create.js agree on the real folder and on what is inside it', () => {
  const guard = require('../test-support/launch-guard');
  assert.equal(guard.realLaunchAgentsDir(), create.realLaunchAgentsDir());
  for (const p of [path.join(REAL, 'a.plist'), path.join(REAL, 'sub', 'a.plist'),
    path.join(SANDBOX, 'LaunchAgents', 'a.plist'), path.join(path.dirname(REAL), 'a.plist'), REAL]) {
    assert.equal(guard.isRealLaunchTarget(p), create.isRealLaunchTargetUnderTest(p, UNDER_TEST), p);
  }
});

test('#3605 create.js: the rollback delete skips a real-folder job file under test (recorder, no real delete possible)', () => {
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(REAL, 'com.kosmos.agent.x.plist'), UNDER_TEST), true);
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(REAL, 'com.kosmos.agent.x.plist'), {}), false);
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(SANDBOX, 'LaunchAgents', 'x.plist'), UNDER_TEST), false);
  const removed = [];
  const orig = fs.rmSync;
  fs.rmSync = (file) => { removed.push(String(file)); };
  try {
    assert.equal(create.removeJobFileForRollback(path.join(REAL, 'com.kosmos.agent.x.plist')), false);
    assert.deepEqual(removed, [], 'no delete may reach a real-folder job file under test');
    // Control: a sandboxed job file IS deleted, so the recorder can see a delete.
    const safe = path.join(SANDBOX, 'LaunchAgents', 'com.kosmos.agent.x.plist');
    assert.equal(create.removeJobFileForRollback(safe), true);
    assert.deepEqual(removed, [safe]);
  } finally { fs.rmSync = orig; }
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.equal((src.match(/fs\.rmSync\(\s*plistPath\(/g) || []).length, 0,
    'a job-file delete must go through removeJobFileForRollback');
  assert.match(src, /removeJobFileForRollback\(plistPath\(name\)\);/, 'the createAgent rollback must use it');
});

test('#3605 preload: tools/run-tests.sh loads it on the node --test line', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'run-tests.sh'), 'utf8');
  const line = sh.split('\n').find((l) => /^node --test /.test(l));
  assert.ok(line, 'run-tests.sh has no `node --test` line');
  assert.match(line, /--require "\$REPO\/test-support\/launch-guard\.js"/);
  assert.match(line, /"\$\{KOSMOS_TEST_FILES\[@\]\}"/, 'the guard must ride the same line that runs the counted set');
});
