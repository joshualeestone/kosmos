'use strict';
/* #5400: the failover's "your part was moved" notice rides on whatever Kosmos next types into an owed agent
 * (chat.setMovedTell). Its own file, with chat.test.js's sandbox and scripted tmux, so every "typed" below is measured
 * on the argv handed to tmux, never on a real pane. Cards come from test-support/fleet.
 *
 *   node --test engine/chat.movedtell-5400.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-movedtell-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const ft = require('./failovertell');
const fleet = require('../test-support/fleet');

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}
function okProbe() { return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }; }
function ok() { return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; }
function refused() { return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no' }; }
function arm(answers) {
  const calls = [];
  const fn = (args) => { calls.push(args); if (args[0] === 'display-message') return okProbe(); return answers.length ? answers.shift() : ok(); };
  fn.pastedText = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  chat.setRunner(fn);
  chat.setDryRun(false);
  return fn;
}

const ITEM = { projectId: 'p1', n: 3, partId: 1, who: 'zed', done: false, phrase: 'task 3 in "Launch" (now zed\'s)' };
/* A hook over an in-memory owed list, as server.js wires it over the project records. */
function hook(owedNow) {
  const told = [];
  const state = { owed: owedNow.slice() };
  chat.setMovedTell({
    owed: () => state.owed.slice(),
    note: (items) => ft.noteFor(items),
    told: (session, items) => { told.push([session, items.map((i) => i.phrase)]); state.owed = state.owed.filter((i) => !items.includes(i)); },
  });
  return told;
}

test('an owed agent\'s next line carries the note IN FRONT of the message, and the part is marked told once it lands', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const v = chat.deliver('casey', 'Your limit has reset; carry on.', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED);
    const typed = tmux.pastedText();
    assert.ok(typed.indexOf(ITEM.phrase) !== -1 && typed.indexOf(ITEM.phrase) < typed.indexOf('Your limit has reset'), JSON.stringify(typed));
    assert.ok(!/reply with one word/.test(typed), 'the note on a person\'s line asks for nothing');
    assert.equal(told.length, 1);
    assert.equal(told[0][0], 'casey');
  });
});

test('CONTROL: an agent owed nothing gets exactly its message', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Hello there.', board.agents);
    assert.equal(tmux.pastedText(), 'Hello there.');
    assert.equal(told.length, 0);
  });
});

test('a line that already names the part (the idle sweep\'s own, agyquota\'s carry-on) does not get it twice', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const line = ft.lineFor([ITEM]);
    chat.deliver('casey', line, board.agents);
    assert.equal(tmux.pastedText(), line);
    assert.equal(told.length, 0, 'the hook marked a part the caller marks itself');
  });
});

test('a line that did not land marks nothing told', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    arm([refused(), refused(), refused(), refused()]);
    const v = chat.deliver('casey', 'Hello there.', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'fixture: the paste was not refused: ' + JSON.stringify(v));
    assert.equal(told.length, 0);
  });
});

test('a message the note would push over the limit goes as it was; the note waits for the next line', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const long = 'x'.repeat(chat.MAX_TEXT - 5);
    const v = chat.deliver('casey', long, board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED);
    assert.equal(tmux.pastedText(), long);
    assert.equal(told.length, 0);
  });
});

test('two lines queued for one agent: only the first carries the note', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const told = hook([ITEM]);
    const tmux = arm([]);
    const [a, b] = await Promise.all([chat.deliverAsync('casey', 'First line here.', board.agents), chat.deliverAsync('casey', 'Second line here.', board.agents)]);
    assert.equal(a.state, chat.DELIVERY.PLACED); assert.equal(b.state, chat.DELIVERY.PLACED);
    const typed = tmux.pastedText();
    assert.equal(typed.split(ITEM.phrase).length - 1, 1, 'the note went out twice: ' + JSON.stringify(typed));
    assert.equal(told.length, 1);
  } finally { board.restore(); }
});

