'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9219: `kosmos report <needs_you|blocked> --again` sends `"again":true` with no words of its own (the board
 * brings the wait back from its copy); --again with words, another option or another state is refused before any
 * request. Both CLIs, each against what reached the board (the Mac CLI a stub board that records requests, the Windows
 * CLI an injected fetch). Harness as cli.heldq-7915.test.js.
 *
 *   node --test cli.waitagain-9219.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const win = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-waitagain-9219-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
const HEALTH = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
function withBoard(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HEALTH); return; }
      hits.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ recorded: true, note: 'brought back' }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, hits); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}
const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });
const reportBodies = (hits) => hits.filter((h) => h.method === 'POST' && h.url.startsWith('/api/report')).map((h) => JSON.parse(h.body));


const REFUSED = [
  [['report', 'needs_you', '--again', 'new words'], /takes no words or other options/],
  [['report', 'needs_you', '--again', '--on', 'x'], /takes no words or other options/],
  [['report', 'needs_you', '--again', '--held'], /takes no words or other options/],
  [['report', 'blocked', '--again', '--auto'], /takes no words or other options/],
  [['report', 'working', '--again'], /--again goes only with needs_you or blocked/],
  [['report', 'clear', '--again'], /--again goes only with needs_you or blocked/],
];

test('#9219 Mac: --again sends again:true with no words; without it, no again; mixed or elsewhere refused before any request', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(async (port, hits) => {
    for (const state of ['needs_you', 'blocked']) {
      hits.length = 0;
      const r = await runCli(['report', state, '--again'], envFor(port));
      assert.equal(r.code, 0, state + ': ' + r.out);
      const bodies = reportBodies(hits);
      assert.equal(bodies.length, 1, JSON.stringify(hits));
      assert.equal(bodies[0].again, true);
      assert.equal(bodies[0].state, state);
      assert.equal(bodies[0].text, '', 'no words of its own: the board brings them back');
    }
    // CONTROL: an ordinary report sends again:false.
    hits.length = 0;
    const plain = await runCli(['report', 'needs_you', 'Which logo?'], envFor(port));
    assert.equal(plain.code, 0, plain.out);
    assert.equal(reportBodies(hits)[0].again, false);
    for (const [args, why] of REFUSED) {
      hits.length = 0;
      const r = await runCli(args, envFor(port));
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.out);
      assert.match(r.out, why, args.join(' '));
      assert.equal(hits.length, 0, args.join(' ') + ' reached the board');
    }
    const help = await runCli(['report'], envFor(port));
    assert.match(help.out, /--again \(needs_you or blocked only\)/);
  }));

const AGENT = 'ab'.repeat(16);
async function runWin(argv) {
  const calls = []; const out = []; const err = [];
  const code = await win.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD7915', agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), method: init.method, body: init.body });
      return { status: 200, text: async () => JSON.stringify({ recorded: true }) };
    },
  });
  const posts = calls.filter((c) => c.method === 'POST' && c.route.startsWith('/api/report')).map((c) => JSON.parse(c.body));
  return { code, posts, out: out.join('\n'), err: err.join('\n') };
}

test('#9219 Windows: the same, through the CLI\'s own main()', async () => {
  for (const state of ['needs_you', 'blocked']) {
    const r = await runWin(['report', state, '--again']);
    assert.equal(r.code, 0, state + ': ' + r.err);
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].again, true);
    assert.equal(r.posts[0].text, '');
  }
  const plain = await runWin(['report', 'needs_you', 'Which logo?']);
  assert.equal(plain.posts[0].again, undefined, 'CONTROL: an ordinary report sends no again');
  for (const [argv, why] of REFUSED) {
    const r = await runWin(argv);
    assert.equal(r.code, 2, argv.join(' ') + ': ' + r.err);
    assert.match(r.err, why, argv.join(' '));
    assert.equal(r.posts.length, 0, argv.join(' ') + ' reached the board');
  }
  const usage = await runWin(['report']);
  assert.match(usage.err, /--again \(needs_you or blocked only\)/);
});
