'use strict';
/**
 * kosmos#5836: `kosmos task ran ... --value "<reading>"` sends the reading and says how it compares with what the PERSON was
 * last told (never / the same / changed); `kosmos task told ... [--value "..."]` records what the person was told. Both
 * CLIs, against a stub board (cli.task-ran-unchanged-5643's harness): install/kosmos runs for real, the Windows CLI gets an
 * injected fetch.
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
const TOKEN = 'ab'.repeat(32);
const homes = [];
test.after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5836-cli-'));
  homes.push(home);
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), 'boardtoken5836');
  return home;
}
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body; try { body = JSON.parse(raw); } catch { body = { unparseable: raw }; }
        seen.push({ route: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        // As the board answers: the stored task, which says whether the run was unchanged (the flag, or the same note).
        // 'again' answers as a retry within a minute of an unchanged run: duplicate AND lastRunUnchanged.
        res.end(JSON.stringify((body && typeof body.value === 'string' ? { task: { number: 3 }, vs_told: body.value === 'v-never' ? { state: 'never' } : body.value === 'v-same' ? { state: 'same', told: { value: 'told "x"', at: 'T' } } : { state: 'changed', told: { value: 'told "x"', at: 'T' } } } : { task: { number: 3 } })));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', async () => {
    let failure = null;
    try { await fn(server.address().port, seen); } catch (e) { failure = e; }
    server.close(() => (failure ? reject(failure) : resolve()));
  }));
}
function sh(port, home, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, so, se) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(so) + String(se) });
  }));
}
async function win(argv) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), body });
      const ans = (body && typeof body.value === 'string' ? { task: { number: 3 }, vs_told: body.value === 'v-never' ? { state: 'never' } : body.value === 'v-same' ? { state: 'same', told: { value: 'told "x"', at: 'T' } } : { state: 'changed', told: { value: 'told "x"', at: 'T' } } } : { task: { number: 3 } });
      return { status: 200, text: async () => JSON.stringify(ans) };
    },
  });
  return { code, calls, out: out.join('\n') + err.join('\n') };
}


for (const [state, value, want] of [
  ['never', 'v-never', /never been told this task's reading, so this is news: tell them, then run: kosmos task told p1 3/],
  // The told value is 'told "x"' (with quotes): both CLIs print it as the person read it, unescaped.
  ['same', 'v-same', /the same as what the person was last told \("told "x""\): nothing new to tell them/],
  ['changed', 'v-changed', /CHANGED since the person was last told \(they were told "told "x""\): tell them, then run: kosmos task told p1 3/],
]) {
  test('install/kosmos: task ran --value sends the reading and says it is ' + state + ' against what the person was told', async () => {
    const home = makeHome();
    await withStub(async (port, seen) => {
      const r = await sh(port, home, ['task', 'ran', 'p1', '3', '--value', value, 'checked it']);
      assert.equal(r.code, 0, r.out);
      assert.equal(seen[0].route, '/api/project/p1/task/3/ran');
      assert.equal(seen[0].body.value, value);
      assert.equal(seen[0].body.note, 'checked it');
      assert.match(r.out, /Recorded a run of task 3 on p1\./);
      assert.match(r.out, want);
    });
  });
  test('Windows CLI: task ran --value sends the reading and says it is ' + state + ' against what the person was told', async () => {
    const r = await win(['task', 'ran', 'p1', '3', '--value', value, 'checked it']);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls[0].route, '/api/project/p1/task/3/ran');
    assert.equal(r.calls[0].body.value, value);
    assert.match(r.out, /Recorded a run of task 3 on p1\./);
    assert.match(r.out, want);
  });
}

test('both CLIs: a run with NO --value sends no value and says nothing about what the person was told (control)', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    const r = await sh(port, home, ['task', 'ran', 'p1', '3', 'checked it']);
    assert.equal(r.code, 0, r.out);
    assert.equal('value' in seen[0].body, false);
    assert.doesNotMatch(r.out, /person was|never been told/);
  });
  const w = await win(['task', 'ran', 'p1', '3', 'checked it']);
  assert.equal(w.code, 0, w.out);
  assert.equal('value' in w.calls[0].body, false);
  assert.doesNotMatch(w.out, /person was|never been told/);
});

test('both CLIs: task told sends the words given, or none (the board then uses the last reading)', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    let r = await sh(port, home, ['task', 'told', 'p1', '3', '--value', 'price went up to $45']);
    assert.equal(r.code, 0, r.out);
    assert.equal(seen[0].route, '/api/project/p1/task/3/told');
    assert.equal(seen[0].body.value, 'price went up to $45');
    assert.match(r.out, /Recorded what the person was told about task 3 on p1\./);
    r = await sh(port, home, ['task', 'told', 'p1', '3']);
    assert.equal(r.code, 0, r.out);
    assert.equal('value' in seen[1].body, false);
  });
  let w = await win(['task', 'told', 'p1', '3', '--value', 'price went up to $45']);
  assert.equal(w.code, 0, w.out);
  assert.equal(w.calls[0].route, '/api/project/p1/task/3/told');
  assert.equal(w.calls[0].body.value, 'price went up to $45');
  assert.match(w.out, /Recorded what the person was told about task 3 on p1\./);
  w = await win(['task', 'told', 'p1', '3']);
  assert.equal('value' in w.calls[0].body, false);
});

// Review 1: an option is never taken as the reading (`--value --unchanged` used to store "--unchanged").
const REFUSED = [['task', 'told', 'p1', '3', '--note', 'x'], ['task', 'told', 'p1', '3', '--value'], ['task', 'ran', 'p1', '3', '--value'],
  ['task', 'ran', 'p1', '3', '--value', '--unchanged'], ['task', 'told', 'p1', '3', '--value', '--note']];
test('both CLIs: told takes bare words as what was told (as ran takes its note)', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    const r = await sh(port, home, ['task', 'told', 'p1', '3', 'price', 'went', 'up']);
    assert.equal(r.code, 0, r.out);
    assert.equal(seen[0].body.value, 'price went up');
  });
  const w = await win(['task', 'told', 'p1', '3', 'price', 'went', 'up']);
  assert.equal(w.code, 0, w.out);
  assert.equal(w.calls[0].body.value, 'price went up');
});

test('both CLIs: told refuses an option, and --value with no words or with an option, before calling the board', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    for (const args of REFUSED) {
      const r = await sh(port, home, args);
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.out);
    }
    assert.equal(seen.length, 0, 'a refused command reached the board');
  });
  for (const args of REFUSED) {
    const w = await win(args);
    assert.equal(w.code, 2, args.join(' ') + ': ' + w.out);
    assert.equal(w.calls.length, 0);
  }
});

/* Review 2: told's words, whatever mix of bare words and --value, join in order on both CLIs; `--` ends the options and
   is never part of the text, so a reading starting with -- can still be told. */
for (const [args, want] of [
  [['task', 'told', 'p1', '3', 'a', '--value', 'b'], 'a b'],
  [['task', 'told', 'p1', '3', '--', '3', 'errors'], '3 errors'],
  [['task', 'told', 'p1', '3', '--', '--dry', 'run'], '--dry run'],
]) {
  test('both CLIs: told ' + args.slice(4).join(' ') + ' records "' + want + '"', async () => {
    const home = makeHome();
    await withStub(async (port, seen) => {
      const r = await sh(port, home, args);
      assert.equal(r.code, 0, r.out);
      assert.equal(seen[0].body.value, want);
    });
    const w = await win(args);
    assert.equal(w.code, 0, w.out);
    assert.equal(w.calls[0].body.value, want);
  });
}
