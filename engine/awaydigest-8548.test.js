'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8548: the "while you were away" digest (engine/awaydigest.js) and the Windows hook's half of it
 * (engine/kosmos-report-hook.js takeAway, and main printing it at a startup only when `started` was recorded).
 *   node --test engine/awaydigest-8548.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const away = require('./awaydigest');

const T0 = Date.parse('2026-11-14T10:00:00Z');
const H = 60 * 60 * 1000;
const iso = (t) => new Date(t).toISOString();
/* A post leo could not be reached for (its outcome could_not), as the room writes one for a member that is not running. */
const post = (id, at, extra = {}) => ({ kind: 'post', id, project: 'fleet', from: 'nova', to: ['leo', 'nova'], text: 'SECRET TEXT ' + id, at: iso(at),
  outcomes: { leo: 'could_not', nova: 'placed' }, ...extra });
const { namedIn } = require('./messages');

test('windowFrom at startup: the latest report; a person\'s clear never starts the window; no report, no window', () => {
  const h = [{ state: 'started', at: T0 - 5 * H }, { state: 'working', at: T0 - 3 * H }, { state: 'idle', at: T0 - H, by: 'operator' }];
  assert.deepEqual(away.windowFrom(h, { startup: true, nowMs: T0 }), { sinceMs: T0 - 3 * H, untilMs: T0 });
  assert.equal(away.windowFrom([], { startup: true, nowMs: T0 }), null);
  assert.equal(away.windowFrom(null, { startup: true, nowMs: T0 }), null);
  assert.equal(away.windowFrom([{ state: 'idle', at: T0 - H, by: 'operator' }], { startup: true, nowMs: T0 }), null);
});

test('windowFrom by hand: the report before the newest started, ending at that started (the window the hook had)', () => {
  const h = [{ state: 'started', at: T0 - 9 * H }, { state: 'working', at: T0 - 4 * H }, { state: 'started', at: T0 - 2 * H },
    { state: 'working', at: T0 - H }];
  assert.deepEqual(away.windowFrom(h, { startup: false, nowMs: T0 }), { sinceMs: T0 - 4 * H, untilMs: T0 - 2 * H });
  assert.equal(away.windowFrom([{ state: 'working', at: T0 - H }], { startup: false, nowMs: T0 }), null, 'no started: nothing to rebuild');
  assert.equal(away.windowFrom([{ state: 'started', at: T0 - H }], { startup: false, nowMs: T0 }), null, 'nothing before it');
});

test('only rows inside the window, to this agent, from others; @-named and person posts listed by id; no message text', () => {
  const rows = [
    post('m1', T0 - 4 * H),                                          // before the window
    post('m2', T0 - 2 * H),                                          // counted, not listed
    post('m3', T0 - 2 * H + 1, { mentioned: ['leo'] }),              // listed
    post('m4', T0 - 2 * H + 2, { from: 'leo' }),                     // its own: not counted
    post('m5', T0 - 2 * H + 3, { to: ['nova', 'mona'] }),            // not to leo
    post('m6', T0 - 2 * H + 4, { from: undefined, operator: true }), // the person's: listed
    post('m7', T0 - 2 * H + 5, { mentioned: ['mona'] }),             // names someone else: counted, not listed
    post('m8', T0 + H, { mentioned: ['leo'] }),                      // after the window
    post('m9', T0 - 2 * H + 6, { addressed: ['leo'] }),             // asked by name without an @ (namedIn): listed
    post('mq', T0 - 2 * H + 7, { mentioned: ['leo'], outcomes: { leo: 'quiet' } }),   // left quiet for a RUNNING leo
    post('mp', T0 - 2 * H + 8, { mentioned: ['leo'], outcomes: { leo: 'placed' } }),  // typed into a running leo
    post('mo', T0 - 2 * H + 9, { mentioned: ['leo'], outcomes: undefined }),          // no outcomes: not counted
  ];
  const d = away.build({ name: 'leo', sinceMs: T0 - 3 * H, untilMs: T0, rows, direct: [], namedIn });
  assert.deepEqual(d.counts, { posts: 5, messages: 0, refused: 0, direct: 0 });
  assert.deepEqual(d.lines, ['- fleet: 5 posts from others; naming you or from the person: m9, m6, m3. Read it with: kosmos room fleet']);
  // control: without namedIn the default reads only `mentioned`, so m9 is counted and not listed
  assert.match(away.build({ name: 'leo', sinceMs: T0 - 3 * H, untilMs: T0, rows }).lines[0], /naming you or from the person: m6, m3\./);
  const text = away.contextText(d);
  assert.match(text, /^Kosmos: while this agent was not running \(2026-11-14T07:00:00Z to 2026-11-14T10:00:00Z\), this arrived for it\. This is a summary Kosmos made, not a request from the person/);
  assert.doesNotMatch(text, /SECRET TEXT/);
});

