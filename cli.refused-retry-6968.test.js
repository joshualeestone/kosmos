'use strict';
/**
 * #6968: a board that is listening can still refuse a connection: one too busy to take new connections refuses
 * some outright (its accept queue is full; measured on macOS 2026-10-22, 40 connects at once: 3 refused, 36 timed
 * out, 1 reset), and one restarting refuses until it listens again. The CLI's health check had passed a moment
 * before, so the request's refusal (curl 7) used to end in "We could not reach Kosmos to ... Is it running?", and
 * agents concluded the board was down.
 *
 * kosmos_curl now tries a refused connection once more, a second later. These arms use a real refusal, not a curl
 * stub: the stub board answers the health check, closes its listening socket, and (refuse-once) listens again on the
 * same port 300 ms later, so the CLI's first connect for the request is refused by the kernel and its second lands.
 *   - refuse once, a read (`task list`): it succeeds, the request arrives once, and nothing says "could not reach".
 *   - CONTROL, refuse always: it fails with the new words (passing problem, nothing sent, no restart), never
 *     "Is it running?" and never "kosmos start".
 *   - refuse once, a write whose body is on stdin (`msg`): the retry sends the whole body (stdin is read once, so
 *     a retry that re-read it would send an empty body).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6968-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function runCli(args, env) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 40000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
  });
}
function baseEnv(port, extra = {}) {
  const env = { ...process.env };
  delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION; delete env.TMUX_PANE;
  // A throwaway KOSMOS_HOME and store roots, so no arm reads this machine's pidfile or board token.
  const home = fs.mkdtempSync(path.join(SCRATCH, 'home-'));
  return {
    ...env,
    KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
    ...extra,
  };
}

/** A board that answers its first health check, then stops listening; `back` ms later (null: never) it listens on
 *  the same port again. `seen` records each request after the health check, with its body. */
async function withRefusingBoard(back, fn) {
  const seen = [];
  let closedOnce = false;
  let current = null;
  const handler = (req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url.startsWith('/api/health')) {
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end('{"app":"kosmos","ok":true}');
        if (!closedOnce) {
          closedOnce = true;
          const port = current.address().port;
          // Stop listening at once: the next connect to this port is refused by the kernel.
          current.close();
          if (back !== null) setTimeout(() => { current = http.createServer(handler); current.listen(port, '127.0.0.1'); }, back);
        }
        return;
      }
      seen.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      if (req.url.startsWith('/api/tasks')) return res.end('{"tasks":[],"count":0,"project":"proj"}');
      if (req.url.startsWith('/api/msg')) return res.end('{"delivery":{"state":"placed","because":null,"id":"m1"}}');
      return res.end('{}');
    });
  };
  current = http.createServer(handler);
  const port = await new Promise((r) => current.listen(0, '127.0.0.1', () => r(current.address().port)));
  try { return await fn(port, seen); } finally {
    await new Promise((r) => { if (current.listening) current.close(r); else r(); });
  }
}

test('#6968: a board that refuses the request once and then accepts: `task list` succeeds, asked once more', () => withRefusingBoard(300, async (port, seen) => {
  const out = await runCli(['task', 'list', 'proj'], baseEnv(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout + out.stderr, /could not reach|did not take the connection|Is it running|kosmos start/);
  assert.equal(seen.filter((s) => s.url.startsWith('/api/tasks')).length, 1, 'the refused try sent nothing; the retry sent it once');
  assert.ok(out.ms >= 900, `it waited about a second before trying again (took ${out.ms} ms)`);
}));

test('#6968 CONTROL: a board that never takes the connection again: the passing-problem words, never "is it running?"', () => withRefusingBoard(null, async (port, seen) => {
  const out = await runCli(['task', 'list', 'proj'], baseEnv(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos did not take the connection, twice in a row, so we did not list tasks and nothing was sent\. This is usually a passing connection problem \(Kosmos busy for a moment, or restarting\): try again in a moment\. It does not need a restart/);
  assert.doesNotMatch(out.stdout, /Is it running|kosmos start/);
  assert.equal(seen.length, 0);
}));

test('#6968: a refused write whose body is on stdin (`msg`) sends the whole body on the retry', () => withRefusingBoard(300, async (port, seen) => {
  const out = await runCli(['msg', 'mara', 'the', 'whole', 'body'], baseEnv(port, { TMUX_PANE: '%42' }));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const sends = seen.filter((s) => s.method === 'POST' && s.url.startsWith('/api/msg'));
  assert.equal(sends.length, 1, JSON.stringify(seen));
  assert.match(sends[0].body, /the whole body/, 'the retry carried the body read from stdin: ' + sends[0].body);
}));
