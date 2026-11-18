'use strict';
/**
 * kosmos#8664: `kosmos task edit <project> <n> [--title "<new>"] [--detail "<new>" | --clear-detail]` on both CLIs.
 * install/kosmos runs against a stub board (cli.task-donewhen-5152.test.js's harness); tools/windows/kosmos-cli.js gets
 * an injected fetch. Both must send the same body to POST .../task/<n>/text, and refuse the same mistakes BEFORE any
 * request, with a control that does reach the board.
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
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const BOARD = 'boardtoken8664taskedit';
const TOKEN = 'ab'.repeat(32);

const homes = [];
test.after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8664-cli-'));
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

/* A stub board: `/` answers as Kosmos, every POST is recorded with its parsed body and answered as a task write. */
function withStub(fn, refusal, answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body; try { body = JSON.parse(raw); } catch { body = { unparseable: raw }; }
        seen.push({ route, body, agent: req.headers['x-kosmos-agent-token'] });
        if (refusal) { res.writeHead(refusal.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: refusal.error })); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer ? answer.body : { task: { number: 4, sentence: 'x', who: null }, changed: true }));
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
async function win(argv, refusal, answer) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '').split('?')[0];
      calls.push({ route, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, agent: init.headers['x-kosmos-agent-token'] });
      if (refusal) return { status: refusal.status, text: async () => JSON.stringify({ error: refusal.error }) };
      return { status: 200, text: async () => JSON.stringify(answer ? answer.body : { task: { number: 4, sentence: 'x', who: null }, changed: true }) };
    },
  });
  return { code, calls, out: out.join('\n') + '\n' + err.join('\n') };
}

const ROUTE = '/api/project/p8664/task/4/text';
/* What each CLI sends (both must agree). from_pane is dropped before comparing: the Mac one carries the pane. */
const SENDS = [
  [['--title', 'Fix login on iPhone'], { sentence: 'Fix login on iPhone' }],
  [['--detail', 'line one\nline two, "quoted" \\ back'], { detail: 'line one\nline two, "quoted" \\ back' }],
  [['--clear-detail'], { detail: null }],
  [['--title', 'tab\there', '--detail', 'new'], { sentence: 'tab here', detail: 'new' }],
  [['--detail', 'kept', '--title', 'order does not matter'], { sentence: 'order does not matter', detail: 'kept' }],
];
const REFUSED = [
  [[], /Usage: kosmos task edit/],
  [['--title'], /--title needs the new title/],
  [['--title', '   '], /A task needs a title/],
  [['--detail'], /--detail needs the new detail/],
  [['--title', 'a', '--title', 'b'], /Say --title once/],
  [['--detail', 'a', '--clear-detail'], /do not go together/],
  [['--clear-detail', '--clear-detail'], /Say --clear-detail once/],
  [['just words'], /Put --title or --detail before the new words/],
  [['--colour', 'red'], /--colour is not an option of kosmos task edit/],
  [['--title', '--clear-detail'], /--title needs a value, and --clear-detail is an option/],   // never a title of "--clear-detail"
  [['--detail', '--title', 'x'], /--detail needs a value, and --title is an option/],
];
const withoutPane = (b) => { const c = { ...b }; delete c.from_pane; return c; };

test('the Mac CLI sends each edit to the task text route, with the agent token', { skip: SKIP_POSIX_SHELL }, async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    for (const [extra, want] of SENDS) {
      const before = seen.length;
      const r = await sh(port, home, ['task', 'edit', 'p8664', '4', ...extra]);
      assert.equal(r.code, 0, extra.join(' ') + ': ' + r.out);
      assert.match(r.out, /Changed task 4 on p8664\. See it with: kosmos task show p8664 4/);
      assert.equal(seen.length, before + 1, 'one request per edit');
      const got = seen[seen.length - 1];
      assert.equal(got.route, ROUTE);
      assert.equal(got.agent, TOKEN, 'the agent token was not sent');
      assert.deepEqual(withoutPane(got.body), want, extra.join(' '));
    }
  });
});

