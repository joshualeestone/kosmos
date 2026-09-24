'use strict';

/**
 * #3224: `kosmos post --in-reply-to <id> <project> <text>` binds the reply to the room
 * the cited message came from -- the server refuses if the target project differs. The
 * CLI's job is to put `in_reply_to` on the /api/post body when the flag is given, send NO
 * such field otherwise, and treat the flag as LEADING-only (the same recoverable tradeoff
 * as --no-reply / --file). Same stub-board harness as cli.post-noreply-2908.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function withStubBoard(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/post')) {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"delivery":{"state":"placed"}}');
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

test('#3224: kosmos post --in-reply-to <id> puts in_reply_to on the /api/post body', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--in-reply-to', 'm12', 'beta', 'the answer'], env);
  assert.equal(out.code, 0, 'the post should succeed: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'exactly one post reached the board');
  assert.equal(seen[0].in_reply_to, 'm12', '--in-reply-to must put in_reply_to on the body');
  assert.equal(seen[0].project, 'beta', 'the project must be the arg after the flag pair');
  assert.equal(seen[0].text, 'the answer', 'the flag and its value must be consumed, not swept into the text');
}));

test('#3224: the --in-reply-to=<id> equals form is accepted too', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--in-reply-to=m7', 'beta', 'hi'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].in_reply_to, 'm7', 'the = form must set in_reply_to');
  assert.equal(seen[0].project, 'beta');
}));

test('#3224 CONTROL: without --in-reply-to the body omits in_reply_to entirely', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'beta', 'a plain post'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'in_reply_to'), false,
    'a post that is not a bound reply must omit in_reply_to, not send an empty one');
}));

test('#3224: --in-reply-to combines with --no-reply in EITHER order (both are leading flags)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  // --no-reply first
  const a = await runCli(['post', '--no-reply', '--in-reply-to', 'm3', 'beta', 'ack'], env);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(seen[0].in_reply_to, 'm3', 'in_reply_to must survive with --no-reply first');
  assert.equal(seen[0].reply_expected, false, '--no-reply must still take effect');
  assert.equal(seen[0].project, 'beta');
  assert.equal(seen[0].text, 'ack');
  // --in-reply-to first (the reverse order the while-loop must also accept)
  const b = await runCli(['post', '--in-reply-to', 'm4', '--no-reply', 'beta', 'ack2'], env);
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.equal(seen[1].in_reply_to, 'm4', 'in_reply_to must survive with --in-reply-to first');
  assert.equal(seen[1].reply_expected, false, '--no-reply must still take effect in the reverse order');
  assert.equal(seen[1].project, 'beta');
  assert.equal(seen[1].text, 'ack2');
}));

test('#3224: --in-reply-to= (empty value) is REFUSED, not silently dropped (no unbound post)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--in-reply-to=', 'beta', 'answer'], env);
  assert.equal(out.code, 2, 'an empty --in-reply-to= must error, not silently post an unbound reply');
  assert.equal(seen.length, 0, 'nothing must be posted when the citation id is empty');
  assert.match(out.stdout + out.stderr, /in-reply-to needs a message id/, 'the error must say what is missing');
}));

test('#3224: --in-reply-to "" (empty SPACE value) is REFUSED too -- the space form must not silently post unbound (parity with the = form and the Windows CLI)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--in-reply-to', '', 'beta', 'answer'], env);
  assert.equal(out.code, 2, 'an empty --in-reply-to "" must error, not silently post an unbound reply with the misroute guard disabled');
  assert.equal(seen.length, 0, 'nothing must be posted when the citation id is empty');
  assert.match(out.stdout + out.stderr, /in-reply-to needs a message id/, 'the error must say what is missing');
}));

test('#3224: --in-reply-to is LEADING-only; mid-args it is message text (documented tradeoff)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'beta', 'please --in-reply-to that thread'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'in_reply_to'), false,
    'a non-leading --in-reply-to must not be treated as the flag');
  assert.match(seen[0].text, /--in-reply-to/, 'the token stays in the message text when not leading');
}));
