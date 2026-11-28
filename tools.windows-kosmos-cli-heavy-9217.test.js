'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9217: `kosmos heavy` on the Windows CLI (tools/windows/kosmos-cli.js), driven through its main with a fetch
   that records each request and answers as the board would. The same cases as cli.heavy-9217.test.js on the Mac: what
   start and end send, what each answer prints, and what is refused before any request. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-heavy-9217-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

async function run(argv, answer) {
  const calls = [], out = [], err = [];
  const code = await cli.main(argv, {
    env: {},
    url: 'http://127.0.0.1:1',
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => null, agentToken: () => null },
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
      const [status, json] = answer(calls[calls.length - 1]);
      return { status, text: async () => JSON.stringify(json) };
    },
    engine: {},
    readStdin: () => ({ text: '', ended: true }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

const ok = (c) => (c.method === 'GET'
  ? [200, { ok: true, jobs: [{ agent: 'ada-discord', name: 'Ada', label: 'full test run', pid: 4242, since: Date.UTC(2026, 10, 27, 15, 5) }] }]
  : c.body.action === 'start' ? [200, { ok: true, job: { label: c.body.label, pid: c.body.pid || null, since: 1 } }]
    : [200, { ok: true, ended: 1, others: 0 }]);

test('heavy start sends the action, label and pid, and says it is recorded', async () => {
  const r = await run(['heavy', 'start', 'full test run', '--pid', '4242'], ok);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Recorded: full test run\. It shows on the board as running while process 4242 runs\. kosmos heavy end --pid 4242 when it is done\.$/);
  const posts = r.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/api\/heavy$/);
  assert.equal(posts[0].body.action, 'start');
  assert.equal(posts[0].body.label, 'full test run');
  assert.equal(posts[0].body.pid, 4242);
});

test('heavy end sends no label and no pid when none is given, and says it ended', async () => {
  const r = await run(['heavy', 'end'], ok);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Ended: it no longer shows on the board\.$/);
  const post = r.calls.find((c) => c.method === 'POST');
  assert.equal(post.body.action, 'end');
  assert.equal(post.body.label, undefined);
  assert.equal(post.body.pid, undefined);
});

test('a bare end that left process-tied jobs says how to end them; with a pid it says the plain sentence', async () => {
  const left = () => [200, { ok: true, ended: 0, others: 2 }];
  const r = await run(['heavy', 'end'], left);
  assert.match(r.out, /Your 2 recorded jobs are tied to a process: end each with kosmos heavy end --pid N/);
  const p = await run(['heavy', 'end', '--pid', '77'], left);
  assert.match(p.out, /^Nothing of yours was recorded as running for that process\.$/);
});

test('a bare heavy lists what is running, by the display name', async () => {
  const r = await run(['heavy'], ok);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^full test run \(Ada, since \d\d:\d\d, process 4242\)$/m);
  assert.equal(r.calls[0].method, 'GET');
  const none = await run(['heavy'], () => [200, { ok: true, jobs: [] }]);
  assert.equal(none.out, 'No heavy job is running on this computer.');
});

test('the board\'s refusal is said in its words and exits 1', async () => {
  const r = await run(['heavy', 'start', 'x'], () => [400, { error: 'a job cannot start with -' }]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Kosmos did not record that: a job cannot start with -\./);
  const l = await run(['heavy'], () => [403, { error: 'only an agent or the person on this computer can list its heavy jobs' }]);
  assert.equal(l.code, 1);
  assert.match(l.err, /Kosmos could not list heavy jobs: only an agent/);
});

test('bad arguments are refused before any request', async () => {
  for (const argv of [['heavy', 'start'], ['heavy', 'start', 'a', 'b'], ['heavy', 'end', '--pid'], ['heavy', 'words']]) {
    const r = await run(argv, ok);
    assert.equal(r.code, 2, argv.join(' ') + ': ' + r.out + r.err);
    assert.deepEqual(r.calls, [], argv.join(' ') + ' sent a request');
  }
  const bad = await run(['heavy', 'start', 'x', '--pid', 'abc'], ok);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /a process id is a whole number above 1/);
  assert.deepEqual(bad.calls, []);
});

