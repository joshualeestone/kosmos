'use strict';
/**
 * #4771: the Mac CLI's `kosmos task hold|unhold` and the "[on hold]" marker in `kosmos task list`, driven against a
 * fake board (the Windows twin is tools.windows-kosmos-cli-570.test.js). The harness is cli.task-2662.test.js's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
// A sandboxed KOSMOS_HOME whose runtime/bin/node is this node, as cli.agent-create-3734.test.js does: the list's
// formatter runs on the CLI's own runtime, and without one the CLI prints the raw answer.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-hold-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* A board that records each hold write and answers from `answer` (status, body), and serves a task list. */
function board(answer) {
  const writes = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const hold = /^\/api\/project\/([^/]+)\/task\/(\d+)\/hold$/.exec(req.url);
      if (req.method === 'POST' && hold) {
        writes.push({ project: hold[1], n: hold[2], body: JSON.parse(raw || 'null') });
        const [status, body] = answer(writes[writes.length - 1]);
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(body));
      }
      if (req.method === 'GET' && req.url.startsWith('/api/tasks')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ project: 'p1', tasks: [
          { number: 1, sentence: 'held itself', onHold: true },
          { number: 2, sentence: 'in a paused project', projectPaused: true },
          { number: 3, sentence: 'real work' },
          { number: 4, sentence: 'finished while held', onHold: true, isClosed: true },
        ] }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return { server, writes };
}

async function withBoard(answer, fn) {
  const b = board(answer);
  await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, KOSMOS_HOME: HOME, KOSMOS_PORT: String(b.server.address().port), TMUX_PANE: '%42', KOSMOS_NO_LEGACY_MIGRATION: '1' };
  try { return await fn(env, b.writes); } finally { await new Promise((r) => b.server.close(r)); }
}

test('#4771 Mac CLI: task hold / unhold POST {onHold} to the task\'s hold route and say what happened', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), ...(w.body.onHold ? { onHold: true } : {}) } }], async (env, writes) => {
    const on = await runCli(['task', 'hold', 'p1', '3'], env);
    assert.equal(on.code, 0, on.stdout + on.stderr);
    assert.match(on.stdout, /Put task 3 on p1 on hold/);
    const off = await runCli(['task', 'unhold', 'p1', '3'], env);
    assert.equal(off.code, 0, off.stdout + off.stderr);
    assert.match(off.stdout, /Took task 3 on p1 off hold/);
    assert.deepEqual(writes.map((x) => [x.project, x.n, x.body]), [['p1', '3', { onHold: true }], ['p1', '3', { onHold: false }]]);
  });
});

test('#4771 Mac CLI: a refused unhold says the board\'s reason and exits non-zero; a non-number is sent nowhere', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard(() => [403, { error: 'the person put this task on hold, so only they can take it off, on the screen' }], async (env, writes) => {
    const r = await runCli(['task', 'unhold', 'p1', '3'], env);
    assert.notEqual(r.code, 0, 'a refusal exited 0');
    assert.match(r.stdout, /could not change that task: the person put this task on hold, so only they can take it off, on the screen/);
    const bad = await runCli(['task', 'hold', 'p1', 'two'], env);
    assert.notEqual(bad.code, 0);
    assert.equal(writes.length, 1, 'a non-number task was sent to the board');
  });
});

test('#4771 Mac CLI: task list marks held work "[on hold]"; a plain task is the control', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard(() => [500, {}], async (env) => {
    const r = await runCli(['task', 'list', 'p1'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const lines = r.stdout.split('\n');
    assert.ok(lines.includes('[1] [on hold] held itself'), r.stdout);
    assert.ok(lines.includes('[2] [on hold] in a paused project'), r.stdout);
    assert.ok(lines.includes('[3] real work'), 'control: a task not held is marked: ' + r.stdout);
    assert.ok(lines.includes('[4] [done] finished while held'), r.stdout);
  });
});

test('#7749 Mac CLI: task hold --because sends the reason in either order; none means no write', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true } }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--because', 'waits on "legal"'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    const b = await runCli(['task', 'hold', 'p1', '3', '--until-task', '5', '--because', 'legal'], env);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    const none = await runCli(['task', 'hold', 'p1', '3', '--because'], env);
    assert.equal(none.code, 2);
    assert.deepEqual(writes.map((x) => x.body), [{ onHold: true, because: 'waits on "legal"' }, { onHold: true, until: { task: 5 }, because: 'legal' }]);
  });
});

