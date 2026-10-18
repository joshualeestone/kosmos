'use strict';

/**
 * #718: phone notifications, driven through the real board. What is guarded:
 *   - OFF by default, and while off NOTHING leaves the Mac: a counting sender
 *     sees zero sends for a needs_you and a reply, and the tunnel is never run.
 *     The same actions DO send once on (the control), so the zero is not vacuous.
 *   - Turning on mints the notify token through the tunnel's mac-request verb,
 *     with the body on stdin (never argv), and the token is never returned.
 *   - While on: a needs_you sends once on the change into needs_you (a repeat
 *     does not buzz again), a reply sends as `replied`, and the payload is
 *     exactly the coordinator's fields. The report's and the reply's words never
 *     leave.
 *   - The id sent is push's own, never ping.installId().
 *   - Turning off stops sending at once; a Mac not connected to Kosmos+ cannot
 *     turn it on.
 *
 *   node --test server.phonenotify-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-718pn-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const STATE = path.join(SANDBOX, 'remote');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test/kosmos';

// A fake tunnel binary: records its argv and stdin, answers a minted token.
const TUNNEL_LOG = path.join(SANDBOX, 'tunnel.log');
const FAKE_TUNNEL = path.join(SANDBOX, 'fake-kosmos-tunnel');
const MINTED = 'knt1_testtoken0123456789';
/* The record every fake tunnel writes for a call: mints() counts "ARGV: mac-request" in it (#4136: one copy). It is
   ONE printf, so one append: written piece by piece, two tunnels running at once interleaved their pieces
   ("ARGV:ARGV: mac-request ...") and the count read one mint where there were two. */