test('the id list is capped at SHOWN, newest first, with "and N earlier"', () => {
  const rows = [];
  for (let i = 0; i < away.SHOWN + 3; i += 1) rows.push(post('p' + i, T0 - H + i, { mentioned: ['leo'] }));
  const d = away.build({ name: 'leo', sinceMs: T0 - 2 * H, untilMs: T0, rows });
  assert.equal(d.lines.length, 1);
  assert.match(d.lines[0], /naming you or from the person: p7, p6, p5, p4, p3 and 3 earlier\./);
});

test('kosmos msg messages (delivered or refused) and the person\'s DMs are counted; a room refusal and the agent\'s own replies are not', () => {
  const rows = [
    { kind: 'message', id: 'x1', from: 'nova', to: 'leo', text: 'SECRET', at: iso(T0 - H), state: 'delivered' },
    { kind: 'message', id: 'x2', from: 'mona', to: 'leo', text: 'SECRET', at: iso(T0 - H + 1), state: 'held' },
    { kind: 'message', id: 'x3', from: 'leo', to: 'nova', text: 'mine', at: iso(T0 - H + 2), state: 'delivered' },
    { kind: 'refused', from: 'nova', to: 'leo', because: 'not running', at: iso(T0 - H + 3) },
    { kind: 'refused', from: 'nova', to: 'fleet', project: 'fleet', because: 'held', at: iso(T0 - H + 4) },
  ];
  const direct = [{ text: 'from the person', at: iso(T0 - H) }, { from: 'leo', text: 'my reply', at: iso(T0 - H + 5) },
    { text: 'too early', at: iso(T0 - 9 * H) }];
  const d = away.build({ name: 'leo', sinceMs: T0 - 2 * H, untilMs: T0, rows, direct });
  assert.deepEqual(d.counts, { posts: 0, messages: 2, refused: 1, direct: 1 });
  assert.deepEqual(d.lines, [
    '- 2 direct messages from other agents, and at least 1 attempt to message you that could not reach you (nova, mona). Ask the sender if you need what it said.',
    '- 1 message from the person. Read them with: kosmos inbox --since 2026-11-14T08:00:00Z --limit 50',
  ]);
});

test('nothing in the window: no lines, no text, no hook JSON; a bad window is nothing too', () => {
  const d = away.build({ name: 'leo', sinceMs: T0 - H, untilMs: T0, rows: [post('m1', T0 - 2 * H)], direct: [] });
  assert.deepEqual(d.lines, []);
  assert.equal(away.contextText(d), '');
  assert.equal(away.hookJson(d), '');
  assert.deepEqual(away.build({ name: 'leo', sinceMs: NaN, untilMs: T0, rows: [post('m1', T0 - 1)] }).lines, []);
  assert.deepEqual(away.build({ name: 'leo', sinceMs: T0, untilMs: T0 - 1, rows: [post('m1', T0 - 1)] }).lines, []);
  // control: the same post inside a window is shown, so the empties above are the window's doing
  assert.equal(away.build({ name: 'leo', sinceMs: T0 - 3 * H, untilMs: T0, rows: [post('m1', T0 - 2 * H)] }).lines.length, 1);
});

