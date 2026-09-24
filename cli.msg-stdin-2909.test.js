'use strict';

/**
 * #2909: `kosmos msg --stdin <agent>` reads the direct message from standard input, so backticks
 * and $ reach the agent as written. It shares the post --stdin reader (_read_piped_message), so
 * these tests cover what msg adds: the flag and its refusals, curl-on-stdin, and keeping a piped
 * message on every failure after the read. Same harness as cli.post-stdin-2909.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env, input, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(CLI, args, { env, timeout: timeoutMs || 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 'no exit code (' + (err.signal || err.code) + ')') : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input === undefined ? '' : input);
  });
}

function withStubBoard(fn, reply, stallMs) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/msg')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push(body);
        const answer = () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(reply || '{"delivery":{"state":"placed"}}');
        };
        if (stallMs) setTimeout(answer, stallMs); else answer();
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

const envFor = (port) => ({ ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });
const RICH = 'Run `echo PWNED` then check $HOME and "quotes" \\ backslash\n\n- one\n- two';

test('#2909: kosmos msg --stdin delivers backticks, $, quotes and newlines as written', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['msg', '--stdin', 'mara'], envFor(port), RICH + '\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].to, 'mara');
  assert.equal(seen[0].text, RICH);
}));

test('#2909 CONTROL: without --stdin, msg still takes its words from the args and never reads stdin', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['msg', 'mara', 'plain', 'words'], envFor(port), 'this must not be read');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'plain words');
}));

test('#2909: msg --stdin refusals send nothing (args too, trailing flag, empty pipe, no agent)', () => withStubBoard(async (port, seen) => {
  const mixed = await runCli(['msg', '--stdin', 'mara', 'also'], envFor(port), 'x');
  assert.equal(mixed.code, 2);
  assert.match(mixed.stdout, /stdin OR as arguments/);
  const trailing = await runCli(['msg', 'mara', '--stdin'], envFor(port), 'x');
  assert.equal(trailing.code, 2);
  assert.match(trailing.stdout, /--stdin must come before the agent name/);
  const empty = await runCli(['msg', '--stdin', 'mara'], envFor(port), '\n\u001b\n');
  assert.equal(empty.code, 2);
  assert.match(empty.stdout, /nothing was piped in: kosmos msg --stdin <agent>/);
  const noAgent = await runCli(['msg', '--stdin'], envFor(port), 'x');
  assert.equal(noAgent.code, 2);
  assert.match(noAgent.stdout, /Usage: kosmos msg \[--stdin\]/);
  assert.equal(seen.length, 0);
}));

test('#2909: a declined piped msg is kept in a private file, not lost', () => withStubBoard(async (port) => {
  const out = await runCli(['msg', '--stdin', 'mara'], envFor(port), 'MSG-BODY-2909');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Not delivered: mara is not running/);
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.ok(saved, out.stdout);
  try {
    assert.equal(fs.readFileSync(saved[1], 'utf8'), 'MSG-BODY-2909');
    assert.equal(fs.statSync(saved[1]).mode & 0o777, 0o600);
  } finally { fs.rmSync(saved[1], { force: true }); }
}, '{"delivery":{"state":"could_not","because":"mara is not running."}}'));

test('#2909: with Kosmos not running, a piped msg is read and kept, not lost', async () => {
  const out = await runCli(['msg', '--stdin', 'mara'], { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%42' }, 'DOWN-BODY');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.ok(saved, out.stdout);
  try { assert.equal(fs.readFileSync(saved[1], 'utf8'), 'DOWN-BODY'); } finally { fs.rmSync(saved[1], { force: true }); }
});

test('#2909: a piped msg with bytes that are not UTF-8 is sent, not aborted', () => withStubBoard(async (port, seen) => {
  // Pinned to a UTF-8 locale: that is where BSD sed/tr abort on a stray byte, so this test can fail.
  const out = await runCli(['msg', '--stdin', 'mara'], { ...envFor(port), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.equal(out.code, 0, 'a Latin-1 byte must not kill the msg escaper: ' + out.stdout + out.stderr);
  assert.equal(seen[0]._unparsable, undefined);
  assert.equal(seen[0].text, 'caf�');
}));

test('#2909: a 2 MB piped msg body reaches the board (curl on stdin, not argv)', () => withStubBoard(async (port, seen) => {
  const big = 'x'.repeat(2 * 1024 * 1024);
  const out = await runCli(['msg', '--stdin', 'mara'], envFor(port), big);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text.length, big.length);
}));

test('#2909: the msg usage line is the same sentence in install/kosmos and the Windows CLI', () => {
  const bash = fs.readFileSync(CLI, 'utf8').match(/say "(Usage: kosmos msg \[--stdin\][^"]*)"/);
  assert.ok(bash, 'install/kosmos must carry the msg usage line');
  assert.equal(bash[1].replace(/\\\$/g, '$'), require('./tools/windows/kosmos-cli').USAGE.msg);
});

test('#2909: a msg that times out is a "maybe": exit 3, do not re-send, and no copy is saved', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['msg', '--stdin', 'mara'], envFor(port), 'SLOW-BODY', 45000);
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /may have been delivered/);
  assert.doesNotMatch(out.stdout, /saved at/, 'a message that may have landed is not offered for re-sending');
  assert.equal(seen.length, 1, 'the board did receive it');
}, null, 17000));

test('#2909: a piped msg the board refuses, or one too large to send, is kept', () => withStubBoard(async (port) => {
  const refused = await runCli(['msg', '--stdin', 'mara'], envFor(port), 'REFUSED-BODY');
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /refused that request: no such agent/);
  const saved = refused.stdout.match(/saved at (\S+)/);
  assert.ok(saved, refused.stdout);
  try { assert.equal(fs.readFileSync(saved[1], 'utf8'), 'REFUSED-BODY'); } finally { fs.rmSync(saved[1], { force: true }); }
  const quotes = await runCli(['msg', '--stdin', 'mara'], envFor(port), '"'.repeat(3.5 * 1024 * 1024));
  assert.equal(quotes.code, 2);
  assert.match(quotes.stdout, /too large to send to the board/);
  const big = quotes.stdout.match(/saved at (\S+)/);
  assert.ok(big, quotes.stdout.slice(0, 300));
  fs.rmSync(big[1], { force: true });
}, '{"error":"no such agent"}'));

test('#2909: a wrong-world piped msg the outbox cannot keep is saved to a file', () => withStubBoard(async (port) => {
  const env = { ...envFor(port), KOSMOS_HOME: '/nonexistent-kosmos-home-2909' };
  const out = await runCli(['msg', '--stdin', 'mara'], env, 'WW-MSG');
  assert.equal(out.code, 1, 'KOSMOS_HOME points nowhere, so the outbox cannot keep it: ' + out.stdout);
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.ok(saved, out.stdout);
  try { assert.equal(fs.readFileSync(saved[1], 'utf8'), 'WW-MSG'); } finally { fs.rmSync(saved[1], { force: true }); }
}, '{"wrongWorld":true,"world":"other"}'));

test('#2909: msg keeps its existing tab/CR flattening (#1927), so only backticks and $ are promised verbatim', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['msg', '--stdin', 'mara'], envFor(port), 'a\tb `c` $d\r\ne\r\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'a b `c` $d \ne');
}));