test('CONTROL: with no hook installed (resetForTests), nothing is added', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Hello there.', board.agents);
    assert.equal(tmux.pastedText(), 'Hello there.');
  });
});

/* Review 1 (opus, blind). */
test('review 1 BLOCKER: a slash command is typed exactly, with no note in front, and nothing is marked told', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', '/clear', board.agents);
    assert.equal(tmux.pastedText(), '/clear');
    assert.equal(told.length, 0);
  });
});

test('review 1: a line typed while the note is on its way (a sync send in an async line\'s gap) carries no second note', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const told = hook([ITEM]);
    const tmux = arm([]);
    const first = chat.deliverAsync('casey', 'First line here.', board.agents);   // takes the note; settles later
    const second = chat.deliver('casey', 'Second line here.', board.agents);       // bypasses the queue
    await first;
    // What keeps them apart: a window with a line still being placed refuses another line ("busy").
    assert.equal(second.state, chat.DELIVERY.COULD_NOT, JSON.stringify(second));
    assert.equal(second.busy, true, 'the second line was refused for another reason: ' + JSON.stringify(second));
    const typed = tmux.pastedText();
    assert.equal(typed.split(ITEM.phrase).length - 1, 1, 'the note went out twice: ' + JSON.stringify(typed));
    assert.equal(told.length, 1);
  } finally { board.restore(); }
});

test('review 1: an UNCONFIRMED line does not count as told; the note rides again on the next line', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const timedOut = { ran: false, spawnFailed: false, status: null, out: '', err: 'timed out' };
    arm([ok(), timedOut, timedOut, timedOut]);
    const v = chat.deliver('casey', 'Hello there.', board.agents);
    assert.equal(v.state, chat.DELIVERY.UNCONFIRMED, 'fixture: not unconfirmed: ' + JSON.stringify(v));
    assert.equal(told.length, 0, 'an unconfirmed line counted as told');
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Again, please.', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), 'the note did not ride again');
    assert.equal(told.length, 1);
  });
});

/* Review 2 (sonnet, blind). */
test('review 2 BLOCKER: a menu answer (a bare digit, y, esc) is typed exactly; the note waits for the next real line', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    for (const key of ['2', ' 1 ', 'y', 'esc']) {
      const tmux = arm([ok(), ok()]);
      chat.deliver('casey', key, board.agents);
      assert.equal(tmux.pastedText(), key.trim() === key ? key : tmux.pastedText(), 'fixture');
      assert.ok(!tmux.pastedText().includes(ITEM.phrase), 'the note went in front of ' + JSON.stringify(key));
    }
    assert.equal(told.length, 0);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Thanks, carry on now.', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), 'the note did not ride the next real line');
    assert.equal(told.length, 1);
  });
});
test('review 2 NIT: a line naming one owed part carries the note for the other only, and marks only that one', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const OTHER = { ...ITEM, n: 4, partId: 2, phrase: 'task 4 in "Launch" (now zed\'s)' };
    const told = hook([ITEM, OTHER]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'About ' + ITEM.phrase + ': thanks.', board.agents);
    const typed = tmux.pastedText();
    assert.equal(typed.split(ITEM.phrase).length - 1, 1, 'the named part was repeated: ' + JSON.stringify(typed));
    assert.ok(typed.includes(OTHER.phrase));
    assert.deepEqual(told, [['casey', [OTHER.phrase]]]);
  });
});

