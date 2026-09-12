'use strict';

/**
 * #2908: `kosmos post --no-reply <project> <text>` marks a room post an acknowledgement, so a
 * mentioned recipient reads it in the foreground but is NOT told to answer -- this is what breaks
 * the ack-of-an-ack loop. The CLI's only job is to put `reply_expected:false` on the /api/post
 * body when --no-reply is given, and to send NO such field otherwise (omitted = the route's
 * current reply-required behavior). Same shebang/harness idiom as cli.post-setE-2321.test.js:
 * spawn the real install/kosmos against a stub board that captures the POST body.
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

/** Stub board: answer the health GET, capture the /api/post body, return a placed delivery. */
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

test('#2908: kosmos post --no-reply sends reply_expected:false on the /api/post body', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--no-reply', 'proj', 'thanks, got it'], env);
  assert.equal(out.code, 0, 'the post should succeed: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'exactly one post reached the board');
  assert.equal(seen[0].reply_expected, false, '--no-reply must put reply_expected:false on the body');
  assert.equal(seen[0].text, 'thanks, got it', 'the --no-reply flag must be consumed, not swept into the text');
  assert.equal(seen[0].project, 'proj', 'the project must be the arg after --no-reply');
}));

test('#2908 CONTROL: kosmos post WITHOUT --no-reply sends NO reply_expected field (omitted = current behavior)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'proj', 'a plain message'], env);
  assert.equal(out.code, 0, 'the post should succeed: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'exactly one post reached the board');
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'reply_expected'), false,
    'an ordinary post must omit reply_expected entirely, not send true/false');
}));

test('#2908: --no-reply is a LEADING flag; mid-args it is message text (documented tradeoff, matches --file)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  // Here --no-reply is NOT the first token, so it is part of the message, and no field is sent.
  const out = await runCli(['post', 'proj', 'please --no-reply on that'], env);
  assert.equal(out.code, 0, 'the post should still succeed: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'reply_expected'), false,
    'a non-leading --no-reply must not be treated as the flag');
  assert.match(seen[0].text, /--no-reply/, 'the token stays in the message text when not leading');
}));
