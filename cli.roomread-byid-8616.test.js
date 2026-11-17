'use strict';
/**
 * kosmos#8616: `kosmos room <project> --post <post-id>` and `--since <post-id>` reach the board as &post= / &since=, a
 * bracketed id ([m42]) reads, a malformed id or a bad mix is refused before any request, and a board that ignored the
 * flag (its answer has no "Read by id: " head) is said, so the room's tail never passes for what was asked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-byid-8616-'));
const KHOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-byid-8616-home-')));
fs.mkdirSync(path.join(KHOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(KHOME, 'runtime', 'bin', 'node'));
process.on('exit', () => {
  for (const d of [DATA, KHOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const HEALTH = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* "newboard" answers a read by id as a board that knows it; every other room as an older board (the tail). */
function withBoard(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HEALTH); return; }
      hits.push({ method: req.method, url: req.url, body });
      if (/^\/api\/project\/[^/]+\/room\?/.test(req.url) && req.method === 'GET') {
        const byId = /[?&](post|since)=/.test(req.url);
        const knows = req.url.startsWith('/api/project/newboard/') && byId;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(knows ? 'Read by id: post m42:\n01:18  [m42] posterseat: hello\n' : 'the room\n');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not in this stub' }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, hits); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_HOME: KHOME, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });
const roomReads = (hits) => hits.filter((h) => h.method === 'GET' && /\/room\?/.test(h.url)).map((h) => h.url);

test('kosmos#8616: --post and --since (and their = forms, and a bracketed id) reach the board as &post= / &since=', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(async (port, hits) => {
    for (const [args, url] of [
      [['room', 'newboard', '--post', 'm42'], '/api/project/newboard/room?as=text&post=m42'],
      [['room', '--post=[m42]', 'newboard'], '/api/project/newboard/room?as=text&post=m42'],
      [['room', 'newboard', '--since', 'm7'], '/api/project/newboard/room?as=text&since=m7'],
      [['room', 'newboard', '--since=m7', '-n', '5'], '/api/project/newboard/room?as=text&n=5&since=m7'],
    ]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stderr);
      assert.deepEqual(roomReads(hits), [url], args.join(' '));
      assert.equal(out.stderr, '', args.join(' ') + ': a board that knows it was warned about: ' + out.stderr);
    }
  }));

test('kosmos#8616: a malformed id, both flags, --post with -n, or with --unanswered, is refused before any request', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(async (port, hits) => {
    for (const args of [
      ['room', 'newboard', '--post', '42'], ['room', 'newboard', '--post', 'm0'], ['room', 'newboard', '--post', 'mx1'],
      ['room', 'newboard', '--post'], ['room', 'newboard', '--post', 'm1', '--since', 'm2'],
      ['room', 'newboard', '--post', 'm1', '-n', '3'], ['room', 'newboard', '--since', 'm1', '--unanswered'],
      ['room', 'newboard', '--post', 'm12345678901234'],
    ]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 2, args.join(' ') + ' was not refused: ' + out.stdout + out.stderr);
      assert.deepEqual(roomReads(hits), [], args.join(' ') + ' reached the board');
    }
  }));

test('kosmos#8616: an older board that ignored the flag is said; a plain read is not (control)', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(async (port) => {
    const old = await runCli(['room', 'oldboard', '--since', 'm7'], envFor(port));
    assert.equal(old.code, 0);
    assert.match(old.stderr, /does not know --since yet/);
    const plain = await runCli(['room', 'oldboard'], envFor(port));
    assert.equal(plain.stderr, '', 'CONTROL: a plain read was warned about');
  }));
