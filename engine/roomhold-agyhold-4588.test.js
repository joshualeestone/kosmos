'use strict';

/**
 * #4588 PR B review (WARNING): room deliveries into a Gemini (Antigravity) agent paused on the shared Google quota.
 *
 * A colleague's room post, addressed or not, is an automatic sender from the member's side, so it goes through the
 * quota gate (chat.deliverAutomatic / deliverAutomaticAsync). A held post is kept for the member like a #4624 hold (its
 * id, marked when it names the member) and told in one line later: by the idle flush, the next typed arrival, or
 * roomhold.flushReleased once the member's timers are released. The person's own post is typed at once.
 *
 * Same harness as messages.roomhold-4624.test.js: real roster rows from the fleet fixture, a scripted tmux runner,
 * and every "was it typed" assertion reads the recorded pastes.
 *
 *   node --test engine/roomhold-agyhold-4588.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomhold-agy-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const selfreport = require('./selfreport');
const status = require('./status');
const roomhold = require('./roomhold');
const agyquota = require('./agyquota');
const store = require('./store');
const fleet = require('../test-support/fleet');

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}
async function withFleetAsync(specs, fn) {
  const board = fleet.install(specs);
  try { return await fn(board); } finally { board.restore(); }
}

function okProbe() { return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }; }
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

function fakeTmux() {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return okProbe();
    return ok();
  };
  fn.pastedSends = () => {
    const out = [];
    let cur = '';
    let target = null;
    let has = false;
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

function arm() {
  const tmux = fakeTmux();
  chat.setRunner(tmux);
  chat.setDryRun(false);
  return tmux;
}

function armSender(session) { messages.setRunner(() => ({ ok: true, session })); }

function typedTo(tmux, session) {
  const t = (s) => String(s.target || '');
  return tmux.pastedSends().filter((s) => t(s).startsWith('=' + session + ':') || t(s).startsWith('=' + session + '-discord:')).map((s) => s.text);
}

function report(name, state) {
  const kept = selfreport.record(name, { state, because: 'test' });
  assert.equal(kept.recorded, true, 'the test could not record a report for ' + name);
}

/* leo (claude) posts; mara is a Gemini (Antigravity) member; april is a claude member (the non-agy CONTROL). */
const AGY = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
function room3() {
  return [fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', AGY), fleet.agent('april', { state: 'idle' })];
}
const MEMBERS = ['leo', 'mara', 'april'];
const PROJECT = 'henderson-lease';

/* The real cards, with the pool paused (mara's card shows a reset ahead) or not. Only quotaUntil is overridden. */
function rosterOf(board, quotaUntil) {
  return board.agents.map((c) => (c.sessionName === 'mara' ? { ...c, quotaUntil } : { ...c }));
}
const AHEAD = () => new Date(Date.now() + 30 * 60e3).toISOString();
/* After the reset: the card no longer shows a pause and the pool memory has aged out (its release has passed). */
function poolReset() { agyquota.POOL_MEMO.bySession.clear(); agyquota.POOL_MEMO.seen.clear(); }

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  poolReset();
  for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#4588 B room fixture: mara is a real antigravity card and the gate holds it while its card shows a reset ahead', () => {
  withFleet(room3(), (board) => {
    const r = rosterOf(board, AHEAD());
    assert.equal(r.find((c) => c.sessionName === 'mara').runner, 'antigravity');
    assert.equal(r.find((c) => c.sessionName === 'april').runner !== 'antigravity', true);
    assert.notEqual(agyquota.heldForQuota('mara', r, Date.now()), null);
    assert.equal(agyquota.heldForQuota('april', r, Date.now()), null);
  });
});

test('#4588 B room: a colleague\'s post that @-names a paused agy member is held (not typed), kept marked as addressed; the claude member is typed (CONTROL)', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    report('april', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara @april can you check clause 4?' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(sent.state, chat.DELIVERY.PLACED, 'a held post must read as placed to the sender: ' + (sent.because || ''));
    assert.equal(sent.outcomes.mara, roomhold.HELD);
    assert.deepEqual(typedTo(tmux, 'mara'), [], 'a paused agy member was typed a colleague\'s post');
    assert.equal(typedTo(tmux, 'april').length, 1, 'CONTROL: a non-agy member is never held');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [roomhold.addressedId(sent.id)]);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), []);
  });
});

