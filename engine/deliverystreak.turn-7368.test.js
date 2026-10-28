'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7368: a Windows Claude step that never ends is said on the card, naming the step, once it has shown no
 * activity for an hour with messages queued behind it, and the person is told to restart it and send them again.
 *
 * On Windows a message is written into the agent's input and counts as PLACED even mid-turn, so the #7212 streak
 * (which only counts what did not land) can never see a step that holds them. The agent's supervisor counts what it
 * queued (`queued`), and the step's clock is its last sign of activity (review 1: B1 and B2).
 *
 *   node --test engine/deliverystreak.turn-7368.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-turnstuck-7368-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const ss = require('./win32streamstate');
const ds = require('./deliverystreak');
const fleet = require('../test-support/fleet');
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/* A publisher that records every write instead of touching disk, on a clock the test moves. */
function recording() {
  const wrote = [];
  const clock = { t: Date.parse('2026-10-27T12:00:00Z') };
  const pub = ss.publisher('agent-a', { write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {}, setTimer: () => {}, now: () => clock.t });
  return { pub, last: () => wrote[wrote.length - 1], wrote, clock };
}
const toolResult = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id || lastId, content: 'done' }] } });
let nextId = 0; let lastId = null;
/* A main-agent tool call with its own id, and the result for the latest one (or a given id). */
const toolUse = (name, input) => { lastId = 'toolu_' + (++nextId); return { type: 'assistant', message: { content: [{ type: 'tool_use', id: lastId, name, input }] } }; };
const init = { type: 'system', subtype: 'init' };
const result = { type: 'result', is_error: false };

/* The step a tool call is shown as, read the way the card reads it: through the publisher's own write. */
function stepVia(name, input) {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote(); r.pub.event(init);
  r.pub.event(toolUse(name, input));
  r.pub.wrote();   // something queued, so the step is written
  return r.last().step;
}

/* A Stripe-shaped test token, built so the source holds no literal key (GitHub push protection reads the file). */
const LIVE = 'sk_' + 'live_' + 'abcdefghijklmnopqrstuvwx';

test('#7368: the step names the shell command in quotes, or the tool and what it acts on; masked, one line, cut by character', () => {
  assert.equal(stepVia('Bash', { command: 'npm install' }), 'running "npm install"');
  assert.equal(stepVia('Read', { file_path: 'C:\\work\\notes.md' }), 'using Read on C:\\work\\notes.md');
  assert.equal(stepVia('WebFetch', {}), 'using WebFetch');
  // An MCP call reads as the tool and where it comes from, not the internal name (measured: a hung one stays open).
  assert.equal(stepVia('mcp__github__create_issue', { title: 'x' }), 'using create issue from github');
  assert.equal(stepVia('mcp__claude_ai_Claude_Docs__read', {}), 'using read from Claude Docs');
  assert.equal(stepVia('mcp__plugin_discord_discord__reply', {}), 'using reply from discord');
  assert.equal(stepVia('mcp__notes__search', { query: 'invoices' }), 'using search from notes on invoices');
  assert.equal(stepVia('mcp__bad__', {}), 'using mcp__bad__', 'CONTROL: a name with no tool part is shown as it is');
  assert.equal(stepVia('mcp__plugin_my_plugin_srv__go', {}), 'using go from my plugin srv', 'an underscore in a plugin name is not split');
  assert.equal(stepVia('mcp__my_server__prod___list', {}), 'using list from my server prod', 'a __ in a server name stays in the server');
  assert.equal(stepVia('mcp__x__' + LIVE, {}), 'using \u2022\u2022\u2022\u2022', 'a token in a tool name masks the whole name');
  assert.equal(stepVia('mcp__s__get_' + LIVE, {}), 'using \u2022\u2022\u2022\u2022', 'and one after an underscore inside the part');
  assert.equal(stepVia('mcp__s__' + 'github_' + 'pat_AAAAAAAAAA__BBBBBBBBBBBBBBBBBBBB', {}), 'using \u2022\u2022\u2022\u2022', 'and one that spans the split');
  assert.equal(stepVia('mcp__claude_ai___t', {}), 'using t', 'a server emptied by its prefix shows the tool alone');
  assert.equal(stepVia('mcp__srv__do-' + LIVE, {}), 'using \u2022\u2022\u2022\u2022', 'and one inside the tool part');
  const longName = stepVia('mcp__' + 'a'.repeat(240) + '__get_' + LIVE, {});
  assert.ok(longName.startsWith('using mcp__aaa') && !longName.includes('live'), 'a name too long to show whole is not reordered: ' + longName);
  assert.equal(stepVia('mcp__onlyserver', {}), 'using mcp__onlyserver', 'CONTROL: not MCP-shaped, shown as it is');
  assert.equal(stepVia('my_tool', {}), 'using my_tool', 'CONTROL: another name keeps its underscores');
  assert.equal(stepVia('Bash', { command: 'a\n\t\u0007 b' }), 'running "a b"', 'control characters and runs of space fold to one space');
  const long = stepVia('Bash', { command: '\u{1F600}'.repeat(200) });
  assert.equal(Array.from(long).length, 80, 'cut to 80 characters');
  assert.ok(!/[\uD800-\uDBFF]\u2026$/.test(long), 'never cut inside a character');
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const masked = stepVia('Bash', { command: 'GH_TOKEN=' + token + ' gh pr list' });
  assert.ok(!masked.includes(token), 'a token in the command is masked before it reaches the card or the log: ' + masked);
});

