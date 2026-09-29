'use strict';

/**
 * #4582: `kosmos reply --stdin` reads the answer to the person from standard input, so a formatted
 * multi-line reply keeps its backticks and $ (a quoted argument would have them substituted by the
 * shell). It shares the post/msg --stdin reader (_read_piped_message, #2909), so these tests cover
 * what reply adds: the flag and its refusals, curl on stdin, the timeout "maybe", and keeping a
 * piped reply on every failure after the read. Same harness as cli.msg-stdin-2909.test.js; the data
 * root is a temp folder so the CLI never reads this machine's real board token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reply-stdin-')));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

/* The multi-MB case escapes megabytes through sed; room a busy machine cannot eat (#3628). */
const BIG_INPUT_TIMEOUT_MS = 60000;

function runCli(args, env, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: timeoutMs || 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    // input === null leaves stdin OPEN and never writes to it, as a tool runner can: a CLI that
    // reads stdin then waits until the harness timeout kills it, which rejects.
    if (input === null) child.on('exit', () => child.stdin.destroy());
    else child.stdin.end(input === undefined ? '' : input);
  });
}

function withStubBoard(fn, reply, stallMs) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/reply')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push(body);
        const answer = () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(reply || '{"kept":true}');
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

const envFor = (port) => ({ ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42', AGENT_WORKFORCE_DATA: DATA });
const RICH = 'Run `echo PWNED` then check $HOME and "quotes" \\ backslash\n\n- one\n- two';
const savedPath = (out) => { const m = out.match(/saved at (\S+)/); return m && m[1]; };

test('#4582: kosmos reply --stdin keeps backticks, $, quotes and newlines as written', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--stdin'], envFor(port), RICH + '\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Answered/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, RICH);
  assert.equal(seen[0].from_pane, '%42');
}));

test('#4582 CONTROL: without --stdin, reply takes its words from the args and never reads stdin', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', 'plain', 'words'], envFor(port), null, 8000);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'plain words');
}));

test('#4582: reply --stdin refusals send nothing (args too, trailing flag, empty pipe, no words)', () => withStubBoard(async (port, seen) => {
  const mixed = await runCli(['reply', '--stdin', 'also'], envFor(port), 'x');
  assert.equal(mixed.code, 2);
  assert.match(mixed.stdout, /stdin OR as arguments/);
  const trailing = await runCli(['reply', 'hello', '--stdin'], envFor(port), 'x');
  assert.equal(trailing.code, 2);
  assert.match(trailing.stdout, /--stdin must come first/);
  const empty = await runCli(['reply', '--stdin'], envFor(port), '\n\u001b\n');
  assert.equal(empty.code, 2);
  assert.match(empty.stdout, /nothing was piped in: kosmos reply --stdin/);
  const none = await runCli(['reply'], envFor(port), 'x');
  assert.equal(none.code, 2);
  assert.match(none.stdout, /Usage: kosmos reply \[--stdin\]/);
  assert.equal(seen.length, 0);
}));

test('#4582: a piped reply the board refuses (over 2000 characters) is kept in a private file', () => withStubBoard(async (port, seen) => {
  const long = 'L'.repeat(2500);
  const out = await runCli(['reply', '--stdin'], envFor(port), long);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.equal(seen[0].text.length, 2500, 'the whole piped reply reached the board, which judges its own limit');
  assert.match(out.stdout, /refused that: a reply is at most 2000 characters/);
  const saved = savedPath(out.stdout);
  assert.ok(saved, out.stdout);
  try {
    assert.equal(fs.readFileSync(saved, 'utf8'), long);
    assert.equal(fs.statSync(saved).mode & 0o777, 0o600);
  } finally { fs.rmSync(saved, { force: true }); }
}, '{"error":"a reply is at most 2000 characters"}'));

test('#4582: a piped reply that was not kept is saved, not lost', () => withStubBoard(async (port) => {
  const out = await runCli(['reply', '--stdin'], envFor(port), 'NOT-KEPT-BODY');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /That was not kept: no conversation/);
  const saved = savedPath(out.stdout);
  assert.ok(saved, out.stdout);
  try { assert.equal(fs.readFileSync(saved, 'utf8'), 'NOT-KEPT-BODY'); } finally { fs.rmSync(saved, { force: true }); }
}, '{"kept":false,"because":"no conversation"}'));

test('#4582: with Kosmos not running, a piped reply is read and kept, not lost', async () => {
  const out = await runCli(['reply', '--stdin'], { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%42', AGENT_WORKFORCE_DATA: DATA }, 'DOWN-BODY');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos is not running/);
  const saved = savedPath(out.stdout);
  assert.ok(saved, out.stdout);
  try { assert.equal(fs.readFileSync(saved, 'utf8'), 'DOWN-BODY'); } finally { fs.rmSync(saved, { force: true }); }
});

test('#4582: a reply that times out is a "maybe": exit 3, do not re-send, and no copy is saved', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--stdin'], envFor(port), 'SLOW-BODY', 45000);
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /may have been kept/);
  assert.doesNotMatch(out.stdout, /saved at/, 'a reply that may have landed is not offered for re-sending');
  assert.equal(seen.length, 1, 'the board did receive it');
}, null, 17000));

test('#4582: a piped reply with bytes that are not UTF-8 is sent, not aborted', () => withStubBoard(async (port, seen) => {
  // Pinned to a UTF-8 locale: that is where BSD sed/tr abort on a stray byte, so this test can fail.
  const out = await runCli(['reply', '--stdin'], { ...envFor(port), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.equal(out.code, 0, 'a Latin-1 byte must not kill the reply escaper: ' + out.stdout + out.stderr);
  assert.equal(seen[0]._unparsable, undefined);
  assert.equal(seen[0].text, 'caf�');
}));

test('#4582: a 2 MB piped reply reaches the board (curl on stdin, not argv), which then judges it', () => withStubBoard(async (port, seen) => {
  const big = 'x'.repeat(2 * 1024 * 1024);
  const out = await runCli(['reply', '--stdin'], envFor(port), big, BIG_INPUT_TIMEOUT_MS);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text.length, big.length);
}));

test('#4582: a wrong-world piped reply the outbox cannot keep is saved to a file', () => withStubBoard(async (port) => {
  const env = { ...envFor(port), KOSMOS_HOME: '/nonexistent-kosmos-home-4582' };
  const out = await runCli(['reply', '--stdin'], env, 'WW-REPLY');
  assert.equal(out.code, 1, 'KOSMOS_HOME points nowhere, so the outbox cannot keep it: ' + out.stdout);
  const saved = savedPath(out.stdout);
  assert.ok(saved, out.stdout);
  try { assert.equal(fs.readFileSync(saved, 'utf8'), 'WW-REPLY'); } finally { fs.rmSync(saved, { force: true }); }
}, '{"wrongWorld":true,"world":"other"}'));

test('#4582: the reply usage line is the same sentence in install/kosmos and the Windows CLI', () => {
  const bash = fs.readFileSync(CLI, 'utf8').match(/say "(Usage: kosmos reply \[--stdin\][^"]*)"/);
  assert.ok(bash, 'install/kosmos must carry the reply usage line');
  assert.equal(bash[1].replace(/\\\$/g, '$'), require('./tools/windows/kosmos-cli').USAGE.reply);
});
