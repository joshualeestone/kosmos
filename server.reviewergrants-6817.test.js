'use strict';
/**
 * kosmos#6817 item 1: GET /api/org/grants, the board notice's read. It answers the recent reviewer grants and the org's
 * kind to the screen only (an agent learns only whether this Kosmos is enrolled, as on /api/org), and it spends none
 * of the one-time notes a GET of /api/org shows once (stoppedFor, leaveRefused), so a board polling it cannot eat
 * them before Settings shows them. Real requests against the board, as server.orgenroll-5531.test.js does.
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reviewergrants-6817-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reviewergrants-6817-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reviewergrants-6817-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reviewergrants-6817-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reviewergrants-6817-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');
const oe = require('./engine/orgenroll');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

async function get(p, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method: 'GET', headers: headers || {} });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const enrollmentFile = () => path.join(store.ROOT, oe.ENROLLMENT_FILE);
const GRANTS = [{ who: 'Pat Lee', grantedAt: 1_790_000_000, effectiveAt: 1_790_086_400 },
  { who: 'Sam‮Ortiz', grantedAt: 1_790_100_000, effectiveAt: 1_790_186_400, removedAt: 1_790_100_060 }];
const enroll = (kind) => fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme', ...(kind ? { kind } : {}) },
  role: 'member', world: oe.worldId(), enrolledAt: '2026-10-07T00:00:00.000Z', reviewerGrants: GRANTS }));

test('#6817: a Kosmos in no company answers not enrolled, no kind, no grants', async () => {
  fs.rmSync(enrollmentFile(), { force: true });
  const r = await get('/api/org/grants', SCREEN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { enrolled: false, kind: null, reviewerGrants: [] });
});

test('#6817: the screen gets the cleaned grants and the kind; an agent learns only that this Kosmos is enrolled', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(enrollmentFile(), { force: true }); });
  enroll();
  const screen = await get('/api/org/grants', SCREEN);
  assert.equal(screen.json.enrolled, true);
  assert.equal(screen.json.kind, 'company');
  assert.deepEqual(screen.json.reviewerGrants, oe.cleanReviewerGrants(GRANTS), 'not the grants /api/org gives, cleaned the same way');
  assert.equal(screen.json.reviewerGrants[1].who, 'SamOrtiz', 'a direction character reached the page');
  const asLeo = await get('/api/org/grants', { 'x-kosmos-agent-token': sendertoken.mint('leo').token });
  assert.deepEqual(asLeo.json, { enrolled: true, kind: null, reviewerGrants: [] }, 'an agent read the company\'s grants: ' + JSON.stringify(asLeo.json));
  enroll('family');
  assert.equal((await get('/api/org/grants', SCREEN)).json.kind, 'family');
});

test('#6817: reading the grants spends no one-time note: /api/org still shows it once (CONTROL: /api/org itself spends it)', async (t) => {
  t.after(() => fs.rmSync(enrollmentFile(), { force: true }));
  fs.rmSync(enrollmentFile(), { force: true });
  fs.writeFileSync(path.join(store.ROOT, 'org-stopped.json'), JSON.stringify({ at: '2026-10-07T00:00:00.000Z', name: 'Acme' }));
  for (let i = 0; i < 3; i += 1) await get('/api/org/grants', SCREEN);
  const first = await get('/api/org', SCREEN);
  assert.equal(first.json.stoppedFor, 'Acme', 'the grants read used up the stopped note');
  const second = await get('/api/org', SCREEN);
  assert.equal(second.json.stoppedFor, null, 'the control: /api/org shows the note once, so the arm above can fail');
});
