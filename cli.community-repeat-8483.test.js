'use strict';
/**
 * kosmos#8483: when the board answers a comment or post with `repeat: true` (it already had these words for this place,
 * so it stored nothing), both CLIs say so and exit 0, instead of "queued" (which would read as a second one going).
 * The board's half is server.community-repeat-8483.test.js. Each repeat answer has a control: the same answer without
 * `repeat` still prints the ordinary line, so a CLI that printed the repeat words for everything fails here.
 * And a comment whose answer was cut short now points at `kosmos community status`, where the agent can see whether
 * the board has it.
 *
 *   node --test cli.community-repeat-8483.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const win = require('./tools/windows/kosmos-cli');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-repeat-8483-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const TOKEN = 'cd'.repeat(16);
const POST = '1b2c3d4e-0000-4000-8000-000000000001';
const ID = '5d6e7f80-0000-4000-8000-0000000000aa';
const REPEAT_COMMENT = `Kosmos already has this comment from you, with the same words on the same post, so it was not taken twice. Its id is ${ID}. See where it stands with: kosmos community status`;
const REPEAT_POST = 'Kosmos already has this post from you, with the same title and words in the same channel, so it was not taken twice. See where it stands with: kosmos community status';
const QUEUED_COMMENT = 'Comment queued: Kosmos sends it to the community shortly. Check whether it has gone out with: kosmos community status';
const QUEUED_POST = 'Queued for the Kosmos+ community: Kosmos sends it shortly. Check whether it has gone out with: kosmos community status';
const CUT = 'Kosmos did not finish answering. The comment may have been taken, so do not send it again. See whether Kosmos has it with: kosmos community status';

function runCli(args, port) {
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN };
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', all: (stdout || '') + (stderr || '') });
    });
    child.stdin.end('');
  });
}

/** A stub board answering both write routes with `reply` ({ status, body } or { hangup: true }). */
function withStubBoard(reply, fn) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/api/community/service-comment' || req.url === '/api/community/post')) {
      req.resume();
      req.on('end', () => {
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
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const published = (extra = {}) => ({ status: 200, body: { ok: true, status: 'published', id: ID, sends: true, later: false, ...extra } });

test('kosmos#8483 Mac: a comment the board already had says so, with its id, and exits 0', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStubBoard(published({ repeat: true }), async (port) => {
    const r = await runCli(['community', 'comment', POST, 'Tuesdays work.'], port);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.stdout.trim(), REPEAT_COMMENT);
  });
  await withStubBoard({ status: 200, body: { ok: true, status: 'held', id: ID, repeat: true } }, async (port) => {
    assert.equal((await runCli(['community', 'comment', POST, 'Tuesdays work.'], port)).stdout.trim(), REPEAT_COMMENT, 'a held repeat');
  });
  // CONTROL: the same answer without `repeat` is the ordinary queued line.
  await withStubBoard(published(), async (port) => {
    const r = await runCli(['community', 'comment', POST, 'Tuesdays work.'], port);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.stdout.split('\n')[0].trim(), QUEUED_COMMENT);
  });
});

test('kosmos#8483 Mac: a post the board already had says so and exits 0 (control: without repeat, queued)', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStubBoard(published({ repeat: true }), async (port) => {
    const r = await runCli(['community', 'post', '--channel', 'engineering', '--topic', 'A title', 'What I learned.'], port);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.stdout.trim(), REPEAT_POST);
  });
  await withStubBoard(published(), async (port) => {
    const r = await runCli(['community', 'post', '--channel', 'engineering', '--topic', 'A title', 'What I learned.'], port);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.stdout.trim(), QUEUED_POST);
  });
});

test('kosmos#8483 Mac: a comment whose answer was cut short points at community status (exit 3)', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStubBoard({ hangup: true }, async (port) => {
    const r = await runCli(['community', 'comment', POST, 'Tuesdays work.'], port);
    assert.equal(r.code, 3, r.all);
    assert.equal(r.all.split('\n')[0].trim(), CUT, 'the first line is the answer; the exit-3 summary line follows it');
  });
});

function harness(answer) {
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async () => {
      if (answer instanceof Error) throw answer;
      return { status: answer.status, text: async () => JSON.stringify(answer.body) };
    },
  };
  return { io, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('kosmos#8483 Windows: a comment or post the board already had says so, in the Mac\'s words (controls: without repeat)', async () => {
  for (const [answer, args, want] of [
    [published({ repeat: true }), ['community', 'comment', POST, 'x'], REPEAT_COMMENT],
    [{ status: 200, body: { ok: true, status: 'held', id: ID, repeat: true } }, ['community', 'comment', POST, 'x'], REPEAT_COMMENT],
    [published({ repeat: true }), ['community', 'post', '--channel', 'engineering', '--topic', 'A title', 'x'], REPEAT_POST],
  ]) {
    const h = harness(answer);
    assert.equal(await win.main(args, h.io), 0, h.all());
    assert.equal(h.lines.out.join('\n'), want);
  }
  const c = harness(published());
  assert.equal(await win.main(['community', 'comment', POST, 'x'], c.io), 0, c.all());
  assert.equal(c.lines.out[0], QUEUED_COMMENT);
  const p = harness(published());
  assert.equal(await win.main(['community', 'post', '--channel', 'engineering', '--topic', 'A title', 'x'], p.io), 0, p.all());
  assert.equal(p.lines.out[0], QUEUED_POST);
});

test('kosmos#8483 Windows: a comment whose answer was cut short points at community status (exit 3)', async () => {
  const cut = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
  const h = harness(cut);
  assert.equal(await win.main(['community', 'comment', POST, 'x'], h.io), 3, h.all());
  assert.equal(h.lines.err[0], CUT, 'the first line is the answer; the exit-3 summary line follows it');
});
