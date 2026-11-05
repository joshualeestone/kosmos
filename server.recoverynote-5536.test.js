'use strict';
/**
 * kosmos#5536: GET /api/org/grants also answers the recoveries of this member's own backup, for the board's notice: to
 * the screen only, cleaned, and never to a family. The field is left out when there are none. Real requests against the
 * board, as server.reviewergrants-6817.test.js does.
 *   node --test server.recoverynote-5536.test.js
 */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoverynote-5536-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoverynote-5536-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoverynote-5536-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoverynote-5536-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recoverynote-5536-launch-'));
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
const AT = Math.floor(Date.now() / 1000) - 3600;
const RECS = [{ what: 'files_opened', at: AT, who: 'Pat‮Lee', epoch: 2, count: 7 }, { what: 'not_a_word', at: AT }, { what: 'key_released', at: AT - 60, who: 'Pat', epoch: 2 }];
const enroll = (kind, recoveries = RECS) => fs.writeFileSync(enrollmentFile(), JSON.stringify({ org: { id: 'org_1', name: 'Acme', slug: 'acme', ...(kind ? { kind } : {}) },
  role: 'member', world: oe.worldId(), enrolledAt: '2026-10-07T00:00:00.000Z', recoveries, recoveriesAt: Date.now() }));

test('#5536: the screen gets the cleaned rows; an agent gets none; a family gets none (CONTROL: the same record as a company gives them)', async (t) => {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(enrollmentFile(), { force: true }); });
  enroll();
  const screen = await get('/api/org/grants', SCREEN);
  assert.deepEqual(screen.json.recoveries, oe.cleanRecoveries(RECS));
  assert.equal(screen.json.recoveries.length, 2, 'a row with an unknown word reached the page');
  assert.equal(screen.json.recoveries[0].who, 'PatLee', 'a direction character reached the page');
  const asLeo = await get('/api/org/grants', { 'x-kosmos-agent-token': sendertoken.mint('leo').token });
  assert.equal('recoveries' in asLeo.json, false, 'an agent read who opened the backup: ' + JSON.stringify(asLeo.json));
  enroll('family');
  const fam = await get('/api/org/grants', SCREEN);
  assert.equal(fam.json.kind, 'family');
  assert.equal('recoveries' in fam.json, false, 'a family was sent recoveries');
});

test('#5536: no rows leave the field out, so the 6817 shape holds for a member with none, and a Kosmos in no company', async (t) => {
  t.after(() => fs.rmSync(enrollmentFile(), { force: true }));
  enroll(undefined, []);
  assert.equal('recoveries' in (await get('/api/org/grants', SCREEN)).json, false);
  fs.rmSync(enrollmentFile(), { force: true });
  assert.deepEqual((await get('/api/org/grants', SCREEN)).json, { enrolled: false, kind: null, reviewerGrants: [] });
});
