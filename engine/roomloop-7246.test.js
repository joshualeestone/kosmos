'use strict';

/**
 * kosmos#7246 slice 2: agents in a room never wake each other in a loop. A person's busy room burned the person's whole
 * provider allowance: agents read posts, replied that they had read them, and the replies woke the others again.
 * An agent's post now wakes only the members it ADDRESSES (an @-name, the fleet's leading "Sender -> Name:" header,
 * @all), a reply wakes its author only when the post it answers asked something, and a per-project cap backstops the
 * rest. The controls are fleetbuilders-shaped posts (Splinter, 12:24): what addresses a member today must still wake it.
 *
 *   node --test engine/roomloop-7246.test.js
 */
const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomloop-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const selfreport = require('./selfreport');
const roomhold = require('./roomhold');
const roomloop = require('./roomloop');
const fleet = require('../test-support/fleet');

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function fakeTmux() {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return ok();
  };
  fn.pastedSends = () => {
    const out = [];
    let cur = ''; let target = null; let has = false;
    for (const a of calls) {
      if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
      else if (a[0] === 'paste-buffer') { target = a[a.length - 1]; }
      else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { out.push({ text: cur, target }); cur = ''; target = null; has = false; }
    }
    if (has) out.push({ text: cur, target });
    return out;
  };
  return fn;
}
function arm() { const tmux = fakeTmux(); chat.setRunner(tmux); chat.setDryRun(false); return tmux; }
function armSender(session) { messages.setRunner(() => ({ ok: true, session })); }
function typedTo(tmux, session) {
  const t = (s) => String(s.target || '');
  return tmux.pastedSends().filter((s) => t(s).startsWith('=' + session + ':') || t(s).startsWith('=' + session + '-discord:')).map((s) => s.text);
}

/* A fleetbuilders-shaped room: a handle, and a display name with a space in it. */
function room() {
  return [fleet.agent('pigeonpete', { state: 'idle', displayName: 'PigeonPete' }),
    fleet.agent('monalisa', { state: 'idle', displayName: 'Mona Lisa' }),
    fleet.agent('angel', { state: 'idle', displayName: 'Angel' })];
}
const MEMBERS = ['pigeonpete', 'monalisa', 'angel'];
const PROJECT = 'fleetbuilders';

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  roomloop.resetForTests();
  for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function post(board, from, text, extra = {}) {
  armSender(from + '-discord');
  const tmux = arm();
  const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text, ...extra }, board.agents, MEMBERS);
  return { sent, tmux, woke: MEMBERS.filter((m) => typedTo(tmux, m).length > 0) };
}

test('CONTROL (fleetbuilders shape): "Sender -> Name:" wakes that member only, display names included', () => {
  withFleet(room(), (board) => {
    const a = post(board, 'pigeonpete', 'PigeonPete -> Mona Lisa, on m702: #7212 re-shot as you asked.');
    assert.deepEqual(a.woke, ['monalisa'], 'the arrow header must wake its target and nobody else');
    assert.equal(a.sent.outcomes.angel, roomhold.QUIET);
    assert.equal(a.sent.state, chat.DELIVERY.PLACED, 'a quiet member must not make the sender re-post');
    const b = post(board, 'monalisa', 'Mona Lisa -> PigeonPete, Angel (both): the design is approved.');
    assert.deepEqual(b.woke.sort(), ['angel', 'pigeonpete']);
  });
});

test('CONTROL: @name and @all still wake their members; @all never wakes its sender', () => {
  withFleet(room(), (board) => {
    assert.deepEqual(post(board, 'angel', 'taken, @monalisa: shots next').woke, ['monalisa']);
    assert.deepEqual(post(board, 'angel', '@all the cut is on staging').woke.sort(), ['monalisa', 'pigeonpete']);
  });
});

test('A: an agent post that addresses no one wakes no one, and is still in the room', () => {
  withFleet(room(), (board) => {
    // Round 5: "Mona Lisa for PigeonPete" names members, but its sender is not the poster, so it is a sentence, not a header.
    for (const text of ['read it, nothing to do from me', 'Mona Lisa for PigeonPete: measured on Agent1s', 'Angel: noted, thanks']) {
      const p = post(board, 'angel', text);
      assert.deepEqual(p.woke, [], 'an unaddressed post woke someone: ' + text);
      assert.equal(p.sent.state, chat.DELIVERY.PLACED, 'refused instead of recorded: ' + text);
      assert.ok(messages.record().rows.some((m) => m.id === p.sent.id), 'not in the room: ' + text);
      for (const m of ['pigeonpete', 'monalisa']) assert.deepEqual(roomhold.heldIn(m, PROJECT), [], 'held for later instead of quiet');
    }
    assert.deepEqual(post(board, 'angel', 'Angel for PigeonPete: measured on Agent1s').woke, ['pigeonpete'], 'CONTROL: the same words from their sender wake the target');
  });
});

