'use strict';
/**
 * #4926: a room post that reached its members must never be answered as a failure. A member whose typing path THREW
 * (not one that answered could_not) used to throw the whole post after every other member had been typed into and
 * before the row was written, so the sender read "refused", posted again, and with no row the retry was not folded:
 * every other member got it twice. Now that member is unconfirmed, the row is written, and a retry folds into it.
 *
 *   node --test engine/messages.typingbroke-4926.test.js
 */
const os = require('node:os');
const path = require('node:path');
// Sandboxed BEFORE any engine require: this writes a message log under store.ROOT.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-messages-typingbroke-4926-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const MEMBERS = ['ava', 'bix', 'cy', 'dee'];

function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => new Promise((r) => setTimeout(r, 2)));
  return calls;
}
const enters = (calls) => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').map((a) => a[a.indexOf('-t') + 1]);

async function withRoom(fn) {
  const board = fleet.install(MEMBERS.map((n) => fleet.agent(n, { state: 'idle' })));
  try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }
  try {
    return await fn(board.snapshot ? board.snapshot() : board.roster);
  } finally {
    board.restore();
    chat.resetForTests();
    if (typeof messages.resetForTests === 'function') messages.resetForTests();
  }
}

/* The agent ava posts to the room; its members are the other three. One of them (cy) has a typing path that throws. */
function breakOne(roster, name, how) {
  const real = { a: chat.deliverAsync, s: chat.deliver, aa: chat.deliverAutomaticAsync, sa: chat.deliverAutomatic };
  const boom = (n, ...rest) => { if (n === name) { if (how === 'reject') return Promise.reject(new Error('typing into ' + n + ' broke')); throw new Error('typing into ' + n + ' broke'); } return null; };
  chat.deliverAsync = (n, ...rest) => boom(n) || real.a(n, ...rest);
  chat.deliverAutomaticAsync = (n, ...rest) => boom(n) || real.aa(n, ...rest);
  chat.deliver = (n, ...rest) => boom(n) || real.s(n, ...rest);
  chat.deliverAutomatic = (n, ...rest) => boom(n) || real.sa(n, ...rest);
  return () => Object.assign(chat, { deliverAsync: real.a, deliver: real.s, deliverAutomaticAsync: real.aa, deliverAutomatic: real.sa });
}
const agentPost = (roster, text, sync) => {
  const sender = { ok: true, card: roster.find((c) => c.sessionName === 'ava') };
  const members = roster.map((c) => c.sessionName);
  const input = { sender, project: 'room4926', projectName: 'Room', text };
  return sync ? messages.sendPost(input, roster, members) : messages.sendPostAsync(input, roster, members);
};
const rows = () => messages.list().filter((r) => r.kind === 'post' && r.project === 'room4926');

for (const how of ['reject', 'throw']) {
  test('#4926 (' + how + '): a post that reached the room is recorded and answered unconfirmed, never refused; a retry folds into it', async () => {
    await withRoom(async (roster) => {
      const calls = arm();
      const restore = breakOne(roster, 'cy', how);
      try {
        const d = await agentPost(roster, 'the build is green', false);
        assert.ok(!d.because || d.state !== chat.DELIVERY.COULD_NOT, 'refused: ' + d.because);
        assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'a post that reached two of three members was answered ' + d.state);
        assert.equal(d.outcomes.cy, chat.DELIVERY.UNCONFIRMED);
        assert.equal(rows().length, 1, 'the post was not recorded');
        const first = enters(calls).length;
        assert.equal(first, 2, 'fixture: bix and dee were not both typed into');
        // The sender, told "unconfirmed, do not re-post", posts it again anyway: the twin folds, nobody is typed into twice.
        const again = await agentPost(roster, 'the build is green', false);
        assert.equal(again.duplicate, true, 'the retry was posted a second time');
        assert.equal(enters(calls).length, first, 'a member was typed into twice');
        assert.equal(rows().length, 1, 'the retry was recorded as a second post');
      } finally { restore(); }
    });
  });
}

test('#4926: the synchronous path (outbox drain) records a post whose one member\'s typing threw, too', async () => {
  await withRoom(async (roster) => {
    arm();
    chat.setPauser(() => {});
    const restore = breakOne(roster, 'cy', 'throw');
    try {
      const d = await agentPost(roster, 'sync post', true);
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'answered ' + d.state + (d.because ? ': ' + d.because : ''));
      assert.equal(rows().length, 1, 'the post was not recorded');
    } finally { restore(); }
  });
});

