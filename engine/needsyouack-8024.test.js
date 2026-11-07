'use strict';
/**
 * kosmos#8024: opening an agent's chat acknowledges the needs-you pushes it holds, through the real routes.
 *
 *   node --test engine/needsyouack-8024.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ack-8024-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const state = mk('remote');
for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
fs.writeFileSync(path.join(state, 'phone-notify.json'), JSON.stringify({ on: true, notifyId: '11111111-2222-4333-8444-555555555555', token: 'knt1_needsyouack0123456789' }));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = state;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';   // never dialled: a sender is injected
delete process.env.KOSMOS_NO_PHONE_NOTICES;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('./remote');
fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
fs.writeFileSync(remote.FILE, JSON.stringify({ on: true }));
remote.macRequest = async () => ({ ok: false, notSent: true, because: 'no coordinator in this test' });
const pn = require('./phonenotify');
const posts = [];
const { start, server } = require('../server');
const fleet = require('../test-support/fleet');
const messages = require('./messages');
const nya = require('./needsyouack');
const chat = require('./chat');

let base;
test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
  pn.setAvailableForTests(true);
  pn.setSender((url, headers, body) => { posts.push({ url, body: JSON.parse(body) }); });
});
test.after(() => { server.close(); });

function withAgent(name, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: name + '-discord' }));
  return Promise.resolve().then(fn).finally(() => { messages.setRunner(null); board.restore(); });
}
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', ...body }) });
  assert.equal(res.status, 200, await res.clone().text());
}
const seen = (name, headers = { 'sec-fetch-site': 'same-origin' }) => fetch(base + '/api/agent/' + name + '/seen', { method: 'POST', headers });
const acks = () => posts.filter((p) => p.url.endsWith('/v1/mac/notify-ack'));

test('a report opened on the person\'s screen is acknowledged once, and only then', async () => {
  await withAgent('ack-open', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Which logo?' });
    assert.equal(acks().length, 0, 'unopened: nothing acknowledged');
    assert.equal(nya.due('ack-open'), true, 'control: the push was held to acknowledge');
    const r = await seen('ack-open');
    assert.equal(r.status, 200);
    assert.equal(acks().length, 1);
    assert.match(acks()[0].body.eventId, /^report:.*:ack-open$/);
    assert.equal(nya.due('ack-open'), false);
    await seen('ack-open');
    assert.equal(acks().length, 1, 'a second open sends nothing');
  });
});

test('an agent cannot acknowledge its own question: no person\'s screen, no ack, though the cursor moves', async () => {
  await withAgent('ack-self', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'May I merge?' });
    const r = await seen('ack-self', {});
    assert.equal(r.status, 200, 'the read cursor still answers as before');
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-self'), true);
  });
});

test('a tab in the background moves the cursor but acknowledges nothing', async () => {
  await withAgent('ack-hidden', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Are you there?' });
    const r = await fetch(base + '/api/agent/ack-hidden/seen?hidden=1', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(r.status, 200);
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-hidden'), true);
    await seen('ack-hidden');
    assert.equal(acks().length, 1, 'control: the same agent opened in view is acknowledged');
  });
});

test('another agent\'s open does not acknowledge this one, and an ordinary report holds nothing', async () => {
  await withAgent('ack-a', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'A question' });
    await seen('ack-other');
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-a'), true);
  });
  await withAgent('ack-plain', async () => {
    await report({ state: 'working', text: 'at it' });
    assert.equal(nya.due('ack-plain'), false);
  });
});

test('a held question sends no push, so it holds nothing to acknowledge', async () => {
  await withAgent('ack-held', async () => {
    await report({ state: 'needs_you', text: 'Later', held: true });
    assert.equal(nya.due('ack-held'), false);
  });
});

test('the board and the phone both fire on a due ack, not only on unread replies', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes("if (dmRec && (dmRec.dmUnread > 0 || (dmRec.openAckDue === true && !dmHidden))) {"));
  assert.ok(page.includes('if (!dmHidden) dmRec.openAckDue = false;'), 'zeroed, or every poll while the chat is open re-fires');
  assert.ok(page.includes("(dmHidden ? '?hidden=1' : '')"), 'a tab in the background says so');
  const chat = fs.readFileSync(path.join(__dirname, '..', 'ios', 'Kosmos', 'ChatView.swift'), 'utf8');
  assert.ok(chat.includes('guard visible, unreadHere > 0 || ackDue, !seenInFlight else { return }'));
});

test('kosmos#8036: a permission wait that passes unopened leaves one line and an ack; one opened first leaves neither', async () => {
  await withAgent('wait-gone', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'asking permission to use Bash: rm -rf /Users/someone/secret', auto: true });
    assert.equal(nya.due('wait-gone'), true, 'control: its push went out and is held');
    assert.equal(acks().length, 0);
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 1, 'over: the coordinator is told, so no email');
    assert.match(acks()[0].body.eventId, /^report:.*:wait-gone$/);
    assert.equal(nya.due('wait-gone'), false);
    const rows = chat.readThread(chat.DIRECT, 'wait-gone').messages;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, nya.WAIT_ENDED_LINE);
    assert.equal(rows[0].kosmos, true, 'nothing owed');
    assert.doesNotMatch(rows[0].text, /secret|rm -rf/, 'the hook\'s words never reach the chat');
    await report({ state: 'idle', text: 'done', auto: true });
    assert.equal(chat.readThread(chat.DIRECT, 'wait-gone').messages.length, 1, 'once');
  });
  await withAgent('wait-twice', async () => {   // review 1: a hook firing twice is normal
    posts.length = 0;
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ls', auto: true });
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ls', auto: true });
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 1, 'the one push is acknowledged though the wait was reported twice');
    assert.equal(chat.readThread(chat.DIRECT, 'wait-twice').messages.length, 1);
  });
  await withAgent('wait-cooled', async () => {   // the phone's cooldown: the wait's push never went out, so nothing is said of it
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Which logo?' });
    await report({ state: 'working', text: 'back at it' });
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ls', auto: true });
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 0);
    assert.equal(chat.readThread(chat.DIRECT, 'wait-cooled').messages.length, 0);
    assert.equal(nya.due('wait-cooled'), true, 'the question is still held for the person');
  });
  await withAgent('wait-seen', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ls', auto: true });
    await seen('wait-seen');
    assert.equal(acks().length, 1, 'control: opened, acknowledged then');
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 1);
    assert.equal(chat.readThread(chat.DIRECT, 'wait-seen').messages.length, 0, 'they saw it: no line');
  });
  await withAgent('ask-real', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Which logo?' });
    await report({ state: 'working', text: 'back at it' });
    assert.equal(acks().length, 0, 'an agent\'s own question is not this');
    assert.equal(chat.readThread(chat.DIRECT, 'ask-real').messages.length, 0);
  });
});

test('kosmos#8036: a wait that ended takes only its own pushes, never an agent question held beside it', () => {
  nya.remember('s8', 'question', 1000);
  nya.remember('s8', 'wait', 1100, { autoWait: true });
  const got = [];
  assert.equal(nya.ended('s8', (id) => { got.push(id); return true; }, 2000), true);
  assert.deepEqual(got, ['wait']);
  assert.equal(nya.due('s8', 2000), true, 'the question is still held');
  assert.equal(nya.ended('s8', () => { throw new Error('no wait is held'); }, 2100), false);
});

test('kosmos#8036: an ack that cannot go still says the line once, and is kept for the next open', () => {
  nya.remember('s9', 'w1', 1000, { autoWait: true });
  assert.equal(nya.ended('s9', () => false, 2000), true);
  assert.equal(nya.ended('s9', () => { throw new Error('asked twice'); }, 3000), false, 'said once');
  let got = 0;
  assert.equal(nya.opened('s9', () => { got++; return true; }, 4000), 1, 'the next open sends it');
  assert.equal(got, 1);
});

test('the store: a failed hand-over is kept, a week is the limit, and each agent keeps a few', () => {
  nya.remember('s1', 'one', 1000);
  assert.equal(nya.opened('s1', () => false, 2000), 0);
  assert.equal(nya.due('s1', 2000), false, 'not reached: not due again at once, or every poll would POST');
  assert.equal(nya.due('s1', 2000 + nya.RETRY_MS), true, 'and due again later');
  let again = 0;
  assert.equal(nya.opened('s1', () => { again++; return true; }, 3000), 1, 'a later open still sends it');
  assert.equal(again, 1);
  nya.remember('s1', 'one', 1000);
  assert.equal(nya.due('s1', 1000 + nya.KEEP_MS), false, 'past a week: dropped');
  for (let i = 0; i < nya.KEEP_PER_AGENT + 3; i++) nya.remember('s2', 'id' + i, 5000 + i);
  const got = [];
  assert.equal(nya.opened('s2', (id) => { got.push(id); return true; }, 6000), nya.KEEP_PER_AGENT);
  assert.ok(got.includes('id' + (nya.KEEP_PER_AGENT + 2)) && !got.includes('id0'), 'the newest are the ones kept');
  assert.equal(nya.opened('nobody', () => { throw new Error('never asked'); }, 6000), 0);
  fs.writeFileSync(nya.file(), 'not json');
  assert.equal(nya.due('s1', 2000), false, 'an unreadable file holds nothing, and does not throw');
  nya.remember('s3', 'three', 7000);
  assert.equal(nya.due('s3', 7000), true, 'and is written fresh');
});

/* kosmos#8036, Josh's iPhone 11-06 20:25: a press on a live permission prompt, through the real routes and a real captured prompt.
   withPrompt: the agent reports the hook's wait over a pane showing the prompt; `afterKey` is what the pane shows once a digit lands. */