test('#7788 Mac CLI: task hold --for-you sends forPerson anywhere after the number, and says so; never on unhold', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, ...(w.body && w.body.forPerson ? { onHoldForPerson: true } : {}) } }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--because', 'needs your yes'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /waiting on your person/);
    const b = await runCli(['task', 'hold', 'p1', '3', '--until-task', '5', '--for-you'], env);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    const c = await runCli(['task', 'hold', 'p1', '3'], env);
    assert.doesNotMatch(c.stdout, /waiting on your person/, 'control: no flag, no line');
    const off = await runCli(['task', 'unhold', 'p1', '3', '--for-you'], env);
    assert.equal(off.code, 2, 'unhold takes no --for-you');
    assert.deepEqual(writes.map((x) => x.body), [{ onHold: true, because: 'needs your yes', forPerson: true }, { onHold: true, until: { task: 5 }, forPerson: true }, { onHold: true }]);
  });
});

test('#7180 Mac CLI: task hold --until-task / --until send the condition and say what it waits for; bad values are sent nowhere', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true } }], async (env, writes) => {
    const t = await runCli(['task', 'hold', 'p1', '3', '--until-task', '5'], env);
    assert.equal(t.code, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /Put task 3 on p1 on hold/);
    assert.match(t.stdout, /It waits for task 5 to be closed/);
    const at = await runCli(['task', 'hold', 'p1', '3', '--until', '2026-11-02T09:00Z'], env);
    assert.equal(at.code, 0, at.stdout + at.stderr);
    assert.match(at.stdout, /It waits until 2026-11-02T09:00Z/);
    assert.deepEqual(writes.map((x) => x.body), [{ onHold: true, until: { task: 5 } }, { onHold: true, until: { at: '2026-11-02T09:00Z' } }]);
    for (const args of [['--until-task', 'five'], ['--until-task', '05'], ['--until', 'friday'], ['--until-task', '5', '--until', '2026-11-02'], ['--until-task']]) {
      const r = await runCli(['task', 'hold', 'p1', '3', ...args], env);
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.stdout + r.stderr);
    }
    assert.equal(writes.length, 2, 'a refused condition was sent');
  });
});

test('#7180 Mac CLI: task list says what a hold waits for', { skip: SKIP_POSIX_SHELL }, async () => {
  const b = board(() => [200, {}]);
  b.server.removeAllListeners('request');
  b.server.on('request', (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/tasks')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ project: 'p1', tasks: [
        { number: 1, sentence: 'waits for a task', onHold: true, onHoldUntil: { task: 5 } },
        { number: 2, sentence: 'waits for a time', onHold: true, onHoldUntil: { at: '2026-11-02T09:00:00.000Z' } },
        { number: 3, sentence: 'a bare hold', onHold: true },
      ] }));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<title>Kosmos</title>Agent Workforce');
  });
  await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, KOSMOS_HOME: HOME, KOSMOS_PORT: String(b.server.address().port), TMUX_PANE: '%42', KOSMOS_NO_LEGACY_MIGRATION: '1' };
  try {
    const r = await runCli(['task', 'list', 'p1'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[1\] \[on hold until task 5 is closed\] waits for a task/);
    assert.match(r.stdout, /\[2\] \[on hold until 2026-11-02T09:00:00\.000Z\] waits for a time/);
    assert.match(r.stdout, /\[3\] \[on hold\] a bare hold/, 'CONTROL: a bare hold');
  } finally { await new Promise((r) => b.server.close(r)); }
});

