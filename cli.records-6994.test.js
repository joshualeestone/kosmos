'use strict';
/**
 * #6994: both CLIs carry a project's records. `kosmos records <project>` prints the board's own rendering
 * (?as=text); `kosmos records set|remove|label` send one row's change. install/kosmos runs against a stub board (the
 * cli.task-donewhen-5152.test.js pattern); tools/windows/kosmos-cli.js gets an injected fetch. Each case is run on
 * both, so the two commands send the same request; each refusal happens BEFORE any request.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const wincli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

const CLI = path.join(__dirname, 'install', 'kosmos');
const BOARD = 'boardtoken6994records';
const TOKEN = 'cd'.repeat(32);
const LIST_TEXT = 'Accounts on Acme pipeline: 2, 1 stale (evidence more than 30 days old)\n  Acme | active | confirmed 2026-10-23 (today) by mara | -\n  Globex | lead | confirmed 2026-09-01 (52 days ago, stale) by ana | notes/globex.md';

const homes = [];
test.after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-6994-cli-'));
  homes.push(home);
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), BOARD);
  return home;
}

/* What the stub answers: the list's text, 201 for a new row, 200 for the rest; `missing` for the 404 arm. */
function answer(method, route, body) {
  if (route.startsWith("/api/project/older/")) return { status: 404, body: { error: "no such endpoint" } };
  if (body && body.name === "acme-lower") return { status: 200, body: { name: "Acme" } };
  if (body && body.name === "Existing") return { status: 200, body: { row: { name: "Existing" }, created: false } };
  if (body && body.name === "Quoted") return { status: 404, body: { error: "there is no record called \"Quoted\" \\ here" } };
  if (route === '/api/project/missing/records' || route.startsWith('/api/project/missing/')) return { status: 404, body: { error: 'there is no project by that name' } };
  if (method === 'GET') return { status: 200, text: LIST_TEXT + '\n' };
  if (route.endsWith('/label')) return { status: 200, body: { label: 'accounts' } };
  if (route.endsWith('/remove')) return { status: 200, body: { name: 'Acme' } };
  return { status: 201, body: { row: { name: 'Acme' }, created: true } };
}
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const [route, query] = req.url.split('?');
    if (route.startsWith('/api/project/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = { unparseable: raw }; }
        seen.push({ method: req.method, route, query: query || '', body, agent: req.headers['x-kosmos-agent-token'] });
        const a = answer(req.method, route, body);
        if (a.text !== undefined) { res.writeHead(a.status, { 'content-type': 'text/plain' }); res.end(a.text); return; }
        res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body));
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
function sh(port, home, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) });
  }));
}
async function win(argv) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'ef'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const [route, query] = url.replace('http://127.0.0.1:1', '').split('?');
      calls.push({ method: init.method, route, query: query || '', body: init.body ? JSON.parse(init.body) : undefined, agent: init.headers['x-kosmos-agent-token'] });
      const a = answer(init.method, route, init.body ? JSON.parse(init.body) : undefined);
      return { status: a.status, text: async () => (a.text !== undefined ? a.text : JSON.stringify(a.body)) };
    },
  });
  return { code, calls, out: out.join('\n') + '\n' + err.join('\n') };
}

/* [argv, method, route, what the body must be, what the command must say]. */
const SENDS = [
  [['records', 'set', 'p6994', 'Acme "Inc" \\ Ltd', '--status', 'active', '--confirmed', '2026-10-20', '--source', 'https://crm.example/a?b=c'],
    'POST', '/api/project/p6994/records',
    { name: 'Acme "Inc" \\ Ltd', status: 'active', confirmed: '2026-10-20', source: 'https://crm.example/a?b=c' }, /Added Acme "Inc" \\ Ltd to the records of p6994\./],
  [['records', 'set', 'p6994', 'Acme'], 'POST', '/api/project/p6994/records', { name: 'Acme' }, /Added Acme/],
  [['records', 'set', 'p6994', 'Existing', '--status', 'renewed'], 'POST', '/api/project/p6994/records', { name: 'Existing', status: 'renewed' }, /Updated Existing in the records of p6994\./],
  [['records', 'set', 'p6994', 'Acme', '--status', ''], 'POST', '/api/project/p6994/records', { name: 'Acme', status: '' }, /Added Acme/],
  [['records', 'remove', 'p6994', 'Acme'], 'POST', '/api/project/p6994/records/remove', { name: 'Acme' }, /Removed Acme from the records of p6994\./],
  [['records', 'label', 'p6994', 'accounts'], 'POST', '/api/project/p6994/records/label', { label: 'accounts' }, /now called accounts\./],
];
const REFUSED = [
  [['records', 'set', 'p6994'], /Usage: kosmos records/],
  [['records', 'set', 'p6994', 'Acme', '--colour', 'red'], /Unknown: --colour/],
  [['records', 'set', 'p6994', 'Acme', '--status'], /--status needs a value/],
  [['records', 'set', 'p6994', 'Acme', '--confirmed'], /--confirmed needs a date/],
  [['records', 'remove', 'p6994', 'Acme', 'extra'], /Usage: kosmos records/],
  [['records', 'p6994', 'extra'], /Usage: kosmos records/],
];