test('#4926: a post where EVERY member\'s typing threw is recorded unconfirmed too (each may have been typed), so it is never re-posted blind', async () => {
  await withRoom(async (roster) => {
    arm();
    const restores = ['bix', 'cy', 'dee'].map((n) => breakOne(roster, n, 'throw'));
    try {
      const d = await agentPost(roster, 'nobody', false);
      // Each member's throw is "may have reached", so the post is recorded unconfirmed and the sender told not to re-post.
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED);
      assert.equal(rows().length, 1);
    } finally { restores.reverse().forEach((r) => r()); }
  });
});

const roomhold = require('./roomhold');
const withDeliverAuto = (fn) => { const real = { a: chat.deliverAutomaticAsync }; chat.deliverAutomaticAsync = fn(real.a); return () => { chat.deliverAutomaticAsync = real.a; }; };
const postAs = (roster, who, text, extra) => messages.sendPostAsync(Object.assign({ sender: { ok: true, card: roster.find((c) => c.sessionName === who) }, project: 'room4926', projectName: 'Room', text }, extra || {}), roster, roster.map((c) => c.sessionName));

test('#4926 review 1 (Opus): an answer to the member\'s OWN post held on the quota is kept as asking it (never dropped as stale)', async () => {
  await withRoom(async (roster) => {
    arm();
    roomhold.forget('bix');
    const mine = await postAs(roster, 'bix', 'which branch should I use?');
    assert.ok(mine.id, 'fixture: bix\'s question was not posted');
    // bix is now held on the shared quota: its automatic deliveries answer held.
    const restore = withDeliverAuto((real) => (n, ...rest) => (n === 'bix' ? Promise.resolve({ state: chat.DELIVERY.COULD_NOT, held: true }) : real(n, ...rest)));
    try {
      const ans = await postAs(roster, 'cy', 'use main', { replyTo: mine.id });
      assert.equal(ans.outcomes && ans.outcomes.bix, roomhold.HELD, 'fixture: the answer was not held for bix');
      assert.deepEqual(roomhold.heldIn('bix', 'room4926'), [roomhold.addressedId(ans.id)], 'the answer to bix\'s own question was held unmarked');
      // CONTROL: a plain post (no answer, no @) held on the quota is kept unmarked.
      const plain = await postAs(roster, 'cy', 'unrelated note');
      assert.ok(roomhold.heldIn('bix', 'room4926').includes(plain.id), 'control: a plain held post was marked');
    } finally { restore(); roomhold.forget('bix'); }
  });
});

test('#4926 review 1 (Opus): the held line riding a typed arrival leaves out a stale post and names a fresh one', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    roomhold.forget('dee');
    const before = await postAs(roster, 'cy', 'before the stop');   // real rows, so the record reader keeps them
    fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'valve', from: 'cy', to: 'room4926', project: 'room4926', at: new Date().toISOString(), because: 'loop', stopped: true }) + '\n');
    await new Promise((r) => setTimeout(r, 5));
    const after = await postAs(roster, 'cy', 'after the stop');
    roomhold.forget('dee');
    roomhold.hold('dee', 'room4926', before.id); roomhold.hold('dee', 'room4926', after.id);
    assert.deepEqual([...messages.staleHeld('room4926', [before.id, after.id])], [before.id], 'fixture: the stop did not make only the earlier post stale');
    calls.length = 0;
    await postAs(roster, 'ava', '@dee a question for you');
    const typed = calls.map((a) => a.join(' ')).join('\n');
    assert.ok(typed.includes('(' + after.id + ')'), 'fixture: the typed arrival carried no held line naming the fresh post (cannot see the drop)');
    assert.ok(!new RegExp('\\b' + before.id + '\\b').test(typed), 'a stale held post rode the arrival');
    roomhold.forget('dee');
  });
});

test('#4926 review 1 (Opus): a post the members got but the record could not take is answered unconfirmed, not refused', async () => {
  await withRoom(async (roster) => {
    arm();
    const real = fs.appendFileSync;
    fs.appendFileSync = (f, ...rest) => { if (f === messages.LOG) throw new Error('ENOSPC: no space left'); return real(f, ...rest); };
    let d;
    try { d = await agentPost(roster, 'cannot be recorded', false); } finally { fs.appendFileSync = real; }
    assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'answered ' + d.state);
    assert.match(String(d.because), /could not be recorded/);
  });
});

