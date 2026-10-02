'use strict';
/**
 * kosmos#4891 (the 0.7.15 diagnostic, items N4, N6, N8, N9), the Mac CLI's half, against a stub board that records
 * every request, so each arm is judged by what reached the board and not only by the exit code.
 *
 *   N8  `kosmos room <id> -n 5` printed the whole room: -n was never parsed. Now -n / --limit / --limit= ride to the
 *       board as &n=, and a value that is not 1 to 200 is refused before any request.
 *   N6  `kosmos task list nosuch` said "No tasks for this project yet" and exited 0. The board now answers 404 for
 *       an unknown project (server.gaps-4891.test.js); here, that answer is said and exits 1.
 *   N4  `kosmos report clear` takes a needs_you or blocked off the board: it records `working`.
 *   N9  `kosmos agents --help` printed the general list; `kosmos report` (and so --help) never named `show`.
 *
 *   node --test cli.gaps-4891.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-gaps-4891-'));
/* The validation run: the CLI renders a task list with ITS node, $KOSMOS_HOME/runtime/bin/node, and prints the raw JSON
   when there is none. KOSMOS_HOME defaults to the checkout, which has a runtime/ only where a build left one, so the
   empty-list control read '{"tasks":[]}' in a clean tree. A sandboxed KOSMOS_HOME with this node, as the sibling CLI
   tests do (cli.agent-create-3734.test.js). */
const KHOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-gaps-4891-home-')));
fs.mkdirSync(path.join(KHOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(KHOME, 'runtime', 'bin', 'node'));
process.on('exit', () => {
  for (const d of [DATA, KHOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const CLI = path.join(__dirname, 'install', 'kosmos');
const HEALTH = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* `hits` holds every API request (method, url, body); the health page is not one. Unknown-project ids answer 404
   the way the board does. */
function withBoard(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HEALTH); return; }
      hits.push({ method: req.method, url: req.url, body });
      if (/^\/api\/project\/[^/]+\/room\?/.test(req.url) && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain' }); res.end('the room\n'); return;
      }
      if (req.url === '/api/tasks?project=nosuch') {
        res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'there is no project by that name' })); return;
      }
      if (/^\/api\/tasks\?project=/.test(req.url)) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tasks: [] })); return;
      }
      if (req.url.startsWith('/api/report') && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ recorded: true })); return;
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

test('#4891 N8: -n, --limit and --limit= reach the board as &n=, either side of the project id', () =>
  withBoard(async (port, hits) => {
    for (const args of [['room', 'proj', '-n', '5'], ['room', '-n', '5', 'proj'], ['room', 'proj', '--limit', '5'], ['room', 'proj', '--limit=5']]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stderr);
      assert.deepEqual(roomReads(hits), ['/api/project/proj/room?as=text&n=5'], args.join(' '));
    }
    // Review 2: a project id that starts with "-" is still a project (Kosmos makes ids like "-drafts").
    for (const args of [['room', '-drafts'], ['room', '-drafts', '-n', '3']]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
      assert.deepEqual(roomReads(hits), ['/api/project/-drafts/room?as=text' + (args.length > 2 ? '&n=3' : '')], args.join(' '));
    }
    // CONTROL: without -n the request is exactly what it always was, so an older board answers as before.
    hits.length = 0;
    const plain = await runCli(['room', 'proj'], envFor(port));
    assert.equal(plain.code, 0, plain.stderr);
    assert.deepEqual(roomReads(hits), ['/api/project/proj/room?as=text']);
  }));

test('#4891 N8: a value that is not a whole number from 1 to 200 is refused before any request', () =>
  withBoard(async (port, hits) => {
    for (const args of [['room', 'proj', '-n', '0'], ['room', 'proj', '-n', '201'], ['room', 'proj', '-n', 'abc'], ['room', 'proj', '-n', '05'],
      ['room', 'proj', '-n', '99999999999999999999999'], ['room', 'proj', '-n'], ['room', 'proj', '--limit='], ['room', 'a', 'b']]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 2, args.join(' ') + ' should be a usage error: ' + out.stdout + out.stderr);
      assert.equal(hits.length, 0, args.join(' ') + ' reached the board');
    }
    // CONTROL: the edges that are in range go through.
    for (const n of ['1', '200']) {
      hits.length = 0;
      const out = await runCli(['room', 'proj', '-n', n], envFor(port));
      assert.equal(out.code, 0, n + ': ' + out.stderr);
      assert.deepEqual(roomReads(hits), ['/api/project/proj/room?as=text&n=' + n]);
    }
  }));

