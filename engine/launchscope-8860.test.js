'use strict';
/**
 * kosmos#8860: a board whose agent job files do not go in the account's real ~/Library/LaunchAgents (a throwaway
 * board: its own AGENT_WORKFORCE_LAUNCH, HOME or AGENT_WORKFORCE_HOME) still registers its agents in the account's
 * one launchd domain. Its labels must therefore not be the real board's. These tests only build label strings;
 * nothing is written and launchctl is never run.
 *
 *   node --test engine/launchscope-8860.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const create = require('./create');

const VARS = ['AGENT_WORKFORCE_LAUNCH', 'AGENT_WORKFORCE_HOME', 'HOME', 'KOSMOS_WORLD'];
function withEnv(set, fn) {
  const saved = {};
  for (const k of VARS) saved[k] = process.env[k];
  try {
    for (const k of VARS) {
      if (Object.prototype.hasOwnProperty.call(set, k)) {
        if (set[k] === undefined) delete process.env[k]; else process.env[k] = set[k];
      }
    }
    return fn();
  } finally {
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const ACCOUNT_HOME = os.userInfo().homedir;
const REAL_LAUNCH = path.join(ACCOUNT_HOME, 'Library', 'LaunchAgents');
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `launchscope-8860-${tag}-`));
const SCOPED = /^com\.kosmos\.agent\.ava\+launch-[0-9a-f]{8}$/;

test('CONTROL: a board writing to the account\'s real LaunchAgents keeps today\'s bare label', () => {
  const viaLaunch = withEnv({ AGENT_WORKFORCE_LAUNCH: REAL_LAUNCH, AGENT_WORKFORCE_HOME: undefined, KOSMOS_WORLD: undefined },
    () => ({ label: create.serviceLabel('ava'), scope: create.launchScope() }));
  assert.equal(viaLaunch.label, 'com.kosmos.agent.ava');
  assert.equal(viaLaunch.scope, 'default');
  const viaHome = withEnv({ AGENT_WORKFORCE_LAUNCH: undefined, AGENT_WORKFORCE_HOME: undefined, HOME: ACCOUNT_HOME, KOSMOS_WORLD: undefined },
    () => create.serviceLabel('ava'));
  assert.equal(viaHome, 'com.kosmos.agent.ava', 'the installed board sets none of these and must not be renamed');
});

test('a throwaway board with its own job folder cannot share the real board\'s label', () => {
  const real = withEnv({ AGENT_WORKFORCE_LAUNCH: REAL_LAUNCH, AGENT_WORKFORCE_HOME: undefined, KOSMOS_WORLD: undefined },
    () => create.serviceLabel('ava'));
  const dir = tmp('launch');
  const sbx = withEnv({ AGENT_WORKFORCE_LAUNCH: dir, KOSMOS_WORLD: undefined },
    () => ({ label: create.serviceLabel('ava'), scope: create.launchScope(), plist: create.plistPath('ava') }));
  assert.match(sbx.label, SCOPED);
  assert.notEqual(sbx.label, real, 'same agent name, different label');
  assert.deepEqual(create.parseServiceLabel(sbx.label), { name: 'ava', worldId: sbx.scope },
    'the board reads its own label back into its own scope, which is what its stray sweeps compare');
  assert.equal(sbx.plist, path.join(dir, `${sbx.label}.plist`));
});

test('a throwaway board that only moves HOME (the 11-21 walk\'s shape) is scoped too', () => {
  const home = tmp('home');
  const label = withEnv({ AGENT_WORKFORCE_LAUNCH: undefined, AGENT_WORKFORCE_HOME: undefined, HOME: home, KOSMOS_WORLD: undefined },
    () => create.serviceLabel('ava'));
  assert.match(label, SCOPED, 'HOME moved the job folder, and the account record (not HOME) names the real one');
});

test('two throwaway boards get different labels, and one board\'s label is stable', () => {
  const a = tmp('a');
  const b = tmp('b');
  const at = (dir) => withEnv({ AGENT_WORKFORCE_LAUNCH: dir, KOSMOS_WORLD: undefined }, () => create.serviceLabel('ava'));
  assert.notEqual(at(a), at(b));
  assert.equal(at(a), at(a));
});

test('a named world keeps its own label, with or without its own job folder (#1704 unchanged)', () => {
  const dir = tmp('world');
  assert.equal(withEnv({ AGENT_WORKFORCE_LAUNCH: dir, KOSMOS_WORLD: 'qa' }, () => create.serviceLabel('ava')), 'com.kosmos.agent.ava+qa');
  assert.equal(withEnv({ AGENT_WORKFORCE_LAUNCH: REAL_LAUNCH, KOSMOS_WORLD: 'qa' }, () => create.serviceLabel('ava')), 'com.kosmos.agent.ava+qa');
});
