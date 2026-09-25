'use strict';

/**
 * #3224, the proactive half: `kosmos post --new <project> <text>` says a post is
 * deliberately new for that room, so the board does not hold it back to ask about a
 * question the agent owes the person in another room. The CLI puts new_post:true on
 * the /api/post body only when the flag is given, as a LEADING flag like --no-reply and
 * --in-reply-to. And when the board does hold a post (code which_room), the CLI prints
 * the whole question, both commands included, and hands the text back.
 * Same stub-board harness as cli.post-inreplyto-3224.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function withStubBoard(answer, fn) {
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
        res.end(JSON.stringify(answer));
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

const PLACED = { delivery: { state: 'placed' } };
const envFor = (port) => ({ ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });

test('#3224: kosmos post --new puts new_post:true on the body and consumes the flag', () => withStubBoard(PLACED, async (port, seen) => {
  const out = await runCli(['post', '--new', 'alpha', 'a new post'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].new_post, true);
  assert.equal(seen[0].project, 'alpha');
  assert.equal(seen[0].text, 'a new post');
}));

test('#3224 CONTROL: without --new the body omits new_post', () => withStubBoard(PLACED, async (port, seen) => {
  const out = await runCli(['post', 'alpha', 'a plain post'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'new_post'), false);
}));

test('#3224: --new combines with --no-reply in either order; non-leading --new is message text', () => withStubBoard(PLACED, async (port, seen) => {
  await runCli(['post', '--no-reply', '--new', 'alpha', 'ack'], envFor(port));
  await runCli(['post', '--new', '--no-reply', 'alpha', 'ack2'], envFor(port));
  await runCli(['post', 'alpha', 'try --new stuff'], envFor(port));
  assert.equal(seen[0].new_post, true); assert.equal(seen[0].reply_expected, false); assert.equal(seen[0].text, 'ack');
  assert.equal(seen[1].new_post, true); assert.equal(seen[1].reply_expected, false); assert.equal(seen[1].text, 'ack2');
  assert.equal(Object.prototype.hasOwnProperty.call(seen[2], 'new_post'), false);
  assert.match(seen[2].text, /--new/);
}));

test('#3224: a held post (which_room) prints the whole question with both commands, exits 1, and hands the text back', () => {
  const because = 'you have an unanswered question from the person in Beta (m45), and this post is for Alpha. '
    + 'If it answers that question, post it there: kosmos post --in-reply-to m45 beta <your text>. '
    + 'If it is a new post for Alpha, send it again with --new: kosmos post --new alpha <your text>';
  return withStubBoard({ delivery: { state: 'could_not', code: 'which_room', because } }, async (port) => {
    const out = await runCli(['post', 'alpha', 'meant for beta'], envFor(port));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    const said = out.stdout + out.stderr;
    assert.ok(said.includes('Not posted: ' + because + '.'), 'the whole question must reach the agent, both commands intact: ' + said);
    assert.match(said, /meant for beta/, 'the text is handed back so it is not lost');
    assert.match(said, /here it is to send again/, 'a which-room hold says send again, not wait for the room');
  });
});
