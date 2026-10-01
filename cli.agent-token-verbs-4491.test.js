'use strict';
/**
 * #4491 slices 2-5 (slice 5 adds `kosmos task add` and `kosmos task close`): `kosmos msg`, `kosmos post`, `kosmos react`, `kosmos task message`, and (slice 4) the reads
 * `kosmos room`, `kosmos task list`, `kosmos agent roles` and `kosmos agent role-draft` present the agent's own token
 * (KOSMOS_AGENT_TOKEN, plain hex only) as `x-kosmos-agent-token`, as reply and report already do,
 * so the board can tell the agent from the person. The board token is still sent as well, by default. Slice 7:
 * with KOSMOS_AGENT_TOKEN_ONLY=1 the agent verbs send the agent token alone (the token-only tests below).
 *
 * The valid-token case is the control for the other two: a CLI that never sent the header would
 * pass every "no header" assertion here.
 *
 * Same stub and sandbox pattern as cli.presents-token.test.js and cli.presents-board-token-1968.test.js:
 * the stub answers `/` with a Kosmos page so the CLI's healthy() accepts it, and KOSMOS_HOME is a
 * throwaway whose store ROOT holds a known board.token, so the real one is never read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const BOARD = 'boardtoken4491slice2';
const TOKEN = 'ab'.repeat(32);

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4491-cli-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), BOARD);
  return home;
}

const ANSWERS = {
  '/api/msg': { delivery: { state: 'placed' } },
  '/api/post': { delivery: { state: 'placed' } },
  '/api/react': { ok: true },
  '/api/project/p4491/task/1/message': { ok: true, delivered: [] },
  // Slice 5: task add and task close. Each CLI arm reads the board's own {"task":...} shape as success.
  '/api/project/p4491/tasks': { task: { number: 1, sentence: 'write the docs' } },
  '/api/project/p4491/task/1/close': { task: { number: 1, state: 'closed' } },
  // Slice 5b: project create.
  '/api/projects': { project: { id: 'my-project' }, told: [], id: 'my-project', agentsUnreadable: false },
  // Slice 7: the rest of an agent's everyday verbs, and three of the person's.
  '/api/reply': { delivery: { state: 'placed' } },
  '/api/report': { recorded: true },
  '/api/whoami': { name: 'mara', projects: [] },
  '/api/community/post': { ok: true, state: 'held' },
  '/api/project/p4491/room/reopen': { ok: true },
  '/api/project/p4491/task/1/built': { ok: true, task: { number: 1 } },
  '/api/team': { created: [{ name: 'Nia' }], refused: [] },
};

/* Slice 4: the reads. The room is answered as text (its `?as=text` arm), the others as the JSON each verb parses. */
const READ_ANSWERS = {
  '/api/project/p4491/room': 'nothing here yet\n',
  '/api/tasks': JSON.stringify({ tasks: [], count: 0 }),
  '/api/roles': JSON.stringify({ roles: [{ key: 'builder', label: 'Builder' }], own: { instructions: 'You are {{NAME}}.' } }),
  // Slice 7: the reads its token-only list adds.
  '/api/report': 'working: on it\n',
  '/api/projects/overview': JSON.stringify({ projects: [] }),
  '/api/project/p4491/overview': JSON.stringify({ project: { id: 'p4491', name: 'P' } }),
};

function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (req.method === 'GET' && READ_ANSWERS[route] !== undefined) {
      seen.push({ route, method: 'GET', query: req.url.split('?')[1] || '', agent: req.headers['x-kosmos-agent-token'], board: req.headers['x-kosmos-board-token'] });
      res.writeHead(200, { 'content-type': route.endsWith('/room') ? 'text/plain; charset=utf-8' : 'application/json' });
      return res.end(READ_ANSWERS[route]);
    }
    if (req.method === 'POST' && ANSWERS[route]) {
      seen.push({ route, agent: req.headers['x-kosmos-agent-token'], board: req.headers['x-kosmos-board-token'] });
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ANSWERS[route]));
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

