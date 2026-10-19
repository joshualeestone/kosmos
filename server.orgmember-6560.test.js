'use strict';
/**
 * kosmos#6560: a member the admin removed was told "enrolled" until the next hourly company ask. While enrolled, the
 * board also asks the CHEAP membership check (the status route with { lite: true }, no policy) every ten minutes, and
 * runs the full ask (orgEnrollRefresh) only when that check clearly says the membership ended. The coordinator is a
 * stub on engine/remote.js macRequest, so nothing here can reach a real coordinator.
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgmember-6560-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgmember-6560-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgmember-6560-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgmember-6560-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgmember-6560-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, orgMemberCheckIfDue, _orgRefreshResetForTests } = require('./server');
const store = require('./engine/store');
const oe = require('./engine/orgenroll');
const remote = require('./engine/remote');
const live = require('./engine/live-execution');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

const ACME = { id: 'org_1', name: 'Acme', slug: 'acme' };
const enrollmentFile = () => path.join(store.ROOT, oe.ENROLLMENT_FILE);
function enroll() {
  fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: ACME, role: 'member', world: oe.worldId(), enrolledAt: '2026-10-19T00:00:00.000Z', consentHash: 'cd'.repeat(32) }));
}
/* A stub coordinator: records what was asked, answers with `answer(body)`. The full refresh is counted, not run. */
function rig(t, answer) {
  _orgRefreshResetForTests();
  enroll();
  const sent = [];
  const orig = remote.macRequest;
  remote.macRequest = async (method, route, body) => { sent.push({ route, body }); return { ok: true, data: answer(body) }; };
  const realRefresh = oe.refresh;
  let refreshes = 0;
  oe.refresh = async () => { refreshes += 1; return { ok: true, enrolled: false }; };
  live.allowLiveExecution();
  t.after(() => { remote.macRequest = orig; oe.refresh = realRefresh; live.resetForTests(); _orgRefreshResetForTests(); fs.rmSync(enrollmentFile(), { force: true }); });
  return { sent, refreshes: () => refreshes };
}

test('#6560: a removal seen by the cheap check runs the full ask, and the check sends lite to the status route', async (t) => {
  const r = rig(t, () => ({ lite: true, member: false }));
  await orgMemberCheckIfDue(Date.now());
  assert.equal(r.sent.length, 1, 'the cheap check was not asked: ' + JSON.stringify(r.sent));
  assert.equal(r.sent[0].route, '/v1/mac/org/status');
  assert.deepEqual(r.sent[0].body, { lite: true }, 'the check did not ask for the lite answer');
  assert.equal(r.refreshes(), 1, 'a clear removal did not run the full ask, so the board keeps saying enrolled');
});

test('#6560 CONTROL: still a member here, the cheap check changes nothing', async (t) => {
  const r = rig(t, () => ({ lite: true, member: true, enrolled: { world: oe.worldId(), thisComputer: true } }));
  await orgMemberCheckIfDue(Date.now());
  assert.equal(r.sent.length, 1, 'CONTROL: the cheap check was not asked');
  assert.equal(r.refreshes(), 0, 'a member still here ran the full ask on every cheap check');
});

test('#6560: asked at most every ten minutes, and only while enrolled', async (t) => {
  const r = rig(t, () => ({ lite: true, member: true, enrolled: { world: oe.worldId(), thisComputer: true } }));
  const at = Date.now();
  await orgMemberCheckIfDue(at);
  await orgMemberCheckIfDue(at + 5 * 60 * 1000);
  assert.equal(r.sent.length, 1, 'asked again within ten minutes');
  await orgMemberCheckIfDue(at + 10 * 60 * 1000 + 1);
  assert.equal(r.sent.length, 2, 'not asked again after ten minutes, so a removal waits for the hour');
  fs.rmSync(enrollmentFile(), { force: true });
  await orgMemberCheckIfDue(at + 30 * 60 * 1000);
  assert.equal(r.sent.length, 2, 'a board in no company asked (every board would)');
});

test('#6560: an older coordinator that answers in full (no lite) is not asked again; the hourly ask still covers it', async (t) => {
  const r = rig(t, () => ({ member: false }));   // full shape, no lite marker: not trusted as the cheap check
  const at = Date.now();
  await orgMemberCheckIfDue(at);
  assert.equal(r.refreshes(), 0, 'an answer not marked lite was acted on as the cheap check');
  await orgMemberCheckIfDue(at + 60 * 60 * 1000);
  assert.equal(r.sent.length, 1, 'a coordinator with no cheap check was asked again (a full answer every ten minutes)');
});

test('#6560: nothing is sent before live execution is allowed (as the hourly ask)', async (t) => {
  const r = rig(t, () => ({ lite: true, member: false }));
  live.resetForTests();
  await orgMemberCheckIfDue(Date.now());
  assert.equal(r.sent.length, 0, 'the cheap check was sent before live execution');
});
