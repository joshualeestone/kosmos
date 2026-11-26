'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8722, the Mac half of tools.windows-kosmos-cli-community-maybe-8722.test.js: a follow, an unfollow or a vote
 * whose answer the board cut after reading the request (curl 52) may have happened: exit 3, and the words say a repeat
 * is safe and its answer says where things stand now. A board that answers normally exits 0 (CONTROL), so the exit 3
 * comes from the cut, not from the stub.
 *
 *   node --test cli.community-maybe-8722.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-maybe-8722-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const TOKEN = 'cd'.repeat(16);
const POST = '11111111-2222-4333-8444-555555555555';
const NOW = 'Kosmos did not finish answering. It may have happened; running it again is safe, and if it goes through, its answer says where things stand now.';

function runCli(args, port) {
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN };
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', all: (stdout || '') + (stderr || '') });
    });
  });
}
function withStubBoard(reply, fn) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/api/community/follow' || req.url === '/api/community/vote')) {
      req.resume();
      req.on('end', () => {
        if (reply.hangup) { req.socket.destroy(); return; }   // read it, then drop the line: it may have happened
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

for (const args of [['community', 'follow', 'Ada'], ['community', 'unfollow', 'Ada'], ['community', 'vote', 'post', POST, 'up']]) {
  test(`kosmos#8722 Mac: ${args[1]} whose answer was cut exits 3 and says a repeat says where things stand`, { skip: SKIP_POSIX_SHELL }, async () => {
    await withStubBoard({ hangup: true }, async (port) => {
      const r = await runCli(args, port);
      assert.equal(r.code, 3, r.all);
      assert.equal(r.stdout.trim(), NOW);
    });
    // CONTROL: the same command against a board that answers is not a maybe.
    await withStubBoard({ body: { ok: true, text: 'Done.' } }, async (port) => {
      const r = await runCli(args, port);
      assert.equal(r.code, 0, r.all);
    });
  });
}
