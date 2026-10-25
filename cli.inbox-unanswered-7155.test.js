'use strict';

/**
 * kosmos#7155: `kosmos inbox --unanswered` and `--since <time>` reach the board as the same query from the Mac CLI and
 * the Windows CLI, and a bad time is refused before any request. Driven against a stub board (as cli.inbox-4784).
 *
 *   node --test cli.inbox-unanswered-7155.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

// #4796: a data root of its own, so the CLI never reads this computer's board token and sends it to the stub.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-inbox-7155-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(16);
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: TOKEN });
const TEXT = '2026-09-30 21:00:20Z the person: Please check the invoice\n2026-09-30 21:00:30Z you: On it.\n';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply = { status: 200, text: TEXT }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/inbox')) {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(reply.status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(reply.text);
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
const win = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD7155', agentToken: realHook.agentToken };
async function runWin(argv) {
  const calls = []; const err = [];
  const code = await win.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN }, hook: hookStub, out: () => {}, err: (s) => err.push(s),
    fetch: async (url) => { calls.push(url.replace('http://127.0.0.1:1', '')); return { status: 200, text: async () => 'ok\n' }; },
  });
  return { code, calls, err: err.join('\n') };
}

/* The same flags reach the board as the same query on both CLIs. */
const CASES = [
  [['--unanswered'], '&unanswered=1'],
  [['--since', '2026-10-25T05:22:00-05:00'], '&since=2026-10-25T05%3A22%3A00-05%3A00'],
  [['--since=2026-10-25 05:22'], '&since=2026-10-25%2005%3A22'],
  [['--since', '2026-10-25T10:22:00+01:00', '--unanswered', '--limit', '3'], '&unanswered=1&since=2026-10-25T10%3A22%3A00%2B01%3A00'],
];

test('#7155: inbox --unanswered and --since ride to the board, the same on the Mac and Windows CLIs', () => withStubBoard(async (port, seen) => {
  for (const [args, extra] of CASES) {
    seen.length = 0;
    const limit = args.includes('--limit') ? '3' : '';
    const want = '/api/inbox?as=text&limit=' + limit + '&from_pane=%257' + extra;
    const out = await runCli(['inbox', ...args], envFor(port));
    assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, want, 'Mac: ' + args.join(' '));
    const w = await runWin(['inbox', ...args]);
    assert.equal(w.code, 0, w.err);
    assert.equal(w.calls[0], want.replace('%257', ''), 'Windows: ' + args.join(' '));
  }
  // Control: no flag, no addition, so the old query is unchanged.
  seen.length = 0;
  await runCli(['inbox'], envFor(port));
  assert.equal(seen[0].url, '/api/inbox?as=text&limit=&from_pane=%257');
}));

test('#7155: a --since with no value or with characters no time holds is refused before any request', () => withStubBoard(async (port, seen) => {
  for (const args of [['--since'], ['--since='], ['--since', '$(id)'], ['--since', '05:22&x=1']]) {
    const out = await runCli(['inbox', ...args], envFor(port));
    assert.equal(out.code, 2, 'Mac ' + args.join(' ') + ': ' + out.stdout + out.stderr);
    const w = await runWin(['inbox', ...args]);
    assert.equal(w.code, 2, 'Windows ' + args.join(' '));
    assert.equal(w.calls.length, 0, 'Windows sent ' + args.join(' '));
  }
  assert.equal(seen.length, 0, 'the Mac CLI sent a bad --since');
}));

test('#7155: --help names the new flags on both CLIs', async () => {
  const out = await runCli(['inbox', '--help'], envFor(1));
  assert.match(out.stdout, /\[--unanswered\] \[--since <time>\]/);
  const err = [];
  await win.main(['inbox', '--help'], { env: {}, hook: hookStub, out: (s) => err.push(s), err: (s) => err.push(s), fetch: async () => { throw new Error('no request'); } });
  assert.match(err.join('\n'), /\[--unanswered\] \[--since <time>\]/);
});