test('#4891 N6: the CLI says the board\'s 404 and exits 1 (wiring only: the CLI already did; server.gaps-4891 proves the change)', () =>
  withBoard(async (port) => {
    const missing = await runCli(['task', 'list', 'nosuch'], envFor(port));
    assert.equal(missing.code, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout + missing.stderr, /there is no project by that name/);
    assert.doesNotMatch(missing.stdout, /No tasks for this project yet/);
    // CONTROL: a real project with no tasks is still an empty list, exit 0.
    const empty = await runCli(['task', 'list', 'proj'], envFor(port));
    assert.equal(empty.code, 0, empty.stderr);
    assert.match(empty.stdout, /No tasks for this project yet/);
  }));

test('#4891 N4: `kosmos report clear` records working, with the note when one is given', () =>
  withBoard(async (port, hits) => {
    const out = await runCli(['report', 'clear', 'answered, back to it'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    const posts = hits.filter((h) => h.method === 'POST' && h.url.startsWith('/api/report'));
    assert.equal(posts.length, 1, JSON.stringify(hits));
    const body = JSON.parse(posts[0].body);
    assert.equal(body.state, 'working');
    assert.equal(body.text, 'answered, back to it');
    // CONTROL: a plain report still sends the state it names, so the arm above is clear's own.
    hits.length = 0;
    await runCli(['report', 'idle'], envFor(port));
    const idle = hits.filter((h) => h.method === 'POST' && h.url.startsWith('/api/report'));
    assert.equal(JSON.parse(idle[0].body).state, 'idle');
  }));

test('#4891 review 2/3: `report clear --auto` is refused by name before any request; a note mentioning --auto is a note', () =>
  withBoard(async (port, hits) => {
    for (const args of [['report', 'clear', '--auto'], ['report', 'clear', '--on', 'x', '--auto', 'back']]) {
      hits.length = 0;
      const out = await runCli(args, envFor(port));
      assert.equal(out.code, 2, args.join(' '));
      assert.match(out.stdout + out.stderr, /takes no --auto/, args.join(' '));
      assert.equal(hits.length, 0, args.join(' ') + ' reached the board');
    }
    // CONTROL: the hook's own path, `report working --auto`, is untouched (review 4: keyed on clear, not on working).
    hits.length = 0;
    const hook = await runCli(['report', 'working', '--auto', 'x'], envFor(port));
    assert.equal(hook.code, 0, hook.stdout + hook.stderr);
    const hookBody = JSON.parse(hits.find((h) => h.url.startsWith('/api/report')).body);
    assert.equal(hookBody.state, 'working');
    assert.equal(hookBody.auto, true);
    // CONTROL: --auto after the note is note text, as it is for every other state.
    hits.length = 0;
    const note = await runCli(['report', 'clear', 'back', 'to', 'it,', 'dropped', '--auto'], envFor(port));
    assert.equal(note.code, 0, note.stdout + note.stderr);
    const body = JSON.parse(hits.find((h) => h.url.startsWith('/api/report')).body);
    assert.equal(body.state, 'working');
    assert.match(body.text, /dropped --auto/);
  }));

test('#4891 N9: agents --help is its own usage; report --help names show and clear; neither sends anything', () =>
  withBoard(async (port, hits) => {
    const agents = await runCli(['agents', '--help'], envFor(port));
    assert.equal(agents.code, 0, agents.stderr);
    assert.match(agents.stdout, /^Usage: kosmos agents\b/m);
    assert.doesNotMatch(agents.stdout, /Kosmos commands:/, 'agents --help fell to the general list');
    const report = await runCli(['report', '--help'], envFor(port));
    assert.equal(report.code, 0, report.stderr);
    assert.match(report.stdout + report.stderr, /kosmos report show\b/);
    assert.match(report.stdout + report.stderr, /kosmos report clear\b/);
    assert.equal(hits.length, 0, '--help sent: ' + JSON.stringify(hits));
    // CONTROL: a verb with no arm of its own still prints the general list, so the agents arm is not that.
    const start = await runCli(['start', '--help'], envFor(port));
    assert.match(start.stdout, /Kosmos commands:/);
  }));