const LOG_CALL = `in=$(cat); printf 'ARGV:%s\\nSTDIN:%s\\n' "$(printf ' %s' "$@")" "$in" >> "${TUNNEL_LOG}"`;
/* Waits (up to about 60s) for a gate file before answering, so a test can hold a mint open (#4136). */
const WAIT_GATE = (gate) => `n=0; while [ ! -f "${gate}" ] && [ $n -lt 3000 ]; do sleep 0.02; n=$((n + 1)); done`;
fs.writeFileSync(FAKE_TUNNEL, `#!/bin/bash
${LOG_CALL}
printf '{"token":"${MINTED}"}\\n'
`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const phonenotify = require('./engine/phonenotify');
const ping = require('./engine/ping');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');

const WHO = 'leo';
let base;
const sent = [];

function enrol() {
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
}
function unenrol() { fs.rmSync(STATE, { recursive: true, force: true }); }

test.before(async () => {
  phonenotify.setAvailableForTests(true);   // the ship gate is covered in server.phonenotify-gate-718.test.js
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
  phonenotify.setSender((url, headers, body) => sent.push({ url, headers, body: JSON.parse(body) }));
});
test.after(() => {
  phonenotify.setSender(null);
  phonenotify.setClock(null);
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
let fakeNow = 1e12;
test.beforeEach(() => {
  sent.length = 0;
  phonenotify.resetCooldownForTests();
  fakeNow += 60 * 60 * 1000;
  phonenotify.setClock(() => fakeNow);
  unenrol();
  fs.rmSync(TUNNEL_LOG, { force: true });
  try { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); } catch { /* not there */ }
  try { fs.rmSync(sendertoken.DIR, { recursive: true, force: true }); } catch { /* not there */ }
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  const tok = sendertoken.mint(WHO).token;
  return Promise.resolve().then(() => fn({ 'x-kosmos-agent-token': tok }))
    .finally(() => { sendertoken.revoke(WHO); messages.setRunner(null); board.restore(); });
}
const report = (h, state) => call('POST', '/api/report', { headers: h, body: { state, text: 'THE REPORT WORDS' } });
const reply = (h) => call('POST', '/api/reply', { headers: h, body: { text: 'THE REPLY WORDS' } });

test('OFF by default: nothing is sent and the tunnel never runs', async () => {
  enrol();
  const st = await call('GET', '/api/phone-notify');
  assert.equal(st.json.on, false, 'phone notifications must start off');
  assert.equal(st.json.connected, true);
  await withLeo(async (h) => {
    assert.equal((await report(h, 'needs_you')).json.recorded, true);
    assert.equal((await reply(h)).json.kept, true);
  });
  assert.equal(sent.length, 0, 'something left the Mac while phone notifications were off');
  assert.equal(fs.existsSync(TUNNEL_LOG), false, 'the tunnel ran while off');
});

test('OFF even with a token on disk: only an explicit on:true sends', async () => {
  enrol();
  // A token is held but the switch was never set, or the file is not a plain object.
  await withLeo(async (h) => {
    for (const content of [JSON.stringify({ notifyId: 'n1', token: 'knt1_heldtoken0123' }), '[1]', 'not json']) {
      fs.writeFileSync(path.join(STATE, 'phone-notify.json'), content);
      await report(h, 'needs_you'); await report(h, 'working'); await reply(h);
    }
  });
  assert.equal(sent.length, 0, 'sent without an explicit on:true');
});

test('turning on mints through mac-request, body on stdin, token never returned', async () => {
  enrol();
  const on = await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(on.code, 200, on.text);
  assert.equal(on.json.on, true);
  assert.doesNotMatch(on.text, /knt1_/, 'the token leaked into the response');
  assert.deepEqual(Object.keys(on.json).sort(), ['available', 'connected', 'kinds', 'on'], 'the setting answer carries more than it should');
  const log = fs.readFileSync(TUNNEL_LOG, 'utf8');
  assert.match(log, /ARGV: mac-request --coordinator https:\/\/coord\.example\.test\/kosmos --state-dir \S+ --method POST --path \/v1\/mac\/notify-credential\n/);
  const stdin = JSON.parse(log.split('STDIN:')[1]);
  assert.match(stdin.install_id, /^[0-9a-f-]{36}$/, 'the credential is not bound to a random push id');
  assert.notEqual(stdin.install_id, ping.installId(), 'push reused the install id promised never to leave the Mac');
  assert.doesNotMatch(log.split('STDIN:')[0], /install_id/, 'the body went on argv');
});

test('ON: needs_you sends once per change into it, reply sends replied, never the words', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  await withLeo(async (h) => {
    await report(h, 'needs_you');
    await report(h, 'needs_you');   // still waiting: no second buzz
    assert.equal(sent.length, 1, 'a repeat needs_you buzzed again');
    await report(h, 'working');
    fakeNow += phonenotify.NEEDS_YOU_COOLDOWN_MS + 1;
    await report(h, 'needs_you');   // a new wait, past the cooldown: buzz
    assert.equal(sent.length, 2, 'a new needs_you after working did not send');
    await reply(h);
    assert.equal(sent.length, 3, 'a reply did not send');
  });
  const [first, , third] = sent;
  assert.equal(first.url, 'https://coord.example.test/kosmos/v1/mac/notify');
  assert.equal(first.headers['x-kosmos-notify-token'], MINTED);
  assert.deepEqual(Object.keys(first.body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'projectId', 'session']);
  assert.equal(first.body.kind, 'needs_you');
  assert.match(first.body.id, /^report:\d{4}-\d\d-\d\dT/, 'the unique part of the event id is not first, so a long session name could cut it off');
  assert.match(third.body.id, /^reply:\d{4}-\d\d-\d\dT/);
  assert.equal(first.body.session, WHO);
  assert.equal(third.body.kind, 'replied');
  const all = JSON.stringify(sent);
  assert.doesNotMatch(all, /THE REPORT WORDS|THE REPLY WORDS/, 'message words left the Mac');
  assert.equal(first.body.installId, phonenotify.readState().notifyId);
  assert.notEqual(first.body.installId, ping.installId());
});

test('at most one needs_you buzz per agent within the cooldown', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  await withLeo(async (h) => {
    assert.equal(phonenotify.NEEDS_YOU_COOLDOWN_MS, 5 * 60 * 1000);
    await report(h, 'needs_you');
    await report(h, 'working');
    fakeNow += 4 * 60 * 1000;       // fixed times, not derived from the constant under test
    await report(h, 'needs_you');   // a new wait, but inside the cooldown
    assert.equal(sent.length, 1, 'a second needs_you inside the cooldown buzzed');
    await report(h, 'working');
    fakeNow += 2 * 60 * 1000;
    await report(h, 'needs_you');   // past it
    assert.equal(sent.length, 2, 'a needs_you after the cooldown did not send');
    await reply(h);                 // replies are not rate-limited
    assert.equal(sent.length, 3);
  });
});

test('needs_you names the project it stands under, carried forward when the report names none', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const p = projects.create({ name: 'Henderson lease' });
  await withLeo(async (h) => {
    await call('POST', '/api/report', { headers: h, body: { state: 'working', project: p.id, text: 'x' } });
    await report(h, 'needs_you');   // no project on this report
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.project, 'Henderson lease');
});

test('#6254: a kind whose sub-switch is off sends nothing of that kind, the master on', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  // needsYou off: a needs_you report does not buzz; replied (its switch still on) does.
  const off = await call('PUT', '/api/phone-notify', { body: { kind: 'needsYou', on: false } });
  assert.equal(off.code, 200, off.text);
  assert.equal(off.json.kinds.needsYou, false, 'the needsYou sub-switch did not turn off');
  assert.equal(off.json.kinds.replied, true, 'another kind was turned off by mistake');
  await withLeo(async (h) => {
    await report(h, 'needs_you');
    assert.equal(sent.length, 0, 'needs_you buzzed with its switch off');
    await reply(h);
    assert.equal(sent.length, 1, 'replied did not buzz with its switch on');
    // replied off too (a plain PUT, no agent header needed): now neither buzzes, master still on.
    await call('PUT', '/api/phone-notify', { body: { kind: 'replied', on: false } });
    sent.length = 0;
    await report(h, 'working'); await report(h, 'needs_you'); await reply(h);
    assert.equal(sent.length, 0, 'a kind buzzed with its switch off');
  });
  // an unknown kind name is refused, and defaults persist unreadable-as-default.
  const bad = await call('PUT', '/api/phone-notify', { body: { kind: 'nope', on: true } });
  assert.equal(bad.code, 400, bad.text);
  const st = await call('GET', '/api/phone-notify');
  assert.equal(st.json.kinds.ready, true, 'ready lost its default');
  assert.equal(st.json.kinds.postedRoom, false, 'postedRoom default is off');
  // a kind field that is NOT a string is still routed to setKind (-> 400), never falling through
  // to the master turn-off: a malformed `{ kind, on }` must not silently disable the feature.
  const badType = await call('PUT', '/api/phone-notify', { body: { kind: 5, on: false } });
  assert.equal(badType.code, 400, badType.text);
  const st2 = await call('GET', '/api/phone-notify');
  assert.equal(st2.json.on, true, 'a non-string kind fell through to the master path and turned it off');
});

