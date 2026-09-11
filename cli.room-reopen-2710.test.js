'use strict';
/**
 * kosmos#2710, the CLI half:
 *   - a post the room loop-guard refuses no longer ends in a doubled period
 *     ("...bring you in.." -> "...bring you in."), and the agent's text is
 *     HANDED BACK so a refused substantive post is not silently lost;
 *   - `kosmos room reopen <project-id>` clears a held room over HTTP, and its
 *     usage / not-found arms behave.
 *
 * Same stub-server posture as cli.post-setE-2321.test.js: a fake board serves
 * the health page (so healthy() passes) and canned JSON for the routes under
 * test, and the real `install/kosmos` script is driven with execFile.
 *
 *   node --test cli.room-reopen-2710.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const HEALTH = '<title>Kosmos</title>Agent Workforce';
const VALVE_BECAUSE = 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.';

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* A stub board. `routes` maps "METHOD /path-prefix" to { code, body }; any GET
   not matched serves the health page so healthy() passes. */
function withBoard(routes, fn) {
  const server = http.createServer((req, res) => {
    for (const key of Object.keys(routes)) {
      const [m, p] = key.split(' ');
      if (req.method === m && req.url.startsWith(p)) {
        const r = routes[key];
        res.writeHead(r.code, { 'content-type': 'application/json' });
        res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
        return;
      }
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(HEALTH);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#2710: a valve-refused post ends in ONE period and hands the agent its text back', () => {
  const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', because: VALVE_BECAUSE } } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const TEXT = 'the lease renews monthly unless notice is given, which changes our timeline';
    const out = await runCli(['post', 'henderson', TEXT], env);
    assert.match(out.stdout, /bring you in\./, 'the refusal sentence is missing');
    assert.doesNotMatch(out.stdout, /bring you in\.\./, 'the refusal still ends in a doubled period');
    assert.ok(out.stdout.includes(TEXT), 'the agent’s text was not handed back, so a refused post is still lost');
    assert.match(out.stdout, /not sent/, 'the hand-back does not tell the agent the post was not sent');
    assert.notEqual(out.code, 0, 'a not-posted result must exit non-zero');
  });
});

test('#2710: `kosmos room reopen <project>` clears a held room and says so', () => {
  const routes = { 'POST /api/project/henderson/room/reopen': { code: 200, body: { ok: true, at: '2026-09-10T20:00:00.000Z' } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen', 'henderson'], env);
    assert.match(out.stdout, /Reopened henderson/, 'reopen did not confirm the room was reopened: ' + out.stdout);
    assert.equal(out.code, 0, 'a successful reopen must exit 0');
  });
});

test('#2710: `kosmos room reopen` with no project prints usage and exits 2', () => {
  return withBoard({}, async (port) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen'], env);
    assert.match(out.stdout, /Usage: kosmos room reopen/, 'no-project reopen did not print its usage');
    assert.equal(out.code, 2, 'a usage error must exit 2');
  });
});

test('#2710: reopen of an unknown project reports it and exits non-zero', () => {
  const routes = { 'POST /api/project/nope/room/reopen': { code: 404, body: { ok: false, because: 'there is no project by that name' } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen', 'nope'], env);
    assert.match(out.stdout, /no project called "nope"/, 'a 404 reopen was not reported clearly: ' + out.stdout);
    assert.notEqual(out.code, 0, 'a failed reopen must exit non-zero');
  });
});