test('CONTROL: a person\'s post that names no one still reaches every member', () => {
  withFleet(room(), (board) => {
    const tmux = arm();
    const sent = messages.sendPost({ operator: true, project: PROJECT, text: 'how is everyone doing' }, board.agents, MEMBERS);
    assert.equal(sent.state, chat.DELIVERY.PLACED);
    for (const m of MEMBERS) assert.equal(typedTo(tmux, m).length, 1, m + ' did not get the person\'s post');
  });
});

test('B: a reply wakes its author only when the post it answers asked something', () => {
  withFleet(room(), (board) => {
    const ask = post(board, 'monalisa', 'Mona Lisa -> Angel: can you build #7346?');
    const answer = post(board, 'angel', 'yes, after #7265', { replyTo: ask.sent.id });
    assert.deepEqual(answer.woke, ['monalisa'], 'the answer to a question must reach its asker');
    // Round 3: the author is woken by an envelope, never by bare words (#4642: what arrives is always marked).
    for (const t of typedTo(answer.tmux, 'monalisa')) assert.ok(t.startsWith('['), 'the reply reached its author unmarked: ' + t.slice(0, 80));
    const fyi = post(board, 'monalisa', 'shots are in the folder');
    const ack = post(board, 'angel', 'read it, nothing to do', { replyTo: fyi.sent.id });
    assert.deepEqual(ack.woke, [], 'an acknowledgement of an FYI woke its author: the loop');
  });
});

test('C: past the per-project cap, agent posts wake no one, the person is told once, and the person still gets through', () => {
  withFleet(room(), (board) => {
    let n = 0;
    while (n < roomloop.LOOP_CAP) { post(board, 'angel', '@monalisa ping ' + n); n += 1; }
    // kosmos#7461: a post asking ONE member gets through a pause (within its pair's budget), so this asks two.
    const over = post(board, 'angel', '@monalisa @pigeonpete ping over');
    assert.deepEqual(over.woke, [], 'the capped post still woke someone');
    assert.equal(over.sent.outcomes.monalisa, roomhold.QUIET);
    post(board, 'angel', '@monalisa @pigeonpete ping over again');
    const notes = messages.record().rows.filter((m) => m.kind === 'note' && /paused agents waking each other/.test(m.text));
    assert.equal(notes.length, 1, 'the person must be told once per pause, not once per post');
    const tmux = arm();
    messages.sendPost({ operator: true, project: PROJECT, text: '@monalisa are you there' }, board.agents, MEMBERS);
    assert.equal(typedTo(tmux, 'monalisa').length, 1, 'the cap held back the person\'s own post');
  });
});


test('addressedMembers: the header only at the start, names that are not members ignored', () => {
  const r = MEMBERS;
  assert.deepEqual([...messages.addressedMembers('Angel -> PigeonPete, #7324 step 1 is measured: x', r, [], new Set(), 'angel')], ['pigeonpete']);
  assert.deepEqual([...messages.addressedMembers('a note that says Angel -> PigeonPete: later', r, [], new Set(), 'angel')], [], 'mid-text arrows address no one');
  assert.deepEqual([...messages.addressedMembers('Angel -> Nobody: x', r, [], new Set(), 'angel')], []);
  assert.deepEqual([...messages.addressedMembers('email me at a@all.example', r, [], new Set(), 'angel')], [], '@all inside a word is not a broadcast');
});

test('round 1: a person\'s @all or arrow header keeps the person\'s old meaning (@-names only; no owed answers)', () => {
  withFleet(room(), (board) => {
    const tmux = arm();
    const sent = messages.sendPost({ operator: true, project: PROJECT, text: 'Josh -> Angel: @all how is it going' }, board.agents, MEMBERS);
    for (const m of MEMBERS) assert.equal(typedTo(tmux, m).length, 1, m + ' did not get the person\'s post');
    const row = messages.record().rows.find((x) => x.id === sent.id);
    assert.ok(!row.mentioned || row.mentioned.length === 0, 'a person\'s header or @all became owed answers: ' + JSON.stringify(row.mentioned));
  });
});

test('round 1: the cap counts posts, not members, so an @all post is never cut partway', () => {
  withFleet(room(), (board) => {
    for (let i = 0; i < roomloop.LOOP_CAP - 1; i += 1) post(board, 'angel', '@monalisa ping ' + i);
    const all = post(board, 'pigeonpete', '@all the post that fills the cap');
    assert.deepEqual(all.woke.sort(), ['angel', 'monalisa'], 'the post that fills the cap must still reach every member it addresses');
    const over = post(board, 'pigeonpete', '@all one too many');
    assert.deepEqual(over.woke, []);
    assert.match(String(over.sent.because), /woke no one: Kosmos has paused agents waking each other/, 'the sender must be told why its post woke no one');
  });
});

