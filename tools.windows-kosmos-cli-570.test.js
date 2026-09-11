'use strict';
/**
 * #570: the Windows agent's `kosmos` command (tools/windows/kosmos-cli.js).
 *
 * 🛑 What it must not get wrong: the route and body each verb sends (the board
 * already speaks them for install/kosmos), the two credentials it presents, and
 * the exit code a caller reads -- 3 for "maybe", never 1, which invites the retry
 * that duplicates a send. No board is needed: fetch is injected, and one test
 * runs against a real local server.
 *
 *   node --test tools.windows-kosmos-cli-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

/* Run one command against a scripted board. `answer(route, init)` returns
   { status, body } (an object is sent as JSON) or throws to simulate a failure. */
async function run(argv, answer, env) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: env || { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const a = answer ? answer(route, init) : { status: 200, body: {} };
      const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      return { status: a.status || 200, text: async () => text };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const refusedWith = (e) => () => { throw e; };

// ── the answer that did not exist: reply ────────────────────────────────────

test('reply: POST /api/reply with the text, the agent token AND the board token; kept -> exit 0', async () => {
  const r = await run(['reply', 'OSPREY'], () => ({ body: { kept: true } }));
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/reply');
  assert.deepEqual(r.calls[0].body, { text: 'OSPREY', from_pane: '' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT, 'no agent token: a Windows agent has no pane, so the board cannot tell who it is');
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'no board token: a Windows board enforces and would 403');
  assert.match(r.out, /Answered/);
});

test('reply: words arrive as one message, and an empty reply is a usage error that sends nothing', async () => {
  const r = await run(['reply', 'two', 'words']);
  assert.equal(r.calls[0].body.text, 'two words');
  const e = await run(['reply']);
  assert.equal(e.code, 2);
  assert.equal(e.calls.length, 0);
});

test('a junk KOSMOS_AGENT_TOKEN is not presented (it would take the token arm and be refused there)', async () => {
  const r = await run(['reply', 'x'], () => ({ body: { kept: true } }), { KOSMOS_AGENT_TOKEN: 'not-hex!' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined);
});

// ── msg: the three delivery states and their exit codes ─────────────────────

test('msg: placed -> 0, unconfirmed -> 3 (never 1), could_not -> 1 with the board\'s own sentence', async () => {
  const placed = await run(['msg', 'mara', 'hello', 'there'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(placed.code, 0);
  assert.deepEqual(placed.calls[0].body, { to: 'mara', text: 'hello there', from_pane: '' });
  assert.equal(placed.calls[0].route, '/api/msg');
  const maybe = await run(['msg', 'mara', 'hi'], () => ({ body: { delivery: { state: 'unconfirmed', because: 'typed, Enter not confirmed.' } } }));
  assert.equal(maybe.code, 3, 'an unconfirmed send must be exit 3: exit 1 invites the duplicate a retry sends');
  const no = await run(['msg', 'mara', 'hi'], () => ({ body: { delivery: { state: 'could_not', because: 'mara is not running.' } } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Not delivered: mara is not running.', 'the board\'s sentence, once, with one period');
});

test('an unreachable board is exit 1 with the url; a TIMEOUT is exit 3, because the board may already have acted', async () => {
  const down = await run(['msg', 'mara', 'hi'], refusedWith(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' })));
  assert.equal(down.code, 1);
  assert.match(down.err, /could not reach Kosmos .*127\.0\.0\.1:1/);
  const slow = await run(['msg', 'mara', 'hi'], refusedWith(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
  assert.equal(slow.code, 3);
});

test('a refusal ({error}) is exit 1 with the board\'s words', async () => {
  const r = await run(['msg', 'mara', 'hi'], () => ({ status: 403, body: { error: 'this board belongs to the account that started it' } }));
  assert.equal(r.code, 1);
  assert.match(r.err, /refused that request: this board belongs/);
});

// ── post, react, report, whoami, room, task ─────────────────────────────────

test('post: /api/post with the project and text; a --file attempt is refused before anything is sent', async () => {
  const r = await run(['post', 'proj-1', 'room', 'news'], () => ({ body: { delivery: { state: 'placed' } } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', text: 'room news', from_pane: '' });
  const f = await run(['post', 'proj-1', '--file=notes.md']);
  assert.equal(f.code, 2);
  assert.equal(f.calls.length, 0);
});

test('react: /api/react with project, post id and emoji, and the agent hears WHICH way the toggle went', async () => {
  const r = await run(['react', 'proj-1', 'm3', '🔥'], () => ({ body: { ok: true, op: 'add' } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', of: 'm3', emoji: '🔥', from_pane: '' });
  assert.equal(r.out, 'Reacted 🔥 to that post.');
  const off = await run(['react', 'proj-1', 'm3', '🔥'], () => ({ body: { ok: true, op: 'remove' } }));
  assert.equal(off.out, 'Took your 🔥 back off that post.', 'a second react takes it back, and the agent must be told');
  const no = await run(['react', 'proj-1', 'm9', '🔥'], () => ({ body: { ok: false, because: 'there is no post m9.' } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Not reacted: there is no post m9.');
});

test('report: the flags become fields; a blocked report with nothing to act on is refused locally (#2001)', async () => {
  const r = await run(['report', 'blocked', '--on', 'the deploy', '--owner', 'baron', 'waiting'], () => ({ body: { recorded: true } }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls[0].body, { state: 'blocked', text: 'waiting', on: 'the deploy', owner: 'baron', until: '', project: '', auto: false, from_pane: '' });
  const empty = await run(['report', 'needs_you']);
  assert.equal(empty.code, 2);
  assert.equal(empty.calls.length, 0);
  const show = await run(['report', 'show'], () => ({ body: 'You are idle.\n' }));
  assert.equal(show.calls[0].route, '/api/report?as=text&from_pane=');
  assert.equal(show.out, 'You are idle.');
});

test('whoami prints the BOARD\'s sentence, verbatim', async () => {
  const r = await run(['whoami'], () => ({ body: { because: 'You are leo, on the default account.' } }));
  assert.equal(r.out, 'You are leo, on the default account.');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
});

test('room and task sanitize the project id the way install/kosmos does, and present no agent token', async () => {
  const room = await run(['room', 'proj/../x y'], () => ({ body: 'room text\n' }));
  assert.equal(room.calls[0].route, '/api/project/proj..xy/room?as=text');
  assert.equal(room.calls[0].headers['x-kosmos-agent-token'], undefined);
  const list = await run(['task', 'list', 'p1'], () => ({ body: { tasks: [{ number: 1, sentence: 'ship it', isClosed: false, whoNames: ['leo'] }] } }));
  assert.equal(list.calls[0].route, '/api/tasks?project=p1');
  assert.equal(list.out, '[1] ship it (leo)');
  const add = await run(['task', 'add', 'p1', 'write docs', 'more', 'detail'], () => ({ body: { task: {} } }));
  assert.deepEqual(add.calls[0].body, { sentence: 'write docs', detail: 'more detail', from_pane: '' });
  assert.equal(add.calls[0].headers['x-kosmos-agent-token'], undefined, 'the tasks route ignores it; sending it only suggests it counts');
  const close = await run(['task', 'close', 'p1', 'two']);
  assert.equal(close.code, 2, 'a non-number task is a usage error, sent nowhere');
  assert.equal(close.calls.length, 0);
});

test('no verb, or an unknown one, is a usage error', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['start'])).code, 2, 'the board is Kosmos.exe; this command has no start');
});

// ── one derivation: the routes are install/kosmos's routes ──────────────────

test('every route this sends is one install/kosmos sends', () => {
  const bash = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  for (const route of ['/api/msg', '/api/reply', '/api/post', '/api/react', '/api/report', '/api/whoami', '/api/tasks?project=', '/room?as=text', '/tasks', '/close']) {
    assert.ok(bash.includes(route), 'install/kosmos no longer uses ' + route + '; the Windows CLI is speaking a route the board may have dropped');
  }
});

// ── the real hook, and a real board ─────────────────────────────────────────

test('the default wiring finds the engine and its hook in a source checkout', () => {
  const dir = cli.engineDir(path.join(__dirname, 'tools', 'windows'));
  assert.ok(fs.existsSync(path.join(dir, 'kosmos-report-hook.js')), 'engineDir did not find the engine from tools/windows');
  const hook = require(path.join(dir, 'kosmos-report-hook.js'));
  assert.equal(hook.agentToken({ KOSMOS_AGENT_TOKEN: 'zz' }), null);
  assert.match(hook.resolveUrl({ KOSMOS_PORT: '17001' }, -1), /:17001$/);
});

test('against a real local server: the request is well-formed on the wire', async () => {
  let seen = null;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { seen = { url: req.url, headers: req.headers, body: JSON.parse(b) }; res.end(JSON.stringify({ kept: true })); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const code = await cli.main(['reply', 'over the wire'], {
      env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, url: 'http://127.0.0.1:' + srv.address().port, out: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.equal(seen.url, '/api/reply');
    assert.equal(seen.headers['x-kosmos-agent-token'], AGENT);
    assert.equal(seen.body.text, 'over the wire');
  } finally { await new Promise((r) => srv.close(r)); }
});

// ── the arguments kosmos.ps1 hands over in a temp file ─────────────────────

test('argvFrom: kosmos.ps1\'s JSON file is read ONLY behind its flag, exactly, and a bare number becomes text', () => {
  const file = JSON.stringify(['reply', 'line one\nline two', 'She said "go & echo X" ok', '100%PATH%', 3]);
  assert.deepEqual(cli.argvFrom([cli.ARGV_FILE_FLAG, 'f.json'], () => file), ['reply', 'line one\nline two', 'She said "go & echo X" ok', '100%PATH%', '3']);
  assert.deepEqual(cli.argvFrom([cli.ARGV_FILE_FLAG, 'f.json'], () => '\uFEFF' + file)[0], 'reply', 'a BOM broke the read');
  assert.deepEqual(cli.argvFrom(['reply', 'hi'], () => { throw new Error('read a file it was not given'); }), ['reply', 'hi']);
});

test('argvFrom: a PowerShell list or table is REFUSED, never stringified into different words', () => {
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => JSON.stringify(['msg', 'foo', { a: 1 }])), /list or table, not text/);
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => JSON.stringify(['msg', 'foo', ['a', 'b']])), /list or table/);
  assert.throws(() => cli.argvFrom([cli.ARGV_FILE_FLAG, 'f'], () => 'not json'), /could not read the arguments/);
});

test('main reads kosmos.ps1\'s file, and refuses a mangled argument with exit 2 before sending anything', async () => {
  const calls = [];
  const ok = await cli.main([cli.ARGV_FILE_FLAG, 'x'], { env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, out: () => {}, err: () => {}, readFile: () => JSON.stringify(['reply', 'two\nlines']), fetch: async (u, init) => { calls.push(JSON.parse(init.body)); return { status: 200, text: async () => '{"kept":true}' }; } });
  assert.equal(ok, 0);
  assert.equal(calls[0].text, 'two\nlines', 'the multi-line answer was cut, which is the defect the .ps1 shim exists to end');
  const errs = [];
  const bad = await cli.main([cli.ARGV_FILE_FLAG, 'x'], { env: {}, hook: hookStub, out: () => {}, err: (s) => errs.push(s), readFile: () => JSON.stringify(['reply', { a: 1 }]), fetch: async () => { throw new Error('sent a mangled message'); } });
  assert.equal(bad, 2);
  assert.match(errs.join(' '), /Put that part in quotes/);
});