test('#6994: `kosmos records <project>` prints the board\'s rendering, the same on both commands', () => withStub(async (port, seen) => {
  const home = makeHome();
  const mac = await sh(port, home, ['records', 'p6994']);
  assert.equal(mac.code, 0, mac.out);
  assert.equal(mac.out, LIST_TEXT + '\n', 'exactly the board\'s list, with no blank line after it');
  assert.deepEqual(seen.map((s) => [s.method, s.route, s.query]), [['GET', '/api/project/p6994/records', 'as=text']]);
  const w = await win(['records', 'p6994']);
  assert.equal(w.code, 0, w.out);
  assert.equal(w.out, LIST_TEXT + '\n');
  assert.deepEqual(w.calls.map((c) => [c.method, c.route, c.query]), [['GET', '/api/project/p6994/records', 'as=text']]);
}));

for (const [argv, method, route, body, said] of SENDS) {
  test('#6994: ' + argv.slice(0, 2).join(' ') + ' sends the same request on both commands: ' + JSON.stringify(argv.slice(2)), () => withStub(async (port, seen) => {
    const mac = await sh(port, makeHome(), argv);
    assert.equal(mac.code, 0, mac.out);
    assert.match(mac.out, said);
    assert.equal(seen.length, 1, JSON.stringify(seen));
    assert.deepEqual([seen[0].method, seen[0].route, seen[0].body], [method, route, body]);
    assert.equal(seen[0].agent, TOKEN, 'the agent\'s own token went with it');
    const w = await win(argv);
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, said);
    assert.deepEqual(w.calls.map((c) => [c.method, c.route, c.body]), [[method, route, body]]);
  }));
}

for (const [argv, said] of REFUSED) {
  test('#6994: refused before any request on both commands: ' + JSON.stringify(argv), () => withStub(async (port, seen) => {
    const mac = await sh(port, makeHome(), argv);
    assert.equal(mac.code, 2, mac.out);
    assert.match(mac.out, said);
    assert.deepEqual(seen, [], 'the Mac command sent a request it should have refused');
    const w = await win(argv);
    assert.equal(w.code, 2, w.out);
    assert.match(w.out, said);
    assert.deepEqual(w.calls.filter((c) => c.route.startsWith('/api/project/')), []);
  }));
}

test('#6994: an unknown project is said in plain words on both commands', () => withStub(async (port) => {
  const mac = await sh(port, makeHome(), ['records', 'missing']);
  assert.equal(mac.code, 1, mac.out);
  assert.match(mac.out, /There is no project called missing\. kosmos project list shows them\./);
  const w = await win(['records', 'missing']);
  assert.equal(w.code, 1, w.out);
  assert.match(w.out, /There is no project called missing\. kosmos project list shows them\./);
  const set = await sh(port, makeHome(), ['records', 'set', 'missing', 'Acme']);
  assert.match(set.out, /Not changed: there is no project by that name\./);
}));

test('#6994: a refusal that quotes a name arrives whole, quotes and backslash included, on both commands', () => withStub(async (port) => {
  const mac = await sh(port, makeHome(), ['records', 'remove', 'p6994', 'Quoted']);
  assert.equal(mac.code, 1, mac.out);
  assert.match(mac.out, /Not changed: there is no record called "Quoted" \\ here\./);
  const w = await win(['records', 'remove', 'p6994', 'Quoted']);
  assert.equal(w.code, 1, w.out);
  assert.match(w.out, /Not changed: there is no record called "Quoted" \\ here\./);
}));

test('#6994: a project id that cannot be one is refused before any request, in the 404\'s words, on both commands', () => withStub(async (port, seen) => {
  for (const argv of [['records', 'p/../x'], ['records', 'set', 'a b', 'Acme']]) {
    const mac = await sh(port, makeHome(), argv);
    assert.equal(mac.code, 1, mac.out);
    assert.match(mac.out, /There is no project called .*\. kosmos project list shows them\./);
    const w = await win(argv);
    assert.equal(w.code, 1, w.out);
    assert.match(w.out, /There is no project called .*\. kosmos project list shows them\./);
    assert.deepEqual(w.calls.filter((c) => c.route.startsWith('/api/project/')), []);
  }
  assert.deepEqual(seen, [], 'the Mac command sent a request for an id it should have refused');
}));

test('#6994: a board from before records says so in plain words, on the list and on a write, on both commands', () => withStub(async (port) => {
  for (const argv of [['records', 'older'], ['records', 'set', 'older', 'Acme']]) {
    const mac = await sh(port, makeHome(), argv);
    assert.equal(mac.code, 1, mac.out);
    assert.match(mac.out, /[Tt]his Kosmos does not keep records yet[.;] [Uu]pdate Kosmos to use kosmos records\./);
    assert.doesNotMatch(mac.out, /no project called/);
    const w = await win(argv);
    assert.equal(w.code, 1, w.out);
    assert.match(w.out, /[Tt]his Kosmos does not keep records yet[.;] [Uu]pdate Kosmos to use kosmos records\./);
  }
}));

test('#6994: remove names the row as the board stored it, on both commands', () => withStub(async (port) => {
  const mac = await sh(port, makeHome(), ['records', 'remove', 'p6994', 'acme-lower']);
  assert.match(mac.out, /Removed Acme from the records of p6994\./);
  const w = await win(['records', 'remove', 'p6994', 'acme-lower']);
  assert.match(w.out, /Removed Acme from the records of p6994\./);
}));