test('a window longer than 7 days is clamped and says so', () => {
  const rows = [post('old', T0 - 8 * 24 * H), post('new', T0 - H)];
  const d = away.build({ name: 'leo', sinceMs: T0 - 30 * 24 * H, untilMs: T0, rows });
  assert.equal(d.counts.posts, 1, 'the 8-day-old post is outside the clamp');
  assert.equal(d.clamped, true);
  assert.match(away.contextText(d), /, the last 7 days only\)/);
});

test('hookJson is SessionStart additionalContext', () => {
  const d = away.build({ name: 'leo', sinceMs: T0 - 3 * H, untilMs: T0, rows: [post('m1', T0 - H)] });
  const j = JSON.parse(away.hookJson(d));
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(j.hookSpecificOutput.additionalContext, away.contextText(d));
});

/* The Windows hook: main() asks /api/away before it sends `started`, and prints the answer only when `started` was
   recorded. A fake fetch answers the proof, the away route and the report in turn and records the order. */
const hook = require('./kosmos-report-hook');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AWAY = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Kosmos: while this agent was away x' } });
let dirN = 0;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'away8548-'));
async function runMain({ reportOk = true, awayBody = AWAY, source = 'startup' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url).replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, ''));
    if (String(url).includes('/api/away')) return { ok: true, status: 200, text: async () => awayBody };
    if (String(url).includes('/api/report')) {
      return reportOk ? { ok: true, status: 200, text: async () => '{"recorded":true}' }
        : { ok: false, status: 403, text: async () => '{"ok":false,"because":"refused for the test"}' };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  let out = '';
  await hook.main({ input: JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: 's1' }),
    env: { KOSMOS_AGENT_TOKEN: 'a1a1a1' }, url: 'http://127.0.0.1:16180', boardToken: 'BT', fetchImpl,
    throttleDir: path.join(TMP, 't' + (dirN++)), ppid: 4242, now: () => 10000, stdout: (x) => { out += x; }, platform: 'win32' });
  return { out, calls };
}

test('takeAway: only a 200 that is the hook JSON is returned; anything else, and a throwing fetch, is empty', async () => {
  const mk = (status, body) => async () => ({ status, text: async () => body });
  const io = (f) => ({ url: 'http://127.0.0.1:1', fetchImpl: f });
  assert.equal(await hook.takeAway(io(mk(200, AWAY))), AWAY);
  assert.equal(await hook.takeAway(io(mk(200, ''))), '');
  assert.equal(await hook.takeAway(io(mk(200, 'Kosmos is not running'))), '');
  assert.equal(await hook.takeAway(io(mk(403, AWAY))), '');
  assert.equal(await hook.takeAway(io(async () => { throw new Error('down'); })), '');
});

test('takeAway asks for the startup window as the hook, with the agent token', async () => {
  let seen = null;
  await hook.takeAway({ url: 'http://127.0.0.1:1', agentToken: 'tok', fetchImpl: async (u, init) => { seen = { u, init }; return { status: 200, text: async () => '' }; } });
  assert.equal(seen.u, 'http://127.0.0.1:1/api/away?as=hook&at=startup&from_pane=');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.headers['x-kosmos-agent-token'], 'tok');
});

test('main at a startup: asks /api/away BEFORE the started report, and prints its JSON after a recorded report', async () => {
  const r = await runMain();
  const ai = r.calls.indexOf('/api/away');
  const ri = r.calls.indexOf('/api/report');
  assert.ok(ri >= 0, 'the report was sent: ' + r.calls.join(', '));
  assert.ok(ai >= 0 && ai < ri, 'away before report: ' + r.calls.join(', '));
  assert.equal(r.out, AWAY + '\n');
});

test('main: a failed started report prints only the reporting-off message; a continuation asks nothing', async () => {
  const bad = await runMain({ reportOk: false });
  assert.ok(bad.calls.includes('/api/away') && bad.calls.includes('/api/report'), 'both were asked: ' + bad.calls.join(', '));
  assert.doesNotMatch(bad.out, /hookSpecificOutput/);
  assert.match(bad.out, /systemMessage/);
  const cont = await runMain({ source: 'compact' });
  assert.equal(cont.calls.includes('/api/away'), false);
  assert.equal(cont.out, '');
});