test('#4588 B room: an un-addressed colleague post is held for the paused (idle-reporting) member too', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'thinking out loud' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(sent.outcomes.mara, roomhold.HELD);
    assert.deepEqual(typedTo(tmux, 'mara'), []);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [sent.id], 'an un-addressed post is kept unmarked');
  });
});

test('#4588 B review 2 (W2): a quota-held post carries when it will be told (heldUntil), in the reply and the log row; a typed member has none', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    report('april', 'idle');
    armSender('leo-discord');
    arm();
    const until = AHEAD();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara @april when?' }, rosterOf(board, until), MEMBERS);
    assert.equal(sent.outcomes.mara, roomhold.HELD);
    assert.ok(sent.heldUntil && typeof sent.heldUntil.mara === 'string', 'a HELD outcome with no heldUntil reads as delivered');
    assert.equal(Date.parse(sent.heldUntil.mara), Date.parse(until));
    assert.equal('april' in sent.heldUntil, false, 'CONTROL: a typed member is not held until anything');
    const row = messages.readLog().find((m) => m && m.id === sent.id);
    assert.deepEqual(row && row.heldUntil, sent.heldUntil, 'the stored row must carry heldUntil for a later reader');
  });
});

test('#4588 B review 2 (W2) CONTROL: a post that holds nobody has no heldUntil field at all (an ordinary row is unchanged)', () => {
  withFleet(room3(), (board) => {
    report('april', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@april only you' }, rosterOf(board, null), MEMBERS);
    assert.equal('heldUntil' in sent, false);
  });
});

test('#4588 B review 3: with the brake on (ROOM_HOLD_OFF=1) a colleague post is typed to a quota-paused member as before: not held, not refused', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    report('april', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF = '1';
    try {
      const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara @april brake on' }, rosterOf(board, AHEAD()), MEMBERS);
      assert.equal(sent.outcomes.mara, chat.DELIVERY.PLACED, 'the brake must type as before: ' + (sent.because || ''));
      assert.equal(typedTo(tmux, 'mara').length, 1);
      assert.deepEqual(roomhold.heldIn('mara', PROJECT), [], 'kept under the brake: only a typed arrival would ever tell it');
      assert.equal('heldUntil' in sent, false);
    } finally { delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF; }
  });
});

test('#4588 B review 3: with the brake on, a post whose ONLY recipient is the quota-paused member is still stored in the room', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF = '1';
    try {
      const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara only you, brake on' }, rosterOf(board, AHEAD()), ['leo', 'mara']);
      assert.ok(sent.id, 'the post was refused and never reached the room log: ' + (sent.because || ''));
      assert.ok(messages.readLog().some((m) => m && m.id === sent.id), 'the room lost the post');
    } finally { delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF; }
  });
});

test('#4588 B room CONTROL: the person\'s own post is typed into the paused agy member at once, carrying the held line', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const r = rosterOf(board, AHEAD());
    const first = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara over to you' }, r, MEMBERS);
    assert.equal(first.outcomes.mara, roomhold.HELD);
    const tmux = arm();
    const mine = messages.sendPost({ operator: true, project: PROJECT, text: 'the person writes to the room' }, r, MEMBERS);
    assert.equal(mine.outcomes.mara, chat.DELIVERY.PLACED, 'the person\'s post was held');
    const got = typedTo(tmux, 'mara');
    assert.equal(got.length, 1);
    assert.match(got[0], /the person writes to the room/);
    assert.match(got[0], new RegExp('1 of them names you and asks for your answer \\(' + first.id + '\\)'), 'the held post did not ride on the typed arrival');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [], 'told once: the ride cleared it');
  });
});

test('#4588 B room: the async room path (sendPostAsync) holds a colleague post the same way', async () => {
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const sent = await messages.sendPostAsync({ fromPane: '%7', project: PROJECT, text: '@mara async?' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(sent.outcomes.mara, roomhold.HELD);
    assert.deepEqual(typedTo(tmux, 'mara'), []);
    assert.equal(typedTo(tmux, 'april').length, 1, 'CONTROL: the claude member is typed');
  });
});

test('#4588 B room: after the reset a colleague post is typed to the agy member as before (the gate is not stuck)', () => {
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara now?' }, rosterOf(board, null), MEMBERS);
    assert.equal(sent.outcomes.mara, chat.DELIVERY.PLACED);
    assert.equal(typedTo(tmux, 'mara').length, 1);
  });
});