const VERBS = [
  ['/api/msg', ['msg', 'mara', 'hello']],
  ['/api/post', ['post', 'p4491', 'hello']],
  ['/api/react', ['react', 'p4491', 'm1', 'thumbsup']],
  ['/api/project/p4491/task/1/message', ['task', 'message', 'p4491', '1', 'hello']],
  // Slice 4, the reads (two-word verbs are named by both words in the test titles below).
  ['/api/project/p4491/room', ['room', 'p4491']],
  ['/api/tasks', ['task', 'list', 'p4491']],
  ['/api/roles', ['agent', 'roles']],
  ['/api/roles', ['agent', 'role-draft']],
  // Slice 5, the two task writes.
  ['/api/project/p4491/tasks', ['task', 'add', 'p4491', 'write the docs']],
  ['/api/project/p4491/task/1/close', ['task', 'close', 'p4491', '1']],
  // Slice 5b: the maker of a project is named by its token.
  ['/api/projects', ['project', 'create', 'My Project', '/tmp/kosmos-4491-no-such-folder']],
];
const verbName = (args) => args.slice(0, args[0] === 'task' || args[0] === 'agent' || args[0] === 'project' ? 2 : 1).join(' ');

// Async execFile, never execFileSync: a synchronous child blocks the event loop the stub answers on.
// The exit code itself is not asserted (the headers the stub saw are), but a run that ended with no
// numeric code (killed at the timeout, or never started) is a failure, not a pass (#3628).
function runCli(args, env) {
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve();
  }));
}

async function send(port, seen, home, args, token, only, extraEnv) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', ...(extraEnv || {}) };
  if (token === null) delete env.KOSMOS_AGENT_TOKEN; else env.KOSMOS_AGENT_TOKEN = token;
  /* Slice 7's switch is OFF unless a test turns it on: never inherited from the machine running the tests. */
  if (only === undefined) delete env.KOSMOS_AGENT_TOKEN_ONLY; else env.KOSMOS_AGENT_TOKEN_ONLY = only;
  const before = seen.length;
  await runCli(args, env);
  for (let i = 0; i < 100 && seen.length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, before + 1, `kosmos ${verbName(args)} did not reach the board at all, so its headers cannot be judged`);
  return seen[seen.length - 1];
}

