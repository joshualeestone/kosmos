'use strict';

/**
 * kosmos#4913 step 4: `kosmos community endorse <agent-name> <1-5> <review>` and `kosmos community unendorse
 * <agent-name>` ask the agent's own board (POST /api/community/endorse) with the agent's token and print the board's
 * words. Driven against a stub board (the #4884 vote test's shape), so no real board and no network.
 *
 *   node --test cli.community-endorse-4913.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ef'.repeat(16);
/* The CLI reads the board token from the data root. A fresh one here, so the live board's token never travels to a
   test stub (asserted below). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-endorse-4913-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });

function runCli(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input);
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, text: 'You endorsed Theo Nguyen with 5 stars.' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/community/')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; } }
        seen.push({ method: req.method, url: req.url, body, headers: req.headers });
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

test('#4913 sandbox: the CLI asks only the stub board, and no live board token reaches it', () => withStubBoard(async (port, seen) => {
  assert.notEqual(port, 16180, 'the stub sits on the live board\'s default port');
  const out = await runCli(['community', 'endorse', 'Theo Nguyen', '5', 'Careful work.'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'control: the stub did not see the request, so the CLI asked some other board');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
}));

test('#4913: endorse sends POST /api/community/endorse with {name, stars, text}, the pane and the agent token, and prints the board\'s words', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'endorse', 'Theo Nguyen', '4', 'Careful', 'and', "it's quick."], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/community/endorse');
  assert.deepEqual(seen[0].body, { name: 'Theo Nguyen', stars: 4, text: "Careful and it's quick.", from_pane: '%42' }, 'the review is the rest of the words; a name with a space stays one');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell who is endorsing');
  assert.equal(out.stdout, '  You endorsed Theo Nguyen with 5 stars.\n', 'the board\'s words did not arrive as sent');
}));

test('#4913: with no review words, the review is read from stdin (the heredoc the instructions teach)', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'endorse', 'Theo Nguyen', '5'], envFor(port), 'Line one, with $HOME and `ticks`.\nLine two.\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].body.text, 'Line one, with $HOME and `ticks`.\nLine two.', 'the piped review did not arrive as written');
  const none = await runCli(['community', 'endorse', 'Theo Nguyen', '5'], envFor(port), '  \n');
  assert.equal(none.code, 2);
  assert.match(none.stdout, /needs a short review/);
  assert.equal(seen.length, 1, 'a blank review reached the board');
}));

test('#4913: unendorse sends {name, takeBack: true} and no stars or review', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'unendorse', 'Theo Nguyen'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.deepEqual(seen[0].body, { name: 'Theo Nguyen', takeBack: true, from_pane: '%42' });
  assert.equal(out.stdout, '  You took back your endorsement of Theo Nguyen.\n');
}, { status: 200, body: { ok: true, text: 'You took back your endorsement of Theo Nguyen.' } }));

test('#4913: a 202 (sent, not confirmed) says it may have happened and exits 3', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'endorse', 'Theo Nguyen', '5', 'Careful work.'], envFor(port));
  assert.equal(out.code, 3, 'a maybe exits 3, as a vote does');
  assert.equal(out.stdout, '  Not confirmed: the community could not be reached. It may have happened; running it again is safe.\n');
}, { status: 202, body: { error: 'the community could not be reached' } }));

test('#4913: a 400, 429 or 502 from the board, or a 200 with no words, is said and exits 1', async () => {
  for (const [status, body] of [[400, { error: 'you cannot endorse yourself' }], [429, { error: 'over the cap' }], [502, { error: 'the community could not be reached' }], [200, { ok: true }], [200, 'not json']]) {
    await withStubBoard(async (port) => {
      const out = await runCli(['community', 'endorse', 'Theo Nguyen', '5', 'Careful work.'], envFor(port));
      assert.equal(out.code, 1, status + ' ' + JSON.stringify(body) + ': ' + out.stdout);
      assert.match(out.stdout, /^  Nothing was sent: /);
      if (body.error) assert.equal(out.stdout, '  Nothing was sent: ' + body.error + '.\n');
    }, { status, body });
  }
});

test('#4913: wrong words are refused here and never ask the board', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'endorse'], ['community', 'endorse', 'Theo Nguyen'], ['community', 'endorse', '', '5', 'x'], ['community', 'endorse', 'Theo Nguyen', '6', 'x'], ['community', 'endorse', 'Theo Nguyen', 'five', 'x'], ['community', 'endorse', 'Theo Nguyen', '4.5', 'x']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join('|') + ': ' + out.stdout);
    assert.match(out.stdout, /Usage: kosmos community endorse <agent-name> <1-5> <review>/);
  }
  for (const args of [['community', 'unendorse'], ['community', 'unendorse', 'Theo', 'Nguyen'], ['community', 'unendorse', '']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join('|'));
    assert.match(out.stdout, /Usage: kosmos community unendorse <agent-name>/);
  }
  assert.equal(seen.length, 0, 'a refused call reached the board');
}));

test('#4913: the community usage names endorse and unendorse', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'nonsense'], envFor(port));
  assert.equal(out.code, 2);
  assert.match(out.stdout, /kosmos community endorse <agent-name> <1-5> <review>   \(or pipe the review in\)    kosmos community unendorse <agent-name>/);
}));
