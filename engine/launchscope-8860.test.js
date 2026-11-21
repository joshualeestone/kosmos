'use strict';
/**
 * kosmos#8860: a board whose agent job files do not go in the account's real ~/Library/LaunchAgents (a throwaway
 * board: its own AGENT_WORKFORCE_LAUNCH, HOME or AGENT_WORKFORCE_HOME) still registers its agents in the account's
 * one launchd domain, so its labels must not be the real board's. These tests only build label strings: nothing is
 * written to a real LaunchAgents folder and launchctl is never run.
 *
 * The decision is driven through launchScopeFor with every input passed in, because a test process cannot be
 * "really live" (it has a runner, or setRunner(null) has turned dry-run on). The readers are driven through
 * setLaunchScopeForTests.
 *
 *   node --test engine/launchscope-8860.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipOnWin32 } = require('../test-support/skip-on-win32');   // HOME and symlinks are POSIX-shaped here
const create = require('./create');

const ACCOUNT = path.join(os.userInfo().homedir, 'Library', 'LaunchAgents');
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `launchscope-8860-${tag}-`));
const SCOPE = /^launch-[0-9a-f]{8}$/;
const none = () => false;
/* A live macOS board writing its jobs to `folder`: the case a throwaway board is. Each test changes one input. */
const scope = (over) => create.launchScopeFor(Object.assign(
  { world: 'default', platform: 'darwin', live: true, folder: ACCOUNT, account: ACCOUNT, hasBareJob: none }, over));

test('CONTROL: a live board writing to the account\'s real LaunchAgents keeps today\'s bare labels', () => {
  assert.equal(scope({}), 'default');
});

test('a live throwaway board with its own job folder gets its own scope', () => {
  assert.match(scope({ folder: tmp('own') }), SCOPE);
});

test('each input that cannot reach launchd, or cannot be told apart, keeps the bare label', () => {
  const dir = tmp('arms');
  assert.match(scope({ folder: dir }), SCOPE, 'precondition: this folder is scoped when nothing else differs');
  assert.equal(scope({ folder: dir, live: false }), 'default', 'not live (a test, a dry run, the gate closed)');
  assert.equal(scope({ folder: dir, platform: 'linux' }), 'default', 'Linux: units are keyed by the world');
  assert.equal(scope({ folder: dir, platform: 'win32' }), 'default', 'Windows: tasks are keyed by the world');
  assert.equal(scope({ folder: dir, account: null }), 'default', 'an unreadable account record');
  assert.equal(scope({ folder: dir, hasBareJob: () => true }), 'default', 'a folder already holding a bare job');
});

test('a named world keeps its own id, live or not (#1704 unchanged)', () => {
  assert.equal(scope({ world: 'qa', folder: tmp('world') }), 'qa');
  assert.equal(scope({ world: 'qa', live: false }), 'qa');
});

test('two throwaway folders get different scopes, and one folder\'s scope is stable', () => {
  const a = tmp('a');
  const b = tmp('b');
  assert.notEqual(scope({ folder: a }), scope({ folder: b }));
  assert.equal(scope({ folder: a }), scope({ folder: a }));
});

test('a folder\'s scope does not change when it is first created', () => {
  const dir = path.join(tmp('later'), 'not-made-yet');
  const before = scope({ folder: dir });
  fs.mkdirSync(dir);
  assert.match(before, SCOPE);
  assert.equal(scope({ folder: dir }), before, 'spelled from its nearest existing parent, so /tmp and /private/tmp do not split it');
});

test('the account\'s folder by another spelling (a symlink) keeps the bare label', { skip: skipOnWin32('a symlink needs a privilege on Windows') }, () => {
  const real = tmp('real');
  const link = path.join(tmp('link'), 'la');
  fs.symlinkSync(real, link);
  assert.equal(scope({ folder: link, account: real }), 'default', 'compared in its on-disk spelling, so a real board reached by another path is never renamed');
});

