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
  // Review 2: a project id that starts with "-" is still a project, as on the Mac.
  for (const argv of [['room', '-drafts'], ['room', '-drafts', '-n', '3']]) {
    const r = await run(argv, () => ({ body: 'the room\n' }));
    assert.equal(r.code, 0, argv.join(' ') + ': ' + r.err);
    assert.deepEqual(r.calls.map((c) => c.route), ['/api/project/-drafts/room?as=text' + (argv.length > 2 ? '&n=3' : '')], argv.join(' '));
  }
  const plain = await run(['room', 'proj'], () => ({ body: 'the room\n' }));
  assert.deepEqual(plain.calls.map((c) => c.route), ['/api/project/proj/room?as=text']);
});

test('#4891 N8 Windows: a value that is not 1 to 200 is refused and sends nothing', async () => {
  for (const argv of [['room', 'proj', '-n', '0'], ['room', 'proj', '-n', '201'], ['room', 'proj', '-n', 'abc'], ['room', 'proj', '-n', '05'],
    ['room', 'proj', '-n'], ['room', 'proj', '--limit='], ['room', 'a', 'b']]) {
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

test('#4891 review 2/3 Windows: `report clear --auto` is refused by name; --auto in a note needs a -- (kosmos#4889)', async () => {
  for (const argv of [['report', 'clear', '--auto'], ['report', 'clear', '--on', 'x', '--auto', 'back']]) {
    const r = await run(argv, () => ({ body: JSON.stringify({ recorded: true }) }));
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /takes no --auto/, argv.join(' '));
    assert.equal(r.calls.length, 0, argv.join(' ') + ' sent a request');
  }
  // CONTROL: the hook's own path, `report working --auto`, is untouched (review 4).
  const hook = await run(['report', 'working', '--auto', 'x'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(hook.code, 0, hook.err);
  const hookBody = JSON.parse(hook.calls.find((c) => c.method === 'POST').body);
  assert.equal(hookBody.state, 'working');
  assert.equal(hookBody.auto, true);
  /* kosmos#4889: an option after the note is refused, as it is for every other state (it used to be note text). */
  const late = await run(['report', 'clear', 'back', 'to', 'it,', 'dropped', '--auto'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(late.code, 2, late.err);
  assert.match(late.err, /--auto is not an option of kosmos report/);
  assert.equal(late.calls.filter((c) => c.method === 'POST').length, 0, 'a refused note reached the board');
  /* #7756, as on the Mac: a clear says so, and only a clear. */
  const said = await run(['report', 'clear', 'found', 'it'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(JSON.parse(said.calls.find((c) => c.method === 'POST').body).clear, true);
  const plain = await run(['report', 'working', 'on', 'it'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(JSON.parse(plain.calls.find((c) => c.method === 'POST').body).clear, false);
  /* CONTROL: after a bare --, --auto is note text. */
  const note = await run(['report', 'clear', '--', 'back', 'to', 'it,', 'dropped', '--auto'], () => ({ body: JSON.stringify({ recorded: true }) }));
  assert.equal(note.code, 0, note.err);
  const body = JSON.parse(note.calls.find((c) => c.method === 'POST').body);
  assert.equal(body.state, 'working');
  assert.match(body.text, /dropped --auto/);
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

test('#4926 Windows: --unanswered reaches the board as &unanswered=1, as on the Mac', async () => {
  for (const [argv, want] of [
    [['room', 'proj', '--unanswered'], '/api/project/proj/room?as=text&unanswered=1'],
    [['room', '--unanswered', 'proj'], '/api/project/proj/room?as=text&unanswered=1'],
    [['room', 'proj', '-n', '5', '--unanswered'], '/api/project/proj/room?as=text&n=5&unanswered=1'],
  ]) {
    const r = await run(argv, () => ({ body: 'the room\n' }));
    assert.equal(r.code, 0, argv.join(' ') + ': ' + r.err);
    assert.deepEqual(r.calls.map((c) => c.route), [want], argv.join(' '));
  }
});

test('kosmos#7969 Windows: --unanswered --all reaches the board as &unanswered=1&all=1, either side of the project id, as on the Mac', async () => {
  for (const [argv, want] of [
    [['room', 'proj', '--unanswered', '--all'], '/api/project/proj/room?as=text&unanswered=1&all=1'],
    [['room', '--all', '--unanswered', 'proj'], '/api/project/proj/room?as=text&unanswered=1&all=1'],
    [['room', '--all', 'proj', '-n', '5', '--unanswered'], '/api/project/proj/room?as=text&n=5&unanswered=1&all=1'],
    // A project id that starts with "-" (Kosmos makes ids like "-drafts") is still the project beside the new flag.
    [['room', '-drafts', '--unanswered', '--all'], '/api/project/-drafts/room?as=text&unanswered=1&all=1'],
  ]) {
    const r = await run(argv, () => ({ body: 'Waiting on an answer from you: nothing in this room.\n' }));
    assert.equal(r.code, 0, argv.join(' ') + ': ' + r.err);
    assert.deepEqual(r.calls.map((c) => c.route), [want], argv.join(' '));
  }
});

test('kosmos#7969 Windows: --all without --unanswered is refused (exit 2) and asks nothing of the board; --all is never read as the project', async () => {
  const bare = await run(['room', 'proj', '--all'], () => ({ body: 'the room\n' }));
  assert.equal(bare.code, 2);
  assert.equal(bare.err, '--all goes with --unanswered: kosmos room <project-id> --unanswered --all');
  assert.deepEqual(bare.calls, [], 'a refused --all still reached the board');
  // Before #7969 the CLI took "--all" as the project and refused a second project word; now the project is "proj".
  const both = await run(['room', '--unanswered', '--all', 'proj'], () => ({ body: 'Waiting on an answer from you: nothing in this room.\n' }));
  assert.doesNotMatch(both.err, /reads one project at a time/);
  assert.equal(both.code, 0, both.err);
  assert.deepEqual(both.calls.map((c) => c.route), ['/api/project/proj/room?as=text&unanswered=1&all=1']);
  // CONTROL: the usage line names the flag, as install/kosmos does.
  const usage = await run(['room'], () => ({ body: '' }));
  assert.equal(usage.code, 2);
  assert.match(usage.err, /\[--unanswered \[--all\]\]/);
  assert.match(usage.err, /from the last few days \(--all: older ones too\)/);
});

test('#4926 Windows: --unanswered on a board that ignored it says the answer is the whole room; on one that applied it, nothing extra', async () => {
  const WARN = /does not know --unanswered yet/;
  const old = await run(['room', 'proj', '--unanswered'], () => ({ body: 'the room\n' }));
  assert.equal(old.code, 0, old.err);
  assert.match(old.err, WARN, 'an older board\'s whole room read as the filtered view');
  const now = await run(['room', 'proj', '--unanswered'], () => ({ body: 'Waiting on an answer from you: nothing in this room.\n' }));
  assert.equal(now.code, 0, now.err);
  assert.doesNotMatch(now.out + now.err, WARN, 'a board that applied the flag was called an older one');
  const plain = await run(['room', 'proj'], () => ({ body: 'the room\n' }));
  assert.doesNotMatch(plain.out + plain.err, WARN);
});