const selfreport = require('./selfreport');
const PROMPT = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const NEXT_PROMPT = PROMPT.replace(' /usr/bin/uuidgen\n╌', ' /usr/bin/whoami\n╌');
const IDLE_SCREEN = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';
async function withPrompt(name, { screen = PROMPT, afterKey = IDLE_SCREEN, onKey = null, reportFirst }, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle', runner: 'claude', command: 'claude' })]);
  messages.setRunner(() => ({ ok: true, session: name + '-discord' }));
  let shown = screen;
  const keys = [];
  chat.setRunner((args) => {
    const done = (out) => ({ ran: true, spawnFailed: false, status: 0, out: out || '', err: '' });
    if (args[0] === 'display-message') return done('2.1.296\t\t0\n');
    if (args[0] === 'capture-pane') return done(shown);
    if (args[0] === 'send-keys' && /^\d$/.test(args[args.length - 1])) { keys.push(args[args.length - 1]); shown = afterKey; if (onKey) onKey(); }
    return done();
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  try {
    posts.length = 0;
    await reportFirst();
    const read = async () => (await fetch(base + '/api/agent/' + name + '/thread', { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    const press = async (which = 'allow') => {
      const back = await read();
      const row = (back.messages || []).filter((m) => m && m.kind === 'question' && !m.reported && m.permission).pop();
      assert.ok(row && back.asked, 'premise: the thread serves a permission card: ' + JSON.stringify(back.messages));
      const res = await fetch(base + '/api/agent/' + name + '/thread', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ text: String(row.permission[which]), chose: back.options.find((o) => o.n === row.permission[which]).label, asked: back.asked, request: row.permission.request }) });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(keys.length, 1, 'premise: the key went');
    };
    return await fn({ read, press, keys, setShown: (s) => { shown = s; } });
  } finally { chat.resetForTests(); messages.setRunner(null); board.restore(); }
}
const hookWait = () => report({ state: 'needs_you', text: 'asking permission to use Bash: /usr/bin/uuidgen', auto: true });
const questionRows = (t) => (t.messages || []).filter((m) => m && m.kind === 'question');

test('kosmos#8036: a press that closes the prompt ends the wait at once: no "asked you something" under his Yes, no line after', async () => {
  await withPrompt('pressed', { reportFirst: hookWait }, async ({ read, press }) => {
    assert.equal(nya.due('pressed'), true, 'control: its push is held');
    await press();
    const after = await read();
    assert.deepEqual(questionRows(after), [], 'the row the phone draws as "asked you something"');
    assert.equal(after.asking, false);
    assert.equal(selfreport.read('pressed').state, 'idle');
    assert.equal(nya.due('pressed'), false, 'its push went with it');
    assert.equal(acks().length, 1, 'the coordinator is told, so no email');
    await report({ state: 'working', text: 'running Bash', auto: true });
    const words = chat.readThread(chat.DIRECT, 'pressed').messages.map((m) => m.text);
    assert.ok(!words.includes(nya.WAIT_ENDED_LINE), 'they answered it, so it did not pass by itself: ' + JSON.stringify(words));
  });
});

test('kosmos#8036: a No ends the wait too, and the agent left at its prompt does not read as working', async () => {
  await withPrompt('denied', { reportFirst: hookWait }, async ({ read, press }) => {
    await press('deny');
    const after = await read();
    assert.deepEqual(questionRows(after), []);
    assert.equal(after.asking, false);
    const card = require('./status').snapshot().agents.find((a) => a.sessionName === 'denied');
    assert.equal(card.state, 'idle', JSON.stringify(card.because));
  });
});

test('kosmos#8036 premise (#1995, no press here): a screen showing it running outranks a reported idle', async () => {
  const board = fleet.install([fleet.agent('stillgoing', { state: 'working', runner: 'claude', command: 'claude' })]);
  try {
    assert.equal(selfreport.record('stillgoing', { state: 'idle', because: 'its prompt was answered', auto: true }).recorded, true);
    assert.equal(require('./status').snapshot().agents.find((a) => a.sessionName === 'stillgoing').state, 'working');
  } finally { board.restore(); }
});

test('kosmos#8036 CONTROL: with no press, the same gone-from-screen wait still shows its words (#2456), so the case above shows the fix', async () => {
  await withPrompt('notpressed', { reportFirst: hookWait }, async ({ read, setShown }) => {
    setShown(IDLE_SCREEN);
    const after = await read();
    assert.equal(questionRows(after).length, 1);
    assert.equal(selfreport.read('notpressed').state, 'needs_you');
  });
});

test('kosmos#8036: the next prompt already up after the press keeps the wait', async () => {
  await withPrompt('nextup', { afterKey: NEXT_PROMPT, reportFirst: hookWait }, async ({ read, press }) => {
    await press();
    assert.equal(selfreport.read('nextup').state, 'needs_you');
    assert.equal(questionRows(await read()).length, 1);
  });
});

test('kosmos#8036: a newer report written during the press stands, though the screen reads clear', async () => {
  const later = () => {
    selfreport.record('during', { state: 'needs_you', because: 'asking permission to use Bash: /usr/bin/whoami', auto: true });
  };
  await withPrompt('during', { onKey: later, reportFirst: hookWait }, async ({ press }) => {
    await press();
    const now = selfreport.read('during');
    assert.equal(now.state, 'needs_you');
    assert.match(now.because, /whoami/);
  });
});

test('kosmos#8036: a press on another menu does not end a permission wait standing beside it', async () => {
  const menu = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');
  await withPrompt('othermenu', { screen: menu, reportFirst: hookWait }, async ({ read, keys }) => {
    const back = await read();
    assert.ok(back.asked && back.options && back.options.length, 'premise: the thread offers the menu: ' + JSON.stringify(back.options));
    const res = await fetch(base + '/api/agent/othermenu/thread', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ text: String(back.options[0].n), chose: back.options[0].label, asked: back.asked }) });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(keys.length, 1, 'premise: the press went to the menu as a key');
    assert.equal(selfreport.read('othermenu').state, 'needs_you');
  });
});