for (const [route, args] of VERBS) {
  test(`kosmos ${verbName(args)} presents a valid agent token as x-kosmos-agent-token, and still the board token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        const got = await send(port, seen, home, args, TOKEN);
        assert.equal(got.route, route);
        assert.equal(got.agent, TOKEN, `kosmos ${verbName(args)} did not present the agent token`);
        assert.equal(got.board, BOARD, `kosmos ${verbName(args)} stopped sending the board token (dropping it is a later slice)`);
        /* `kosmos agent roles` asks for the downloaded roles too (#4632); role-draft and the others send their own query. */
        if (args.join(' ') === 'agent roles') assert.equal(got.query, 'catalogue=1', 'kosmos agent roles no longer asks for the catalogue');
        if (args.join(' ') === 'agent role-draft') assert.equal(got.query, '', 'kosmos agent role-draft started asking for the catalogue');
        if (args[0] === 'room') assert.equal(got.query, 'as=text');
        if (args.join(' ').startsWith('task list')) assert.equal(got.query, 'project=p4491');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  test(`kosmos ${verbName(args)} sends no agent header for a junk or absent token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        for (const token of ['not-hex; rm -rf', 'ABCDEF', '', null]) {
          const got = await send(port, seen, home, args, token);
          assert.equal(got.agent, undefined, `kosmos ${verbName(args)} forwarded ${JSON.stringify(token)} as an agent token`);
          assert.equal(got.board, BOARD);
        }
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

/* Slice 7: KOSMOS_AGENT_TOKEN_ONLY=1. An agent's everyday verbs then send its own token and NOT the person's board
   token, so the board knows the caller is that agent. The default (the tests above) is unchanged. */
const TOKEN_ONLY_VERBS = [
  ...VERBS.filter(([, args]) => verbName(args) !== 'project create'),
  ['/api/reply', ['reply', 'hello']],
  ['/api/report', ['report', 'working', 'on it']],
  ['/api/report', ['report', 'show']],
  ['/api/whoami', ['whoami']],
  ['/api/project/p4491/task/1/built', ['task', 'built', 'p4491', '1', 'the tests']],
  ['/api/projects/overview', ['project', 'list']],
  ['/api/project/p4491/overview', ['project', 'show', 'p4491']],
  ['/api/team', ['agent', 'create', 'Nia', 'builder', 'to help']],
];
/* The person's verbs: the board token opens these, whatever the switch says. */
const PERSON_VERBS = [
  ['/api/projects', ['project', 'create', 'My Project', '/tmp/kosmos-4491-no-such-folder']],
  ['/api/community/post', ['community', 'post', 'hello']],
  ['/api/project/p4491/room/reopen', ['room', 'reopen', 'p4491']],
];
const longName = (args) => (['community', 'report'].includes(args[0]) || args.join(' ').startsWith('room reopen') ? args.slice(0, 2).join(' ') : verbName(args));

for (const [route, args] of TOKEN_ONLY_VERBS) {
  test(`token-only: kosmos ${longName(args)} sends the agent's token and not the board token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        /* CONTROL first: the same verb with the switch off still sends both, so the absence below is the switch. */
        const off = await send(port, seen, home, args, TOKEN);
        assert.equal(off.route, route);
        assert.deepEqual([off.agent, off.board], [TOKEN, BOARD], `control: with the switch off, kosmos ${longName(args)} did not send both tokens`);
        const on = await send(port, seen, home, args, TOKEN, '1');
        assert.equal(on.route, route);
        assert.equal(on.agent, TOKEN, `kosmos ${longName(args)} did not present the agent token`);
        assert.equal(on.board, undefined, `token-only: kosmos ${longName(args)} still sent the person's board token`);
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  test(`token-only: kosmos ${longName(args)} keeps the board token when it has no usable agent token, or the switch is not exactly 1`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        /* `agent create` refuses to run at all with no usable token (it is for an agent acting for the person), so it
           has no request to judge here; its switch cases below still run. */
        if (verbName(args) !== 'agent create') {
          for (const token of ['not-hex; rm -rf', 'ABCDEF', '', null]) {
            const got = await send(port, seen, home, args, token, '1');
            assert.deepEqual([got.agent, got.board], [undefined, BOARD], `with ${JSON.stringify(token)} as its token, kosmos ${longName(args)} sent no credential the board can use`);
          }
          /* ABCDE: upper case with no letter past F, which a locale-ordered [a-f] range lets through (review 1). The
             board token must stay; whether the verb also presents it as its agent token is each verb's own older
             rule, not this switch's. */
          /* Run in a dictionary-ordered locale ON PURPOSE: under C or POSIX a range rejects ABCDE too, so this case
             could not fail there (review 2 measured it). en_US.UTF-8 is present on every macOS runner. */
          const upper = await send(port, seen, home, args, 'ABCDE', '1', { LC_ALL: 'en_US.UTF-8' });
          assert.equal(upper.board, BOARD, `with "ABCDE" as its token, kosmos ${longName(args)} dropped the board token`);
        }
        for (const only of ['', '0', 'true', 'yes', ' 1']) {
          const got = await send(port, seen, home, args, TOKEN, only);
          assert.deepEqual([got.agent, got.board], [TOKEN, BOARD], `KOSMOS_AGENT_TOKEN_ONLY=${JSON.stringify(only)} dropped the board token`);
        }
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

for (const [route, args] of PERSON_VERBS) {
  test(`token-only: kosmos ${longName(args)} is the person's and still sends the board token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        const got = await send(port, seen, home, args, TOKEN, '1');
        assert.equal(got.route, route);
        assert.equal(got.board, BOARD, `token-only: kosmos ${longName(args)} lost the board token that opens its route`);
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

/* Slice 5: the board now refuses an agent that is not on the project. Each verb prints the board's own sentence and
   exits 1 (its own stub: the shared one above always answers 200). */
for (const [args, verb] of [[['task', 'add', 'p4491', 'write the docs'], 'add tasks to it'], [['task', 'close', 'p4491', '1'], 'close its tasks']]) {
  test(`kosmos ${verbName(args)} prints the board's refusal for an agent that is not on the project, and exits 1`, async () => {
    const home = makeHome();
    const sentence = 'that agent is not on this project, so it cannot ' + verb;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        req.resume();
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: sentence }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const env = { ...process.env, KOSMOS_PORT: String(server.address().port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN };
      const out = await new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
        if (err && typeof err.code !== 'number') { reject(err); return; }
        resolve({ code: err ? err.code : 0, text: String(stdout) + String(stderr) });
      }));
      assert.equal(out.code, 1, 'a refused ' + verbName(args) + ' did not exit 1: ' + out.text.slice(0, 200));
      assert.ok(out.text.includes(sentence), 'the board\'s sentence was not printed: ' + out.text.slice(0, 200));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}