test('round 1: a bystander\'s reply to a question asked of someone else wakes no one', () => {
  withFleet(room(), (board) => {
    const ask = post(board, 'monalisa', 'Mona Lisa -> Angel: can you build #7346?');
    const plusOne = post(board, 'pigeonpete', '+1, me too', { replyTo: ask.sent.id });
    assert.deepEqual(plusOne.woke, [], 'a bystander\'s +1 woke the asker');
  });
});

test('round 1: quiet posts count as missed when a member is next woken, and cost the valve nothing', () => {
  withFleet(room(), (board) => {
    post(board, 'angel', 'an fyi nobody is asked about');
    const ask = post(board, 'angel', '@monalisa one question');
    assert.match(typedTo(ask.tmux, 'monalisa').join(''), /This room has been talking without you: 1 earlier post/, 'a quiet post was not counted as missed');
    const row = messages.record().rows.find((x) => x.kind === 'post' && /fyi nobody/.test(x.text));
    assert.equal(messages.reachedCount(row), 0, 'a post that woke no one was charged to the valve');
  });
});

test('round 1: an @all inside `code` is quoted, not a broadcast', () => {
  assert.deepEqual([...messages.addressedMembers('use `@all` to reach everyone', MEMBERS, [], new Set(), 'angel')], []);
  assert.deepEqual([...messages.addressedMembers('@all heads up', MEMBERS, [], new Set(), 'angel')].sort(), ['monalisa', 'pigeonpete']);
  assert.deepEqual([...messages.addressedMembers('@all heads up', MEMBERS, [], new Set(), 'angel', { all: false })], [], 'the swarm-off check reads named members only');
});

test('round 2: the row keeps @-names in `mentioned` (claims, owed answers, the #185 nudge) and who it named in `addressed`', () => {
  withFleet(room(), (board) => {
    const p = post(board, 'angel', 'Angel -> Mona Lisa: @all the cut is on staging');
    const row = messages.record().rows.find((x) => x.id === p.sent.id);
    assert.ok(!row.mentioned, 'a header or @all became an owed answer: ' + JSON.stringify(row.mentioned));
    // Round 6: `addressed` is who it named (rule B's set), without @all; the @all still woke both (wake set, not stored).
    assert.deepEqual([...row.addressed].sort(), ['monalisa']);
    assert.deepEqual(p.woke.sort(), ['monalisa', 'pigeonpete'], 'the @all still wakes everyone');
    const at = post(board, 'angel', '@pigeonpete one question');
    assert.deepEqual(messages.record().rows.find((x) => x.id === at.sent.id).mentioned, ['pigeonpete'], 'CONTROL: an @-name is still an owed answer');
  });
});

test('round 2: @all-hands and @everyone-else are words, not broadcasts', () => {
  assert.deepEqual([...messages.addressedMembers('see the @all-hands notes', MEMBERS, [], new Set(), 'angel')], []);
  assert.deepEqual([...messages.addressedMembers('thanks @everyone-else', MEMBERS, [], new Set(), 'angel')], []);
  assert.deepEqual([...messages.addressedMembers('thanks @all.', MEMBERS, [], new Set(), 'angel')].sort(), ['monalisa', 'pigeonpete'], 'CONTROL: @all at a sentence end');
});

/* Round 3 (W1): the room valve charges an agent's post up front for the members it will wake, not for the whole room. */
const limits = require('./limits');
const ROOM_BUDGET = limits.DEFAULTS.perHour * limits.ROOM_FACTOR;
function seedArrivals(n) {
  // n arrivals of real content from alternating senders (so only the volume valve can fire), one member each.
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const now = Date.now();
  for (let i = 0; i < n; i += 1) {
    const from = i % 2 ? 'pigeonpete' : 'monalisa';
    fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id: 'm' + (i + 1), project: PROJECT, from, to: ['angel'],
      text: 'step ' + i + ' of the build carries real content', at: new Date(now - (n - i) * 1000).toISOString(), outcomes: {} }) + '\n');
  }
}
test('round 3: one arrival under the budget, a post that wakes one member goes through', () => {
  withFleet(room(), (board) => {
    seedArrivals(ROOM_BUDGET - 1);
    const one = post(board, 'angel', '@monalisa can you check the build log for step 3');
    assert.equal(one.sent.state, chat.DELIVERY.PLACED, 'a one-member post was charged for the whole room: ' + JSON.stringify(one.sent.code));
    assert.deepEqual(one.woke, ['monalisa']);
  });
});
test('round 3 CONTROL: at the same point, a post that wakes both members is held', () => {
  withFleet(room(), (board) => {
    seedArrivals(ROOM_BUDGET - 1);
    const both = post(board, 'angel', '@all can you check the build log for step 3');
    assert.equal(both.sent.code, 'room_held', 'the control did not reach the valve, so the arm above proves nothing');
  });
});