test('#7368 review 1 B1: the message that STARTS a turn is not waiting behind it; one written into a busy agent is', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();   // starts the turn
  assert.equal(r.last().state, ss.BUSY);
  assert.equal(r.last().queued, undefined, 'the message that started the turn queues nothing');
  r.pub.event(toolUse('Bash', { command: 'sleep forever' }));
  r.pub.wrote();   // the person sends another while it is busy
  assert.equal(r.last().queued, 1, 'a message written into a busy agent is queued behind its turn');
  r.pub.wrote();
  assert.equal(r.last().queued, 2);
});

test('#7368 review 2 (measured on Claude Code 2.1.311): messages written during a step are taken at its next boundary, so the queue empties there and cannot drift', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();                                             // A starts the turn
  r.pub.event(init);
  r.pub.event(toolUse('Bash', { command: 'sleep 30' }));     // a step runs
  r.pub.wrote(); r.pub.wrote();                              // B and C written while it runs
  assert.equal(r.last().queued, 2, 'two wait behind the running step');
  r.pub.event(toolResult());                                   // the step ends: the agent takes B and C in this same turn
  assert.equal(r.last().queued, undefined, 'taken at the boundary: nothing waits');
  r.pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } });
  r.pub.event(result);                                       // one result for all three: no second turn ever starts
  for (let i = 0; i < 10; i++) { r.pub.wrote(); r.pub.event(init); r.pub.event(result); }
  assert.equal(r.last().queued, undefined, 'ten more ordinary turns later, still nothing counted: it cannot drift (review 2 BLOCKER)');
  r.pub.wrote(); r.pub.event(toolUse('Bash', { command: 'forever' })); r.pub.wrote();
  assert.equal(r.last().queued, 1, 'CONTROL: a message behind a step that has not ended is still counted');
});

test('#7368 review 3 W1: a second message sent while idle still waits after the first turn starts', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();               // A starts the turn
  r.pub.wrote();               // B, sent right after, waits
  r.pub.event(init);           // the turn's start does not take B (measured)
  assert.equal(r.last().queued, 1, 'B still waits after the turn starts');
  r.pub.event(toolUse('Bash', { command: 'hang' }));
  r.pub.event({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } });
  assert.equal(r.last().queued, 1, 'and still waits while the first step hangs');
});

test('#7368 review 3 W2: a subagent\'s tool result is not a boundary for the person\'s messages', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote(); r.pub.event(init);
  r.pub.event(toolUse('Task', { description: 'research' }));
  const taskId = lastId;
  r.pub.wrote();
  // The subagent's own call (review 5 W1): it must not join the main agent's open calls.
  r.pub.event({ type: 'assistant', parent_tool_use_id: taskId, message: { content: [{ type: 'tool_use', id: 'sub_call', name: 'Bash', input: { command: 'sub' } }] } });
  const sub = { type: 'user', parent_tool_use_id: 'toolu_x', message: { content: [{ type: 'tool_result', content: 'sub step' }] } };
  r.pub.event(sub);
  assert.equal(r.last().queued, 1, 'the subagent\'s own tool result leaves the person\'s message waiting');
  r.pub.event(toolResult(taskId));
  assert.equal(r.last().queued, undefined, 'CONTROL: the main agent\'s tool result takes it (the subagent\'s call never held it open)');
});