test('#4926 review 2 (Sonnet): a throw BEFORE the typing path (nothing typed) is could_not; every member that way is refused, no row', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    const real = roomhold.shouldHold;
    let broken = ['cy'];
    roomhold.shouldHold = (o) => { if (broken.includes(o.name)) throw new Error('lookup broke'); return real(o); };
    try {
      const d = await agentPost(roster, 'one member unreachable', false);
      assert.equal(d.outcomes.cy, chat.DELIVERY.COULD_NOT, 'a member nothing was typed into was recorded as maybe reached');
      assert.equal(enters(calls).length, 2, 'fixture: the other two were not typed into');
      assert.equal(rows().length, 1);
      broken = ['bix', 'cy', 'dee'];
      const none = await agentPost(roster, 'nobody reachable', false);
      assert.equal(none.state, chat.DELIVERY.COULD_NOT, 'a post typed to nobody was not refused: ' + none.state);
      assert.equal(rows().filter((r) => r.text && r.text.includes('nobody reachable')).length, 0, 'a post typed to nobody was recorded');
    } finally { roomhold.shouldHold = real; }
  });
});

test('#4926 review 2 (Sonnet): a re-post of a post that reached the room but could not be recorded folds; nobody is typed into twice', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    const real = fs.appendFileSync;
    fs.appendFileSync = (f, ...rest) => { if (f === messages.LOG) throw new Error('ENOSPC'); return real(f, ...rest); };
    try {
      const d = await agentPost(roster, 'unrecorded once', false);
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED);
      const typed = enters(calls).length;
      const again = await agentPost(roster, 'unrecorded once', false);
      assert.equal(again.duplicate, true, 'the re-post was sent again');
      assert.equal(enters(calls).length, typed, 'a member was typed into twice');
    } finally { fs.appendFileSync = real; }
  });
});

test('#4926 review 2 (Sonnet): a throw from the quoted-words pass after delivery does not turn a landed post into "refused"', async () => {
  await withRoom(async (roster) => {
    arm();
    const earlier = 'an earlier post by cy whose words the quote pass will read back';
    await postAs(roster, 'cy', earlier);
    const real = chat.cleanMessage;
    chat.cleanMessage = (t) => { if (t === earlier) throw new Error('quote pass broke'); return real(t); };
    let d;
    try { d = await agentPost(roster, 'a later post by ava', false); } finally { chat.cleanMessage = real; }
    assert.equal(d.state, chat.DELIVERY.PLACED, 'a landed post was answered ' + d.state);
    assert.ok(rows().some((r) => r.text === 'a later post by ava'), 'the post was not recorded');
  });
});

const opPost = (roster, text) => messages.sendPostAsync({ operator: true, project: 'room4926', projectName: 'Room', text }, roster, roster.map((c) => c.sessionName));
const failLogOnce = () => {
  const real = fs.appendFileSync;
  let failed = false;
  fs.appendFileSync = (f, ...rest) => { if (f === messages.LOG && !failed) { failed = true; throw new Error('ENOSPC'); } return real(f, ...rest); };
  return () => { fs.appendFileSync = real; };
};

test('#4926 review 4 (Sonnet): the PERSON\'s post that could not be recorded is NOT folded: a repeat is delivered (never swallowed)', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    const restore = failLogOnce();
    try {
      const d = await opPost(roster, 'from the person');
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED);
      const typed = enters(calls).length;
      const again = await opPost(roster, 'from the person');
      assert.ok(!again.duplicate, 'the person\'s repeat was swallowed (the page would say "Posted." for a post the room never shows)');
      assert.ok(enters(calls).length > typed, 'the person\'s repeat was not delivered');
    } finally { restore(); }
  });
});

