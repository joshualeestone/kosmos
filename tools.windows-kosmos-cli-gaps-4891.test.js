'use strict';

/* kosmos#4891, the Windows twin of cli.gaps-4891.test.js: `kosmos room -n`, `task list` on an unknown project, and
   `kosmos report clear`, driven through the CLI's own main() with an injected fetch (as the #4784 inbox test does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD4891', agentToken: realHook.agentToken };

const AGENT = 'ab'.repeat(16);
async function run(argv, answer) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), method: init.method, body: init.body });
      const a = answer(url);
      return { status: a.status || 200, text: async () => a.body };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

test('#4891 N8 Windows: -n, --limit and --limit= reach the board as &n=; without it the request is unchanged', async () => {
  for (const argv of [['room', 'proj', '-n', '5'], ['room', '-n', '5', 'proj'], ['room', 'proj', '--limit', '5'], ['room', 'proj', '--limit=5']]) {
    const r = await run(argv, () => ({ body: 'the room\n' }));
    assert.equal(r.code, 0, argv.join(' ') + ': ' + r.err);
    assert.deepEqual(r.calls.map((c) => c.route), ['/api/project/proj/room?as=text&n=5'], argv.join(' '));
  }
  const plain = await run(['room', 'proj'], () => ({ body: 'the room\n' }));
  assert.deepEqual(plain.calls.map((c) => c.route), ['/api/project/proj/room?as=text']);
});

test('#4891 N8 Windows: a value that is not 1 to 200 is refused and sends nothing', async () => {
  for (const argv of [['room', 'proj', '-n', '0'], ['room', 'proj', '-n', '201'], ['room', 'proj', '-n', 'abc'], ['room', 'proj', '-n', '05'],
    ['room', 'proj', '-n'], ['room', 'proj', '--limit='], ['room', 'proj', '--tail'], ['room', 'a', 'b']]) {
    const r = await run(argv, () => ({ body: '' }));
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.calls.length, 0, argv.join(' ') + ' sent a request');
  }
  // CONTROL: the in-range edges go through.
  for (const n of ['1', '200']) {
    const r = await run(['room', 'proj', '-n', n], () => ({ body: '' }));
    assert.equal(r.code, 0, n);
    assert.equal(r.calls[0].route, '/api/project/proj/room?as=text&n=' + n);
  }
});

test('#4891 N6 Windows: the CLI says the board\'s 404 and exits 1 (wiring only: the CLI already did; server.gaps-4891 proves the change)', async () => {
  const missing = await run(['task', 'list', 'nosuch'], () => ({ status: 404, body: JSON.stringify({ error: 'there is no project by that name' }) }));
  assert.equal(missing.code, 1, missing.out + missing.err);
  assert.match(missing.err, /there is no project by that name/);
  assert.doesNotMatch(missing.out, /No tasks for this project yet/);
  const empty = await run(['task', 'list', 'proj'], () => ({ body: JSON.stringify({ tasks: [] }) }));
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /No tasks for this project yet/);
});

test('#4891 N4 Windows: `kosmos report clear` records working, with the note', async () => {
  const r = await run(['report', 'clear', 'answered, back to it'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(r.code, 0, r.err);
  const posts = r.calls.filter((c) => c.method === 'POST' && c.route.startsWith('/api/report'));
  assert.equal(posts.length, 1, JSON.stringify(r.calls));
  const body = JSON.parse(posts[0].body);
  assert.equal(body.state, 'working');
  assert.equal(body.text, 'answered, back to it');
  // CONTROL: a plain report sends the state it names.
  const idle = await run(['report', 'idle'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(JSON.parse(idle.calls.find((c) => c.method === 'POST').body).state, 'idle');
});