test('#7368 review 3 W3: while a message waits, the card names the step that is running, never one that finished', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote(); r.pub.event(init);
  r.pub.event(toolUse('Bash', { command: 'first' }));
  r.pub.event(toolResult());                               // first ends
  r.pub.wrote();                                         // a message arrives between steps
  assert.equal(r.last().step, undefined, 'no step is named between steps');
  r.pub.event(toolUse('Bash', { command: 'second' }));   // the step that hangs
  assert.equal(r.last().step, 'running "second"', 'the running step reaches disk while something waits');
});

test('#7368 review 2 W2: the step clock moves on activity, in buckets, so a busy agent writes about once per bucket, not per tool', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();
  const first = r.last().stepSince;
  const before = r.wrote.length;
  for (let i = 0; i < 50; i++) { r.pub.event(toolUse('Bash', { command: 'step ' + i })); r.pub.event(toolResult()); }
  assert.ok(r.wrote.length - before <= 1, 'fifty named tools inside one bucket cost at most one write, not fifty: ' + (r.wrote.length - before));
  r.clock.t += ss.STEP_CLOCK_MS + 1000;
  r.pub.event(toolUse('Bash', { command: 'later' }));
  assert.notEqual(r.last().stepSince, first, 'activity in a later bucket moves the clock on disk');
  assert.equal(r.last().step, 'running "later"', 'and the current step rides with that write');
});

test('#7368 review 1 B2: the clock is the last sign of activity, not the turn\'s start; a quiet step keeps its clock', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();
  const first = r.last().stepSince;
  assert.ok(Number.isFinite(Date.parse(first)), 'a busy agent has a step clock');
  r.pub.event(toolUse('Bash', { command: 'sleep forever' }));
  r.pub.wrote();   // a message arriving is not activity of the agent's; its write carries the step (review 2 W3)
  assert.equal(r.last().step, 'running "sleep forever"');
  assert.equal(r.last().stepSince, first, 'a queued message does not move the clock');
  r.pub.event(result);
  assert.equal(r.last().stepSince, undefined, 'an idle agent has no step');
  assert.equal(r.last().step, undefined);
});

test('#7368: turnFor reads a busy agent\'s step and queue from its state file, and nothing from an idle one', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, store.safeKey(n) + '.json');
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  fs.writeFileSync(at('ada'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: process.pid, at: since, stepSince: since, step: 'running "npm install"', queued: 3 }));
  assert.deepEqual(ss.turnFor('ada'), { since, step: 'running "npm install"', queued: 3 });
  const dead = require('node:child_process').spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(at('dan'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: dead, at: since, stepSince: since, queued: 3 }));
  assert.equal(ss.turnFor('dan'), null, 'review 2 W5: a file whose process is gone describes no agent running now');
  fs.writeFileSync(at('bea'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: 1, at: since, queued: 2 }));
  assert.equal(ss.turnFor('bea'), null, 'CONTROL: an idle agent is not on a step');
  fs.writeFileSync(at('cal'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since }));
  assert.equal(ss.turnFor('cal'), null, 'a busy record from before #7368 (no step clock) says nothing');
});

test('#7368: an hour with no activity AND a message queued is a stall that names the step; each alone is not', () => {
  const now = Date.now();
  const old = new Date(now - 2 * HOUR).toISOString();
  assert.equal(ds.turnStuckOf('ada', { since: old, step: 'running "npm install"', queued: 0 }, { now }), null, 'a long quiet step nothing waits behind is not said');
  assert.equal(ds.turnStuckOf('ada', { since: new Date(now - 59 * MIN).toISOString(), step: null, queued: 3 }, { now }), null, 'CONTROL: under an hour of quiet is not stuck');
  const st = ds.turnStuckOf('ada', { since: old, step: 'running "npm install"', queued: 2 }, { now });
  assert.deepEqual({ lastWhy: st.lastWhy, count: st.count, step: st.step, since: st.since }, { lastWhy: 'turn', count: 2, step: 'running "npm install"', since: old });
  assert.match(st.next, /Restart it to free it \(the waiting messages will need sending again\)/);
  assert.match(ds.turnStuckOf('ada', { since: old, step: null, queued: 1 }, { now }).next, /the waiting message will need/, 'one message is singular');
  assert.doesNotMatch(st.next, /send them again|you sent/, 'review 5 W2: the words never assume the person sent them');
  // Review 5 N1: the clock on disk can trail by a bucket, so the hour is counted past it.
  assert.equal(ds.turnStuckOf('ada', { since: new Date(now - 63 * MIN).toISOString(), step: null, queued: 1 }, { now }), null, '63 minutes is not yet over an hour once the bucket is allowed for');
  assert.ok(ds.turnStuckOf('ada', { since: new Date(now - 66 * MIN).toISOString(), step: null, queued: 1 }, { now }), '66 minutes is');
  assert.equal(ds.turnStuckOf('ada', null, { now }), null);
});