test('an empty --pid is refused, not read as no pid', async () => {
  for (const argv of [['heavy', 'end', '--pid', ''], ['heavy', 'end', '--pid='], ['heavy', 'start', 'x', '--pid', '']]) {
    const r = await run(argv, ok);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.deepEqual(r.calls, []);
  }
});

test('kosmos#9222: a job Kosmos could not check is listed with how to end it', async () => {
  const r = await run(['heavy'], () => [200, { ok: true, jobs: [{ agent: 'ada-discord', name: 'Ada', label: 'overnight', pid: 4242, since: Date.UTC(2026, 10, 27, 3, 5), unchecked: true }] }]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^overnight \(Ada, since \d\d:\d\d, process 4242\): Kosmos could not check it, so the board does not show it; if it is no longer your job, kosmos heavy end --pid 4242$/m);
});

// kosmos#9217 slice 2: take and release, worded as install/kosmos (cli.heavy-9217.test.js expects the same words).
const S = Date.UTC(2026, 10, 27, 15, 5);
const turnAnswers = {
  turn: { ok: true, turn: true, job: { label: 'suite', pid: 4242, since: S } },
  behind: { ok: true, turn: false, place: 2, holder: { agent: 'ada', label: 'cut', pid: null, since: S }, ahead: [{ agent: 'bo', label: 'v', pid: null, since: S }] },
  free: { ok: true, turn: false, place: 2, holder: null, ahead: [{ agent: 'bo', label: 'v', pid: null, since: S }] },
  ended: { ok: true, left: 0, ended: 1 },
  left: { ok: true, left: 1, ended: 0 },
  none: { ok: true, left: 0, ended: 0 },
};
const answering = (k) => () => [200, turnAnswers[k]];

test('heavy take: the turn returns 0 and says how to release it; it sends take with the label and pid', async () => {
  const r = await run(['heavy', 'take', 'suite', '--pid', '4242'], answering('turn'));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Your turn: suite is recorded as running while process 4242 runs\. kosmos heavy release --pid 4242 when it is done\.$/);
  const post = r.calls.find((c) => c.method === 'POST');
  assert.deepEqual([post.body.action, post.body.label, post.body.pid], ['take', 'suite', 4242]);
});

test('heavy take: a kept place returns 3 and says the place, the holder and who is ahead', async () => {
  const r = await run(['heavy', 'take', 'suite'], answering('behind'));
  assert.equal(r.code, 3, r.err);
  assert.match(r.out, /^Not yet: you are 2nd in line; ada has the turn \(cut, since \d\d:\d\d\)\. Ahead of you: bo\. Ask again with kosmos heavy take to keep your place\.$/);
});

test('heavy take: behind a free turn, it names who has 2 minutes to take it', async () => {
  const r = await run(['heavy', 'take', 'suite'], answering('free'));
  assert.equal(r.code, 3, r.err);
  assert.match(r.out, /^Not yet: you are 2nd in line; the turn is free for bo, who has 2 minutes to take it\. Ask again with kosmos heavy take to keep your place\.$/);
});

test('heavy release: an ended turn, a given-up place, and nothing to release each say so and return 0', async () => {
  for (const [k, want] of [['ended', /^Released: your turn has ended, and it no longer shows on the board\.$/], ['left', /^Released: you gave up your place in line\.$/], ['none', /^You had no turn and no place in line\.$/]]) {
    const r = await run(['heavy', 'release'], answering(k));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, want, k);
    assert.equal(r.calls.find((c) => c.method === 'POST').body.action, 'release');
  }
});

test('heavy take needs a label; release takes none', async () => {
  assert.equal((await run(['heavy', 'take'], answering('turn'))).code, 2);
  const r = await run(['heavy', 'release', 'words'], answering('turn'));
  assert.equal(r.code, 2);
  assert.equal(r.calls.filter((c) => c.method === 'POST').length, 0);
});

test('a bare heavy lists the line of turns after what is running', async () => {
  const r = await run(['heavy'], () => [200, { ok: true, jobs: [], line: [{ agent: 'bo', name: 'Bo', label: 'v', pid: null, since: S }] }]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^No heavy job is running on this computer\.\nWaiting 1: Bo, v \(in line since \d\d:\d\d\)$/);
});
