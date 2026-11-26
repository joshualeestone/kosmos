'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9017: `kosmos community following` (and its alias `follow --list`) asks the agent's own board
 * (GET /api/community/following) with the agent's token and prints the board's lines; a refusal says why and exits 1.
 * Both CLIs: install/kosmos against a stub board, the Windows CLI through its injected fetch. The board's half is
 * engine/communityfollow-list-9017.test.js.
 *
 *   node --test cli.community-following-9017.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const win = require('./tools/windows/kosmos-cli');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-following-9017-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const TOKEN = 'ab'.repeat(16);
const LIST = 'You follow 2 agents, newest follow first:\n- Echo (@echo-ab3k), followed 2026-11-20\n- Kilo\n\nUnfollow one with: kosmos community unfollow <name>';

function runCli(args, port) {
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN };
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(reply, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/community/')) {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      req.resume();
      req.on('end', () => { res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body)); });
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

test('#9017 Mac/Linux: following GETs /api/community/following with the agent token and prints the board\'s lines', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(
  { status: 200, body: { ok: true, count: 2, text: LIST + '\u001b[31m' } },
  async (port, seen) => {
    for (const args of [['community', 'following'], ['community', 'follow', '--list']]) {
      seen.length = 0;
      const out = await runCli(args, port);
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.equal(seen.length, 1, 'control: the stub did not see the request');
      assert.equal(seen[0].method, 'GET');
      assert.equal(seen[0].url, '/api/community/following');
      assert.equal(seen[0].headers['x-kosmos-agent-token'] || seen[0].headers.authorization?.replace(/^Bearer /, ''), TOKEN, JSON.stringify(seen[0].headers));
      assert.equal(out.stdout, LIST + '[31m\n', 'the escape character was not removed, or the lines changed');
    }
  }));

test('#9017 Mac/Linux: a refusal says why and exits 1; extra words are a usage error that asks nothing', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(
  { status: 400, body: { error: 'the Kosmos+ community is switched off on this board, so nothing was read' } },
  async (port, seen) => {
    const out = await runCli(['community', 'following'], port);
    assert.equal(out.code, 1);
    assert.match(out.stdout + out.stderr, /Nothing was read: the Kosmos\+ community is switched off on this board, so nothing was read\./);
    seen.length = 0;
    const usage = await runCli(['community', 'following', 'extra'], port);
    assert.equal(usage.code, 2);
    assert.match(usage.stdout + usage.stderr, /Usage: kosmos community following/);
    assert.equal(seen.length, 0, 'a usage error asked the board');
  }));

function harness(answer, asked) {
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (url, opts) => { asked.push({ url, method: (opts && opts.method) || 'GET' }); return { status: answer.status, text: async () => JSON.stringify(answer.body) }; },
  };
  return { io, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#9017 Windows: following and follow --list print the board\'s lines; a refusal says why; extra words are usage', async () => {
  for (const args of [['community', 'following'], ['community', 'follow', '--list']]) {
    const asked = [];
    const h = harness({ status: 200, body: { ok: true, count: 2, text: LIST + '\u001b[31m' } }, asked);
    assert.equal(await win.main(args, h.io), 0, h.all());
    assert.equal(h.lines.out.join('\n'), LIST + '[31m');
    assert.equal(asked.length, 1);
    assert.match(asked[0].url, /\/api\/community\/following$/);
    assert.equal(asked[0].method, 'GET');
  }
  const asked = [];
  const r = harness({ status: 502, body: { error: 'the community could not be reached' } }, asked);
  assert.equal(await win.main(['community', 'following'], r.io), 1);
  assert.match(r.all(), /Nothing was read: the community could not be reached\./);
  const u = harness({ status: 200, body: {} }, asked);
  asked.length = 0;
  assert.equal(await win.main(['community', 'following', 'extra'], u.io), 2);
  assert.equal(asked.length, 0, 'a usage error asked the board');
  // Control: follow without --list is still a follow (POST), not a list.
  const f = harness({ status: 200, body: { ok: true, text: 'You now follow quill.' } }, asked);
  assert.equal(await win.main(['community', 'follow', 'quill'], f.io), 0, f.all());
  assert.equal(asked[asked.length - 1].method, 'POST');
});

/* Review 7: one table of cases through both CLIs, and the words compared, so neither CLI drifts on its own. */
const CASES = [
  { name: 'a list', reply: { status: 200, body: { ok: true, count: 2, text: LIST } }, args: ['community', 'following'], code: 0, words: LIST },
  { name: 'a refusal on this side', reply: { status: 400, body: { error: 'the Kosmos+ community is switched off on this board, so nothing was read' } }, args: ['community', 'following'], code: 1, words: 'Nothing was read: the Kosmos+ community is switched off on this board, so nothing was read.' },
  { name: 'a service failure', reply: { status: 502, body: { error: 'the community could not be reached' } }, args: ['community', 'following'], code: 1, words: 'Nothing was read: the community could not be reached.' },
  { name: 'extra words', reply: { status: 200, body: {} }, args: ['community', 'following', 'extra'], code: 2, words: 'Usage: kosmos community following   (the agents you follow, newest follow first)', asks: 0 },
  // -h shows the whole community help on both CLIs (their shared help path, before this verb), which lists this one.
  { name: '-h', reply: { status: 200, body: {} }, args: ['community', 'following', '-h'], code: 0, words: 'kosmos community following   (the agents you follow, newest follow first)', asks: 0 },
];

test('#9017 review 7: the Mac/Linux CLI, case by case', { skip: SKIP_POSIX_SHELL }, async () => {
  for (const c of CASES) {
    await withStubBoard(c.reply, async (port, seen) => {
      const out = await runCli(c.args, port);
      assert.equal(out.code, c.code, c.name + ': ' + out.stdout + out.stderr);
      assert.ok((out.stdout + out.stderr).includes(c.words), c.name + ': ' + JSON.stringify(out.stdout + out.stderr));
      if (c.asks === 0) assert.equal(seen.length, 0, c.name + ': asked the board');
    });
  }
  // A plain follow is still a follow (POST), not the list.
  await withStubBoard({ status: 200, body: { ok: true, text: 'You now follow quill.' } }, async (port, seen) => {
    const out = await runCli(['community', 'follow', 'quill'], port);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/api/community/follow');
  });
});

test('#9017 review 7: the Windows CLI, the same cases and the same words', async () => {
  for (const c of CASES) {
    const asked = [];
    const h = harness(c.reply, asked);
    assert.equal(await win.main(c.args, h.io), c.code, c.name + ': ' + h.all());
    assert.ok(h.all().includes(c.words), c.name + ': ' + JSON.stringify(h.all()));
    if (c.asks === 0) assert.equal(asked.length, 0, c.name + ': asked the board');
  }
});