function flushDeps(r) {
  return { deliver: chat.deliverAutomaticAsync, roster: r, DELIVERY: chat.DELIVERY, env: {}, shownOf: () => 'Henderson lease' };
}

test('#4588 B idle flush: on a paused agy member it is held, nothing is typed, and the ids are put back; after the reset it is told once', async () => {
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara look at this' }, rosterOf(board, AHEAD()), MEMBERS);
    const bg = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'and this, not for you' }, rosterOf(board, AHEAD()), MEMBERS);
    const kept = [roomhold.addressedId(sent.id), bg.id];
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), kept);

    let tmux = arm();
    const held = await roomhold.flushOnIdle('mara', flushDeps(rosterOf(board, AHEAD())));
    assert.equal(held.length, 1);
    assert.equal(held[0].state, chat.DELIVERY.COULD_NOT);
    assert.deepEqual(typedTo(tmux, 'mara'), [], 'the idle flush typed into a paused agy member');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), kept, 'a held flush dropped the ids');

    poolReset();
    tmux = arm();
    const done = await roomhold.flushOnIdle('mara', flushDeps(rosterOf(board, null)));
    assert.equal(done[0].state, chat.DELIVERY.PLACED);
    const got = typedTo(tmux, 'mara');
    assert.equal(got.length, 1);
    assert.match(got[0], new RegExp('2 room posts arrived in project Henderson lease \\(' + sent.id + ', ' + bg.id + '\\)\\. 1 of them names you'));
    assert.equal(got[0].includes('@'), false, 'the internal mark leaked into the line');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), []);
    tmux = arm();
    assert.deepEqual(await roomhold.flushOnIdle('mara', flushDeps(rosterOf(board, null))), [], 'told twice');
  });
});

function releasedDeps(r, now) {
  return { ...flushDeps(r), isAgy: (c) => c.runner === 'antigravity' && c.isNamedOurs !== false, readReport: (n) => selfreport.read(n), now, decayMs: status.REPORT_WORKING_DECAY_MS };
}

test('#4588 B retry (flushReleased): with no idle report, posts held on the quota reach the member after the reset, once; not while held', async () => {
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara please' }, rosterOf(board, AHEAD()), MEMBERS);

    let tmux = arm();
    const r1 = rosterOf(board, AHEAD());
    const heldFile = roomhold.fileFor('mara');
    const stamp = Math.floor(fs.statSync(heldFile).mtimeMs / 1000) * 1000 - 60000;   // whole seconds: utimes rounds
    fs.utimesSync(heldFile, new Date(stamp), new Date(stamp));   // a minute back, so a rewrite is visible
    const whileHeld = await roomhold.flushReleased(r1, releasedDeps(r1, Date.now()));
    // #4797: while the quota holds her, she is not tried at all: no result (so no log line), her file not rewritten.
    assert.deepEqual(whileHeld, [], 'the retry tried a member the quota still holds');
    assert.equal(fs.statSync(heldFile).mtimeMs, stamp, 'the held file was rewritten while nothing could be told');
    assert.deepEqual(typedTo(tmux, 'mara'), [], 'the retry typed while the pool is held');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [roomhold.addressedId(sent.id)]);

    poolReset();
    tmux = arm();
    const r2 = rosterOf(board, null);
    const after = await roomhold.flushReleased(r2, releasedDeps(r2, Date.now()));
    assert.deepEqual(after.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]]);
    assert.equal(typedTo(tmux, 'mara').length, 1);
    assert.match(typedTo(tmux, 'mara')[0], new RegExp('names you and asks for your answer \\(' + sent.id + '\\)'));
    tmux = arm();
    assert.deepEqual(await roomhold.flushReleased(r2, releasedDeps(r2, Date.now())), [], 'delivered twice');
    assert.deepEqual(typedTo(tmux, 'mara'), []);
  });
});

test('#4588 B retry CONTROL: a working agy member, and a non-agy member holding #4624 posts, are not flushed by the retry', async () => {
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'working');
    report('april', 'idle');
    assert.equal(roomhold.hold('mara', PROJECT, 'm900001'), true);
    assert.equal(roomhold.hold('april', PROJECT, 'm900002'), true);
    const tmux = arm();
    const r = rosterOf(board, null);
    assert.deepEqual(await roomhold.flushReleased(r, releasedDeps(r, Date.now())), []);
    assert.deepEqual(tmux.pastedSends(), []);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), ['m900001']);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), ['m900002'], 'the retry reached a non-agy member');
  });
});

