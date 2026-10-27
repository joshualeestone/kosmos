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
    const over = post(board, 'angel', '@monalisa ping over');
    assert.deepEqual(over.woke, [], 'the capped post still woke someone');
    assert.equal(over.sent.outcomes.monalisa, roomhold.QUIET);
    post(board, 'angel', '@monalisa ping over again');
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

test('round 2: the row keeps @-names in `mentioned` (claims, owed answers, the #185 nudge) and the wake set in `addressed`', () => {
  withFleet(room(), (board) => {
    const p = post(board, 'angel', 'Angel -> Mona Lisa: @all the cut is on staging');
    const row = messages.record().rows.find((x) => x.id === p.sent.id);
    assert.ok(!row.mentioned, 'a header or @all became an owed answer: ' + JSON.stringify(row.mentioned));
    assert.deepEqual([...row.addressed].sort(), ['monalisa', 'pigeonpete']);
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
const FLEET = [['angel', 'Angel'], ['monalisa', 'Mona Lisa'], ['renettilley', 'Renet Tilley'], ['barondraxum', 'Baron Draxum'],
  ['icecreamkitty', 'Ice Cream Kitty'], ['pigeonpete', 'PigeonPete'], ['claudebot', 'Splinter']].map(([sessionName, name]) => ({ sessionName, name }));
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
  const twoKitties = FLEET.concat([{ sessionName: 'kittyhawk', name: 'Kitty Hawk' }]);
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
    assert.deepEqual(post(board, 'angel', '@monalisa paused?').woke, [], 'control: the project must be paused before the person posts');
    arm();
    messages.sendPost({ operator: true, project: PROJECT, text: 'carry on, both of you' }, board.agents, MEMBERS);
    assert.deepEqual(post(board, 'angel', '@monalisa after the person').woke, ['monalisa'], 'the person posted and the pause still held');
  });
});

/* Round 4: the window itself, the header's "all", a row from before the upgrade, and two async posts at the cap. */
test('round 4: the cap frees as its oldest wake leaves the hour, and a new pause is said again', () => {
  const t0 = Date.parse('2026-10-27T12:00:00Z');
  for (let i = 0; i < roomloop.LOOP_CAP; i += 1) roomloop.noteWake('p', t0 + i * 1000);
  assert.equal(roomloop.paused('p', t0 + 60000), true);
  assert.equal(roomloop.freesAt('p', t0 + 60000), t0 + roomloop.LOOP_WINDOW_MS, 'the window frees when its first wake is an hour old');
  assert.ok(roomloop.pauseNote('p', t0 + 60000), 'the first pause is said');
  assert.equal(roomloop.pauseNote('p', t0 + 61000), '', 'and only once');
  assert.equal(roomloop.paused('p', t0 + roomloop.LOOP_WINDOW_MS + 500), false, 'the oldest wake aged out, so there is room');
  roomloop.noteWake('p', t0 + roomloop.LOOP_WINDOW_MS + 600);
  assert.equal(roomloop.paused('p', t0 + roomloop.LOOP_WINDOW_MS + 700), true);
  // Round 5: the slid window paused again within the hour of the last note, so the person is not told again.
  assert.equal(roomloop.pauseNote('p', t0 + roomloop.LOOP_WINDOW_MS + 700), '', 'a slot freeing and filling again re-posted the note');
  assert.ok(roomloop.pauseNote('p', t0 + 60000 + roomloop.LOOP_WINDOW_MS), 'an hour after the last note, a pause still on is said again');
  roomloop.clear('p');
  for (let i = 0; i < roomloop.LOOP_CAP; i += 1) roomloop.noteWake('p', t0 + roomloop.LOOP_WINDOW_MS + 61000 + i);
  assert.ok(roomloop.pauseNote('p', t0 + roomloop.LOOP_WINDOW_MS + 62000), 'after the person posted, a new pause is said at once');
  assert.equal(roomloop.paused('other', t0 + 60000), false, 'CONTROL: another project is not paused');
});
test('round 4: "Ada -> all:" and "-> everyone:" are the header\'s @all', () => {
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
    const b = messages.sendPostAsync({ fromPane: '%7', project: PROJECT, text: '@pigeonpete second of two' }, board.agents, MEMBERS);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.outcomes.monalisa, 'placed', 'the first post fills the cap and wakes its member');
    assert.equal(rb.outcomes.pigeonpete, roomhold.QUIET, 'a post started while the first was still typing ran past the cap');
  } finally { board.restore(); }
});

/* Round 5 (M1): words after a name, and the word form read every way, so the fleet's own shapes keep their names. */
test('round 5: a header name keeps its member whatever words follow it', () => {
  const F = FLEET.concat([{ sessionName: 'basil', name: 'Basil' }, { sessionName: 'ada', name: 'Ada' }]);
  const n = F.map((c) => c.sessionName);
  const a = (from, text) => [...messages.addressedMembers(text, n.filter((x) => x !== from), F, new Set(), from)].sort();
  assert.deepEqual(a('pigeonpete', 'PigeonPete -> Mona Lisa on m702: re-shot'), ['monalisa']);
  assert.deepEqual(a('claudebot', 'Splinter -> PigeonPete and Angel re #12: x'), ['angel', 'pigeonpete']);
  assert.deepEqual(a('claudebot', 'Splinter -> Angel about the cut: x'), ['angel']);
  assert.deepEqual(a('ada', 'Ada to Basil for review: x'), ['basil'], 'the greedy first reading of "to" lost the name');
  assert.deepEqual(a('barondraxum', 'Baron to Kitty for tonight: x'), ['icecreamkitty']);
  assert.deepEqual(a('angel', 'Thanks to Kitty for the fix: x'), [], 'CONTROL: no reading has the poster as its sender');
  assert.deepEqual(a('claudebot', 'Splinter -> owners of the Kosmos Cloud finish line: x'), [], 'CONTROL: no leading words name a member');
});
