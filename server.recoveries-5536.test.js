'use strict';
/**
 * kosmos#5536: GET /api/org sends the recoveries of this member's own backup (kept by engine/orgenroll.js from the
 * coordinator's status answer, kosmos-relay #781) to the screen only, cleaned, with when they were confirmed and
 * whether older ones were left out; an agent's token gets none, and a Kosmos in no company none. Real requests against
 * the board, as server.reviewergrants-6817.test.js does.
 *   node --test server.recoveries-5536.test.js
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoveries-5536-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoveries-5536-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoveries-5536-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoveries-5536-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoveries-5536-launch-'));
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
const RECS = [{ what: 'files_opened', who: 'Pat\u202eLee', at: 1_790_000_100, epoch: 3, count: 7 },
  { what: 'key_released', who: 'Pat Lee', at: 1_790_000_000, epoch: 3 }, { what: 'nonsense', at: 1_790_000_000 }];
const AT = Date.now() - 3600 * 1000;
const enroll = (extra) => fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme' },
  role: 'member', world: oe.worldId(), enrolledAt: '2026-10-07T00:00:00.000Z', recoveries: RECS, recoveriesAt: AT, ...(extra || {}) }));


test('#5536: the screen gets the cleaned recoveries, when they were confirmed, and recoveriesMore; an agent gets none', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(enrollmentFile(), { force: true }); });
  enroll({ recoveriesMore: true });
  const screen = await get('/api/org', SCREEN);
  assert.equal(screen.status, 200);
  assert.equal(screen.json.enrolled, true, 'CONTROL: the record reads as joined here');
  assert.deepEqual(screen.json.recoveries, oe.cleanRecoveries(RECS), 'not cleaned as the engine cleans them');
  assert.equal(screen.json.recoveries.length, 2, 'a malformed row reached the page');
  assert.equal(screen.json.recoveries[0].who, 'PatLee', 'a direction character reached the page');
  assert.equal(screen.json.recoveriesAt, AT);
  assert.equal(screen.json.recoveriesMore, true);
  const asLeo = await get('/api/org', { 'x-kosmos-agent-token': sendertoken.mint('leo').token });
  assert.equal(asLeo.status, 200);
  assert.equal(asLeo.json.recoveries, undefined, 'an agent read the member\'s recoveries: ' + JSON.stringify(asLeo.json));
  enroll();
  assert.equal((await get('/api/org', SCREEN)).json.recoveriesMore, undefined, 'recoveriesMore without it on the record');
});

test('#5536: a Kosmos in no company, or a record for another world, gets no recoveries', async (t) => {
  t.after(() => fs.rmSync(enrollmentFile(), { force: true }));
  fs.rmSync(enrollmentFile(), { force: true });
  assert.equal((await get('/api/org', SCREEN)).json.recoveries, undefined);
  enroll({ world: 'another-world' });
  const r = await get('/api/org', SCREEN);
  assert.equal(r.json.enrolled, false, 'CONTROL: a record for another world is not joined here');
  assert.equal(r.json.recoveries, undefined, 'another world\'s record sent its recoveries');
});