test('the Windows CLI sends the same bodies', async () => {
  for (const [extra, want] of SENDS) {
    const r = await win(['task', 'edit', 'p8664', '4', ...extra]);
    assert.equal(r.code, 0, extra.join(' ') + ': ' + r.out);
    assert.match(r.out, /Changed task 4 on p8664\. See it with: kosmos task show p8664 4/);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].route, ROUTE);
    assert.equal(r.calls[0].agent, TOKEN);
    assert.deepEqual(withoutPane(r.calls[0].body), want, extra.join(' '));
  }
});

test('both CLIs refuse the same mistakes before any request', { skip: SKIP_POSIX_SHELL }, async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    for (const [extra, re] of REFUSED) {
      const mac = await sh(port, home, ['task', 'edit', 'p8664', '4', ...extra]);
      assert.equal(mac.code, 2, 'mac ' + JSON.stringify(extra) + ': ' + mac.out);
      assert.match(mac.out, re, 'mac ' + JSON.stringify(extra));
      const w = await win(['task', 'edit', 'p8664', '4', ...extra]);
      assert.equal(w.code, 2, 'win ' + JSON.stringify(extra) + ': ' + w.out);
      assert.match(w.out, re, 'win ' + JSON.stringify(extra));
      assert.equal(w.calls.length, 0, 'win sent a request for ' + JSON.stringify(extra));
      // This verb takes no `--` escape, so neither CLI may offer one.
      assert.doesNotMatch(mac.out + w.out, /put -- before it/, 'a refusal offered a -- escape the verb does not take: ' + JSON.stringify(extra));
    }
    const notNum = await sh(port, home, ['task', 'edit', 'p8664', 'four', '--title', 'x']);
    assert.equal(notNum.code, 2);
    assert.match(notNum.out, /must be a number/);
    const winNotNum = await win(['task', 'edit', 'p8664', 'four', '--title', 'x']);
    assert.equal(winNotNum.code, 2);
    assert.match(winNotNum.out, /must be a number/);
    assert.equal(winNotNum.calls.length, 0, 'win sent a request for a task number that is not a number');
    assert.equal(seen.length, 0, 'the Mac CLI sent a request for a refused edit');
    // CONTROL: the same harness does reach the board for a good edit.
    assert.equal((await sh(port, home, ['task', 'edit', 'p8664', '4', '--title', 'ok'])).code, 0);
    assert.equal(seen.length, 1, 'the control did not reach the stub');
  });
});

test('an edit that changed nothing says so, on both CLIs', { skip: SKIP_POSIX_SHELL }, async () => {
  const home = makeHome();
  const nothing = { status: 200, body: { task: { number: 4, sentence: 'x', who: null }, changed: false } };
  await withStub(async (port) => {
    const r = await sh(port, home, ['task', 'edit', 'p8664', '4', '--title', 'x']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Task 4 on p8664 already reads that way, so nothing changed\./);
  }, null, nothing);
  const w = await win(['task', 'edit', 'p8664', '4', '--title', 'x'], null, nothing);
  assert.equal(w.code, 0, w.out);
  assert.match(w.out, /Task 4 on p8664 already reads that way, so nothing changed\./);
});

test('a board refusal is passed on in its own words, on both CLIs', { skip: SKIP_POSIX_SHELL }, async () => {
  const home = makeHome();
  const refusal = { status: 403, error: 'mara is not on this project, so it cannot change its tasks' };
  await withStub(async (port) => {
    const r = await sh(port, home, ['task', 'edit', 'p8664', '4', '--title', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Kosmos could not change that task: mara is not on this project/);
  }, refusal);
  const w = await win(['task', 'edit', 'p8664', '4', '--title', 'x'], refusal);
  assert.equal(w.code, 1);
  assert.match(w.out, /Kosmos could not change that task: mara is not on this project/);
});
