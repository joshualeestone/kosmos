'use strict';
/**
 * kosmos#8071: `kosmos agent restart "<name>" [--yes]` restarts one agent through the agent page's own Restart
 * (POST /api/agent/<name>/restart). A person confirms at a terminal; a script says --yes, and with neither nothing is
 * sent. Run against a stub board in a sandboxed KOSMOS_HOME for install/kosmos, and in process for the Windows CLI, as
 * cli.agent-remove-7362.test.js does. Every negative case has a control showing the same stub records a POST.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agentrs-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');

// engine/remove.js restart()'s answers, in its own words (review 1: the real sentences, not one-liners).
const RESTARTED = [200, { outcome: 'restarted', because: 'Sally Sales is starting again. It will read its instructions when it comes back. Its folder and everything in it are as they were.', steps: [] }];
const REFUSED = [400, { outcome: 'refused', because: 'it was not started: it is moving to another account now', steps: [] }];
const PARTIAL = [200, { outcome: 'partial', because: "we could not close Sally Sales's window, so it is still running the older instructions. Nothing was changed.", steps: [] }];
const THREW = [500, { error: 'we could not restart this agent', detail: 'tmux: no server running' }];

function withStub(reply, fn, self = 'me-agent') {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      if (req.url === '/api/whoami') {   // who is asking: the self-check
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agent: self }));
        return;
      }
      if (/^\/api\/agent\/[^/]+\/restart$/.test(req.url)) {
        seen.push({ method: req.method, url: req.url, body: raw, headers: req.headers });
        res.writeHead(reply[0], { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply[1]));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

async function cli(port, args) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 30000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('kosmos#8071 Mac: --yes restarts through the agent page\'s own route and says the board\'s words', () => withStub(RESTARTED, async (port, seen) => {
  const r = await cli(port, ['agent', 'restart', ' Sally Sales ', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['POST /api/agent/Sally%20Sales/restart'], 'not one POST to the named agent (name trimmed)');
  assert.match(r.out, /Restarting Sally Sales stops what it is doing now/);
  assert.match(r.out, /Sally Sales is starting again\. It will read its instructions when it comes back\. Its folder and everything in it are as they were\.$/m);
}));

test('kosmos#8071 review 1: never yourself, on either platform; a route that threw is "may be partly restarted", exit 3', async () => {
  await withStub(RESTARTED, async (port, seen) => {
    const r = await cli(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /Nothing was restarted: Sally Sales is you/);
    const w = await winRun(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(w.code, 2, w.err);
    assert.equal(seen.length, 0, 'an agent restarted itself');
  }, 'Sally Sales');
  await withStub(THREW, async (port) => {
    const r = await cli(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /Sally Sales may be partly restarted: we could not restart this agent\. Look at its page before trying again/);
    const w = await winRun(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(w.code, 3, w.err);
    assert.match(w.err, /may be partly restarted/);
  });
});

test('kosmos#8071 Mac: a refusal and a partial restart exit 1 in the board\'s words', async () => {
  await withStub(REFUSED, async (port) => {
    const r = await cli(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos did not restart Sally Sales: it was not started: it is moving to another account now\./);
  });
  await withStub(PARTIAL, async (port) => {
    const r = await cli(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Not restarted as asked: we could not close Sally Sales's window, so it is still running the older instructions\. Nothing was changed\./);
  });
});

test('kosmos#8071 Mac: no --yes and no terminal, an option-shaped name, a missing name or an extra word: nothing is sent', () => withStub(RESTARTED, async (port, seen) => {
  const r = await cli(port, ['agent', 'restart', 'Sally Sales']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Nothing was restarted: there is no terminal here to confirm on\. To restart Sally Sales without being asked, add --yes\./);
  assert.equal((await cli(port, ['agent', 'restart', '--foo', '--yes'])).code, 2);
  assert.equal((await cli(port, ['agent', 'restart', '--yes'])).code, 2);
  assert.equal((await cli(port, ['agent', 'restart', 'sally', 'extra', '--yes'])).code, 2);
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
  assert.equal((await cli(port, ['agent', 'restart', 'sally', '--yes'])).code, 0, 'CONTROL: a good call was not sent');
  assert.equal(seen.length, 1);
}));

/* ── tools/windows/kosmos-cli.js, in process, against the same stub ─────────────── */

const wincli = require('./tools/windows/kosmos-cli');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_8071', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = [];
  const s = seams || {};
  const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x), canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); } });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

test('kosmos#8071 Windows: --yes restarts; at a terminal, y restarts and anything else cancels with nothing sent', () => withStub(RESTARTED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'restart', 'Sally Sales', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['POST /api/agent/Sally%20Sales/restart']);
  assert.match(r.out, /Sally Sales is starting again\./);
  for (const answer of ['', 'n', 'yess']) {
    const c = await winRun(port, ['agent', 'restart', 'Sally Sales'], { tty: true, answer });
    assert.equal(c.code, 1, JSON.stringify(answer));
    assert.match(c.err, /Cancelled\. Nothing was restarted\./);
  }
  assert.equal(seen.length, 1, 'a cancelled restart was sent');
  const y = await winRun(port, ['agent', 'restart', 'Sally Sales'], { tty: true, answer: 'y' });
  assert.equal(y.code, 0, y.err);
  assert.deepEqual(y.asked, ['Restart Sally Sales? [y/N] ']);
  assert.equal(seen.length, 2, 'CONTROL: a confirmed restart was not sent');
}));

test('kosmos#8071 Windows: a refusal and a partial restart exit 1; no terminal and no --yes sends nothing', async () => {
  await withStub(REFUSED, async (port) => {
    const r = await winRun(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Kosmos did not restart Sally Sales: it was not started: it is moving to another account now\./);
  });
  await withStub(PARTIAL, async (port) => {
    const r = await winRun(port, ['agent', 'restart', 'Sally Sales', '--yes']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Not restarted as asked: .*Nothing was changed\./);
  });
  await withStub(RESTARTED, async (port, seen) => {
    const r = await winRun(port, ['agent', 'restart', 'Sally Sales']);
    assert.equal(r.code, 2);
    assert.equal(seen.length, 0);
  });
});