/* #6254: `ready` through the REAL built route. An agent marking a task built is work waiting for the person's
   check, so it buzzes once; the person's own mark from the screen and a clear do not, and the `ready` sub-switch
   silences it. leo is solo on each task, so tellBuiltMark (the #6330 seam this send-site sits beside) tells nobody
   and the only thing to count is the ready buzz. sent is reset between arms, so each assertion stands alone. */
test('#6254 ready: an agent built mark buzzes ready once; a screen mark, a clear, and the switch off do not', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  const roster = board.agents;
  const tok = sendertoken.mint(WHO).token;
  const h = { 'x-kosmos-agent-token': tok };
  try {
    const p = projects.create({ name: 'Delivery run' });
    projects.addAgent(p.id, WHO, roster);
    const newTask = (s) => tasks.create(p.id, { sentence: s, who: WHO }).number;
    const built = (n, body = {}, headers = h) => call('POST', `/api/project/${p.id}/task/${n}/built`, { headers, body });

    // 1) An agent's own mark buzzes ready once, with the payload the coordinator expects and no task words.
    sent.length = 0;
    const n1 = newTask('Draft the invoice');
    const r1 = await built(n1);
    assert.equal(r1.json.changed, true, r1.text);
    assert.equal(sent.length, 1, 'an agent built mark did not buzz ready');
    assert.equal(sent[0].body.kind, 'ready');
    assert.equal(sent[0].body.session, WHO);
    assert.equal(sent[0].body.project, 'Delivery run');
    assert.match(sent[0].body.id, /^built:/, 'the ready event id does not start with its own unique part');
    assert.deepEqual(Object.keys(sent[0].body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'projectId', 'session']);
    assert.equal(sent[0].body.text, undefined, 'the task words left the Mac');

    // 2) The person's own mark from the screen does not buzz (viaScreen). Past any cooldown, so a zero is the gate.
    fakeNow += phonenotify.READY_COOLDOWN_MS + 1;
    sent.length = 0;
    const n2 = newTask('Print the labels');
    const r2 = await built(n2, {}, { 'sec-fetch-site': 'same-origin' });
    assert.equal(r2.json.changed, true, 'control: the screen mark did change the task: ' + r2.text);
    assert.equal(sent.length, 0, 'a built mark from the screen buzzed');

    // 3) A clear does not buzz. The agent builds a fresh task (buzzes), then clears it; only the clear is counted.
    fakeNow += phonenotify.READY_COOLDOWN_MS + 1;
    const n3 = newTask('Weigh the parcel');
    await built(n3);
    fakeNow += phonenotify.READY_COOLDOWN_MS + 1;
    sent.length = 0;
    const cleared = await built(n3, { clear: true });
    assert.equal(cleared.json.changed, true, 'control: the clear did change the task: ' + cleared.text);
    assert.equal(sent.length, 0, 'a clear buzzed ready');

    // 4) With the ready sub-switch off, an agent built mark does not buzz; the master stays on.
    await call('PUT', '/api/phone-notify', { body: { kind: 'ready', on: false } });
    fakeNow += phonenotify.READY_COOLDOWN_MS + 1;
    sent.length = 0;
    const n4 = newTask('File the receipt');
    const r4 = await built(n4);
    assert.equal(r4.json.changed, true, r4.text);
    assert.equal(sent.length, 0, 'ready buzzed with its switch off');

    // CONTROL: ready back on, a fresh mark buzzes again (the zero above was the switch, not a stuck cooldown).
    await call('PUT', '/api/phone-notify', { body: { kind: 'ready', on: true } });
    fakeNow += phonenotify.READY_COOLDOWN_MS + 1;
    sent.length = 0;
    await built(newTask('Post the parcel'));
    assert.equal(sent.length, 1, 'ready did not buzz after its switch went back on');
  } finally {
    sendertoken.revoke(WHO); board.restore();
  }
});