test('#4926 review 3 (Opus): an unrecorded post\'s twin is forgotten once the room has spoken since, and after the window', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    let restore = failLogOnce();
    try { await agentPost(roster, 'said once', false); } finally { restore(); }
    await postAs(roster, 'cy', 'someone else spoke');   // recorded
    const before = enters(calls).length;
    const again = await agentPost(roster, 'said once', false);
    assert.ok(!again.duplicate, 'a repeat after the room spoke was folded');
    assert.ok(enters(calls).length > before, 'the repeat was not typed');
    // The window: past SEND_DEDUP_WINDOW_MS the twin is gone.
    restore = failLogOnce();
    try { await agentPost(roster, 'said twice', false); } finally { restore(); }
    const realNow = Date.now;
    Date.now = () => realNow() + messages.SEND_DEDUP_WINDOW_MS + 1000;
    let late;
    try { late = await agentPost(roster, 'said twice', false); } finally { Date.now = realNow; }
    assert.ok(!late.duplicate, 'a twin outlived the dedup window');
  });
});

test('#4926 review 3 (Opus): a member that fails after its long post was spilled but before typing keeps no inbox file', async () => {
  await withRoom(async (roster) => {
    arm();
    for (const n of MEMBERS) fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, n), { recursive: true });   // a spill needs the agent's own folder
    const real = roomhold.take;
    roomhold.take = (name, ...rest) => { if (name === 'cy') throw new Error('take broke'); return real(name, ...rest); };
    let d;
    try { d = await agentPost(roster, 'long '.repeat(200), false); } finally { roomhold.take = real; }
    assert.equal(d.outcomes.cy, chat.DELIVERY.COULD_NOT);
    const inbox = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'cy', 'Inbox');
    const left = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.startsWith(d.id)) : [];
    assert.deepEqual(left, [], 'cy kept a spill file for a post it never got');
    const bixInbox = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'bix', 'Inbox');
    assert.ok(fs.existsSync(bixInbox) && fs.readdirSync(bixInbox).some((f) => f.startsWith(d.id)), 'fixture: the post did not spill at all (cannot see the cleanup)');
  });
});

test('#4926 review 4 (Sonnet): a post that began while the unrecorded one was still being typed breaks its quiet', async () => {
  await withRoom(async (roster) => {
    arm();
    let restore = failLogOnce();
    let d;
    try { d = await agentPost(roster, 'slow one', false); } finally { restore(); }
    // A row whose START is after the unrecorded post's start but before it finished (its keptAt).
    const between = new Date(Date.parse(d.at) + 1).toISOString();
    fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id: 'm77', project: 'room4926', from: 'cy', to: ['ava'], text: 'meanwhile', at: between, outcomes: { ava: 'placed' } }) + '\n');
    assert.ok(messages.list().some((r) => r.id === 'm77'), 'fixture: the record reader dropped the meanwhile row');
    const again = await agentPost(roster, 'slow one', false);
    assert.ok(!again.duplicate, 'a repeat after a post that began meanwhile was folded');
  });
});

test('#4926 review 5 (Opus): the unrecorded twin\'s quiet: only this room breaks it; an outside party\'s reply does; the same millisecond does', async () => {
  await withRoom(async (roster) => {
    arm();
    const addRow = (row) => fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
    for (const [label, row, folds] of [
      ['another room', (at) => ({ kind: 'post', id: 'm81', project: 'elsewhere', from: 'cy', to: ['ava'], text: 'x', at, outcomes: { ava: 'placed' } }), true],
      ['the same millisecond', (at) => ({ kind: 'post', id: 'm82', project: 'room4926', from: 'cy', to: ['ava'], text: 'x', at, outcomes: { ava: 'placed' } }), false],
    ]) {
      const restore = failLogOnce();
      let d;
      try { d = await agentPost(roster, 'twin ' + label, false); } finally { restore(); }
      addRow(row(d.at));
      assert.ok(messages.list().some((r) => r.text === 'x' && r.at === d.at), 'fixture: the ' + label + ' row was dropped by the reader');
      const again = await agentPost(roster, 'twin ' + label, false);
      assert.equal(Boolean(again.duplicate), folds, label + ': the fold went the wrong way');
    }
  });
});

test('#4926 review 5 (Opus): an outside party\'s reply (an external row) in the room breaks the unrecorded twin\'s quiet', () => {
  const src = fs.readFileSync(path.join(__dirname, 'messages.js'), 'utf8');
  const at = src.indexOf('function unrecordedTwin(');
  assert.match(src.slice(at, at + 1200), /r\.kind === 'post' \|\| r\.kind === 'external'/, 'the twin\'s quiet no longer counts an outside party\'s reply');
});
