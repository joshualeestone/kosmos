'use strict';
/*
 * #2563 route slice: GET /api/worlds/list (counted) and POST /api/worlds with
 * importAgentsFrom (copy agents into the new Kosmos), exercised over HTTP against a
 * real sandboxed board -- the vertical slice the web selector calls.
 *
 *   node --test server.worlds-import-2563.test.js
 *
 * Sandbox env is set ONCE at module load and the board is started ONCE (test.before),
 * matching every other server-route test in the tree. The many engine modules that
 * freeze store.ROOT at require time therefore all resolve against this one sandbox --
 * re-sandboxing mid-file would leave those frozen modules pointed at a stale root.
 * The two tests use distinct Kosmos names, so one board serves both.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function mkroot(t) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-wimport-' + t)); }

const SANDBOX = mkroot('data-');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

// Install a fixture PANE SOURCE before starting the server: pointing the tmux var at
// /bin/echo without one lets the board's pane reads fall through to the LIVE fleet (a
// real hazard the shipped meta-guard enforces). fleet.install sets the status
// pane-source seam to a fixture, so this board reads the fixture, never real agents.
const fleet = require('./test-support/fleet');
const srv = require('./server.js');
const worlds = require('./engine/worlds.js');

let server;
let baseUrl;
before(async () => {
  fleet.install([fleet.agent('probe', { state: 'idle', displayName: 'Probe' })]);
  server = await srv.start(0);
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { fleet.restore(); } catch { /* best effort: clear the pane-source seam */ }
});

const j = (r) => r.json();
function seedProfile(world, name, body) {
  const base = worlds.baseRoot(process.env);
  const dir = worlds.worldProfilesDir(base, world);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(body || { name }));
}

test('#2563 POST /api/worlds importAgentsFrom copies agents into the new Kosmos, source unchanged', async () => {
  const src = await fetch(baseUrl + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Source' }) }).then(j);
  assert.equal(src.ok, true, src.because || '');
  seedProfile(src.world, 'alice', { name: 'alice', role: 'analyst' });
  seedProfile(src.world, 'bob', { name: 'bob' });

  const made = await fetch(baseUrl + '/api/worlds', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dest', importAgentsFrom: [src.world.id] }),
  }).then(j);
  assert.equal(made.ok, true, made.because || '');
  assert.ok(made.imported, 'the response reports what it imported');
  assert.equal(made.imported.copied, 2, 'both source agents were copied');
  assert.equal(made.imported.skipped, 0);

  const b = worlds.baseRoot(process.env);
  assert.equal(worlds.agentCount(b, made.world), 2, 'target holds both imported agents');
  assert.equal(worlds.agentCount(b, src.world), 2, 'source is unchanged');
});

test('#2563 GET /api/worlds/list returns each Kosmos with an agentCount', async () => {
  const w = await fetch(baseUrl + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Counted' }) }).then(j);
  seedProfile(w.world, 'alice');
  seedProfile(w.world, 'bob');

  const list = await fetch(baseUrl + '/api/worlds/list').then(j);
  assert.ok(Array.isArray(list.worlds), 'worlds is an array');
  const row = list.worlds.find((x) => x.id === w.world.id);
  assert.ok(row, 'the created Kosmos is listed');
  assert.equal(row.agentCount, 2, 'its agent count is reported');
  assert.ok('name' in row && 'id' in row, 'each row carries id + name for the selector');
  // CONTROL: a plain create (no import) still 200s and reports no `imported` block
  const plain = await fetch(baseUrl + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Plain' }) }).then(j);
  assert.equal(plain.ok, true);
  assert.equal(plain.imported, undefined, 'a create without importAgentsFrom is byte-for-byte the old shape');
});