/* Review round 6: the quota gate holds only a member the board can type into (chat.addressable). mara STOPPED is her
   pane with no Antigravity in it: a shell that would run typed text, so nothing can be typed now or after the reset. */
const AGY_STOPPED = { ...AGY, state: 'stopped', command: '-zsh' };
/* Between a test's two arms: the stored reports, holds and log of the first arm would make the fleet check misread the second. */
function fresh() {
  chat.resetForTests();
  messages.resetForTests();
  poolReset();
  for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
}
function room3Stopped() {
  return [fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', AGY_STOPPED), fleet.agent('april', { state: 'idle' })];
}

test('#4588 B review 6: during a pool pause a colleague post to a room with a STOPPED agy member is COULD_NOT for her, with no heldUntil and nothing kept; CONTROL: a reachable paused member stays HELD', () => {
  withFleet(room3Stopped(), (board) => {
    report('mara', 'idle');
    report('april', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const r = rosterOf(board, AHEAD());
    assert.notEqual(agyquota.heldForQuota('mara', r, Date.now()), null, 'fixture: the pool is not paused for mara');
    assert.equal(chat.addressable('mara', r).ok, false, 'fixture: the stopped mara is addressable');
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara @april clause 4?' }, r, MEMBERS);
    assert.equal(sent.outcomes.mara, chat.DELIVERY.COULD_NOT, 'a stopped member was held as if she could be told later');
    assert.equal(sent.heldUntil && sent.heldUntil.mara, undefined, 'a stopped member was given a heldUntil');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [], 'ids were kept for a pane nothing can type into');
    assert.deepEqual(typedTo(tmux, 'mara'), []);
    assert.equal(sent.outcomes.april, chat.DELIVERY.PLACED, 'CONTROL: the claude member is typed');
  });
  fresh();
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara clause 4?' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(sent.outcomes.mara, roomhold.HELD, 'CONTROL: a reachable paused agy member is no longer held');
  });
});

test('#4588 B review 6: a post whose ONLY recipient is a STOPPED agy member is refused during a pool pause (no id, not in the room log); CONTROL: reachable, it is kept', () => {
  withFleet(room3Stopped(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    const tmux = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara only you' }, rosterOf(board, AHEAD()), ['leo', 'mara']);
    assert.ok(!sent.id, 'a post that reached nobody was given an id: ' + JSON.stringify(sent.outcomes || {}));
    assert.equal(messages.readLog().some((m) => m && m.kind === 'post' && m.project === PROJECT), false, 'the refused post is in the room log');
    assert.equal(sent.state, chat.DELIVERY.COULD_NOT);
    assert.deepEqual(typedTo(tmux, 'mara'), []);
  });
  fresh();
  withFleet(room3(), (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara only you' }, rosterOf(board, AHEAD()), ['leo', 'mara']);
    assert.ok(sent.id, 'CONTROL: a post held for a reachable member was refused');
    assert.ok(messages.readLog().some((m) => m && m.id === sent.id));
  });
});

test('#4926 R2: flushReleased (the quota-release flush) drops an ask held over a day, through the real staleHeld; CONTROL: a fresh one is told', async () => {
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'idle');
    armSender('leo-discord');
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara please' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [roomhold.addressedId(sent.id)], 'fixture: the ask was not held on the quota');
    poolReset();
    const r = rosterOf(board, null);
    const at = (later) => ({ ...releasedDeps(r, Date.now()), stale: (p, ids, who) => messages.staleHeld(p, ids, undefined, Date.now() + later, who) });
    let tmux = arm();
    // A day and an hour after the post: the ask is dropped, nothing is typed.
    const late = await roomhold.flushReleased(r, at(messages.HELD_ASKED_MAX_MS + 3600000));
    assert.deepEqual(typedTo(tmux, 'mara'), [], 'an ask held over a day was typed after the quota released');
    assert.deepEqual(late, [], 'a flush that told nothing reported a result');
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [], 'the dropped ask was kept');
    // CONTROL: the same ask held again, released within the day, is told.
    roomhold.hold('mara', PROJECT, roomhold.addressedId(sent.id));
    tmux = arm();
    await roomhold.flushReleased(r, at(0));
    assert.equal(typedTo(tmux, 'mara').length, 1, 'a fresh ask was not told after the quota released');
  });
});

