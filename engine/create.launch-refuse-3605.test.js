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
    const SYNC = ['writeFileSync','appendFileSync','copyFileSync','renameSync','symlinkSync','linkSync','rmSync','unlinkSync'];
    const CB = ['writeFile','appendFile','copyFile','rename','rm','unlink'];
    const PR = ['writeFile','appendFile','copyFile','rename','rm','unlink'];
    for (const n of SYNC) fs[n] = () => { seen.push(n); };
    for (const n of CB) fs[n] = (...a) => { seen.push('cb.' + n); };
    for (const n of PR) fs.promises[n] = async () => { seen.push('p.' + n); };
    require(${JSON.stringify(guard)});
    const REAL = ${JSON.stringify(REAL)}, SAFE = ${JSON.stringify(path.join(SANDBOX, 'LaunchAgents'))};
    const R = path.join(REAL, 'com.kosmos.agent.p.plist'), S = path.join(SAFE, 'com.kosmos.agent.p.plist');
    const out = {};
    const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = /#3605/.test(e.message) ? 'refused' : 'other:' + e.message; } };
    // Destination index per method: the real path goes where that method WRITES.
    const DEST1 = new Set(['copyFileSync','renameSync','symlinkSync','linkSync','copyFile','rename']);
    for (const n of SYNC) tryIt(n, () => DEST1.has(n) ? fs[n]('/nope', R) : fs[n](R, 'x'));
    for (const n of CB) tryIt('cb.' + n, () => DEST1.has(n) ? fs[n]('/nope', R, () => {}) : fs[n](R, () => {}));
    tryIt('caseVariant', () => fs.writeFileSync(path.join(path.dirname(REAL), 'launchagents', 'p.plist'), 'x'));
    tryIt('fileUrl', () => fs.writeFileSync(pathToFileURL(R), 'x'));
    tryIt('renameFromReal', () => fs.renameSync(R, S));
    tryIt('sandbox', () => fs.writeFileSync(S, 'x'));
    Promise.all(PR.map((n) => (DEST1.has(n) ? fs.promises[n]('/nope', R) : fs.promises[n](R, 'x')).then(
      () => { out['p.' + n] = 'allowed'; }, (e) => { out['p.' + n] = /#3605/.test(e.message) ? 'refused' : 'other'; })))
      .then(() => process.stdout.write(JSON.stringify({ out, seen })));
  `;
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const res = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const refused = Object.keys(res.out).filter((k) => !['renameFromReal', 'sandbox'].includes(k));
  if (process.platform !== 'darwin') refused.splice(refused.indexOf('caseVariant'), 1);
  for (const k of refused) assert.equal(res.out[k], 'refused', `${k} must be refused`);
  assert.equal(res.out.renameFromReal, 'allowed', 'moving a file OUT of the real folder is not a write into it');
  assert.equal(res.out.sandbox, 'allowed');
  // Only the allowed calls reached the underlying function: every refusal came BEFORE the call.
  const expectSeen = ['renameSync', 'writeFileSync'];
  if (process.platform !== 'darwin') expectSeen.unshift('writeFileSync');
  assert.deepEqual(res.seen.sort(), expectSeen.sort());
});

test('#3605 create.js: the rollback delete is skipped for a real-folder job file under test', () => {
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(REAL, 'com.kosmos.agent.x.plist'), UNDER_TEST), true);
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(REAL, 'com.kosmos.agent.x.plist'), {}), false);
  assert.equal(create.isRealLaunchTargetUnderTest(path.join(SANDBOX, 'LaunchAgents', 'x.plist'), UNDER_TEST), false);
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.match(src, /if \(!isRealLaunchTargetUnderTest\(plistPath\(name\)\)\) \{\s*try \{ fs\.rmSync\(plistPath\(name\), \{ force: true \}\); \}/,
    'the createAgent rollback must not delete a real-folder job file under test');
});

test('#3605 preload: tools/run-tests.sh loads it on the node --test line', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'run-tests.sh'), 'utf8');
  const line = sh.split('\n').find((l) => /^node --test /.test(l));
  assert.ok(line, 'run-tests.sh has no `node --test` line');
  assert.match(line, /--require "\$REPO\/test-support\/launch-guard\.js"/);
  assert.match(line, /"\$\{KOSMOS_TEST_FILES\[@\]\}"/, 'the guard must ride the same line that runs the counted set');
});
