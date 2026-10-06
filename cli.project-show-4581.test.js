'use strict';
/**
 * #4581: `kosmos project list` and `kosmos project show <id>` on the Mac CLI. The stub is a REAL http server the
 * CLI's own curl hits (cli.project-create-3388.test.js's harness), answering with payloads built by the real
 * engine/projectview.js, so this pins the route, the tokens sent, the exact-id refusal and the printed words.
 * The data root is a temp folder, so the CLI never reads this machine's real board token.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const v = require('./engine/projectview');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-show-')));
const TOKEN = 'ab'.repeat(32);

/* Real member rows: fleet's cards through projects.describe, never hand-built (fixture-discipline). The data root
   is a temp folder, set before the engine is loaded. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-4581-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');
const FLEET = fleet.install([fleet.agent('mark', { state: 'idle' }), fleet.agent('sam', { state: 'idle', runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything' })]);
const RAW = { id: 'ff', name: 'Five Families', folder: '/p/ff', agents: ['mark', 'sam'], tasks: [{ number: 1, sentence: 'rank', state: 'open' }] };
const DESCRIBED = projects.describe(RAW, FLEET.agents, [RAW]);
FLEET.restore();
test.after(() => { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const LIST = { projects: v.listOf([DESCRIBED]), agentsUnreadable: false };
const SHOW = { project: v.overviewOf(DESCRIBED, [], { now: Date.now(), folderOf: () => null, readBrief: () => ({ goal: 'Ask each family', done: null, found: true }) }), agentsUnreadable: false };

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code) + ' ' + stderr)); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      /* #4466's healthy() probes /api/health first; only the project routes are this test's subject. */
      if (req.url !== '/api/health') seen.push({ method: req.method, url: req.url, agent: req.headers['x-kosmos-agent-token'] });
      if (req.url === '/api/project/shape/overview') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (req.url === '/api/project/html/overview') { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>Bad gateway</html>'); return; }
      const [status, body] = req.url === '/api/projects/overview' ? [200, LIST]
        : req.url === '/api/project/ff/overview' ? [200, SHOW]
          : [404, { error: 'there is no project by that name' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn({ ...process.env, KOSMOS_PORT: String(server.address().port), AGENT_WORKFORCE_DATA: DATA, KOSMOS_AGENT_TOKEN: TOKEN }, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#4581 kosmos project list: GET /api/projects/overview with the agent\'s own token, printed by the shared renderer', () => withStub(async (env, seen) => {
  const out = await runCli(['project', 'list'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.deepEqual(seen, [{ method: 'GET', url: '/api/projects/overview', agent: TOKEN }]);
  assert.equal(out.stdout, v.renderList(LIST).join('\n') + '\n');
}));

test('#4581 kosmos project show <id>: GET /api/project/<id>/overview, printed by the shared renderer', () => withStub(async (env, seen) => {
  const out = await runCli(['project', 'show', 'ff'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.deepEqual(seen.map((s) => s.url), ['/api/project/ff/overview']);
  assert.equal(seen[0].agent, TOKEN);
  assert.equal(out.stdout, v.renderShow(SHOW).join('\n') + '\n');
  assert.match(out.stdout, /Goal \(as written in BRIEF\.md\): "Ask each family"/);
}));

test('#4581 show: a garbled id is refused before any request; an unknown one is the board\'s own sentence', () => withStub(async (env, seen) => {
  const garbled = await runCli(['project', 'show', 'ff!!!'], env);
  assert.equal(garbled.code, 1);
  assert.match(garbled.stdout, /there is no project by that name/);
  assert.equal(seen.length, 0, 'a garbled id must never be stripped into a real one and sent');
  for (const dots of ['.', '..']) {
    const d = await runCli(['project', 'show', dots], env);
    assert.equal(d.code, 1, dots + ': ' + d.stdout);
    assert.match(d.stdout, /there is no project by that name/);
  }
  assert.equal(seen.length, 0, 'a dot segment would reach another route');
  const unknown = await runCli(['project', 'show', 'nope'], env);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stdout, /Kosmos refused that: there is no project by that name\./);
}));

test('#4581 usage: list takes nothing, show takes exactly one id; the help names all three', () => withStub(async (env, seen) => {
  for (const args of [['project', 'list', 'extra'], ['project', 'show'], ['project', 'show', 'a', 'b']]) {
    const out = await runCli(args, env);
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout);
  }
  const help = await runCli(['project'], env);
  assert.match(help.stdout, /Usage: kosmos project <list\|show\|create\|pause\|role>/);   // #4771 added pause, #5300 role
  assert.equal(seen.length, 0);
}));

test('#4581 with Kosmos not running, a read says it cannot read, not that it cannot create', async () => {
  const out = await runCli(['project', 'list'], { ...process.env, KOSMOS_PORT: '1', AGENT_WORKFORCE_DATA: DATA });
  assert.equal(out.code, 1);
  assert.match(out.stdout, /its projects cannot be read/);
});

test('#4581 the usage lines match between install/kosmos and the Windows CLI', () => {
  const win = require('./tools/windows/kosmos-cli').USAGE.project;
  const mac = fs.readFileSync(CLI, 'utf8');
  for (const line of win.split('\n').slice(0, 4)) {
    const macForm = line.replace(/"/g, '\\"');
    assert.ok(mac.includes('say "' + macForm + '"'), 'install/kosmos lacks: ' + line);
  }
});

test('#4581 round 1: an answer that is not JSON is not a success (exit 1), never printed as if it were', () => withStub(async (env) => {
  const out = await runCli(['project', 'show', 'html'], env);
  assert.equal(out.code, 1, out.stdout);
  assert.match(out.stdout, /could not read/);
  assert.doesNotMatch(out.stdout, /Bad gateway/);
}));

test('#4581 round 3: valid JSON of the wrong shape is unreadable too (exit 1), never an empty answer', () => withStub(async (env) => {
  const out = await runCli(['project', 'show', 'shape'], env);
  assert.equal(out.code, 1, out.stdout);
  assert.match(out.stdout, /could not read/);
}));