test('#7180 Mac CLI: each wrong hold shape gets its own message; the time said back is the board\'s stored one', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, ...(w.body.until && w.body.until.at ? { onHoldUntil: { at: '2026-11-02T00:00:00.000Z' } } : {}) } }], async (env, writes) => {
    const noValue = await runCli(['task', 'hold', 'p1', '3', '--until-task'], env);
    assert.equal(noValue.code, 2);
    assert.match(noValue.stdout + noValue.stderr, /--until-task needs a value/);
    const stray = await runCli(['task', 'hold', 'p1', '3', 'now'], env);
    assert.equal(stray.code, 2);
    assert.match(stray.stdout + stray.stderr, /takes no more words than its usage shows/);
    const two = await runCli(['task', 'hold', 'p1', '3', '--until', '2026-11-02', 'extra'], env);
    assert.equal(two.code, 2);
    assert.match(two.stdout + two.stderr, /at most one condition/);
    assert.equal(writes.length, 0, 'a wrong shape was sent');
    const lower = await runCli(['task', 'hold', 'p1', '3', '--until', '2026-11-02t09:00z'], env);
    assert.equal(lower.code, 0, 'a lower-case t and z, which the board takes, were refused: ' + lower.stdout + lower.stderr);
    writes.length = 0;
    const ok = await runCli(['task', 'hold', 'p1', '3', '--until', '2026-11-02'], env);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /It waits until 2026-11-02T00:00:00\.000Z/, 'the typed date, not the stored time, was said back');
  });
});

test('#7788 Mac CLI: a board that ignores --for-you (older) holds it, says it is not on the list, and exits 1', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true } }], async (env) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--for-you'], env);
    assert.equal(a.code, 1, a.stdout + a.stderr);
    assert.match(a.stdout, /Put task 3 on p1 on hold/);
    assert.match(a.stdout, /older than --for-you, so it is on hold but not on the list/);
    assert.doesNotMatch(a.stdout, /It is on the list of what is waiting on your person/, 'claimed a mark the board did not record');
  });
});

test('#8395 Mac CLI: --suggest sends the suggested answer with --for-you, anywhere after the number, and says it was kept', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, ...(w.body && w.body.forPerson ? { onHoldForPerson: true } : {}),
    ...(w.body && typeof w.body.suggest === 'string' ? { onHoldSuggest: w.body.suggest } : {}) } }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--suggest', 'the lower one', '--for-you', '--because', 'which price'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /Suggested answer, as shown beside it: the lower one/);
    const b = await runCli(['task', 'hold', 'p1', '3', '--because', 'which price', '--for-you', '--suggest', 'yes'], env);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    // --suggest as the value of --because is the reason, not the option.
    const c = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--because', '--suggest'], env);
    assert.equal(c.code, 0, c.stdout + c.stderr);
    assert.deepEqual(writes.map((x) => x.body), [
      { onHold: true, because: 'which price', forPerson: true, suggest: 'the lower one' },
      { onHold: true, because: 'which price', forPerson: true, suggest: 'yes' },
      { onHold: true, because: '--suggest', forPerson: true },
    ]);
  });
});

test('#8395 Mac CLI: --suggest without --for-you, or with no words, is refused and sent nowhere', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard(() => [200, { task: { number: 3, onHold: true } }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--suggest', 'yes'], env);
    assert.equal(a.code, 2, a.stdout + a.stderr);
    assert.match(a.stdout + a.stderr, /--suggest goes with --for-you/);
    const blank = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--suggest', '   '], env);
    assert.equal(blank.code, 2, 'a suggestion of only spaces was sent');
    const b = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--suggest'], env);
    assert.equal(b.code, 2, b.stdout + b.stderr);
    assert.match(b.stdout + b.stderr, /--suggest needs a few words/);
    assert.equal(writes.length, 0, 'a refused --suggest still reached the board');
  });
});

