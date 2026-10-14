'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
/* #6071 (slice D1): `kosmos tool-failed <tool> <signature>`, the error line on stdin, posts the hook's digest to
 * POST /api/toolfail. The real CLI against a stand-in board that records what arrives.
 *   node --test cli.tool-failed-6071.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-toolfail-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
const CLI = path.join(__dirname, 'install', 'kosmos');
const SIG = 'd'.repeat(64);

function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/toolfail')) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = { unreadable: body }; }
        seen.push({ token: req.headers['x-kosmos-agent-token'], body: parsed });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"recorded":true}');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function cli(port, args, stdin, extraEnv) {
  return new Promise((resolve) => {
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
      AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'ab12cd', ...(extraEnv || {}) };
    const child = cp.spawn(CLI, args, { env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(stdin == null ? '' : stdin);
  });
}

test('the digest arrives as one readable body: tool, signature, the first error line, the pane; with the agent token', () => withStub(async (port, seen) => {
  const r = await cli(port, ['tool-failed', 'Bash', SIG], 'Exit code 2\nsecond line', { TMUX_PANE: '%5' });
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].body, { tool: 'Bash', sig: SIG, error: 'Exit code 2', from_pane: '%5' });
  assert.equal(seen[0].token, 'ab12cd');
}));

test('quotes, backslashes and control characters stay readable JSON, even cut at the length limit', () => withStub(async (port, seen) => {
  /* 299 characters then a quote: escaped first and cut after, the cut would fall between \ and " and leave a lone
     backslash escaping the closing quote. */
  const tricky = 'a'.repeat(299) + '"\t tail \\ end';
  await cli(port, ['tool-failed', 'Edit "x"', SIG], tricky);
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].body.unreadable, 'the body is not JSON: ' + JSON.stringify(seen[0].body).slice(0, 200));
  assert.equal(seen[0].body.tool, 'Edit "x"');
  assert.equal(seen[0].body.error, tricky.slice(0, 300).replace(/\t/g, ' '));
}));

test('a signature that is not hex sends nothing, and the verb always exits 0', () => withStub(async (port, seen) => {
  for (const sig of ['', 'xyz', SIG + '"']) {
    const r = await cli(port, ['tool-failed', 'Bash', sig], 'e');
    assert.equal(r.code, 0);
  }
  assert.equal(seen.length, 0);
}));

test('no board answering still exits 0', async () => {
  const r = await cli(1, ['tool-failed', 'Bash', SIG], 'e');
  assert.equal(r.code, 0, r.out);
});