test('#4588 B review 6: flushReleased skips a STOPPED agy member holding posts (no try, no log line, ids kept); CONTROL: reachable, it is told', async () => {
  await withFleetAsync(room3Stopped(), async (board) => {
    report('mara', 'idle');
    assert.equal(roomhold.hold('mara', PROJECT, 'm900003'), true);
    const tmux = arm();
    const r = rosterOf(board, null);
    assert.deepEqual(await roomhold.flushReleased(r, releasedDeps(r, Date.now())), [], 'a stopped member was retried (a COULD_NOT and a log line every minute)');
    assert.deepEqual(tmux.pastedSends(), []);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), ['m900003'], 'the ids were dropped');
  });
  fresh();
  await withFleetAsync(room3(), async (board) => {
    report('mara', 'idle');
    assert.equal(roomhold.hold('mara', PROJECT, 'm900004'), true);
    arm();
    const r = rosterOf(board, null);
    const done = await roomhold.flushReleased(r, releasedDeps(r, Date.now()));
    assert.deepEqual(done.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]], 'CONTROL: a reachable member was not told');
  });
});

test('#4588 B clause: without an addressed id the #4624 line is byte-unchanged', () => {
  assert.equal(roomhold.clauseFor('p1', 'P one', ['m1']),
    '[Since you last heard from this room, 1 room post not addressed to you arrived in project P one (m1). Nothing is asked of you; read them with: kosmos room p1]');
  assert.equal(roomhold.plainId(roomhold.addressedId('m7')), 'm7');
  // The same id held again unmarked is kept once, with its mark.
  assert.equal(roomhold.hold('zed', 'p1', roomhold.addressedId('m7')), true);
  assert.equal(roomhold.hold('zed', 'p1', 'm7'), true);
  assert.deepEqual(roomhold.heldIn('zed', 'p1'), ['@m7']);
});

test('#4797: the log line says "told of" only when something was told', () => {
  const placed = roomhold.toldLine('mara', { n: 2, projectId: PROJECT, state: chat.DELIVERY.PLACED }, 'after the quota hold');
  assert.match(placed, /^room-hold: mara told of 2 held post\(s\) in .+ after the quota hold, delivery=/);
  assert.match(roomhold.toldLine('mara', { n: 2, projectId: PROJECT, state: chat.DELIVERY.PLACED }), /told of 2 held post\(s\) in [^ ]+, delivery=/);
  const refused = roomhold.toldLine('mara', { n: 2, projectId: PROJECT, state: chat.DELIVERY.COULD_NOT }, 'after the quota hold');
  assert.equal(/told of/.test(refused.replace('could not yet be told of', '')), false, 'a refused try was logged as told');
  assert.match(refused, /could not yet be told of 2 held post\(s\)/);
  assert.ok(refused.endsWith('\n') && placed.endsWith('\n'));
  // No state: flushOnIdle put the ids back, so it was not told either.
  assert.match(roomhold.toldLine('mara', { n: 1, projectId: PROJECT, state: undefined }), /could not yet be told of 1 held post.*\(delivery=none\)/);
  // UNCONFIRMED: flushOnIdle cleared the ids (the line reached the pane), so it is told, and says so.
  assert.match(roomhold.toldLine('mara', { n: 1, projectId: PROJECT, state: chat.DELIVERY.UNCONFIRMED }), /told of 1 held post\(s\) in [^ ]+, delivery=/);
});

test('#4797: both server log lines for a flush go through toldLine (no inline "told of" left)', () => {
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal((src.match(/roomhold\.toldLine\(/g) || []).length, 2, 'CONTROL: the two call sites were not found');
  const inline = /room-hold: (\$\{[^}]+\}|' \+ \w+ \+ ')\s*told of/;
  // CONTROL: the check matches the old inline line, in both template and concatenated form.
  assert.ok(inline.test('write(`room-hold: ${who} told of ${d.n} held post(s)`)'), 'the check cannot see a template line');
  assert.ok(inline.test("write('room-hold: ' + who + ' told of ' + n)"), 'the check cannot see a concatenated line');
  assert.equal(inline.test(src), false, 'an inline "told of" log line is back in server.js');
});

