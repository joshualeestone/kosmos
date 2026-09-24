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
test('#3605 preload: refuses every writer into the real LaunchAgents, before the write, and passes others through', () => {
  const { execFileSync } = require('node:child_process');
  const guard = path.join(__dirname, '..', 'test-support', 'launch-guard.js');
  const script = `
    const fs = require('node:fs'); const path = require('node:path');
    const seen = [];
    for (const n of ['writeFileSync','appendFileSync','copyFileSync','renameSync'])
      fs[n] = (...a) => { seen.push(n); };
    fs.promises.writeFile = async () => { seen.push('promises.writeFile'); };
    require(${JSON.stringify(guard)});
    const REAL = ${JSON.stringify(REAL)}, SAFE = ${JSON.stringify(path.join(SANDBOX, 'LaunchAgents'))};
    const out = {};
    const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = /#3605/.test(e.message) ? 'refused' : 'other:' + e.message; } };
    tryIt('write', () => fs.writeFileSync(path.join(REAL, 'com.kosmos.agent.p.plist'), 'x'));
    tryIt('append', () => fs.appendFileSync(path.join(REAL, 'com.kosmos.agent.p.plist'), 'x'));
    tryIt('copyDest', () => fs.copyFileSync('/etc/hosts', path.join(REAL, 'com.kosmos.agent.p.plist')));
    tryIt('renameDest', () => fs.renameSync('/nope', path.join(REAL, 'p.plist')));
    tryIt('renameFromReal', () => fs.renameSync(path.join(REAL, 'p.plist'), path.join(SAFE, 'p.plist')));
    tryIt('sandbox', () => fs.writeFileSync(path.join(SAFE, 'com.kosmos.agent.p.plist'), 'x'));
    fs.promises.writeFile(path.join(REAL, 'p.plist'), 'x').then(
      () => { out.promise = 'allowed'; }, (e) => { out.promise = /#3605/.test(e.message) ? 'refused' : 'other'; })
      .then(() => process.stdout.write(JSON.stringify({ out, seen })));
  `;
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const res = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  assert.deepEqual(res.out, {
    write: 'refused', append: 'refused', copyDest: 'refused', renameDest: 'refused',
    renameFromReal: 'allowed', sandbox: 'allowed', promise: 'refused',
  });
  // Only the two allowed calls reached a writer: every refusal came BEFORE the write.
  assert.deepEqual(res.seen, ['renameSync', 'writeFileSync']);
});

test('#3605 preload: tools/run-tests.sh loads it on the node --test line', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'run-tests.sh'), 'utf8');
  const line = sh.split('\n').find((l) => /^node --test /.test(l));
  assert.ok(line, 'run-tests.sh has no `node --test` line');
  assert.match(line, /--require "\$REPO\/test-support\/launch-guard\.js"/);
  assert.match(line, /"\$\{KOSMOS_TEST_FILES\[@\]\}"/, 'the guard must ride the same line that runs the counted set');
});
