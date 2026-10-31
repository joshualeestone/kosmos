'use strict';
/*
 * #7206: GET /api/worlds/overview over HTTP against a real sandboxed board. A DeepSeek agent runs Claude Code, so its
 * card's runner is claude; the route tags it from its launch job (a claude job on a .kosmos-deepseek-* folder) and the
 * overview gives DeepSeek its own row. Its rate limit or failed sign-in is then never counted under Claude, which
 * would tell the person their Claude agents are limited. A Claude agent beside it is the control.
 *
 *   node --test server.worlds-overview-deepseek-7206.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function mkroot(t) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-woverview-ds-' + t)); }

const SANDBOX = mkroot('data-');
const HOME = mkroot('home-');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const fleet = require('./test-support/fleet');
const jobfix = require('./test-support/jobfixture');
const srv = require('./server.js');
const create = require('./engine/create');
const compat = require('./engine/anthropiccompat');
const worlds = require('./engine/worlds.js');

/* Each agent's launch job, as create writes it: the DeepSeek one on a DeepSeek account folder, the Claude one on a
   Claude folder. The job is what the route reads (create.agentProvider). */
function job(name, configDir) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, '/bin/echo', '/bin/echo', null, configDir, 'claude'), 'utf8');
}
const DS_HOME = path.join(HOME, '.kosmos-deepseek-work');
compat.storeAccount(DS_HOME, { vendor: 'deepseek', model: 'deepseek-chat', key: 'sk-deepseek-0123456789abcdef' });
const CLAUDE_HOME = path.join(HOME, '.claude-work');
fs.mkdirSync(CLAUDE_HOME, { recursive: true });

let server;
let baseUrl;
before(async () => {
  fleet.install([
    fleet.agent('cleo', { state: 'idle', displayName: 'Cleo', runner: 'claude' }),
    fleet.agent('dee', { state: 'rate_limited', displayName: 'Dee', runner: 'claude' }),
  ]);
  job('cleo', CLAUDE_HOME);
  job('dee', DS_HOME);
  assert.equal(create.agentProvider('dee', 'claude'), 'deepseek', 'PRE-CONTROL: the DeepSeek job does not read as DeepSeek');
  assert.equal(create.agentProvider('cleo', 'claude'), 'anthropic', 'PRE-CONTROL: the Claude job does not read as Claude');
  server = await srv.start(0);
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { fleet.restore(); } catch { /* best effort */ }
});

test('#7206 GET /api/worlds/overview: a rate-limited DeepSeek agent is its own row, and Claude is not paused', async () => {
  const res = await fetch(baseUrl + '/api/worlds/overview');
  assert.equal(res.status, 200);
  const body = await res.json();
  const def = body.worlds.find((w) => w.id === worlds.DEFAULT_ID);
  assert.ok(def && Array.isArray(def.providers), 'no providers for the running Kosmos: ' + JSON.stringify(body));
  const rows = Object.fromEntries(def.providers.map((p) => [p.provider, [p.state, p.agents, p.paused]]));
  assert.deepEqual(rows.deepseek, ['paused', 1, 1], 'DeepSeek has no row of its own: ' + JSON.stringify(def.providers));
  assert.deepEqual(rows.claude, ['not_paused', 1, 0], 'CONTROL: the DeepSeek pause was counted under Claude: ' + JSON.stringify(def.providers));
});