test('#4624 follow-up review 1: the minute retry skips an agy member whose hook said idle while it holds only posts asking nothing; one naming it is told', async () => {
  await withFleetAsync(room3(), async (board) => {
    assert.equal(selfreport.record('mara', { state: 'idle', because: 'turn ended', auto: true }).recorded, true);
    assert.equal(roomhold.hold('mara', PROJECT, 'm900010'), true);
    let tmux = arm();
    const r = rosterOf(board, null);
    assert.deepEqual(await roomhold.flushReleased(r, releasedDeps(r, Date.now())), [], 'an idle member was woken about posts that ask nothing of it');
    assert.deepEqual(tmux.pastedSends(), []);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), ['m900010']);
    // CONTROL: once a held post names her, the retry tells her (the #4588 purpose).
    assert.equal(roomhold.hold('mara', PROJECT, roomhold.addressedId('m900011')), true);
    tmux = arm();
    const done = await roomhold.flushReleased(r, releasedDeps(r, Date.now()));
    assert.deepEqual(done.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]]);
  });
});

test('#4624 follow-up review 2: the production shape, a quota-paused agy member whose BRIDGE wrote its idle: an un-addressed post is held by the idle rule (no heldUntil), an addressed one by the quota (heldUntil), and after the reset only the addressed one is retried', async () => {
  await withFleetAsync(room3(), async (board) => {
    assert.equal(selfreport.record('mara', { state: 'idle', because: 'quota stop', auto: true }).recorded, true);
    armSender('leo-discord');
    arm();
    const plain = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'thinking out loud' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(plain.outcomes.mara, roomhold.HELD);
    assert.equal(!!(plain.heldUntil && plain.heldUntil.mara), false, 'the idle rule held it, so no quota time applies');
    const asked = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@mara please' }, rosterOf(board, AHEAD()), MEMBERS);
    assert.equal(asked.outcomes.mara, roomhold.HELD);
    assert.ok(asked.heldUntil && typeof asked.heldUntil.mara === 'string', 'an addressed post lost its quota time');
    poolReset();
    const tmux = arm();
    const r = rosterOf(board, null);
    const done = await roomhold.flushReleased(r, releasedDeps(r, Date.now()));
    assert.deepEqual(done.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]]);
    const line = typedTo(tmux, 'mara')[0] || '';
    // The retry ran because a held post names her, and the line asks for that answer only (review 3).
    assert.match(line, new RegExp('names you and asks for your answer \\(' + asked.id + '(?![0-9])'), 'the addressed post was not told as asked: ' + line);
    assert.doesNotMatch(line, new RegExp('asks for your answer \\([^)]*' + plain.id + '(?![0-9])'), 'the un-addressed post was told as asked');
  });
});

/* #4588 ask 3 review 13: a plain post the ordinary #4624 idle hold kept waits for the member's next wake, cap or no cap.
   Review 1 retried every held post while a cap was set, which typed up to `max` idle Gemini agents a minute into posts
   that ask nothing of them. Both arms: no cap and a cap with room. */
test('#4588 ask 3: an idle agy member\'s #4624-held PLAIN post waits for its next wake, with a cap set and without', async () => {
  const capSetting = require('./agycap-setting');
  for (const capOn of [false, true]) {
    chat.resetForTests(); messages.resetForTests(); poolReset();
    for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
    if (capOn) assert.deepEqual(capSetting.set({ maxWorking: 2 }), { ok: true }); else fs.rmSync(capSetting.FILE, { force: true });
    try {
      await withFleetAsync(room3(), async (board) => {
        // An AUTOMATIC idle report (by:'auto'), the only kind roomhold's idleNow counts, so the #4624 hold keeps the post.
        const kept = selfreport.record('mara', { state: 'idle', because: 'test', auto: true });
        assert.equal(kept.recorded, true);
        assert.equal(selfreport.read('mara').by, 'auto', 'fixture: the idle report is automatic');
        armSender('leo-discord');
        arm();
        const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'an update for the room' }, rosterOf(board, null), MEMBERS);
        assert.deepEqual(roomhold.heldIn('mara', PROJECT), [sent.id], 'fixture: the plain post is held for mara, unmarked');
        const tmux = arm();
        const r2 = rosterOf(board, null);
        assert.deepEqual(await roomhold.flushReleased(r2, releasedDeps(r2, Date.now())), [], (capOn ? 'cap on' : 'no cap') + ': the idle member was woken for a plain post');
        assert.deepEqual(typedTo(tmux, 'mara'), []);
        assert.deepEqual(roomhold.heldIn('mara', PROJECT), [sent.id], 'the post is still held for her next wake');
      });
    } finally { fs.rmSync(capSetting.FILE, { force: true }); agyquota.CAP_STARTS.clear(); }
  }
});