test('#7368 review 2 W4: the board masks the step again with the person\'s own secrets', () => {
  const sm = require('./secretmask');
  const secret = 'zq-person-secret-7368-' + 'Xy9Kp2Lm4Nq';
  sm.setKnownSecrets([secret]);
  try {
    const st = ds.turnStuckOf('ada', { since: new Date(Date.now() - 2 * HOUR).toISOString(), step: 'running "deploy ' + secret + '"', queued: 1 });
    assert.ok(st && st.step && !st.step.includes(secret), 'a known secret in the step never reaches the card: ' + (st && st.step));
  } finally { sm.setKnownSecrets([]); }
});

test('#7368: the card carries it for a Windows Claude agent reading Working, ahead of the streak; not for other runners or states', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  fs.writeFileSync(path.join(dir, store.safeKey('dee') + '.json'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: process.pid, at: since, stepSince: since, step: 'running "x"', queued: 2 }));
  const win = { name: 'dee', command: 'claude.exe', runner: 'claude' };
  ds.resetForTests();
  const now = Date.now();
  for (const m of [40, 35, 2]) ds.note('dee', { state: 'could_not', because: 'x' }, now - m * MIN);   // a #7212 streak too
  assert.ok(ds.stallOf('dee'), 'CONTROL: the streak alone would be said');
  assert.equal(status.deliveryStallOf(win, { state: 'working' }).lastWhy, 'turn', 'review 3 W4: with both, the stuck step is said (it names the step)');
  ds.resetForTests();   // the controls below are about the step alone
  assert.equal(status.deliveryStallOf(win, { state: 'idle' }), null, 'CONTROL: an idle card is not on a step');
  assert.equal(status.deliveryStallOf({ ...win, runner: 'codex' }, { state: 'working' }), null, 'not for another runner\'s supervisor');
  assert.equal(status.deliveryStallOf({ name: 'dee', command: 'claude' }, { state: 'working' }), null, 'not for a Mac pane');
});

test('#7368: the page says it in its own sentence, naming the step and how many wait', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  const card = (mins, count, step) => ({ name: 'Ada', state: 'working', deliveryStall: { since: new Date(Date.now() - mins * MIN).toISOString(), count,
    lastWhy: 'turn', step, words: ds.WHY_WORDS.turn, next: ds.turnNext(count) } });
  assert.equal(stateReason(card(125, 3, 'running "npm install"')),
    'Ada has been on one step for about 2 hours: running "npm install". 3 messages are waiting behind it. Restart it to free it (the waiting messages will need sending again), or wait if it is a long job.');
  assert.equal(stateReason(card(70, 1, null)),
    'Ada has been on one step for about 70 minutes. 1 message is waiting behind it. Restart it to free it (the waiting message will need sending again), or wait if it is a long job.');
  assert.match(stateReason({ name: 'Ada', state: 'idle', deliveryStall: { since: new Date(Date.now() - 45 * MIN).toISOString(), count: 4, lastWhy: 'menu', words: ds.WHY_WORDS.menu } }),
    /^No message has reached Ada/, 'CONTROL: the #7212 stall keeps its own sentence');
});

test('#7368: the board log says a stuck step once, in its own words', () => {
  const st = { since: '2026-10-27T12:00:00.000Z', count: 3, step: 'running "x"' };
  assert.equal(ds.turnLine('ada', st), 'turn-stuck: ada has been on one step since 2026-10-27T12:00:00.000Z (running "x"), with 3 messages waiting behind it.\n');
  assert.match(ds.turnLine('ada', { ...st, count: 1, step: null }), /since 2026-10-27T12:00:00\.000Z, with 1 message waiting/);
});