/* Round 3 (W2): the header as the fleet writes it, controls from real Fleet Builders posts. */
/* Real roster cards from test-support/fleet (fixture discipline), copied so they outlive the install. */
function fleetRoster(pairs) {
  const board = fleet.install(pairs.map(([name, displayName]) => fleet.agent(name, { state: 'idle', displayName })));
  try { return board.agents.map((c) => ({ ...c })); } finally { board.restore(); }
}
const FLEET_PAIRS = [['angel', 'Angel'], ['monalisa', 'Mona Lisa'], ['renettilley', 'Renet Tilley'], ['barondraxum', 'Baron Draxum'],
  ['icecreamkitty', 'Ice Cream Kitty'], ['pigeonpete', 'PigeonPete'], ['claudebot', 'Splinter']];
const FLEET = fleetRoster(FLEET_PAIRS);
const fleetNames = FLEET.map((c) => c.sessionName);
const addressed = (from, text, roster = FLEET) => [...messages.addressedMembers(text, fleetNames.filter((n) => n !== from), roster, new Set(), from)].sort();
test('round 3: the header reads "to", "for", "→", parentheses with colons, and one word of a display name', () => {
  assert.deepEqual(addressed('barondraxum', 'Baron to Kitty, heads-up on S3 ca4752d9d before its push: my local validation'), ['icecreamkitty']);
  assert.deepEqual(addressed('monalisa', 'Mona Lisa -> Renet, #7365 room archive: my design and a proposed data shape'), ['renettilley']);
  assert.deepEqual(addressed('angel', 'Angel -> PigeonPete (re: #12): x'), ['pigeonpete'], 'a colon inside parentheses ended the header');
  assert.deepEqual(addressed('renettilley', 'Renet for Baron: #7324 steps 2 to 4 are built'), ['barondraxum']);
  assert.deepEqual(addressed('icecreamkitty', 'Ice Cream Kitty -> PigeonPete, Angel (and Josh\'s walkthrough), from the question: t'), ['angel', 'pigeonpete']);
  assert.deepEqual(addressed('angel', 'Angel -> Mona Lisa & Baron and Renet: x'), ['barondraxum', 'monalisa', 'renettilley']);
  assert.deepEqual(addressed('angel', '**Angel → Kitty:** x'), ['icecreamkitty']);
});
test('round 3 CONTROLS: what is not a header addresses no one', () => {
  assert.deepEqual(addressed('angel', 'Thanks to Kitty: great work'), [], '"to" needs the sender to name the poster');
  assert.deepEqual(addressed('claudebot', 'Splinter -> owners of the Kosmos Cloud finish line: x'), []);
  assert.deepEqual(addressed('pigeonpete', 'PigeonPete, on m616 seam F: answered'), []);
  assert.deepEqual(addressed('angel', 'Angel -> Mona Lisa, on m590: fine by me'), ['monalisa'], 'a reference after the name is not a member');
  const twoKitties = fleetRoster(FLEET_PAIRS.concat([['kittyhawk', 'Kitty Hawk']]));
  const names = fleetNames.concat(['kittyhawk']);
  assert.deepEqual([...messages.addressedMembers('Angel -> Kitty: x', names.filter((n) => n !== 'angel'), twoKitties, new Set(), 'angel')], [],
    'two members share the word, so it names neither');
  assert.deepEqual([...messages.addressedMembers('Angel -> Kitty Hawk: x', names.filter((n) => n !== 'angel'), twoKitties, new Set(), 'angel')], ['kittyhawk'],
    'CONTROL: the whole display name still names one');
});

/* Round 3 (W4): "Your own messages still reach them" -- and a person's post starts the agents' count over. */
test('round 3: a person\'s post clears the pause, so the agents can wake each other again', () => {
  withFleet(room(), (board) => {
    for (let i = 0; i < roomloop.LOOP_CAP; i += 1) post(board, 'angel', '@monalisa ping ' + i);
    assert.deepEqual(post(board, 'angel', '@monalisa @pigeonpete paused?').woke, [], 'control: the project must be paused before the person posts');   // kosmos#7461: two, not one
    arm();
    messages.sendPost({ operator: true, project: PROJECT, text: 'carry on, both of you' }, board.agents, MEMBERS);
    assert.deepEqual(post(board, 'angel', '@monalisa after the person').woke, ['monalisa'], 'the person posted and the pause still held');
  });
});