/* #4588 ask 3 review 13, the other arm: a post the CAP held is marked, so once the cap lets the member through the
   minute retry tells it, even though the member is idle by then (the cap held it while no wake was coming). CONTROL:
   the same post with its mark taken off waits, which is what proves the mark (not the cap) is what lets it through. */
test('#4588 ask 3: a post the cap held is marked and the retry tells it once the cap frees; unmarked, it waits (CONTROL)', async () => {
  const capSetting = require('./agycap-setting');
  const room = () => room3().concat([fleet.agent('zed', AGY)]);
  // zed's card says working (the cap counts what the cards say); `busy` false is the same roster after its turn ended.
  const withZed = (board, busy) => rosterOf(board, null).map((c) => (String(c.sessionName).replace(/-discord$/, '') === 'zed' ? { ...c, state: busy ? 'working' : 'idle' } : c));
  for (const marked of [true, false]) {
    chat.resetForTests(); messages.resetForTests(); poolReset();
    for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
    assert.deepEqual(capSetting.set({ maxWorking: 1 }), { ok: true });
    try {
      await withFleetAsync(room(), async (board) => {
        // mara has no report, so the #4624 hold passes the post on; zed (another Gemini agent) is working, so the cap of 1 holds it.
        armSender('leo-discord');
        const first = arm();
        const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'an update for the room' }, withZed(board, true), MEMBERS);
        assert.deepEqual(typedTo(first, 'mara'), [], 'fixture: the cap held the post');
        assert.deepEqual(roomhold.heldIn('mara', PROJECT), [roomhold.cappedId(sent.id)], 'the cap-held post carries the cap mark');
        if (!marked) {
          // CONTROL: the same held post, unmarked.
          assert.deepEqual(roomhold.take('mara', PROJECT), [roomhold.cappedId(sent.id)]);
          assert.equal(roomhold.hold('mara', PROJECT, sent.id), true);
        }
        // Then mara's turn-less idle arrives (automatic) and zed stops working: the cap now has room.
        assert.equal(selfreport.record('mara', { state: 'idle', because: 'test', auto: true }).recorded, true);
        const freed = withZed(board, false);
        agyquota.CAP_STARTS.clear();
        const tmux = arm();
        const after = await roomhold.flushReleased(freed, releasedDeps(freed, Date.now()));
        if (marked) {
          assert.deepEqual(after.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]], 'the cap-held post was not told');
          const line = typedTo(tmux, 'mara')[0] || '';
          assert.match(line, new RegExp('\\(' + sent.id + '\\)'), 'the line names the post by its plain id: ' + line);
          assert.doesNotMatch(line, /\^/, 'the cap mark leaked into the line');
          assert.match(line, /Nothing is asked of you/, 'a cap-held plain post is not told as asked');
          assert.deepEqual(roomhold.heldIn('mara', PROJECT), [], 'told once');
        } else {
          assert.deepEqual(after, [], 'an unmarked post woke the idle member');
          assert.deepEqual(typedTo(tmux, 'mara'), []);
        }
      });
    } finally { fs.rmSync(capSetting.FILE, { force: true }); agyquota.CAP_STARTS.clear(); }
  }
});

/* #4588 ask 3 review 13: the cap's mark is bookkeeping, never a claim that the post asks anything. A stale cap-held post
   is dropped like any plain one (an asked one never is), and a post held twice keeps the stronger mark (@ over ^). */