const endedLines = (name) => chat.readThread(chat.DIRECT, name).messages.filter((m) => m.text === nya.WAIT_ENDED_LINE).length;
test('kosmos#8036: a report landing while the press settles says no line either, and the push is still acknowledged', async () => {
  let landed = null;
  await withPrompt('settling', { onKey: () => { landed = report({ state: 'idle', text: 'finished responding', auto: true }); }, reportFirst: hookWait }, async ({ press }) => {
    await press('deny');
    await landed;
    assert.equal(selfreport.read('settling').state, 'idle');
    assert.equal(endedLines('settling'), 0);
    assert.equal(nya.due('settling'), false);
    assert.equal(acks().length, 1);
  });
});

test('kosmos#8036: a press still unconfirmed says no line when the wait then ends', async () => {
  await withPrompt('slowdraw', { afterKey: PROMPT, reportFirst: hookWait }, async ({ press }) => {
    await press();
    await report({ state: 'working', text: 'running Bash', auto: true });
    assert.equal(endedLines('slowdraw'), 0);
    assert.equal(nya.due('slowdraw'), false);
  });
});

test('kosmos#8036: a press names only its own wait: the next wait passing by itself still says the line', async () => {
  await withPrompt('nextwait', { afterKey: PROMPT, reportFirst: hookWait }, async ({ press }) => {
    await press();
    await new Promise((r) => setTimeout(r, 5));
    await report({ state: 'needs_you', text: 'asking permission to use Bash: /usr/bin/whoami', auto: true });
    nya.remember('nextwait', 'report:later:nextwait', undefined, { autoWait: true });
    await report({ state: 'working', text: 'running Bash', auto: true });
    assert.equal(endedLines('nextwait'), 1);
  });
});

