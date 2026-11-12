'use strict';
/**
 * kosmos#7915: `kosmos report needs_you --held '<question>'` sends `"held":true` to the board; anything else sends
 * `"held":false`; --held on any other state is refused before any request. Both CLIs, each against what reached the
 * board (the Mac CLI a stub board that records requests, the Windows CLI an injected fetch).
 *
 *   node --test cli.heldq-7915.test.js
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
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-heldq-7915-'));
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
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ recorded: true, note: 'Held: the board shows it' }));
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

test('#7915 Mac: --held sends held:true on a needs_you; without it held:false; elsewhere refused before any request', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(async (port, hits) => {
    const held = await runCli(['report', 'needs_you', '--held', 'Which logo?'], envFor(port));
    assert.equal(held.code, 0, held.out);
    let bodies = reportBodies(hits);
    assert.equal(bodies.length, 1, JSON.stringify(hits));
    assert.equal(bodies[0].held, true);
    assert.equal(bodies[0].state, 'needs_you');
    assert.equal(bodies[0].text, 'Which logo?', 'the flag is not part of the question');
    assert.match(held.out, /Held: the board shows it/, 'the board\'s note is printed');
    // CONTROL: the same report without the flag sends held:false.
    hits.length = 0;
    const plain = await runCli(['report', 'needs_you', 'Which logo?'], envFor(port));
    assert.equal(plain.code, 0, plain.out);
    bodies = reportBodies(hits);
    assert.equal(bodies[0].held, false);
    for (const args of [['report', 'working', '--held', 'x'], ['report', 'blocked', '--held', '--on', 'deploy'], ['report', 'clear', '--held']]) {
      hits.length = 0;
      const r = await runCli(args, envFor(port));
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.out);
      assert.match(r.out, /--held goes only with needs_you/, args.join(' '));
      assert.equal(hits.length, 0, args.join(' ') + ' reached the board');
    }
    hits.length = 0;
    const auto = await runCli(['report', 'needs_you', '--held', '--auto', 'x'], envFor(port));
    assert.equal(auto.code, 2, auto.out);
    assert.match(auto.out, /takes no --auto/);
    assert.equal(hits.length, 0, '--held --auto reached the board');
  }));

test('#7915 Mac: the report usage names --held', { skip: SKIP_POSIX_SHELL }, async () => {
  const r = await runCli(['report'], { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: '9' });
  assert.match(r.out, /\[--held\]/);
  assert.match(r.out, /--held \(needs_you only\)/);
});

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

test('#7915 Windows: the same, through the CLI\'s own main()', async () => {
  const held = await runWin(['report', 'needs_you', '--held', 'Which logo?']);
  assert.equal(held.code, 0, held.err);
  assert.equal(held.posts.length, 1);
  assert.equal(held.posts[0].held, true);
  assert.equal(held.posts[0].text, 'Which logo?');
  const plain = await runWin(['report', 'needs_you', 'Which logo?']);
  assert.equal(plain.posts[0].held, false, 'CONTROL');
  for (const argv of [['report', 'working', '--held', 'x'], ['report', 'clear', '--held']]) {
    const r = await runWin(argv);
    assert.equal(r.code, 2, argv.join(' ') + ': ' + r.err);
    assert.match(r.err, /--held goes only with needs_you/);
    assert.equal(r.posts.length, 0, argv.join(' ') + ' reached the board');
  }
  const auto = await runWin(['report', 'needs_you', '--held', '--auto', 'x']);
  assert.equal(auto.code, 2, auto.err);
  assert.match(auto.err, /takes no --auto/);
  assert.equal(auto.posts.length, 0, '--held --auto reached the board');
  const usage = await runWin(['report']);
  assert.match(usage.err, /\[--held\]/);
});