test('live end to end: launchScope scopes a throwaway folder from its real inputs, and its real bare-job check keeps bare labels', () => {
  const VARS = ['AGENT_WORKFORCE_LAUNCH', 'AGENT_WORKFORCE_HOME', 'HOME'];
  const saved = {};
  for (const k of VARS) saved[k] = process.env[k];
  try {
    create.setLaunchLiveForTests(true);        // the one input a test process cannot reach; everything else is real
    create.setProbePlatformForTests('darwin');
    delete process.env.AGENT_WORKFORCE_HOME;
    const dir = tmp('live');
    process.env.AGENT_WORKFORCE_LAUNCH = dir;
    const label = create.serviceLabel('ava');
    assert.match(label, /^com\.kosmos\.agent\.ava\+launch-[0-9a-f]{8}$/, 'a throwaway job folder is scoped');
    assert.equal(create.launchScope(), scope({ folder: dir }), 'built from agentsDir() and the account record, not anything else');
    fs.writeFileSync(path.join(dir, `${label}.plist`), '<plist/>');
    fs.writeFileSync(path.join(dir, 'com.kosmos.agent.notes.txt'), 'x');
    assert.equal(create.serviceLabel('ava'), label, 'its own scoped job and a non-plist file are not bare jobs');
    fs.writeFileSync(path.join(dir, 'com.kosmos.agent.ava.plist'), '<plist/>');
    assert.equal(create.serviceLabel('ava'), label,
      'LATCHED: a bare job written later (by another process) cannot flip a running board and strand its agents');

    const bare = tmp('bare');
    fs.writeFileSync(path.join(bare, 'com.kosmos.agent.ava.plist'), '<plist/>');
    process.env.AGENT_WORKFORCE_LAUNCH = bare;
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava', 'a folder holding a bare job when first asked keeps bare labels');

    process.env.AGENT_WORKFORCE_LAUNCH = ACCOUNT;   // a string only: nothing is read from or written to it here
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava', 'CONTROL: the account\'s own folder is never scoped');
  } finally {
    create.setLaunchLiveForTests(null);
    create.setProbePlatformForTests(null);
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test('CONTROL: in this test process (not live) a temporary job folder keeps the bare label end to end', () => {
  const saved = process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    process.env.AGENT_WORKFORCE_LAUNCH = tmp('dry');
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava');
  } finally {
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = saved;
  }
});

test('a scoped board builds and reads back its own labels: serviceLabel, plistPath, parseServiceLabel', () => {
  try {
    create.setLaunchScopeForTests('launch-0a1b2c3d');
    const label = create.serviceLabel('ava');
    assert.equal(label, 'com.kosmos.agent.ava+launch-0a1b2c3d');
    assert.equal(path.basename(create.plistPath('ava')), `${label}.plist`);
    assert.deepEqual(create.parseServiceLabel(label), { name: 'ava', worldId: create.launchScope() });
    assert.equal(create.serviceLabel('ava', 'qa'), 'com.kosmos.agent.ava+qa', 'an explicit named world is never scoped');
  } finally { create.setLaunchScopeForTests(null); }
});

test('the launchd fleet probes answer in this board\'s scope: a throwaway board reads its own jobs, not the real board\'s', () => {
  const list = '123\t0\tcom.kosmos.agent.mine+launch-0a1b2c3d\n124\t0\tcom.kosmos.agent.theirs\n';
  const off = '\t"com.kosmos.agent.mine+launch-0a1b2c3d" => disabled\n\t"com.kosmos.agent.theirs" => disabled\n';
  try {
    create.setRunner((file, args) => ({ ok: true, stdout: args[0] === 'list' ? list : off }));
    create.setLaunchScopeForTests('launch-0a1b2c3d');
    assert.deepEqual([...create.runningJobs('darwin')], ['mine']);
    assert.deepEqual([...create.disabledJobs('darwin')], ['mine']);
    create.setLaunchScopeForTests(null);
    assert.deepEqual([...create.runningJobs('darwin')], ['theirs'], 'control: the real board reads the bare job');
    assert.deepEqual([...create.disabledJobs('darwin')], ['theirs']);
  } finally { create.setLaunchScopeForTests(null); create.setRunner(null); }
});

test('with the gate open, a dry-run board and a board with a test runner both keep the bare label (neither reaches launchd)', () => {
  const liveExec = require('./live-execution');
  const saved = process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    process.env.AGENT_WORKFORCE_LAUNCH = tmp('notlive');
    create.setProbePlatformForTests('darwin');
    liveExec.allowLiveExecution();   // only label strings are built under it: nothing here calls run()
    create.setRunner(null);          // no runner, and (by setRunner's own rule) dry-run on
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava', 'dry-run: run() returns before the gate');
    create.setRunner(() => ({ ok: true, stdout: '' }));
    create.setDryRun(false);         // a runner and dry-run off: only the runner stands between this and launchd
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava', 'a test runner: nothing reaches launchd');
  } finally {
    // setRunner(null) leaves dry-run ON (its own rule), not as it was: the safe direction for anything after this.
    create.setRunner(null);
    liveExec.resetForTests();
    create.setProbePlatformForTests(null);
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = saved;
  }
});

test('live: HOME alone moves the job folder, and that folder is scoped (the 11-21 walk\'s shape)', { skip: skipOnWin32('os.homedir() reads USERPROFILE on Windows, not HOME') }, () => {
  const VARS = ['AGENT_WORKFORCE_LAUNCH', 'AGENT_WORKFORCE_HOME', 'HOME'];
  const saved = {};
  for (const k of VARS) saved[k] = process.env[k];
  try {
    create.setLaunchLiveForTests(true);
    create.setProbePlatformForTests('darwin');
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    delete process.env.AGENT_WORKFORCE_HOME;
    process.env.HOME = tmp('home');
    assert.match(create.serviceLabel('ava'), /^com\.kosmos\.agent\.ava\+launch-[0-9a-f]{8}$/);
  } finally {
    create.setLaunchLiveForTests(null);
    create.setProbePlatformForTests(null);
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
