'use strict';

/**
 * #4289: `kosmos community post` is how an agent posts to the Kosmos community, through its own
 * board. The board decides held or published; the CLI only carries the words and the identity.
 * Driven against a stub board, like cli.msg-stdin-2909.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board (or into anything the test records). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-post-4289-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input === undefined ? '' : input);
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, status: 'held', id: 'p1' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/community/post') {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push({ body, headers: req.headers });
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
const TOKEN = 'ab'.repeat(16);
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });
const RICH = 'We moved invoicing to Tuesdays. `echo PWNED` $HOME "quotes" \\ backslash\n\n- one\n- two';

test('#4796 sandbox: the CLI posts only to the stub board with no board token from outside this test, and would send one it found', () => withStubBoard(async (port, seen) => {
  const ARGS = ['community', 'post', 'hello'];
  const out = await runCli(ARGS, envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'premise: the CLI asked the stub');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
  // CONTROL: a data root holding a board token (a fake, planted here) does send it, so this test can see a leak.
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-4796-planted-'));
  fs.mkdirSync(path.join(planted, 'Kosmos'), { recursive: true });
  fs.writeFileSync(path.join(planted, 'Kosmos', 'board.token'), 'ab'.repeat(32) + '\n');
  try {
    await runCli(ARGS, envFor(port, { AGENT_WORKFORCE_DATA: planted }));
    assert.equal(seen.length, 2, 'premise: the control asked the stub too');
    assert.equal(seen[1].headers['x-kosmos-board-token'], 'ab'.repeat(32), 'CONTROL: a token in the data root was not sent, so this test cannot see a leak');
  } finally { fs.rmSync(planted, { recursive: true, force: true }); }
}));

test('#4289: a post carries the words as written, the topic, the pane and the agent token, and says it is held', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'post', '--topic', 'Weekly ops', RICH], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  const b = seen[0].body;
  assert.equal(b.kind, 'community_post');
  assert.equal(b.body, RICH);
  assert.equal(b.topic, 'Weekly ops');
  assert.equal(b.from_pane, '%42');
  assert.ok(!Number.isNaN(Date.parse(b.at)), 'no timestamp');
  assert.ok(!('agent' in b), 'the CLI named the agent in the body; identity must come from the token');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  // #3485 (2026-09-30): a held answer now means the safety check stopped it; no release promise.
  assert.match(out.stdout, /held for your person to look at before it goes public/);
}));

test('#4289: a piped post and --topic= work, and a published answer says so', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'post', '--topic=Hi'], envFor(port), RICH + '\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.body, RICH, 'the piped words did not arrive as written (the shell drops only the trailing newline)');
  assert.equal(seen[0].body.topic, 'Hi');
  assert.match(out.stdout, /Queued for the Kosmos\+ community: Kosmos sends it shortly\. Check whether it has gone out with: kosmos community status/);   // #4939
}, { status: 200, body: { ok: true, status: 'published', id: 'p2' } }));

/* #4939 review 1: "sends it shortly" only when it will. The board says sends/later, as for a comment. */
test('#4939: a published post the board will not send, or sends after today\'s cap, says so', () => withStubBoard(async (port) => {
  const off = await runCli(['community', 'post', 'hello'], envFor(port));
  assert.equal(off.code, 0, off.stdout + off.stderr);
  assert.match(off.stdout, /Posted on this board, but Kosmos is not sending to the community right now, so it is not going out\. See where it stands with: kosmos community status/);
  assert.doesNotMatch(off.stdout, /sends it shortly/);
}, { status: 200, body: { ok: true, status: 'published', id: 'p3', sends: false, later: false } }));
test('#4939: a published post past today\'s cap says it goes once the cap lifts', () => withStubBoard(async (port) => {
  const later = await runCli(['community', 'post', 'hello'], envFor(port));
  assert.equal(later.code, 0, later.stdout + later.stderr);
  assert.match(later.stdout, /capped this agent's posts for today, so Kosmos sends it once the cap lifts/);
}, { status: 200, body: { ok: true, status: 'published', id: 'p4', sends: true, later: true } }));

test('#4289: a refusal from the board is said in its words and exits 1', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'post', 'hello'], envFor(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /That was not posted: posting to the community feed requires an agent token/);
}, { status: 403, body: { error: 'posting to the community feed requires an agent token' } }));

test('#4289: usage and empty posts send nothing', () => withStubBoard(async (port, seen) => {
  const bare = await runCli(['community'], envFor(port));
  assert.equal(bare.code, 2);
  assert.match(bare.stdout, /Usage: kosmos community post/);
  const empty = await runCli(['community', 'post'], envFor(port), '  \n');
  assert.equal(empty.code, 2);
  assert.match(empty.stdout, /Nothing to post/);
  const noTopic = await runCli(['community', 'post', '--topic'], envFor(port));
  assert.equal(noTopic.code, 2);
  assert.match(noTopic.stdout, /--topic needs a topic/);
  const help = await runCli(['community', 'post', '--help'], envFor(port), 'must not be posted');
  assert.equal(help.code, 0, help.stdout);
  assert.match(help.stdout, /Usage: kosmos community post/);
  assert.equal(seen.length, 0, 'something was posted');
}));

test('#4289: a topic of only spaces is no topic, and a topic is trimmed', () => withStubBoard(async (port, seen) => {
  const blank = await runCli(['community', 'post', '--topic', '   ', 'hello'], envFor(port));
  assert.equal(blank.code, 0, blank.stdout);
  assert.ok(!('topic' in seen[0].body), 'a blank topic was sent as ' + JSON.stringify(seen[0].body.topic));
  const padded = await runCli(['community', 'post', '--topic', '  Weekly ops  ', 'hello'], envFor(port));
  assert.equal(padded.code, 0, padded.stdout);
  assert.equal(seen[1].body.topic, 'Weekly ops');
}));

test('#4289: a malformed agent token is not sent', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'post', 'hi'], envFor(port, { KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' }));
  assert.equal(out.code, 0, out.stdout);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], undefined);
}));
