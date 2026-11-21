'use strict';

/**
 * kosmos#8846 review 2: the board's usage-poll plan through its REAL wiring (server.js usagePollPlan): the Settings
 * switch it reads, the agents walk, and the sweep's last decision. A sandboxed board with no panes, so every account
 * reads as empty, and the account list is passed in.
 *
 *   node --test server.usagepoll-plan-8846.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8846plan-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'panes.txt'), '');

const server = require('./server');
const setting = require('./engine/autobalance-setting');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const list = [{ dir: path.join(SANDBOX, 'home', '.claude-a'), label: 'a', email: 'a@example.test' }, { dir: path.join(SANDBOX, 'home', '.claude-b'), label: 'b', email: 'b@example.test' }];
const run = (last, lastDid = 'recorded') => ({ state: { last, lastDid } });

test('kosmos#8846 review 2: through the board\'s wiring, the Settings switch off asks nothing, and empty accounts wait for a busy one at risk', () => {
  setting.write({ on: false });
  const off = server._usagePollPlanForTest(list, run({ atRisk: [{ from: list[0].dir }], moves: [], unmeasured: [] }));
  assert.equal(off.off, true, 'the board read its Settings switch as on, or did not read it');
  assert.deepEqual(off.asked, [], 'the switch off still asked about accounts');
  setting.write({ on: true });
  const on = server._usagePollPlanForTest(list, run(null));
  assert.equal(on.off, false, 'CONTROL: the switch on is read');
  assert.deepEqual(on.asked, [], 'an empty account (no panes on this board) was asked with nothing at risk: the walk was not consulted');
  const atRiskEmpty = server._usagePollPlanForTest(list, run({ atRisk: [{ from: list[0].dir, kind: 'usage' }], moves: [], unmeasured: [] }));   // review 4: usage, so the walk is what keeps it false
  assert.equal(atRiskEmpty.needTargets, false, 'an at-risk account with no agents (by the real walk) needed targets');
  const named = server._usagePollPlanForTest(list, run({ atRisk: [], moves: [{ to: list[1].dir }], unmeasured: [] }));
  assert.deepEqual(named.asked.map((a) => a.label), ['b'], 'a named target was not asked');
});

/* Review 3: the busy path through the real agents walk. One agent of ours with no account folder of its own runs on the
   default account, so the default account is busy by the board's own walk. */
test('kosmos#8846 review 3: through the real walk, a busy account at risk gets its targets read; the triggered read skips it', () => {
  setting.write({ on: true });
  const fleet = require('./test-support/fleet');
  fleet.install([fleet.agent('ada', { state: 'idle' })]);
  /* The walk counts an agent by its launch job; one with no account folder runs on the default account. */
  const jobfix = require('./test-support/jobfixture');
  fs.mkdirSync(path.dirname(jobfix.jobPath('ada')), { recursive: true });
  fs.writeFileSync(jobfix.jobPath('ada'), jobfix.jobFor('ada', '/usr/local/bin/claude', '/opt/homebrew/bin/tmux', null, null, 'claude'), 'utf8');
  const withDefault = [{ dir: path.join(SANDBOX, 'home', '.claude'), isDefault: true, label: null, email: 'd@example.test' }, ...list];
  const calm = server._usagePollPlanForTest(withDefault, run(null));
  assert.deepEqual(calm.asked.map((a) => a.isDefault === true), [true], 'the real walk did not see the agent on the default account, or an empty one was asked');
  const risk = server._usagePollPlanForTest(withDefault, run({ atRisk: [{ from: withDefault[0].dir, kind: 'usage' }], moves: [], unmeasured: [] }));
  assert.equal(risk.needTargets, true, 'a busy account at risk, by the real walk, did not need targets');
  assert.deepEqual(risk.asked.map((a) => a.label), [null, 'a', 'b'], 'the empty targets were not asked');
  const trig = server._usagePollPlanForTest(withDefault, run({ atRisk: [{ from: withDefault[0].dir, kind: 'usage' }], moves: [], unmeasured: [] }), { emptyOnly: true });
  assert.deepEqual(trig.asked.map((a) => a.label), ['a', 'b'], 'the triggered read asked the busy account again');
});