test('#7368 review 4 B1 (measured): two calls in one message run one after the other; the person\'s message waits for the second', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote(); r.pub.event(init);
  r.pub.event({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'call_a', name: 'Bash', input: { command: 'quick' } },
    { type: 'tool_use', id: 'call_b', name: 'Bash', input: { command: 'hangs' } },
  ] } });
  r.pub.wrote();                                   // written while both are open
  assert.equal(r.last().queued, 1);
  assert.equal(r.last().step, 'running "quick"', 'review 5 N2: the step is the FIRST call still open');
  r.pub.event(toolResult('call_a'));               // the first returns (18.68 s in the measured run)
  assert.equal(r.last().queued, 1, 'still waiting: the model is not called again until the second returns');
  assert.equal(r.last().step, 'running "hangs"', 'and the card names the call still running');
  r.pub.event(toolResult('call_b'));
  assert.equal(r.last().queued, undefined, 'taken once the last call returns');
});

test('#7368 review 4 W1: the board log says each stuck step once, again for a new step, and forgets an agent gone from the board', (t) => {
  const said = new Map();
  const st = { since: '2026-10-27T12:00:00.000Z', count: 2, lastWhy: 'turn', step: 'running "x"' };
  // A real card from the fleet fixture, with only deliveryStall set (fixture-discipline: never a hand-built card).
  const board = fleet.install([fleet.agent('ada', { state: 'working' })]);
  t.after(() => board.restore());
  const card = (stall) => ({ ...board.card('ada'), deliveryStall: stall });
  assert.equal(ds.turnsToSay([card(st)], said).length, 1, 'said the first time');
  assert.equal(ds.turnsToSay([card(st)], said).length, 0, 'not again the next minute');
  assert.equal(ds.turnsToSay([card(null)], said).length, 0, 'a read without it says nothing');
  assert.equal(ds.turnsToSay([card(st)], said).length, 0, 'and one flicker does not say it again');
  assert.equal(ds.turnsToSay([card({ ...st, step: 'running "y"' })], said).length, 1, 'a new stuck step is said');
  ds.turnsToSay([], said);
  assert.equal(said.size, 0, 'an agent gone from the board is forgotten');
  assert.equal(ds.turnsToSay([card({ ...st, lastWhy: 'menu' })], said).length, 0, 'CONTROL: a #7212 streak is not this line');
});

test('#7368 review 4 N2/N3: a system event is activity, and moves the clock on disk in a later bucket', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();
  const first = r.last().stepSince;
  r.clock.t += ss.STEP_CLOCK_MS + 1000;
  r.pub.event({ type: 'system', subtype: 'status' });
  assert.notEqual(r.last().stepSince, first, 'a system event in a later bucket is written as activity');
});

test('#7368 seam: a hung MCP call, as Claude Code 2.1.312 streams it, stays the step and its progress is not activity', () => {
  // Measured 10-27 against a stdio MCP server that never answers tools/call: after the call, the stream carries only
  // tool_progress every 30 s, with tool_use_id and parent_tool_use_id both set to the hung call's own id.
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.event(init);
  r.pub.event(toolUse('mcp__hang__wait', {}));
  const id = lastId;
  r.pub.wrote();
  const since = r.last().stepSince;
  for (let s = 30; s <= 3660; s += 30) {
    r.clock.t += 30 * 1000;
    r.pub.event({ type: 'tool_progress', tool_use_id: id, parent_tool_use_id: id, tool_name: 'mcp__hang__wait', elapsed_time_seconds: s });
  }
  r.pub.wrote();
  assert.equal(r.last().step, 'using wait from hang');
  assert.equal(r.last().queued, 2, 'both messages still waiting: progress closes nothing');
  assert.equal(r.last().stepSince, since, 'an hour of progress lines did not move the clock');
  r.pub.event(toolResult(id));
  assert.equal(r.last().queued, undefined, 'CONTROL: the call returning does take them');
});

test('#7368 seam: a refused tool call, as Claude Code 2.1.312 streams it, closes its call and takes the waiting message', () => {
  // Measured 10-27 with a permissions deny rule: a system event (subtype permission_denied) whose message is a plain
  // string, then a main-agent tool_result with is_error true for the refused call.
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.event(init);
  r.pub.event(toolUse('Bash', { command: 'echo hi' }));
  const id = lastId;
  r.pub.wrote();
  assert.equal(r.last().queued, 1);
  r.pub.event({ type: 'system', subtype: 'permission_denied', message: 'Permission to use Bash with command echo hi has been denied.' });
  assert.equal(r.last().queued, 1, 'the denial notice alone closes nothing');
  assert.equal(r.last().step, 'running "echo hi"', 'and the refused call is still the step');
  r.pub.event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Permission to use Bash with command echo hi has been denied.' }] } });
  assert.equal(r.last().queued, undefined, 'the refused result closes the call like any other');
});
