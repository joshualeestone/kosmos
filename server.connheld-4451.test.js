'use strict';
/**
 * #4451: agents know the Connections tab, can MARK a service they connect, and read what is
 * connected CHEAPLY.
 *
 * 🛑 THE COST TRAP THE CARD NAMES. `GET /api/connections` checks every door live, and Brave Search,
 * Exa, Tavily and Serper bill the person's own quota for each check (#1636). The agents' read,
 * `GET /api/connections/held`, answers from the disk only. The first test holds that with a
 * CONTROL: the same counting fetchers DO count when the full sweep runs, so a zero on the cheap
 * read is a measurement, not an instrument that could not see.
 *
 *   node --test server.connheld-4451.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connheld-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* #4309: never run the host's gh or vercel with this sandbox as HOME. */
const hostClis = require('./test-support/nohostcli').sandboxHostClis(SANDBOX);

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const tokendoors = require('./engine/tokendoors');

const METERED = ['Brave Search', 'Exa', 'Tavily', 'Serper'];
const TOKEN = 'bsa_0123456789abcdef0123456789abcdef';

let base;
const calls = {};
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  /* Every token door answers from a counting stub: nothing here reaches a real service. */
  for (const name of Object.keys(tokendoors.routes())) {
    calls[name] = 0;
    tokendoors.byName(name).setFetcher(async () => { calls[name] += 1; return { ok: true, status: 200, body: {} }; });
  }
});
test.after(async () => {
  for (const name of Object.keys(tokendoors.routes())) tokendoors.byName(name).setFetcher(null);
  server.closeAllConnections();
  server.close();
  hostClis.restore && hostClis.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const metered = () => METERED.reduce((n, name) => n + calls[name], 0);
const held = async () => {
  const r = await fetch(base + '/api/connections/held');
  assert.equal(r.status, 200);
  const j = await r.json();
  return Object.fromEntries(j.services.map((s) => [s.name, s]));
};

test('#4451: connecting through the door makes ONE metered check, and the agents\' read then says connected without any', async () => {
  // The door, as `kosmos connect brave-search` reaches it.
  const before = calls['Brave Search'];
  const r = await fetch(base + '/api/svc/brave-search/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
  const st = await r.json();
  assert.equal(r.status, 200, JSON.stringify(st));
  assert.equal(st.connected, true, 'the door did not report the token it just accepted as connected');
  assert.equal(calls['Brave Search'] - before, 1, 'connecting made ' + (calls['Brave Search'] - before) + ' metered checks, not one');

  const m0 = metered();
  const h = await held();
  assert.equal(h['Brave Search'].held, true, 'the stored token is not reported');
  assert.equal(h['Brave Search'].connect, 'brave-search', 'the door word an agent uses is missing');
  assert.equal(h.Exa.held, false, 'a door with no token reads as held');
  assert.equal(h.GitHub.how, 'sign-in');
  assert.equal(metered(), m0, 'the agents\' read called a metered service');

  // CONTROL: the page's full sweep DOES check (and so is not for agents), with these same counters.
  const s = await fetch(base + '/api/connections');
  const shelf = await s.json();
  assert.ok(metered() > m0, 'the counters did not move on the full sweep, so the zero above proves nothing');
  // And the row the person sees shows the service the agent connected.
  assert.equal(shelf.doors['/api/svc/brave-search'].connected, true, 'the Connections row does not show the service the agent connected');
});

test('#4451: the agents\' read is refused cross-site, before it reads anything', async () => {
  const r = await fetch(base + '/api/connections/held', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);
  // CONTROL: same-origin passes.
  assert.equal((await fetch(base + '/api/connections/held', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('#4451: a token the service refuses is not kept, and the read still says not connected', async () => {
  const door = tokendoors.byName('Exa');
  door.setFetcher(async () => { calls.Exa += 1; return { ok: false, status: 401, body: {} }; });
  try {
    const r = await fetch(base + '/api/svc/exa/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
    const st = await r.json();
    assert.equal(r.status, 400);
    assert.ok(st.refused, 'a refused token was not reported refused');
    assert.equal((await held()).Exa.held, false, 'a token the service refused was kept');
  } finally {
    door.setFetcher(async () => { calls.Exa += 1; return { ok: true, status: 200, body: {} }; });
  }
});
