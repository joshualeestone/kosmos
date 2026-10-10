'use strict';
/**
 * kosmos#5643: POST /api/project/:id/task/:n/ran takes `unchanged: true` (a run that found nothing new) and refuses any
 * value that is not true or false; the engine rules are in engine/tasks.runrollup-5643.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ransrv-5643-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const ran = async (id, n, body) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/ran`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('#5643: the ran route records an unchanged run (sent as the screen sends a request), and refuses unchanged that is not true or false', async () => {
  const p = projects.create({ name: 'Ran route' });
  const n = tasks.create(p.id, { sentence: 'Watch it' }).number;
  tasks.setRepeat(p.id, n, { every: 'hour' });
  const w = await ran(p.id, n, { note: 'all clear', unchanged: true });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.task.lastRunUnchanged, true);
  assert.equal(w.json.task.unchangedRuns, 1);
  const bad = await ran(p.id, n, { note: 'x', unchanged: 'yes' });
  assert.equal(bad.status, 400, 'a non-boolean unchanged was taken');
  assert.match(bad.json.error, /unchanged is true or false/);
});

test('#5643 retry review 1: the ran route passes run_id, so the same id is one run however late it lands', async () => {
  const p = projects.create({ name: 'Ran route id' });
  const n = tasks.create(p.id, { sentence: 'Watch it' }).number;
  tasks.setRepeat(p.id, n, { every: 'hour' });
  const a = await ran(p.id, n, { note: 'all clear', run_id: 'ab12cd34ef56ab78' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.task.lastRunId, 'ab12cd34ef56ab78', 'the route dropped run_id');
  // Push the recorded run past the time window, as a board that stalled would see it.
  projects.mutate(p.id, (pr) => { const t = tasks.byNumber(pr, n); t.lastRunAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); return pr; });
  const b = await ran(p.id, n, { note: 'all clear', run_id: 'ab12cd34ef56ab78' });
  assert.equal(b.json.duplicate, true, 'a late attempt of the same command was recorded twice');
  const c = await ran(p.id, n, { note: 'all clear', run_id: 'ffffeeee00001111' });
  assert.notEqual(c.json.duplicate, true, 'CONTROL: a new command was taken as the old run');
});