/* Review 3 (opus, blind). */
test('review 3: a multi-word slash command is typed exactly (the slash rule, not the short-token one)', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', '/compact keep the task list', board.agents);
    assert.equal(tmux.pastedText(), '/compact keep the task list');
    assert.equal(told.length, 0);
  });
});
test('review 3: a caller passing { movedNote: false } (the restart-for-handoff request) gets no note; it rides the next line', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const told = hook([ITEM]);
    let tmux = arm([]);
    await chat.deliverAsync('casey', 'Write your handoff now and stop.', board.agents, undefined, undefined, { movedNote: false });
    assert.ok(!tmux.pastedText().includes(ITEM.phrase));
    assert.equal(told.length, 0);
    tmux = arm([]);
    await chat.deliverAsync('casey', 'Pick up from your handoff.', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), 'the note did not ride the pickup line');
    assert.equal(told.length, 1);
  } finally { board.restore(); }
});
test('review 3: the restart-for-handoff route passes { movedNote: false } (server.js, source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('handoffForRestartPrompt(') && l.includes('chat.deliverAsync('));
  assert.ok(line, 'the restart-for-handoff delivery moved; restate this pin');
  assert.match(line, /\{ movedNote: false \}/, 'the restart-for-handoff request would carry the note into a session that is about to end');
});

/* Review 4 (sonnet, blind). */
test('review 4: a command with leading space, and a shell-mode "!" line, are typed exactly', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    for (const [sent, typed] of [['   /compact keep the task list', '/compact keep the task list'], ['! git status --short', '! git status --short']]) {
      const tmux = arm([ok(), ok()]);
      chat.deliver('casey', sent, board.agents);
      assert.equal(tmux.pastedText(), typed, JSON.stringify(sent));
    }
    assert.equal(told.length, 0);
  });
});
test('review 4: the short-token bound is 12: a 12-character token gets no note, a 13-character one does', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    let tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'abcdefghijkl', board.agents);
    assert.equal(tmux.pastedText(), 'abcdefghijkl');
    tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'abcdefghijklm', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), 'a 13-character token did not carry the note');
    assert.equal(told.length, 1);
  });
});

/* Review 5 (opus, blind). */
test('review 5: an agent whose card reads capped (its limit menu still up) gets no note; it rides once the card is past it', () => {
  const rows = (state) => fleet.install([fleet.agent('casey', { state })]);
  let board = rows('rate_limited');
  try {
    const card = board.agents.find((c) => c.sessionName.startsWith('casey'));
    assert.equal(card && card.state, 'rate_limited', 'fixture: the card does not read capped: ' + JSON.stringify(card && card.state));
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    chat.deliver(card.sessionName, 'Are you back? Carry on with the tests.', board.agents);
    assert.ok(!tmux.pastedText().includes(ITEM.phrase), 'the note went into the limit menu');
    assert.equal(told.length, 0);
  } finally { board.restore(); }
});
test('review 5: server.js installs the hook with the note that asks for nothing, and told drops the cached records (source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('chat.setMovedTell({');
  assert.ok(at > -1, 'the hook is not installed: the whole feature is off');
  const block = src.slice(at, src.indexOf('});', at));
  assert.match(block, /note: \(items\) => require\('\.\/engine\/failovertell'\)\.noteFor\(items\)/, 'the note is not noteFor (lineFor asks every person\'s message for a one-word reply)');
  assert.match(block, /told: \(session, items\) => \{ movedRecs\.recs = null;/, 'told keeps a stale read, so the next lines repeat the note');
  assert.match(block, /markAll\(session, items, tasks\.markMoveTold\)/);
  // Review 7: and owed asks the records for THIS session, and the read is at most 5 s old.
  assert.match(block, /return ft\.anyOwed\(recs\) \? ft\.owedFor\(session, recs\) : \[\];/, 'owed could answer nothing for everybody, and the feature would be off');
  const cache = src.slice(src.lastIndexOf('const movedRecords', at), at);
  assert.match(cache, /Date\.now\(\) - movedRecs\.at > 5000/, 'the records may be read once and kept far longer than a few seconds');
});
test('review 6: an agent whose card reads needs-you (a permission or question prompt) gets no note either', () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you' })]);
  try {
    const card = board.agents.find((c) => c.sessionName.startsWith('casey'));
    assert.equal(card && card.state, 'needs_you', 'fixture: the card does not read needs-you: ' + JSON.stringify(card && card.state));
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    chat.deliver(card.sessionName, 'Are you back? Carry on with the tests.', board.agents);
    assert.ok(!tmux.pastedText().includes(ITEM.phrase), 'the note went into a prompt');
    assert.equal(told.length, 0);
  } finally { board.restore(); }
});

/* Review 7 (opus, blind). */
test('review 7: a short real sentence ("ok go ahead") carries the note: the short-token rule is about ONE token', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'ok go ahead', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), JSON.stringify(tmux.pastedText()));
    assert.equal(told.length, 1);
  });
});
test('review 7: a caller passing another casing of the name still finds what the agent is owed, and marks it under the real name', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const real = board.agents.find((c) => c.sessionName.startsWith('casey')).sessionName;
    const told = [];
    chat.setMovedTell({ owed: (s) => (s === real ? [ITEM] : []), note: (items) => ft.noteFor(items), told: (s, items) => told.push(s) });
    const tmux = arm([ok(), ok()]);
    chat.deliver(real.toUpperCase(), 'Your limit has reset; carry on.', board.agents);
    assert.ok(tmux.pastedText().includes(ITEM.phrase), 'the note was skipped for a mis-cased name');
    assert.deepEqual(told, [real]);
  });
});

