'use strict';
/*
 * #5393 route slice: GET /api/worlds/overview over HTTP against a real sandboxed board. Every Kosmos's count of
 * tasks nobody is on, read from its own projects.json, and provider state for the running Kosmos only.
 *
 *   node --test server.worlds-overview-5393.test.js
 *
 * Sandbox env is set ONCE at module load and the board started ONCE, as every server-route test does.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function mkroot(t) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-woverview-' + t)); }

const SANDBOX = mkroot('data-');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

// A fixture pane source, so the board reads these cards and never the live fleet.
const fleet = require('./test-support/fleet');
const srv = require('./server.js');
const worlds = require('./engine/worlds.js');
const store = require('./engine/store.js');

let server;
let baseUrl;
before(async () => {
  fleet.install([
    fleet.agent('alpha', { state: 'idle', displayName: 'Alpha' }),
    fleet.agent('beta', { state: 'rate_limited', displayName: 'Beta' }),
    fleet.agent('carol', { state: 'unknown', displayName: 'Carol', runner: 'codex' }),
    fleet.agent('gone', { state: 'idle', displayName: 'Gone', runner: 'gemini' }),
  ]);
  // 'gone' was removed: its card must not count toward any provider (the /api/status filter).
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'gone', removedAt: '2026-10-06T00:00:00Z' }]));
  server = await srv.start(0);
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { fleet.restore(); } catch { /* best effort */ }
});

const j = (r) => r.json();
const task = (n, extra) => ({ number: n, sentence: 'task ' + n, ...extra });

test('#5393 GET /api/worlds/overview: counts per Kosmos, providers for the running one only', async () => {
  // The running (default) Kosmos: its projects.json is the board's own store.
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), JSON.stringify([
    { id: 'p1', tasks: [task(1), task(2), task(3, { onHold: true }), task(4, { closedAt: '2026-10-01T00:00:00Z' })] },
  ]));
  const made = await fetch(baseUrl + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Elsewhere' }) }).then(j);
  assert.equal(made.ok, true, made.because || '');
  const base = worlds.baseRoot(process.env);
  fs.writeFileSync(path.join(worlds.worldStoreRoot(base, made.world), 'projects.json'), JSON.stringify([
    { id: 'q1', paused: true, tasks: [task(1)] },
    { id: 'q2', tasks: [task(1), task(2), task(3)] },
  ]));

  const res = await fetch(baseUrl + '/api/worlds/overview');
  assert.equal(res.status, 200);
  const body = await res.json();
  const def = body.worlds.find((w) => w.id === worlds.DEFAULT_ID);
  const other = body.worlds.find((w) => w.id === made.world.id);

  assert.equal(def.running, true, 'the board booted into the default Kosmos');
  assert.deepEqual(def.unassigned, { waiting: 2, held: 1 });
  assert.deepEqual(def.providers.map((p) => [p.provider, p.state, p.agents, p.paused]), [['claude', 'some_paused', 2, 1], ['codex', 'not_paused', 1, 0]],
    'removed agent left out (no gemini row); one of two Claude agents limited reads some_paused');
  assert.equal(def.providersBecause, null);

  assert.equal(other.running, false);
  assert.deepEqual(other.unassigned, { waiting: 3, held: 1 });
  assert.equal(other.providers, null);
  assert.match(other.providersBecause, /only while this Kosmos is open/);

  assert.ok(!JSON.stringify(body).includes(base), 'no filesystem path leaves the route');
});

test('#5393 GET /api/worlds/overview: a damaged Kosmos is said on its row, never a zero', async () => {
  const made = await fetch(baseUrl + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Damaged' }) }).then(j);
  const base = worlds.baseRoot(process.env);
  fs.writeFileSync(path.join(worlds.worldStoreRoot(base, made.world), 'projects.json'), '[{"id":');
  const body = await fetch(baseUrl + '/api/worlds/overview').then(j);
  const row = body.worlds.find((w) => w.id === made.world.id);
  assert.equal(row.unassigned, null);
  assert.match(row.unassignedBecause, /cannot make sense of it/);
  assert.ok(body.worlds.find((w) => w.id === worlds.DEFAULT_ID).unassigned, 'the other Kosmos still read');
});