/* #6254: the `posted` kind's gating and coalescing, against phonenotify.happened directly (the /api/post room
   fixture is heavy; the route's wiring to this seam is pinned in the next test, the convention this file's
   siblings use for that route). A post that NAMES the person is postedMention (on by default); any other room
   post is postedRoom (off by default, and per-ROOM capped so a busy opted-in room cannot flood the phone). No
   post's words are ever passed: the payload has no text field at all. */
test('#6254 posted: a names-you post buzzes by default; any other room post waits on postedRoom, then coalesces per room; the switches gate it; no words leave', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const ev = (over) => ({ kind: 'posted', id: 'post:e', agent: 'leo', session: 'leo', project: 'Room A', ...over });

  // A post that names the person: postedMention is on by default -> buzz, with the coordinator payload and no words.
  sent.length = 0;
  phonenotify.happened(ev({ namesPerson: true, id: 'post:m1' }));
  assert.equal(sent.length, 1, 'a names-you post did not buzz under the default postedMention');
  assert.equal(sent[0].body.kind, 'posted');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'projectId', 'session']);
  assert.equal(sent[0].body.text, undefined, 'a post\'s words left the Mac');

  // postedMention off: a names-you post goes silent.
  await call('PUT', '/api/phone-notify', { body: { kind: 'postedMention', on: false } });
  sent.length = 0;
  phonenotify.happened(ev({ namesPerson: true, id: 'post:m2' }));
  assert.equal(sent.length, 0, 'a names-you post buzzed with postedMention off');
  await call('PUT', '/api/phone-notify', { body: { kind: 'postedMention', on: true } });

  // Any OTHER room post: postedRoom is off by default -> silent.
  sent.length = 0;
  phonenotify.happened(ev({ namesPerson: false, id: 'post:m3' }));
  assert.equal(sent.length, 0, 'an ordinary room post buzzed with postedRoom off');

  // Turn postedRoom on: it buzzes, but at most once per room per window; a different room is its own count.
  await call('PUT', '/api/phone-notify', { body: { kind: 'postedRoom', on: true } });
  sent.length = 0;
  phonenotify.happened(ev({ namesPerson: false, id: 'post:m4', project: 'Room A' }));
  assert.equal(sent.length, 1, 'postedRoom on did not buzz');
  phonenotify.happened(ev({ namesPerson: false, id: 'post:m5', project: 'Room A' }));   // same room, inside the window
  assert.equal(sent.length, 1, 'a second post in the same room buzzed inside the coalesce window');
  phonenotify.happened(ev({ namesPerson: false, id: 'post:m6', project: 'Room B' }));   // a different room
  assert.equal(sent.length, 2, 'a post in a different room did not buzz (the cap is per room, not global)');
  fakeNow += phonenotify.POSTED_ROOM_COOLDOWN_MS + 1;
  phonenotify.happened(ev({ namesPerson: false, id: 'post:m7', project: 'Room A' }));   // past the per-room window
  assert.equal(sent.length, 3, 'Room A did not buzz again past the coalesce window');

  // The per-room window keys on the UNIQUE project id, not the display name, so two rooms that
  // happen to share a name keep separate windows; posts to the same id still coalesce.
  fakeNow += phonenotify.POSTED_ROOM_COOLDOWN_MS + 1;
  sent.length = 0;
  phonenotify.happened(ev({ namesPerson: false, id: 'post:i1', project: 'Shared name', projectId: 'p-alpha' }));
  phonenotify.happened(ev({ namesPerson: false, id: 'post:i2', project: 'Shared name', projectId: 'p-beta' }));
  assert.equal(sent.length, 2, 'two rooms sharing a display name but with distinct ids were coalesced into one window');
  phonenotify.happened(ev({ namesPerson: false, id: 'post:i3', project: 'Shared name', projectId: 'p-alpha' }));   // same id, inside its window
  assert.equal(sent.length, 2, 'a second post to the same project id buzzed inside its window');
});