/* Round 4: the window itself, the header's "all", a row from before the upgrade, and two async posts at the cap. */
test('round 8: a pause lasts a whole hour from when it began, then the count starts from zero; each pause is said once', () => {
  const t0 = Date.parse('2026-10-27T12:00:00Z');
  const H = roomloop.LOOP_WINDOW_MS;
  for (let i = 0; i < roomloop.LOOP_CAP; i += 1) roomloop.noteWake('p', t0 + i * 1000);
  const p0 = t0 + 60000;   // the post that finds the cap used: the pause begins here
  assert.equal(roomloop.paused('p', p0), true);
  assert.equal(roomloop.freesAt('p', p0 + 1), p0 + H, 'the pause ends an hour after it began');
  assert.ok(roomloop.pauseNote('p', p0), 'the first pause is said');
  assert.equal(roomloop.pauseNote('p', p0 + 1000), '', 'and only once');
  // Round 8: the oldest wake aging out does NOT let a post through (the slide held a real loop at 40 an hour).
  assert.equal(roomloop.paused('p', t0 + H + 500), true, 'a wake aging out let the loop through mid-pause');
  assert.equal(roomloop.paused('p', p0 + H - 1), true);
  assert.equal(roomloop.paused('p', p0 + H), false, 'the hour is up');
  roomloop.noteWake('p', p0 + H + 1);
  assert.equal(roomloop.paused('p', p0 + H + 2), false, 'the count started again from zero, not from the slid window');
  for (let i = 0; i < roomloop.LOOP_CAP; i += 1) roomloop.noteWake('p', p0 + H + 10 + i);
  assert.equal(roomloop.paused('p', p0 + H + 100), true);
  assert.ok(roomloop.pauseNote('p', p0 + H + 100), 'a new pause is said');
  roomloop.clear('p');
  assert.equal(roomloop.paused('p', p0 + H + 200), false, 'a person acting ends the pause at once');
  assert.equal(roomloop.paused('other', p0), false, 'CONTROL: another project is not paused');
});
test('round 4: "Ada -> all:" and "-> everyone:" are the header\'s @all', () => {
  // Round 8: and with no sender before the arrow.
  assert.deepEqual(addressed('barondraxum', '-> all: hi'), fleetNames.filter((n) => n !== 'barondraxum').sort());
  assert.deepEqual(addressed('barondraxum', '\u2192 Kitty, Renet: hi'), ['icecreamkitty', 'renettilley']);
  assert.deepEqual(addressed('angel', 'Angel -> all: the build is green'), fleetNames.filter((n) => n !== 'angel').sort());
  assert.deepEqual(addressed('angel', 'Angel -> Everyone: x'), fleetNames.filter((n) => n !== 'angel').sort());
  assert.deepEqual([...messages.addressedMembers('Angel -> all: x', fleetNames, FLEET, new Set(), 'angel', { all: false })], [],
    'like @all, not a request to a swarm switched off here');
  assert.deepEqual(addressed('angel', 'Angel -> allison: x'), [], 'CONTROL: a word that starts with all is not all');
});
test('round 4: a row from before the upgrade (no outcomes) is charged for everyone it went to', () => {
  assert.equal(messages.reachedCount({ kind: 'post', to: ['a', 'b', 'c'] }), 3);
  assert.equal(messages.reachedCount({ kind: 'post', to: ['a', 'b'], outcomes: { a: roomhold.QUIET, b: 'placed' } }), 1, 'CONTROL: a quiet member is not charged');
});
test('round 4: two posts started together at the last free wake: only one wakes anyone', async () => {
  const board = fleet.install(room());
  try {
    for (let i = 0; i < roomloop.LOOP_CAP - 1; i += 1) post(board, 'angel', '@monalisa ping ' + i);
    armSender('angel-discord');
    arm();
    const a = messages.sendPostAsync({ fromPane: '%7', project: PROJECT, text: '@monalisa first of two' }, board.agents, MEMBERS);
    // kosmos#7461: the second asks two members, since a one-member post would get through the pause by design.
    const b = messages.sendPostAsync({ fromPane: '%7', project: PROJECT, text: '@pigeonpete @monalisa second of two' }, board.agents, MEMBERS);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.outcomes.monalisa, 'placed', 'the first post fills the cap and wakes its member');
    assert.equal(rb.outcomes.pigeonpete, roomhold.QUIET, 'a post started while the first was still typing ran past the cap');
  } finally { board.restore(); }
});

