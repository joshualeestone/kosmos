'use strict';

/**
 * kosmos#4373 part B: `kosmos community comment <post-id> <text>` asks the agent's own board, with the agent's token,
 * to comment on the service post `read` showed. Driven against a stub board, so no real board and no network.
 *
 *   node --test cli.community-comment-4373.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

// #4796: a data root of its own, so the CLI never reads this computer's board token and sends it to the stub.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-comment-4373-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'cd'.repeat(16);
const POST = '1b2c3d4e-0000-4000-8000-000000000001';
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });

function runCli(args, env, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(stdin);
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, status: 'held', id: 'c1' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/community/service-comment') {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        seen.push({ headers: req.headers, body: JSON.parse(raw) });
        if (reply.hangup) { req.socket.destroy(); return; }   // read it, then drop the line: the board may have kept it
        res.writeHead(reply.status, { 'content-type': 'application/json' });
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
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#4373 B: comment sends the post id and the text as written, with the agent token, and a held answer says held for the person', () => withStubBoard(async (port, seen) => {
  const text = 'Tuesdays "work" for us $HOME `too`';
  const out = await runCli(['community', 'comment', POST, text], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell who is commenting');
  assert.equal(seen[0].body.servicePostId, POST);
  assert.equal(seen[0].body.body, text, 'the text did not arrive as written');
  assert.equal(seen[0].body.kind, 'community_post');
  assert.equal(seen[0].body.from_pane, '%42');
  assert.ok(!('agent' in seen[0].body), 'identity must ride the token, never the body');
  // #3485 (2026-09-30): nothing waits for a release step any more; held means the scrub stopped it for the person.
  assert.match(out.stdout, /^ *Commented, and held for your person to look at before it goes public, which is expected\. Do not send it again\.$/m);
  assert.doesNotMatch(out.stdout, /until your person releases/);
}));

test('#4373 B: a comment piped in on stdin arrives too', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', POST], envFor(port), 'line one\nline two\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.body, 'line one\nline two');
}));

test('#4373 B: a published comment says it goes on the next pass', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'hi'], envFor(port));
  assert.equal(out.code, 0);
  assert.match(out.stdout, /^ *Comment queued: Kosmos sends it to the community shortly\. Check whether it has gone out with: kosmos community status$/m);   // #4939
  assert.doesNotMatch(out.stdout, /held|until your person releases/, 'a published comment was described as held');
}, { status: 200, body: { ok: true, status: 'published', id: 'c1', sends: true } }));

test('#4373 B review 3: published while Community is off, it says it will not go', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'hi'], envFor(port));
  assert.equal(out.code, 0);
  assert.match(out.stdout, /not sending to the community right now, so it will not go/);
  assert.doesNotMatch(out.stdout, /sends it to the community shortly/);
}, { status: 200, body: { ok: true, status: 'published', id: 'c1', sends: false } }));

test('#4373 B: a refusal from the board is said in its words and exits 1', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'x'], envFor(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /That comment was not sent: a community comment can be at most 2000 characters/);
}, { status: 400, body: { error: 'a community comment can be at most 2000 characters' } }));

test('#4373 B review (merge): a 500 may come after the board stored it, so it is a maybe (exit 3), not "not sent"', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'x'], envFor(port));
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /may have been taken, so do not send it again/);
  assert.doesNotMatch(out.stdout, /That comment was not sent/);
}, { status: 500, body: { error: 'we could not submit that comment' } }));

test('#4373 B review (merge): a 200 whose status cannot be read is a maybe too', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'x'], envFor(port));
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /may have been taken/);
}, { status: 200, body: { ok: true } }));

test('#4373 B review (merge): CONTROL: a 503 comes before the store, so it is still "not sent" (exit 1)', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'x'], envFor(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /That comment was not sent/);
}, { status: 503, body: { error: 'we could not check which agents are running' } }));

test('#4373 B: no post id, no text, and --help send nothing; the usage names the verb', () => withStubBoard(async (port, seen) => {
  const none = await runCli(['community', 'comment'], envFor(port));
  assert.equal(none.code, 2);
  assert.match(none.stdout, /Usage: kosmos community comment <post-id>/);
  const blank = await runCli(['community', 'comment', POST, '   '], envFor(port));
  assert.equal(blank.code, 2);
  assert.match(blank.stdout, /a comment needs some text/);
  const help = await runCli(['community', 'comment', '--help'], envFor(port));
  assert.equal(help.code, 0);
  const bare = await runCli(['community'], envFor(port));
  assert.match(bare.stdout, /kosmos community comment <post-id>/, 'the usage does not name the comment verb');
  assert.equal(seen.length, 0, 'something was sent');
}));

test('#4373 B review 4: a connection dropped after the board read the comment is a maybe (exit 3), not "could not reach"', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', POST, 'hi'], envFor(port));
  assert.equal(seen.length, 1, 'control: the board did read the comment');
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /do not send it again/);
  assert.doesNotMatch(out.stdout, /could not reach/);
}, { hangup: true }));

test('#4373 B review 5: past the daily cap it says the comment goes once the cap lifts, not on the next pass', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'comment', POST, 'hi'], envFor(port));
  assert.equal(out.code, 0);
  assert.match(out.stdout, /once the cap lifts/);
  assert.doesNotMatch(out.stdout, /sends it to the community shortly/);
}, { status: 200, body: { ok: true, status: 'published', id: 'c1', sends: true, later: true } }));

test('#4373 B red-team: the heredoc form the block shows keeps a backtick and $ from running on this computer', () => withStubBoard(async (port, seen) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-heredoc-')), 'ran');
  const script = `"${CLI}" community comment ${POST} <<'EOF'\nI use \`touch ${marker}\` and $HOME before rebuilding\nEOF\n`;
  const out = await new Promise((resolve, reject) => execFile('/bin/bash', ['-c', script], { env: envFor(port), timeout: 30000 },
    (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('bash gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, stdout, stderr });
    }));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(fs.existsSync(marker), false, 'the backtick in the comment RAN on this computer');
  assert.equal(seen[0].body.body, `I use \`touch ${marker}\` and $HOME before rebuilding`, 'the text did not arrive as written');
  // Control: the double-quoted form the block no longer shows DOES run it.
  const ctl = `"${CLI}" community comment ${POST} "I use \`touch ${marker}\`"\n`;
  // exit code not read (#3628): the control asserts only whether the backtick ran (the marker file), not how bash exited
  await new Promise((resolve) => execFile('/bin/bash', ['-c', ctl], { env: envFor(port), timeout: 30000 }, () => resolve()));
  assert.equal(fs.existsSync(marker), true, 'control: double quotes should have run the backtick');
  fs.rmSync(path.dirname(marker), { recursive: true, force: true });
}));

test('#4373 B fourth red-team: a body with a line that is only EOF arrives whole and runs nothing under KOSMOS_END (control: EOF ends it early and runs the rest)', () => withStubBoard(async (port, seen) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-heredoc-end-'));
  const marker = path.join(dir, 'ran');
  const body = `I pass text with a heredoc, like:\n  cat <<'EOF'\nEOF\ntouch ${marker}\nthe end`;
  const run = (word) => new Promise((resolve, reject) => execFile('/bin/bash', ['-c', `"${CLI}" community comment ${POST} <<'${word}'\n${body}\n${word}\n`],
    { env: envFor(port), timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('bash gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, stdout, stderr });
    }));
  const good = await run('KOSMOS_END');
  assert.equal(good.code, 0, good.stdout + good.stderr);
  assert.equal(fs.existsSync(marker), false, 'a line in the comment RAN on this computer');
  assert.equal(seen[0].body.body, body, 'the comment did not arrive whole');
  await run('EOF');
  assert.equal(fs.existsSync(marker), true, 'control: with EOF as the word, the text should have ended early and the rest run');
  fs.rmSync(dir, { recursive: true, force: true });
}));

// #4833 slice 3: --reply-to answers one comment (the id read --post shows after "comment"), before or after the post id.
const PARENT = '2c3d4e5f-0000-4000-8000-000000000002';
test('#4833: --reply-to after the post id sends serviceParentId, and the text is everything after it', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', POST, '--reply-to', PARENT, 'Agreed', '--reply-to', 'x'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.servicePostId, POST);
  assert.equal(seen[0].body.serviceParentId, PARENT);
  assert.equal(seen[0].body.body, 'Agreed --reply-to x', 'a second --reply-to inside the text is text');
}));

test('#4833: --reply-to before the post id works the same, and a piped reply arrives too', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', '--reply-to', PARENT, POST], envFor(port), 'piped reply\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.servicePostId, POST);
  assert.equal(seen[0].body.serviceParentId, PARENT);
  assert.equal(seen[0].body.body.trim(), 'piped reply');
}));

test('#4833 CONTROL: without --reply-to no serviceParentId is sent', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'comment', POST, 'top level'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.ok(!('serviceParentId' in seen[0].body), JSON.stringify(seen[0].body));
}));

test('#4833: --reply-to with no comment id is a usage error and nothing is sent', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'comment', POST, '--reply-to'], ['community', 'comment', '--reply-to']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /--reply-to <comment-id>/);
  }
  assert.equal(seen.length, 0);
}));

test('#4833: an empty post id (an unset variable) is a usage error, never skipped to make the text the post id', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'comment', '', POST], ['community', 'comment', '', 'hello'], ['community', 'comment', '--reply-to', PARENT, '', POST]]) {
    const out = await runCli(args, envFor(port), 'should not be read\n');
    assert.equal(out.code, 2, JSON.stringify(args) + ': ' + out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /Usage: kosmos community comment <post-id>/);
  }
  assert.equal(seen.length, 0);
}));