test('kosmos#8036: a press that blew up did not answer the wait, so its passing still says the line', async () => {
  const realAnswer = chat.answerQuestionMenu;
  await withPrompt('blewup', { reportFirst: hookWait }, async ({ read }) => {
    const back = await read();
    const row = questionRows(back).pop();
    chat.answerQuestionMenu = async () => { throw new Error('the pane went away'); };
    try {
      const res = await fetch(base + '/api/agent/blewup/thread', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ text: String(row.permission.allow), chose: back.options.find((o) => o.n === row.permission.allow).label, asked: back.asked, request: row.permission.request }) });
      assert.notEqual(res.status, 200, 'premise: the press failed');
    } finally { chat.answerQuestionMenu = realAnswer; }
    await report({ state: 'working', text: 'running Bash', auto: true });
    assert.equal(endedLines('blewup'), 1);
  });
});

test('kosmos#8036: a press does not close a question the agent reported itself', async () => {
  const own = () => report({ state: 'needs_you', text: 'Which logo do you want?' });
  await withPrompt('ownq', { reportFirst: own }, async ({ press }) => {
    await press();
    const now = selfreport.read('ownq');
    assert.equal(now.state, 'needs_you');
    assert.equal(now.because, 'Which logo do you want?');
  });
});

test('kosmos#8036: a second wait does not repeat the line under itself; a row between lets it speak', async () => {
  await withAgent('twowaits', async () => {
    posts.length = 0;
    /* Each wait's push marked by hand: the phone's cooldown would send no second push, and with no mark there is no line to repeat. */
    let n = 0;
    const wait = async () => {
      await hookWait();
      nya.remember('twowaits', 'report:' + (++n) + ':twowaits', undefined, { autoWait: true });
      await report({ state: 'working', text: 'running a tool', auto: true });
    };
    const said = () => chat.readThread(chat.DIRECT, 'twowaits').messages.filter((m) => m.text === nya.WAIT_ENDED_LINE).length;
    await wait();
    assert.equal(said(), 1, 'control: the first one speaks');
    await wait();
    assert.equal(said(), 1, 'the same sentence again under itself');
    assert.equal(nya.due('twowaits'), false, 'the second push is still acknowledged');
    chat.appendMessage(chat.DIRECT, 'twowaits', { text: 'hello', at: new Date().toISOString() });
    await wait();
    assert.equal(said(), 2, 'a row between: this one is news again');
  });
});

test('kosmos#8036: a press still unconfirmed (the same prompt on screen) keeps the wait', async () => {
  await withPrompt('stillup', { afterKey: PROMPT, reportFirst: hookWait }, async ({ read, press }) => {
    await press();
    assert.equal(selfreport.read('stillup').state, 'needs_you');
    assert.equal(nya.due('stillup'), true);
    assert.equal(questionRows(await read()).length, 1);
  });
});
