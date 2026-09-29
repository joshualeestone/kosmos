'use strict';
/*
 * kosmos#4375: GET/PUT /api/community-industry on the real board. The page draws the board's own list, a key from
 * it or null is stored, and anything else (free text, a missing field) is refused with nothing written.
 *
 *   node --test server.community-industry-4375.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-industry-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-industry-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-industry-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-industry-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-industry-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const communityindustry = require('./engine/communityindustry');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const url = () => `http://127.0.0.1:${server.address().port}/api/community-industry`;
const put = (b) => fetch(url(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) });

test('#4375: the setting file is this test\'s sandbox', () => {
  assert.ok(communityindustry.FILE.startsWith(SANDBOX + path.sep));
});

test('#4375: GET gives none set, readable, and the board\'s own list', async () => {
  const r = await fetch(url());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.industry, null);
  assert.equal(j.ok, true);
  assert.deepEqual(j.industries, communityindustry.INDUSTRIES.map((i) => ({ ...i })));
});

test('#4375: PUT a listed key stores it and answers with it; null clears it', async () => {
  let r = await put({ industry: 'legal' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).industry, 'legal');
  assert.deepEqual(communityindustry.read(), { industry: 'legal', ok: true });
  r = await put({ industry: null });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).industry, null);
  assert.deepEqual(communityindustry.read(), { industry: null, ok: true });
});

test('#4375: free text, a missing field or a bad body is refused and changes nothing', async () => {
  await put({ industry: 'software' });
  for (const b of [{ industry: 'Acme Legal LLP' }, {}, { on: true }, '{not json', { industry: 7 }]) {
    const r = await put(b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(typeof (await r.json()).error, 'string');
  }
  assert.deepEqual(communityindustry.read(), { industry: 'software', ok: true }, 'a refused PUT changed the setting');
});

test('#4375: an unreadable setting reads ok:false, never "none"', async () => {
  fs.writeFileSync(communityindustry.FILE, '{not json');
  const j = await (await fetch(url())).json();
  assert.equal(j.ok, false);
  assert.equal(j.industry, null);
  assert.equal(j.industries.length, 16, 'the list is still given, so the page can offer None to repair it');
});
