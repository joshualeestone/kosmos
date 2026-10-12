'use strict';
/*
 * kosmos#5958 items 4 and 5: GET /api/community/read?ready=1 (an agent's own readiness, `kosmos community ready`) and
 * GET /api/community/ready (every agent's, for the owner) on the real board, through the real engine/communityready.
 * The reader is always the authenticated agent, never a name in the query. No network: the row is read from records.
 *
 *   node --test server.community-ready-5958.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-ready-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-ready-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-ready-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-ready-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-ready-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityready = require('./engine/communityready');
const communityread = require('./engine/communityread');

let readCalls = 0;
const realRead = communityread.read;
test.before(async () => {
  await start(0);
  communityread.read = async (...a) => { readCalls += 1; return realRead(...a); };
});
test.after(() => {
  communityread.read = realRead;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const readAs = (tok, q) => fetch(`${base()}/api/community/read${q}`, { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });

test('#5958: ready=1 answers with the authenticated agent\'s own row, whatever name the query carries', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  assert.equal(communityready.noteTurn({ session: 'Other', act: 'not-reached' }, Date.parse('2026-10-12T15:04:00Z')), true);
  readCalls = 0;
  const r = await readAs(sendertoken.mint('Reader').token, '?ready=1&agent=Other');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.match(j.text, /^Where you stand with the Kosmos\+ community, from this computer's own records:/);
  assert.match(j.text, /The last reminder from Kosmos: none on record/, 'the reader was shown another agent\'s reminder: ' + j.text);
  const other = await (await readAs(sendertoken.mint('Other').token, '?ready=1')).json();
  assert.match(other.text, /The last reminder from Kosmos: 2026-10-12 15:04 UTC, not delivered: Kosmos could not reach it/, 'CONTROL: the agent that was reminded sees it');
  assert.equal(readCalls, 0, 'the community was read');
});

test('#5958: ready=1 goes alone, and needs an agent the board can verify', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Reader').token;
  for (const q of ['?ready=1&channel=general', '?ready=1&post=1b2c3d4e-0000-4000-8000-000000000001', '?ready=1&following=1', '?ready=1&replies=1', '?ready=1&older=eyJhIjoxfQ', '?ready=1&status=1', '?status=1&ready=1']) {
    const bad = await readAs(tok, q);
    assert.equal(bad.status, 400, q);
    assert.match((await bad.json()).error, /one at a time/, q);
  }
  assert.equal((await readAs(null, '?ready=1')).status, 403);
  assert.equal((await readAs(tok, '?ready=1')).status, 200, 'CONTROL: alone, with a token, it answers');
});

test('#5958: a row that cannot be built is a 500 with words, not a crash', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  const real = communityready.readyText;
  communityready.readyText = () => { throw new Error('boom'); };
  t.after(() => { communityready.readyText = real; b.restore(); });
  const r = await readAs(sendertoken.mint('Reader').token, '?ready=1');
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /could not read where you stand/);
});

test('#5958: GET /api/community/ready lists each agent once with its own row', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  assert.equal(communityready.noteTurn({ session: 'Other', act: 'prompted', delivery: 'placed' }, 1234), true);
  const r = await fetch(`${base()}/api/community/ready`);
  assert.equal(r.status, 200);
  const rows = (await r.json()).agents;
  const by = (s) => rows.filter((x) => x.session === s);
  assert.equal(by('Reader').length, 1, JSON.stringify(rows));
  assert.equal(by('Other').length, 1, JSON.stringify(rows));
  assert.deepEqual(by('Other')[0].reminder, { at: 1234, act: 'prompted', delivery: 'placed' });
  assert.equal(by('Reader')[0].reminder, null);
  for (const k of ['switch', 'addressOk', 'block', 'connected', 'rereadOwed', 'account', 'lastPost', 'held']) assert.ok(k in by('Reader')[0], 'the row has no ' + k);
});

test('#5958 review 1: a roster that cannot be read is a 503, not an empty list', async (t) => {
  const real = communityready.rowsFor;
  communityready.rowsFor = () => null;
  t.after(() => { communityready.rowsFor = real; });
  const r = await fetch(`${base()}/api/community/ready`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /could not check which agents are running/);
});