test('#8395 Mac CLI: a board that ignores --suggest (older) holds it, says it was not kept, and exits 1', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard(() => [200, { task: { number: 3, onHold: true, onHoldForPerson: true } }], async (env) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--suggest', 'yes'], env);
    assert.equal(a.code, 1, a.stdout + a.stderr);
    assert.match(a.stdout, /older than --suggest, so the suggested answer was not kept/);
    assert.doesNotMatch(a.stdout, /as shown beside it/, 'claimed a suggestion the board did not keep');
  });
});

test('#7788 review 2 Mac CLI: --for-you as the value of --because is the reason, not the switch', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, ...(w.body && w.body.forPerson ? { onHoldForPerson: true } : {}) } }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--because', '--for-you'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    const b = await runCli(['task', 'hold', 'p1', '3', '--because', 'legal', '--for-you'], env);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    assert.deepEqual(writes.map((x) => x.body), [{ onHold: true, because: '--for-you' }, { onHold: true, because: 'legal', forPerson: true }],
      'the first is a reason; the second (control) is the switch after a reason');
  });
});

test('#7797 Mac CLI: --not-for-you sends forPerson false, keeps the hold, and says it left the list; both switches refused', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, ...(w.body && w.body.forPerson === true ? { onHoldForPerson: true } : {}) }, ...(w.body && w.body.forPerson === false ? { forPersonCleared: true } : {}) }], async (env, writes) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /no longer on the list of what is waiting on your person/);
    const both = await runCli(['task', 'hold', 'p1', '3', '--for-you', '--not-for-you'], env);
    assert.equal(both.code, 2, 'both switches are refused');
    const c = await runCli(['task', 'hold', 'p1', '3', '--because', '--not-for-you'], env);
    assert.equal(c.code, 0, c.stdout + c.stderr);
    assert.deepEqual(writes.map((x) => x.body), [{ onHold: true, forPerson: false }, { onHold: true, because: '--not-for-you' }],
      'unmarked; nothing sent for both; and as a reason it is words (control)');
  });
  // Review 4: a board that does not say whether the mark came off: only what is true either way, and exit 0.
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true } }], async (env) => {
    const unsaid = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(unsaid.code, 0, unsaid.stdout + unsaid.stderr);
    assert.match(unsaid.stdout, /It is not on the list of what is waiting on your person\./);
    assert.doesNotMatch(unsaid.stdout, /no longer on the list/);
  });
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true, onHoldForPerson: true } }], async (env) => {
    const old = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(old.code, 1, 'an older board that kept the mark exits 1');
    assert.match(old.stdout, /older than --not-for-you, so it still waits on your person/);
  });
});

test('#7797 review 1 Mac CLI: --not-for-you says the task stays on hold, never that it put it on hold; a refusal is said and exits 1', { skip: SKIP_POSIX_SHELL }, async () => {
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true }, forPersonCleared: true }], async (env) => {
    const a = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /Task 3 on p1 stays on hold\./);
    assert.match(a.stdout, /no longer on the list of what is waiting on your person/);
    assert.doesNotMatch(a.stdout, /Put task 3/, 'it said it put the task on hold');
  });
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true }, forPersonCleared: false }], async (env) => {
    const b = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    assert.match(b.stdout, /stays on hold as it was\. It was not on the list/);
    assert.doesNotMatch(b.stdout, /no longer on the list/, 'it claimed a mark came off that was never there');
  });
  await withBoard(() => [409, { error: 'this task is not on hold, so there is no mark to take off' }], async (env) => {
    const c = await runCli(['task', 'hold', 'p1', '3', '--not-for-you'], env);
    assert.equal(c.code, 1);
    assert.match(c.stdout + c.stderr, /not on hold, so there is no mark to take off/);
  });
  await withBoard((w) => [200, { task: { number: Number(w.n), onHold: true } }], async (env) => {
    const d = await runCli(['task', 'hold', 'p1', '3'], env);
    assert.match(d.stdout, /Put task 3 on p1 on hold/, 'CONTROL: an ordinary hold still says it put it on hold');
  });
});