test('#4588 ask 3: a cap-marked id is dropped when stale like a plain one, and the asked mark outranks it', () => {
  const asked = roomhold.addressedId('m1');
  const capped = roomhold.cappedId('m2');
  const kept = roomhold.withoutStale(PROJECT, [asked, capped, 'm3'], () => new Set(['m1', 'm2']), 'mara');
  assert.deepEqual(kept, [asked, 'm3'], 'a stale cap-held post was kept, or an asked one dropped');
  assert.deepEqual(roomhold.withoutStale(PROJECT, [capped], () => new Set(['m9']), 'mara'), [capped], 'CONTROL: a fresh cap-held post is kept');
  for (const [first, second, want] of [
    [roomhold.cappedId('m5'), 'm5', roomhold.cappedId('m5')],
    ['m5', roomhold.cappedId('m5'), roomhold.cappedId('m5')],
    [roomhold.cappedId('m5'), roomhold.addressedId('m5'), roomhold.addressedId('m5')],
    [roomhold.addressedId('m5'), roomhold.cappedId('m5'), roomhold.addressedId('m5')],
    ['m5', 'm5', 'm5'],
  ]) {
    roomhold.forget('mara');
    assert.equal(roomhold.hold('mara', PROJECT, first), true);
    assert.equal(roomhold.hold('mara', PROJECT, second), true);
    assert.deepEqual(roomhold.heldIn('mara', PROJECT), [want], first + ' then ' + second);
  }
  assert.equal(roomhold.plainId(capped), 'm2');
  assert.equal(roomhold.isAddressed(capped), false);
});

/* #4588 ask 3 review 14: a post held while the member WORKED is told at its turn end. When the cap refuses that turn-end
   line the member is idle with no wake coming, so the ids go back with the cap's mark and the minute retry tells them
   once the cap frees. CONTROL: the quota refusing the same line puts them back unmarked (the follow-up's rule). */
test('#4588 ask 3: a turn-end flush the cap refuses puts its posts back marked, and the retry tells them once the cap frees; a quota refusal does not mark (CONTROL)', async () => {
  const capSetting = require('./agycap-setting');
  const room = () => room3().concat([fleet.agent('zed', AGY)]);
  const withZed = (board, busy, quotaUntil) => rosterOf(board, quotaUntil).map((c) => (String(c.sessionName).replace(/-discord$/, '') === 'zed' ? { ...c, state: busy ? 'working' : 'idle' } : c));
  for (const by of ['cap', 'quota']) {
    chat.resetForTests(); messages.resetForTests(); poolReset();
    for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
    if (by === 'cap') assert.deepEqual(capSetting.set({ maxWorking: 1 }), { ok: true }); else fs.rmSync(capSetting.FILE, { force: true });
    try {
      await withFleetAsync(room(), async (board) => {
        report('mara', 'working');
        armSender('leo-discord');
        arm();
        const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'an update for the room' }, withZed(board, false, null), MEMBERS);
        assert.deepEqual(roomhold.heldIn('mara', PROJECT), [sent.id], 'fixture: the #4624 hold kept the post for the working member, unmarked');
        // Her turn ends (automatic idle); the turn-end line meets the cap (zed working) or the quota (a reset ahead).
        assert.equal(selfreport.record('mara', { state: 'idle', because: 'test', auto: true }).recorded, true);
        agyquota.CAP_STARTS.clear();
        const refused = arm();
        const r1 = by === 'cap' ? withZed(board, true, null) : withZed(board, false, AHEAD());
        const flushed = await roomhold.flushOnIdle('mara', flushDeps(r1));
        assert.deepEqual(flushed.map((d) => d.state), [chat.DELIVERY.COULD_NOT], 'fixture: the turn-end line was held');
        assert.deepEqual(typedTo(refused, 'mara'), []);
        if (by === 'cap') {
          assert.deepEqual(roomhold.heldIn('mara', PROJECT), [roomhold.cappedId(sent.id)], 'a cap-refused turn-end line put its post back unmarked');
          agyquota.CAP_STARTS.clear();
          const tmux = arm();
          const freed = withZed(board, false, null);
          const after = await roomhold.flushReleased(freed, releasedDeps(freed, Date.now()));
          assert.deepEqual(after.map((d) => [d.name, d.state]), [['mara', chat.DELIVERY.PLACED]], 'the post was stranded');
          assert.match(typedTo(tmux, 'mara')[0] || '', new RegExp('\\(' + sent.id + '\\)'));
          assert.deepEqual(roomhold.heldIn('mara', PROJECT), []);
        } else {
          assert.deepEqual(roomhold.heldIn('mara', PROJECT), [sent.id], 'a quota refusal marked the post');
        }
      });
    } finally { fs.rmSync(capSetting.FILE, { force: true }); agyquota.CAP_STARTS.clear(); poolReset(); }
  }
});