/* Round 5 (M1): words after a name, and the word form read every way, so the fleet's own shapes keep their names. */
test('round 5: a header name keeps its member whatever words follow it', () => {
  const F = fleetRoster(FLEET_PAIRS.concat([['basil', 'Basil'], ['ada', 'Ada']]));
  const n = F.map((c) => c.sessionName);
  const a = (from, text) => [...messages.addressedMembers(text, n.filter((x) => x !== from), F, new Set(), from)].sort();
  assert.deepEqual(a('pigeonpete', 'PigeonPete -> Mona Lisa on m702: re-shot'), ['monalisa']);
  assert.deepEqual(a('claudebot', 'Splinter -> PigeonPete and Angel re #12: x'), ['angel', 'pigeonpete']);
  assert.deepEqual(a('claudebot', 'Splinter -> Angel about the cut: x'), ['angel']);
  assert.deepEqual(a('ada', 'Ada to Basil for review: x'), ['basil'], 'the greedy first reading of "to" lost the name');
  assert.deepEqual(a('barondraxum', 'Baron to Kitty for tonight: x'), ['icecreamkitty']);
  assert.deepEqual(a('angel', 'Thanks to Kitty for the fix: x'), [], 'CONTROL: no reading has the poster as its sender');
  // Round 8: ';', '/' and '+' separate names too.
  assert.deepEqual(a('barondraxum', 'Baron -> Kitty, Angel; Renet: x'), ['angel', 'icecreamkitty', 'renettilley']);
  assert.deepEqual(a('barondraxum', 'Baron -> Kitty/Renet: x'), ['icecreamkitty', 'renettilley']);
  assert.deepEqual(a('barondraxum', 'Baron -> Kitty + Renet: x'), ['icecreamkitty', 'renettilley']);
  assert.deepEqual(a('angel', 'see the a -> b mapping: here'), [], 'CONTROL: an arrow inside a sentence is not a header');
  assert.deepEqual(a('claudebot', 'Splinter -> owners of the Kosmos Cloud finish line: x'), [], 'CONTROL: no leading words name a member');
});

/* Round 6. */
test('round 6: answers to an @all do not each wake its author; answers to a named ask do', () => {
  withFleet(room(), (board) => {
    const all = post(board, 'angel', '@all status of your branches?');
    assert.deepEqual(post(board, 'monalisa', 'mine is green', { replyTo: all.sent.id }).woke, [], 'an answer to a broadcast woke its author');
    const named = post(board, 'angel', 'Angel -> Mona Lisa: status of your branch?');
    assert.deepEqual(post(board, 'monalisa', 'mine is green', { replyTo: named.sent.id }).woke, ['angel'], 'CONTROL: an answer to a named ask wakes its author');
  });
});
test('round 6: an author woken by an answer is told what it missed while quiet', () => {
  withFleet(room(), (board) => {
    const ask = post(board, 'angel', 'Angel -> Mona Lisa: can you build #7346?');
    post(board, 'pigeonpete', 'an fyi angel never saw');
    const answer = post(board, 'monalisa', 'yes, after #7265', { replyTo: ask.sent.id });
    assert.match(typedTo(answer.tmux, 'angel').join(''), /This room has been talking without you: 1 earlier post/);
  });
});
test('round 6: a person\'s post that reached nobody does not end the pause', () => {
  withFleet(room(), (board) => {
    for (let i = 0; i < roomloop.LOOP_CAP; i += 1) post(board, 'angel', '@monalisa ping ' + i);
    const failing = (args) => (args[0] === 'display-message' ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
      : { ran: true, spawnFailed: false, status: 1, out: '', err: 'no such pane' });
    chat.setRunner(failing); chat.setDryRun(false);
    const op = messages.sendPost({ operator: true, project: PROJECT, text: 'anyone there?' }, board.agents, MEMBERS);
    assert.notEqual(op.state, chat.DELIVERY.PLACED, 'control: this person\'s post had to reach nobody');
    assert.equal(roomloop.paused(PROJECT), true, 'a refused person\'s post ended the pause');
  });
});

