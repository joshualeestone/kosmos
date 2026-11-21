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

test('the account\'s folder by another spelling (a symlink) keeps the bare label', () => {
  const real = tmp('real');
  const link = path.join(tmp('link'), 'la');
  fs.symlinkSync(real, link);
  assert.equal(scope({ folder: link, account: real }), 'default', 'compared in its on-disk spelling, so a real board reached by another path is never renamed');
});

test('a folder holding a bare-labelled job keeps bare labels; a scoped job alone does not', () => {
  const dir = tmp('bare');
  const real = (d) => create.launchScopeFor({ world: 'default', platform: 'darwin', live: true, folder: d, account: ACCOUNT,
    hasBareJob: (x) => fs.readdirSync(x).some((f) => /^com\.kosmos\.agent\.[^+]+\.plist$/.test(f)) });
  fs.writeFileSync(path.join(dir, 'com.kosmos.agent.ava+launch-0a1b2c3d.plist'), '<plist/>');
  assert.match(real(dir), SCOPE, 'a scoped job is this board\'s own');
  fs.writeFileSync(path.join(dir, 'com.kosmos.agent.ava.plist'), '<plist/>');
  assert.equal(real(dir), 'default', 'a bare job means this folder\'s board labels bare');
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