/* Review 8 (sonnet, blind): a failing hook never costs a person's line. */
test('review 8: a hook whose owed, note or told throws leaves every line going out (bare), never a thrown delivery', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const boom = () => { throw new Error('a bad project record'); };
    for (const [which, h] of [
      ['owed', { owed: boom, note: (i) => ft.noteFor(i), told: () => {} }],
      ['note', { owed: () => [ITEM], note: boom, told: () => {} }],
    ]) {
      chat.setMovedTell(h);
      const tmux = arm([ok(), ok()]);
      const v = chat.deliver('casey', 'Your limit has reset; carry on.', board.agents);
      assert.equal(v.state, chat.DELIVERY.PLACED, which + ' threw and the line did not go: ' + JSON.stringify(v));
      assert.equal(tmux.pastedText(), 'Your limit has reset; carry on.', which);
    }
    chat.setMovedTell({ owed: () => [ITEM], note: (i) => ft.noteFor(i), told: boom });
    arm([ok(), ok()]);
    const v = chat.deliver('casey', 'Your limit has reset; carry on.', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, 'a throwing told lost the verdict');
  });
});
test('review 8: an incomplete hook is ignored (no note, nothing called)', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    let called = 0;
    chat.setMovedTell({ owed: () => { called += 1; return [ITEM]; }, note: (i) => ft.noteFor(i) });   // no told
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Your limit has reset; carry on.', board.agents);
    assert.equal(tmux.pastedText(), 'Your limit has reset; carry on.');
    assert.equal(called, 0);
  });
});

/* Review 9 (opus, blind): the production async path, where the paste-to-Enter gap is a real wait and the verdict is a
   promise. Without a pauser the tests' runner settles at once and only the synchronous arm ran. */
test('review 9: on the async path (a real gap, the verdict a promise) the note is marked told, and a second queued line carries none', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const told = hook([ITEM]);
    const tmux = arm([]);
    chat.setPauser(() => new Promise((r) => setTimeout(r, 5)));
    const [a, b] = await Promise.all([
      chat.deliverAsync('casey', 'First line here.', board.agents),
      chat.deliverAsync('casey', 'Second line here.', board.agents),
    ]);
    assert.equal(a.state, chat.DELIVERY.PLACED); assert.equal(b.state, chat.DELIVERY.PLACED);
    assert.equal(told.length, 1, 'the async verdict never marked the note told');
    const typed = tmux.pastedText();
    assert.equal(typed.split(ITEM.phrase).length - 1, 1, 'the note went out twice: ' + JSON.stringify(typed));
  } finally { board.restore(); }
});