/* #6254: the /api/post route's wiring to the posted seam (the behavioral gating is proven above; a full room
   fixture that seeds an operator post to reply to is heavy, the same tradeoff server.agent-token-sender-570
   records for this route). Pins that the route fires the notification AFTER the response, keyed on the delivery's
   repliesToPerson, in a catch that can never fail the post -- and that messages.js sets that flag from whether the
   answered post was the person's own. */
test('#6254 posted wiring: /api/post fires posted after the response from delivery.repliesToPerson, never failing the post; messages.js sets repliesToPerson from answered.operator', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const route = src.slice(src.indexOf("pathname === '/api/post'"), src.indexOf("pathname === '/api/react'"));
  assert.ok(route, 'the /api/post route moved; this pin reads nothing');
  // The notification comes from the token-resolved sender and the delivery's own id/flag, after sendJson.
  assert.match(route, /sendJson\(res, 200, \{ delivery \}\);/);
  assert.match(route, /phonenotify\.happened\(\{ kind: 'posted', namesPerson: delivery\.repliesToPerson === true,/);
  assert.match(route, /id: 'post:' \+ delivery\.id/);
  assert.match(route, /catch \{ \/\* a notification is never a reason to fail the post/);
  // The names-you signal is derived in messages.js from whether the answered post carried operator:true.
  const msrc = fs.readFileSync(path.join(__dirname, 'engine', 'messages.js'), 'utf8');
  assert.match(msrc, /repliesToPerson: answered\.operator === true/, 'messages.js no longer derives repliesToPerson from the answered post being the person\'s');
});

test('turning on always mints a fresh token, one turn-on at a time', async () => {
  enrol();
  /* #4136: the two turn-ons must really overlap. Fired as two HTTP PUTs, the first could finish its mint before the
     second reached turnOn on a loaded Mac, and two mints one after the other is correct, so the test went red with
     nothing wrong. Here the mint is held open (the fake tunnel logs its call, then waits for GATE) until the SECOND
     request has reached turnOn, so a second mint can only mean the one-at-a-time rule failed. The tunnel's own
     timeout is raised past the fallback, so a slow second request cannot have the first mint killed under it. */
  const GATE = path.join(SANDBOX, 'mint-gate');
  const realTurnOn = phonenotify.turnOn;
  let arrived = 0;
  const openGate = () => fs.writeFileSync(GATE, '');
  const fallback = setTimeout(openGate, 45000);   // a request that never arrives fails the asserts below, not the run
  phonenotify.turnOn = (...args) => {
    arrived += 1;
    if (arrived === 2) openGate();
    return realTurnOn(...args);
  };
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = tunnelScript('gated-tunnel', `${LOG_CALL}\n${WAIT_GATE(GATE)}\nprintf '{"token":"${MINTED}"}\\n'`);
  process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS = '90000';
  let answers;
  try {
    answers = await Promise.all([
      call('PUT', '/api/phone-notify', { body: { on: true } }),
      call('PUT', '/api/phone-notify', { body: { on: true } }),
    ]);
  } finally {
    clearTimeout(fallback);
    phonenotify.turnOn = realTurnOn;
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
    delete process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS;
    fs.rmSync(GATE, { force: true });
  }
  assert.equal(arrived, 2, 'both turn-ons reached phonenotify.turnOn (the overlap this test needs; a later arrival makes the mint count below meaningless)');
  for (const a of answers) assert.ok(a.code === 200 && a.json.on === true, `a turn-on through the held mint did not succeed: ${a.code} ${JSON.stringify(a.json)}`);
  assert.equal(phonenotify.readState().on, true, 'the held mint did not save on');
  const mints = () => (fs.readFileSync(TUNNEL_LOG, 'utf8').match(/ARGV: mac-request/g) || []).length;
  assert.equal(mints(), 1, 'two concurrent turn-ons each minted');
  await call('PUT', '/api/phone-notify', { body: { on: false } });
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(mints(), 2, 'turning on again reused the old token instead of minting');
});

test('a tunnel too old for mac-request says this computer needs an update, not that Kosmos+ is down', async () => {
  enrol();
  const old = path.join(SANDBOX, 'old-tunnel');
  fs.writeFileSync(old, "#!/bin/bash\necho \"error: unrecognized subcommand 'mac-request'\" >&2\nexit 2\n", { mode: 0o755 });
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = old;
  try {
    const r = await call('PUT', '/api/phone-notify', { body: { on: true } });
    assert.equal(r.code, 400);
    assert.match(r.json.error, /needs an update/);
    assert.equal(phonenotify.readState().on, false);
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL; }
});

function tunnelScript(name, body) {
  const f = path.join(SANDBOX, name);
  fs.writeFileSync(f, '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
  return f;
}

test('a hung tunnel times out: turning on fails in plain words, and the next turn-on is not stuck', async () => {
  enrol();
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = tunnelScript('hung-tunnel', 'cat >/dev/null; exec sleep 30');
  process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS = '500';
  try {
    const t0 = Date.now();
    const r = await call('PUT', '/api/phone-notify', { body: { on: true } });
    assert.ok(Date.now() - t0 < 5000, 'turning on waited for the hung tunnel instead of timing out');
    assert.equal(r.code, 400);
    assert.match(r.json.error, /could not be reached/);
    assert.equal(phonenotify.readState().on, false);
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
    const again = await call('PUT', '/api/phone-notify', { body: { on: true } });
    assert.equal(again.code, 200, 'a timed-out turn-on left later turn-ons stuck');
  } finally {
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
    delete process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS;
  }
});

test('turning off while a turn-on is still minting ends off', async () => {
  enrol();
  /* #4136: the off must arrive WHILE the mint is in flight. A 150ms wait against a 1s mint was a timing guess, and on a
     loaded Mac the mint could finish first, when an off one after the other also ends off, so the test passed without
     testing the overlap. The mint now waits for GATE, which opens only once the off has reached turnOff. */
  const GATE = path.join(SANDBOX, 'off-gate');
  const realTurnOff = phonenotify.turnOff;
  let offArrived = false;
  const openGate = () => fs.writeFileSync(GATE, '');
  const fallback = setTimeout(openGate, 45000);
  phonenotify.turnOff = (...args) => { offArrived = true; openGate(); return realTurnOff(...args); };
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = tunnelScript('slow-tunnel', `${LOG_CALL}\n${WAIT_GATE(GATE)}\nprintf '{"token":"${MINTED}"}\\n'`);
  process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS = '90000';
  try {
    const onP = call('PUT', '/api/phone-notify', { body: { on: true } });
    // The off is sent only once the mint has started (its call is in the log), so it cannot overtake the turn-on.
    for (let i = 0; i < 3000 && !(fs.existsSync(TUNNEL_LOG) && /ARGV: mac-request/.test(fs.readFileSync(TUNNEL_LOG, 'utf8'))); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const off = await call('PUT', '/api/phone-notify', { body: { on: false } });
    const on = await onP;
    assert.equal(offArrived, true, 'the off reached turnOff');
    assert.equal(on.code, 200, `the turn-on through the held mint did not succeed: ${on.code}`);
    assert.equal(off.json.on, false);
    assert.equal(phonenotify.readState().on, false, 'the late turn-on saved on over the off');
  } finally {
    clearTimeout(fallback);
    phonenotify.turnOff = realTurnOff;
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
    delete process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS;
    fs.rmSync(GATE, { force: true });
  }
});

test('#6254: payload carries the room project id for a posted tap, capped, null-but-present when absent', () => {
  const withId = phonenotify.payload('n', { kind: 'posted', agent: 'Leo', session: 'leo', project: 'Kosmos Inside Out', projectId: 'kosmosinsideout' });
  assert.equal(withId.projectId, 'kosmosinsideout', 'a posted payload must carry the room id so the coordinator can route the tap');
  const capped = phonenotify.payload('n', { kind: 'posted', agent: 'Leo', projectId: 'z'.repeat(200) });
  assert.equal(Buffer.byteLength(capped.projectId), 120, 'projectId is capped like project');
  const absent = phonenotify.payload('n', { kind: 'needs_you', agent: 'Leo', session: 'leo' });
  assert.equal(absent.projectId, null, 'projectId is null off a posted event');
  assert.ok('projectId' in absent, 'projectId is always a key, like project and session');
});

test('names are capped in UTF-8 bytes, never inside a character', () => {
  const b = phonenotify.payload('n', { kind: 'needs_you', agent: '\u00e9'.repeat(60), session: 's', project: '\u{1F600}'.repeat(40) });
  assert.equal(Buffer.byteLength(b.agent), 80);
  assert.equal(Buffer.byteLength(b.project), 120);
  assert.equal(b.project, '\u{1F600}'.repeat(30));
});

test('turning off stops sending at once', async () => {
  enrol();
  await call('PUT', '/api/phone-notify', { body: { on: true } });
  const off = await call('PUT', '/api/phone-notify', { body: { on: false } });
  assert.equal(off.json.on, false);
  await withLeo(async (h) => { await report(h, 'needs_you'); await reply(h); });
  assert.equal(sent.length, 0, 'something was sent after turning off');
});

test('a Mac not connected to Kosmos+ cannot turn it on, and nothing is saved', async () => {
  const on = await call('PUT', '/api/phone-notify', { body: { on: true } });
  assert.equal(on.code, 400);
  assert.match(on.json.error, /connect this computer to Kosmos\+ first/);
  assert.equal(phonenotify.readState().on, false);
  assert.equal(fs.existsSync(TUNNEL_LOG), false);
});

test('PUT refuses anything but a boolean', async () => {
  enrol();
  for (const on of ['yes', 1, null]) {
    const r = await call('PUT', '/api/phone-notify', { body: { on } });
    assert.equal(r.code, 400, 'accepted ' + JSON.stringify(on));
  }
});