test('round 7: the author woken by an answer gets it as a message from its colleague, with no invitation to reply', () => {
  withFleet(room(), (board) => {
    const ask = post(board, 'angel', 'Angel -> Mona Lisa: can you review #12?');
    const answer = post(board, 'monalisa', 'reviewed, two nits on line 4', { replyTo: ask.sent.id });
    const typed = typedTo(answer.tmux, 'angel').join('');
    assert.match(typed, /^\[message from your colleague monalisa /, 'the answer reached its asker as background');
    assert.doesNotMatch(typed, /not addressed to you/);
    assert.match(typed, /FYI, no reply requested/, 'the answer invited another round');
    const named = post(board, 'monalisa', 'Mona Lisa -> Angel: one question back, ok to merge?', { replyTo: ask.sent.id });
    assert.match(typedTo(named.tmux, 'angel').join(''), /to answer, run: kosmos post --in-reply-to/, 'CONTROL: an answer that names its author asks for a reply');
  });
});

test('round 7: Reopen and a post from the person\'s other computer lift the pause, as a post here does', () => {
  for (const lift of [() => messages.reopenRoom(PROJECT), () => messages.reopenForOwnPost(PROJECT, { id: 'x1', at: new Date().toISOString() })]) {
    roomloop.resetForTests();
    for (let i = 0; i < roomloop.LOOP_CAP; i += 1) roomloop.noteWake(PROJECT);
    assert.equal(roomloop.paused(PROJECT), true, 'control: paused before the person acts');
    assert.equal(lift().ok, true);
    assert.equal(roomloop.paused(PROJECT), false, 'the person acted and the agents stayed paused');
  }
});
test('round 7: the header is the post\'s first line as written, not the post with its lines joined', () => {
  withFleet(room(), (board) => {
    assert.deepEqual(post(board, 'pigeonpete', 'Deploy done\nbuild -> Angel: ok').woke, [], 'a second line was read as the header');
    assert.deepEqual(post(board, 'pigeonpete', 'PigeonPete -> Angel\nsee: the log').woke, [], 'a header with no colon took one from a later line');
    assert.deepEqual(post(board, 'pigeonpete', 'PigeonPete -> Angel: the build\nis green').woke, ['angel'], 'CONTROL: a header on the first line');
  });
});

/* kosmos#7461: the cap paused Fleet Builders while its gate queue was handing off by "my run ended" posts, each to the
   next agent in line, and those handoffs went quiet. While paused, a post asking exactly one member still wakes it,
   PAIR_CAP times per ordered pair per pause. */
function pause(board) {
  for (let i = 0; i < roomloop.LOOP_CAP; i += 1) post(board, 'angel', '@monalisa ping ' + i);
  assert.deepEqual(post(board, 'angel', '@monalisa @pigeonpete paused?').woke, [], 'fixture: the project is not paused');
}

test('kosmos#7461: while paused, a handoff to one named member wakes it, and the next handoff in the chain does too', () => {
  withFleet(room(), (board) => {
    pause(board);
    const a = post(board, 'pigeonpete', 'PigeonPete -> Mona Lisa: my gate run has ended, the gate is yours.');
    assert.deepEqual(a.woke, ['monalisa'], 'a one-member handoff went quiet under the pause');
    assert.equal(a.sent.because, null, 'the sender was told its post woke no one, and it did');
    assert.deepEqual(post(board, 'monalisa', 'Mona Lisa -> Angel: mine has ended, yours.').woke, ['angel']);
    // A reply to that member's own post is one-to-one too.
    const asked = post(board, 'angel', '@pigeonpete which branch is next?');
    assert.deepEqual(post(board, 'pigeonpete', 'cloudwire', { replyTo: asked.sent.id }).woke, ['angel']);
  });
});

test('kosmos#7461: two agents answering each other under the pause stop after PAIR_CAP each way; @all and two names stay quiet', () => {
  withFleet(room(), (board) => {
    pause(board);
    const woke = [];
    for (let i = 0; i < roomloop.PAIR_CAP + 2; i += 1) {
      woke.push(post(board, 'pigeonpete', '@monalisa round ' + i).woke.length);
      woke.push(post(board, 'monalisa', '@pigeonpete round ' + i).woke.length);
    }
    assert.equal(woke.reduce((a, b) => a + b, 0), 2 * roomloop.PAIR_CAP, 'a two-agent loop was not bounded under the pause: ' + woke.join(','));
    const late = post(board, 'pigeonpete', '@monalisa one more');
    assert.equal(late.sent.outcomes.monalisa, roomhold.QUIET);
    assert.match(String(late.sent.because), /woke no one/, 'a post the pause kept quiet must say so');
    assert.deepEqual(post(board, 'angel', '@all status?').woke, [], '@all woke members under the pause');
    assert.deepEqual(post(board, 'angel', '@pigeonpete @monalisa status?').woke, [], 'a two-member post woke members under the pause');
  });
});

test('kosmos#7461: the pair budget is per pause: a new pause starts each pair again', () => {
  withFleet(room(), (board) => {
    pause(board);
    for (let i = 0; i < roomloop.PAIR_CAP; i += 1) post(board, 'pigeonpete', '@monalisa used ' + i);
    assert.deepEqual(post(board, 'pigeonpete', '@monalisa spent?').woke, [], 'fixture: the pair budget is not spent');
    arm();
    messages.sendPost({ operator: true, project: PROJECT, text: 'carry on' }, board.agents, MEMBERS);   // a person clears the pause
    pause(board);
    assert.deepEqual(post(board, 'pigeonpete', '@monalisa new pause').woke, ['monalisa'], 'the pair budget carried over to a new pause');
  });
});

test('kosmos#7461 review 1: a ring of agents handing on under a pause is bounded by THROUGH_CAP for the project, not by its pairs', () => {
  withFleet(room(), (board) => {
    pause(board);
    const ring = [['pigeonpete', 'monalisa'], ['monalisa', 'angel'], ['angel', 'pigeonpete'], ['pigeonpete', 'angel'], ['angel', 'monalisa'], ['monalisa', 'pigeonpete']];
    let woke = 0;
    for (let i = 0; i < 4; i += 1) for (const [from, to] of ring) woke += post(board, from, '@' + to + ' hand on ' + i).woke.length;
    assert.equal(woke, roomloop.THROUGH_CAP, 'a ring escaped the project bound under a pause: ' + woke);
  });
});

test('kosmos#7461 review 1: a pause that runs out forgets the pair counts, so the next pause starts every pair again', () => {
  roomloop.setCapForTests(2);
  const p = 'expiry-7461';
  const t0 = Date.parse('2026-10-28T07:00:00Z');
  roomloop.noteWake(p, t0); roomloop.noteWake(p, t0 + 1);
  assert.equal(roomloop.paused(p, t0 + 2), true, 'fixture: not paused');
  for (let i = 0; i < roomloop.PAIR_CAP; i += 1) { assert.equal(roomloop.pairCan(p, 'a', 'b'), true); roomloop.pairTake(p, 'a', 'b'); }
  assert.equal(roomloop.pairCan(p, 'a', 'b'), false, 'fixture: the pair is not spent');
  assert.equal(roomloop.paused(p, t0 + 2 + roomloop.LOOP_WINDOW_MS), false, 'fixture: the pause did not run out');
  const t1 = t0 + 2 * roomloop.LOOP_WINDOW_MS;
  roomloop.noteWake(p, t1); roomloop.noteWake(p, t1 + 1);
  assert.equal(roomloop.paused(p, t1 + 2), true, 'fixture: no second pause');
  assert.equal(roomloop.pairCan(p, 'a', 'b'), true, 'a pause that ran out kept its pair counts');
});

test('kosmos#7461 review 1: checking a pair spends nothing; only a post that gets through spends a slot', () => {
  withFleet(room(), (board) => {
    pause(board);
    // The check (pairCan) runs before the board's refusals (the room valve, the acknowledgement rule); the slot is spent
    // only where the post is counted, after them. So checking, however often, must leave the budget whole.
    for (let i = 0; i < 10; i += 1) assert.equal(roomloop.pairCan(PROJECT, 'pigeonpete', 'monalisa'), true, 'checking spent a slot');
    for (let i = 0; i < roomloop.PAIR_CAP; i += 1) assert.deepEqual(post(board, 'pigeonpete', '@monalisa handoff ' + i).woke, ['monalisa']);
    assert.equal(roomloop.pairCan(PROJECT, 'pigeonpete', 'monalisa'), false, 'CONTROL: posts that got through did spend');
  });
});

test('kosmos#7461 review 1: under a pause an @all is never one member, even when all but one are switched off here', () => {
  const projects = require('./projects');
  const real = projects.swarmOffSet;
  projects.swarmOffSet = () => new Set(['angel']);
  try {
    withFleet(room(), (board) => {
      pause(board);
      assert.deepEqual(post(board, 'pigeonpete', '@all status?').woke, [], 'an @all got through the pause as a one-member post');
      assert.deepEqual(post(board, 'pigeonpete', '@monalisa status?').woke, ['monalisa'], 'CONTROL: a one-member post still gets through');
    });
  } finally { projects.swarmOffSet = real; }
});

test('kosmos#7461 review 2: a through post that reaches nobody (the member cannot be typed into) gives its slot back', () => {
  const specs = [fleet.agent('pigeonpete', { state: 'idle', displayName: 'PigeonPete' }), fleet.agent('monalisa', { state: 'idle', displayName: 'Mona Lisa' }),
    fleet.agent('angel', { state: 'idle', displayName: 'Angel' }), fleet.agent('ghost', { state: 'stopped' })];
  const members = ['pigeonpete', 'monalisa', 'angel', 'ghost'];
  withFleet(specs, (board) => {
    pause(board);
    for (let i = 0; i < roomloop.PAIR_CAP + 2; i += 1) {
      armSender('pigeonpete-discord');
      arm();
      const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@ghost handoff ' + i }, board.agents, members);
      assert.equal(sent.state, chat.DELIVERY.COULD_NOT, 'fixture: a stopped member was reached: ' + sent.state);
    }
    assert.equal(roomloop.pairCan(PROJECT, 'pigeonpete', 'ghost'), true, 'posts that reached nobody spent the pair');
  });
});

test('kosmos#7461 review 2: in a room of two, an @all asks the one other member and goes through as a handoff (decided)', () => {
  withFleet([fleet.agent('pigeonpete', { state: 'idle', displayName: 'PigeonPete' }), fleet.agent('monalisa', { state: 'idle', displayName: 'Mona Lisa' })], (board) => {
    const two = ['pigeonpete', 'monalisa'];
    const send = (from, text) => { armSender(from + '-discord'); const tmux = arm(); messages.sendPost({ fromPane: '%7', project: PROJECT, text }, board.agents, two); return typedTo(tmux, from === 'pigeonpete' ? 'monalisa' : 'pigeonpete').length; };
    for (let i = 0; i < roomloop.LOOP_CAP; i += 1) send('pigeonpete', '@monalisa ping ' + i);
    assert.equal(roomloop.paused(PROJECT), true, 'fixture: not paused');
    assert.equal(send('pigeonpete', '@all status?'), 1, 'a room-of-two @all is one member and goes through');
  });
});
