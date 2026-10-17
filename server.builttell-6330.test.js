'use strict';

/**
 * #6330 slice 1: an agent's built mark (POST /api/project/:id/task/:n/built) tells the people the work is handed to, so
 * nobody polls for it: the task's other assignees and the holders of the nearest held task above it. Never the marker itself; never for a
 * clear, the same mark again, or the person's own mark from the screen. An assignee who left the project, or a swarm
 * switched off here, is not told, and the answer says so. The answer's `delivered` lists one outcome per agent.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builttell-6330.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builttell-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
  ]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed', 'ivy']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => {
  const m = sendertoken.mint(name);
  assert.equal(m.ok, true, m.because);
  return { 'x-kosmos-agent-token': m.token };
};
const mark = (n, as, body = {}) => post(`/api/project/${projectId}/task/${n}/built`, body, as);
const told = (r) => (r.json.delivered || []).map((d) => d.agent).sort();

test('the other assignees are told; the marker is not', async () => {
  const n = tasks.create(projectId, { sentence: 'Ship the invite page', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Write the copy', who: 'zed' });
  const r = await mark(n, asAgent('mona'), { note: 'merged, waiting on the release' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(told(r), ['zed'], JSON.stringify(r.json));
  /* The sandbox runs without permission to touch agents, so every send answers could_not; what is proven here is that
     zed was ATTEMPTED (no filter's reason), as the #768 task-message test proves it. */
  const zed = r.json.delivered.find((d) => d.agent === 'zed');
  assert.doesNotMatch(String(zed.because), /not on this project|switched off/, 'zed was filtered: ' + JSON.stringify(zed));
  assert.match(r.json.summary, /zed/, 'the summary the CLI prints does not name zed: ' + r.json.summary);
});

test('the parent task holder is told too, once even when also on the task', async () => {
  const parent = tasks.create(projectId, { sentence: 'Launch the invite flow', who: 'ivy' }).number;
  const child = tasks.create(projectId, { sentence: 'Build the invite form', who: 'mona', parent }).number;
  const r = await mark(child, asAgent('mona'));
  assert.deepEqual(told(r), ['ivy'], JSON.stringify(r.json));
  // ivy on the child as well: still one line, not two.
  const both = tasks.create(projectId, { sentence: 'Test the invite form', who: 'mona', parent }).number;
  tasks.addPart(projectId, both, { sentence: 'Review it', who: 'ivy' });
  const r2 = await mark(both, asAgent('mona'));
  assert.deepEqual(told(r2), ['ivy'], JSON.stringify(r2.json));
});

test('a closed parent is nobody\'s to hand to', async () => {
  const parent = tasks.create(projectId, { sentence: 'Old launch', who: 'ivy' }).number;
  const child = tasks.create(projectId, { sentence: 'A late piece', who: 'mona', parent }).number;
  tasks.close(projectId, parent);
  const r = await mark(child, asAgent('mona'));
  assert.deepEqual(told(r), [], JSON.stringify(r.json));
});

test('nobody is told for the same mark again, a clear, or the person\'s own mark from the screen', async () => {
  const n = tasks.create(projectId, { sentence: 'Fix the footer', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Check it on a phone', who: 'zed' });
  const first = await mark(n, asAgent('mona'), { note: 'done' });
  assert.deepEqual(told(first), ['zed'], 'control: the first mark tells zed: ' + JSON.stringify(first.json));
  const again = await mark(n, asAgent('mona'), { note: 'done' });
  assert.equal(again.status, 200);
  assert.equal(again.json.changed, false);
  assert.equal(again.json.delivered, undefined, 'the same mark again told someone: ' + JSON.stringify(again.json));
  const cleared = await mark(n, asAgent('mona'), { clear: true });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.changed, true, 'control: the clear did change the task');
  assert.equal(cleared.json.delivered, undefined, 'a clear told someone: ' + JSON.stringify(cleared.json));
  const screen = await mark(n, { 'sec-fetch-site': 'same-origin' });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(screen.json.changed, true, 'control: the screen mark did change the task');
  assert.equal(screen.json.delivered, undefined, 'the person\'s mark told someone: ' + JSON.stringify(screen.json));
});

test('an assignee who left the project is not told, and the answer says why', async () => {
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
    fleet.agent('gone', { state: 'idle' }),
  ]).agents;
  projects.addAgent(projectId, 'gone', roster);
  const n = tasks.create(projectId, { sentence: 'Tidy the logs', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Archive them', who: 'gone' });
  tasks.addPart(projectId, n, { sentence: 'Check the dashboards', who: 'zed' });
  projects.removeAgent(projectId, 'gone');
  const r = await mark(n, asAgent('mona'));
  assert.deepEqual(told(r), ['gone', 'zed'], JSON.stringify(r.json));
  const gone = r.json.delivered.find((d) => d.agent === 'gone');
  assert.equal(gone.state, 'could_not');
  assert.match(gone.because, /not on this project any more/);
  // CONTROL: the member on the same task was attempted, not filtered, so the filter is per agent.
  assert.doesNotMatch(String(r.json.delivered.find((d) => d.agent === 'zed').because), /not on this project/, JSON.stringify(r.json));
});

/* The typed text, as server.test.js pastedMessages reads it: set-buffer chunks up to each Enter. */
function pastedMessages(calls) {
  const msgs = [];
  let cur = '';
  let has = false;
  for (const a of calls) {
    if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
    else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { msgs.push(cur); cur = ''; has = false; }
  }
  if (has) msgs.push(cur);
  return msgs;
}

test('the typed line says who marked which task built, the note, how to reply, and the parent it sits under', async () => {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const parent = tasks.create(projectId, { sentence: 'Launch the shop', who: 'ivy' }).number;
    const n = tasks.create(projectId, { sentence: 'Build the cart', who: 'mona', parent }).number;
    tasks.addPart(projectId, n, { sentence: 'Price the items', who: 'zed' });
    const r = await mark(n, asAgent('mona'), { note: 'cart works, needs the price list' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['ivy', 'zed'], JSON.stringify(r.json));
    for (const d of r.json.delivered) assert.equal(d.state, 'placed', 'not typed: ' + JSON.stringify(d));
    const typed = pastedMessages(sends);
    const toZed = typed.find((t) => !/under your task/.test(t));
    const toIvy = typed.find((t) => /under your task/.test(t));
    assert.ok(toZed && toIvy, 'expected one line for each: ' + JSON.stringify(typed));
    assert.match(toZed, new RegExp(`mona marked task ${n} built: "cart works, needs the price list"`));
    assert.match(toZed, new RegExp(`reply in the task: kosmos task message ${projectId} ${n} "\\.\\.\\."`));
    assert.match(toIvy, new RegExp(`\\(it is under your task ${parent}\\)`), 'the parent holder is told why it hears this');
    assert.equal(typed.length, 2, 'exactly one line each for ivy and zed, none for mona: ' + JSON.stringify(typed));
  } finally {
    chat.resetForTests();
  }
});

test('a parent nobody holds directly hands to the nearest held task above it', async () => {
  const top = tasks.create(projectId, { sentence: 'Open the store', who: 'ivy' }).number;
  const middle = tasks.create(projectId, { sentence: 'Set up payments', parent: top }).number;
  const leaf = tasks.create(projectId, { sentence: 'Add the card form', who: 'mona', parent: middle }).number;
  const r = await mark(leaf, asAgent('mona'));
  assert.deepEqual(told(r), ['ivy'], 'the holder up the tree was not told: ' + JSON.stringify(r.json));
});

test('only the parent chain is asked: a held sibling is not told the work is under its task', async () => {
  const top = tasks.create(projectId, { sentence: 'Plan the retreat' }).number;   // nobody on it
  tasks.create(projectId, { sentence: 'Book the venue', who: 'zed', parent: top });   // the held sibling
  const n = tasks.create(projectId, { sentence: 'Book the travel', who: 'mona', parent: top }).number;
  const r = await mark(n, asAgent('mona'));
  assert.deepEqual(told(r), [], 'a sibling holder was told: ' + JSON.stringify(r.json));
  // CONTROL: with the top task held, its holder is told.
  tasks.addPart(projectId, top, { sentence: 'Own the retreat', who: 'ivy' });
  const n2 = tasks.create(projectId, { sentence: 'Book the meals', who: 'mona', parent: top }).number;
  const r2 = await mark(n2, asAgent('mona'));
  assert.deepEqual(told(r2), ['ivy'], JSON.stringify(r2.json));
});

test('when every holder of the parent has left, the next task up is asked', async () => {
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
    fleet.agent('left', { state: 'idle' }),
  ]).agents;
  projects.addAgent(projectId, 'left', roster);
  const top = tasks.create(projectId, { sentence: 'Run the conference', who: 'ivy' }).number;
  const middle = tasks.create(projectId, { sentence: 'Speakers', who: 'left', parent: top }).number;
  const n = tasks.create(projectId, { sentence: 'Invite the keynote', who: 'mona', parent: middle }).number;
  projects.removeAgent(projectId, 'left');
  const r = await mark(n, asAgent('mona'));
  assert.deepEqual(told(r), ['ivy'], 'the walk stopped at a parent whose holders left: ' + JSON.stringify(r.json));
});

test('a swarm switched off in this project is not told, and the answer says why', async () => {
  const n = tasks.create(projectId, { sentence: 'Update the docs', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Proofread', who: 'zed' });
  tasks.addPart(projectId, n, { sentence: 'Screenshots', who: 'ivy' });
  projects.setSwarmOn(projectId, 'zed', false);
  try {
    const r = await mark(n, asAgent('mona'));
    const zed = r.json.delivered.find((d) => d.agent === 'zed');
    assert.equal(zed.state, 'could_not');
    assert.equal(zed.because, projects.SWARM_OFF_SENTENCE('zed'));
    // CONTROL: ivy on the same task was attempted, not filtered.
    assert.notEqual(r.json.delivered.find((d) => d.agent === 'ivy').because, projects.SWARM_OFF_SENTENCE('ivy'), JSON.stringify(r.json));
  } finally {
    projects.setSwarmOn(projectId, 'zed', true);
  }
});

test('quotes and newlines in a note cannot break the line or its reply instruction', async () => {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const n = tasks.create(projectId, { sentence: 'Fix the banner', who: 'mona' }).number;
    tasks.addPart(projectId, n, { sentence: 'Check it', who: 'zed' });
    const r = await mark(n, asAgent('mona'), { note: 'said "done"\nbut "check" it' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const typed = pastedMessages(sends);
    assert.equal(typed.length, 1, JSON.stringify(typed));
    const quoted = typed[0].match(/built: "([^"]*)" - reply in the task: kosmos task message \S+ \d+ "\.\.\."$/);
    assert.ok(quoted, 'the line lost its framing: ' + typed[0]);
    assert.doesNotMatch(quoted[1], /["\n]/);
  } finally {
    chat.resetForTests();
  }
});

test('a failure while working out who to tell never fails the mark: 200, recorded, nobody told', async () => {
  const n = tasks.create(projectId, { sentence: 'Archive the old site', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Redirects', who: 'zed' });
  const real = projects.swarmOffSet;
  projects.swarmOffSet = () => { throw new Error('the store could not be read'); };
  try {
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.delivered, []);
    assert.match(r.json.summary, /could not work out who to tell/, 'a throw was summarised as nobody assigned: ' + r.json.summary);
    assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n).builtBy, 'mona', 'the mark was not recorded');
  } finally {
    projects.swarmOffSet = real;
  }
});

/* As server.limittask-5805.test.js builds an agent out of usage: its card says rate_limited, its pane shows the limit. */
function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
}
const RULE = '─'.repeat(80) + '\n';
const LIMIT_SCREEN = '❯ hello\n'
  + `  ⎿  You've hit your weekly limit · resets ${chicagoDay(Date.now() + 3 * 24 * 3600e3)} at 3pm (America/Chicago)\n`
  + '✻ Sautéed for 0s · done 10:35 PM\n' + RULE + '❯ \n' + RULE + '  zed · Opus 4.8 · 7d 100%\n';

test('an agent out of usage is not typed into: its line is kept (#5805), and an idle one is typed into', async () => {
  const chat = require('./engine/chat');
  const messages = require('./engine/messages');
  const limitqueue = require('./engine/limitqueue');
  limitqueue.resetForTests();
  fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
    fleet.agent('zed', { state: 'rate_limited', runner: 'claude', command: 'claude', screen: LIMIT_SCREEN }),
  ]);
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: args.join(' ').includes('zed') ? LIMIT_SCREEN : '', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    chat.setPauser(() => {});
    const n = tasks.create(projectId, { sentence: 'Ship the newsletter', who: 'mona' }).number;
    tasks.addPart(projectId, n, { sentence: 'Write it', who: 'zed' });
    tasks.addPart(projectId, n, { sentence: 'Send it', who: 'ivy' });
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const zed = r.json.delivered.find((d) => d.agent === 'zed');
    assert.equal(zed.state, messages.HELD_STATE, 'the limited agent was not kept: ' + JSON.stringify(zed));
    assert.equal(limitqueue.list('zed').length, 1, 'nothing kept for zed');
    // CONTROL: the idle assignee on the same task was typed into.
    assert.equal(r.json.delivered.find((d) => d.agent === 'ivy').state, 'placed', JSON.stringify(r.json));
    assert.equal(pastedMessages(sends).length, 1, 'only ivy is typed into: ' + JSON.stringify(pastedMessages(sends)));
  } finally {
    chat.resetForTests();
    messages.resetForTests();
    limitqueue.resetForTests();
    // Back to this file's fleet (not board.restore(): that returns the roster from before, which later tests cannot use).
    fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' })]);
  }
});

test('with agent task messages switched off (cap 0), a mark tells nobody and says so; the mark still stands', async () => {
  const srv = require('./server');
  const n = tasks.create(projectId, { sentence: 'Tag the release', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Write the notes', who: 'zed' });
  srv.setTaskMsgCapForTests(0);
  try {
    const r = await mark(n, asAgent('mona'), { note: 'tagged' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.delivered, []);
    assert.match(r.json.summary, /^The task is marked built, but nobody was told, because these lines count as task messages and agent task messages are switched off on this computer \(AGENT_WORKFORCE_TASK_MSG_CAP is 0\)\.$/, r.json.summary);
    assert.doesNotMatch(r.json.summary, /["\\]/, 'a quote or backslash would cut the Mac CLI sed short: ' + r.json.summary);
    assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n).builtBy, 'mona');
  } finally {
    srv.setTaskMsgCapForTests();
  }
  // CONTROL: with the cap back, a new mark on the same task tells zed.
  const again = await mark(n, asAgent('mona'), { note: 'tagged and pushed' });
  assert.deepEqual(told(again), ['zed'], JSON.stringify(again.json));
});

test('built lines count against the task-message valve: past a low cap the mark stands and nobody is told, and it says why', async () => {
  const srv = require('./server');
  const n = tasks.create(projectId, { sentence: 'Publish the changelog', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Review it', who: 'zed' });
  // CONTROL, and one send on the valve whatever ran before: under the default cap zed is told.
  const first = await mark(n, asAgent('mona'), { note: 'drafted' });
  assert.deepEqual(told(first), ['zed'], JSON.stringify(first.json));
  srv.setTaskMsgCapForTests(1);
  try {
    const r = await mark(n, asAgent('mona'), { note: 'drafted and checked' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.changed, true);
    assert.deepEqual(r.json.delivered, [], 'a mark past the cap still told someone: ' + JSON.stringify(r.json));
    assert.match(r.json.summary, /^The task is marked built, but nobody was told, because these lines count as task messages and agents have /, r.json.summary);
    assert.doesNotMatch(r.json.summary, /["\\]/, 'a quote or backslash would cut the Mac CLI sed short: ' + r.json.summary);
    assert.doesNotMatch(r.json.summary, /from the screen/, 'a built mark was pointed at a screen action that does not exist: ' + r.json.summary);
    assert.doesNotMatch(r.json.summary, /\.\.$/);
    assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n).builtNote, 'drafted and checked', 'the mark did not stand');
  } finally {
    srv.setTaskMsgCapForTests();
  }
});

test('a project list that cannot be read while working out who to tell is said, not taken as nobody assigned', async () => {
  const n = tasks.create(projectId, { sentence: 'Rotate the keys', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Update the vault', who: 'zed' });
  const real = projects.readAll;
  let calls = 0;
  let threw = 0;
  // The route reads the list for membership and setBuilt writes the task; the read inside tellBuiltMark is the last one.
  projects.readAll = (...a) => {
    calls += 1;
    if (new Error().stack.includes('tellBuiltMark')) { threw += 1; throw new Error('the projects file could not be read'); }
    return real.apply(projects, a);
  };
  try {
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.delivered, []);
    assert.match(r.json.summary, /could not work out who to tell/, r.json.summary);
    assert.ok(calls > 1, 'control: the stub saw the route\'s own reads too');
    assert.equal(threw, 1, 'the stub never found the read inside tellBuiltMark, so this test proved nothing');
  } finally {
    projects.readAll = real;
  }
});

test('a failure in one recipient\'s own step is that recipient\'s could_not, never the others\' or the summary\'s', async () => {
  const n = tasks.create(projectId, { sentence: 'Move the domain', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Update DNS', who: 'zed' });
  tasks.addPart(projectId, n, { sentence: 'Check the certificate', who: 'ivy' });
  projects.setSwarmOn(projectId, 'zed', false);
  const real = projects.SWARM_OFF_SENTENCE;
  projects.SWARM_OFF_SENTENCE = () => { throw new Error('no sentence for zed'); };
  try {
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(told(r), ['ivy', 'zed'], JSON.stringify(r.json));
    assert.equal(r.json.delivered.find((d) => d.agent === 'zed').state, 'could_not');
    assert.doesNotMatch(r.json.summary, /could not work out who to tell/, 'one recipient\'s failure hid everyone: ' + r.json.summary);
  } finally {
    projects.SWARM_OFF_SENTENCE = real;
    projects.setSwarmOn(projectId, 'zed', true);
  }
});

test('a pane that has not taken its line by the wait does not hold the answer: it is said as may have been told', async () => {
  const srv = require('./server');
  const chat = require('./engine/chat');
  const n = tasks.create(projectId, { sentence: 'Write the release note', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Proofread it', who: 'zed' });
  tasks.addPart(projectId, n, { sentence: 'Post it', who: 'ivy' });
  const real = chat.deliverAsync;
  chat.deliverAsync = (m, ...rest) => (m === 'ivy' ? new Promise(() => {}) : real(m, ...rest));
  srv.setBuiltTellWaitForTests(300);
  try {
    const started = Date.now();
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(Date.now() - started < 5000, 'the answer waited on the stuck pane: ' + (Date.now() - started) + ' ms');
    const ivy = r.json.delivered.find((d) => d.agent === 'ivy');
    assert.equal(ivy && ivy.state, 'unconfirmed', JSON.stringify(r.json));
    // CONTROL: the other line was not cut short by the wait.
    const zed = r.json.delivered.find((d) => d.agent === 'zed');
    assert.ok(zed && zed.state !== 'unconfirmed', JSON.stringify(r.json));
    assert.doesNotMatch(r.json.summary, /\bNot told\b[^.]*ivy/i, 'a line still being typed was said as not told: ' + r.json.summary);
  } finally {
    chat.deliverAsync = real;
    srv.setBuiltTellWaitForTests();
  }
});

test('a mark spends one task-message unit, as one task message does, and none when no line would be tried', async () => {
  const srv = require('./server');
  const n = tasks.create(projectId, { sentence: 'Tag the release', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Check the tag', who: 'zed' });
  tasks.addPart(projectId, n, { sentence: 'Announce it', who: 'ivy' });
  const before = srv.taskMessageSendCount;
  const r = await mark(n, asAgent('mona'));
  assert.deepEqual(told(r), ['ivy', 'zed'], JSON.stringify(r.json));
  assert.equal(srv.taskMessageSendCount - before, 1, 'two recipients, one mark, one unit');
  // CONTROL: every recipient switched off, so no line would be tried and nothing is spent.
  projects.setSwarmOn(projectId, 'zed', false);
  projects.setSwarmOn(projectId, 'ivy', false);
  try {
    const before2 = srv.taskMessageSendCount;
    const r2 = await mark(n, asAgent('mona'), { note: 'tag pushed' });
    assert.equal(r2.json.delivered.length, 2, JSON.stringify(r2.json));
    assert.equal(srv.taskMessageSendCount - before2, 0, 'a mark that tried no line spent a unit');
  } finally {
    projects.setSwarmOn(projectId, 'zed', true);
    projects.setSwarmOn(projectId, 'ivy', true);
  }
});

test('a line that fails inside the wait is not logged as failing after the answer', async () => {
  const chat = require('./engine/chat');
  const n = tasks.create(projectId, { sentence: 'Sweep the logs', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Read them', who: 'ivy' });
  const real = chat.deliverAsync;
  chat.deliverAsync = async () => ({ state: chat.DELIVERY.COULD_NOT, because: 'pane gone' });
  const written = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { written.push(String(chunk)); return realWrite.call(process.stderr, chunk, ...rest); };
  try {
    const r = await mark(n, asAgent('mona'));
    assert.equal(r.json.delivered.find((d) => d.agent === 'ivy').state, 'could_not', JSON.stringify(r.json));
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(!written.some((w) => /could not be typed after the answer/.test(w)), 'an in-time failure was logged as late: ' + written.join(''));
  } finally {
    process.stderr.write = realWrite;
    chat.deliverAsync = real;
  }
});

for (const how of ['comes back could_not', 'rejects']) {
  test(`a line that ${how} after the answer is logged, naming the agent and the task`, async () => {
    const srv = require('./server');
    const chat = require('./engine/chat');
    const n = tasks.create(projectId, { sentence: 'Rotate the keys', who: 'mona' }).number;
    tasks.addPart(projectId, n, { sentence: 'Check the new keys', who: 'ivy' });
    const real = chat.deliverAsync;
    chat.deliverAsync = () => new Promise((resolve, reject) => setTimeout(() => (how === 'rejects'
      ? reject(new Error('pane gone'))
      : resolve({ state: chat.DELIVERY.COULD_NOT, because: 'pane gone' })), 150));
    const written = [];
    const realWrite = process.stderr.write;
    process.stderr.write = (chunk, ...rest) => { written.push(String(chunk)); return realWrite.call(process.stderr, chunk, ...rest); };
    srv.setBuiltTellWaitForTests(30);
    try {
      const r = await mark(n, asAgent('mona'));
      assert.equal(r.json.delivered.find((d) => d.agent === 'ivy').state, 'unconfirmed', JSON.stringify(r.json));
      await new Promise((res) => setTimeout(res, 400));
      const line = written.find((w) => /could not be typed after the answer/.test(w));
      assert.ok(line, 'a late failure left no trace: ' + written.join(''));
      assert.match(line, new RegExp(`the line to ivy about task ${n} could not be typed after the answer: pane gone`));
    } finally {
      process.stderr.write = realWrite;
      chat.deliverAsync = real;
      srv.setBuiltTellWaitForTests();
    }
  });
}

test('a control character in the note (an escape sequence) never reaches another agent\'s pane', async () => {
  const chat = require('./engine/chat');
  const sends = [];
  try {
    chat.setRunner((args) => {
      sends.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const n = tasks.create(projectId, { sentence: 'Colour the logs', who: 'mona' }).number;
    tasks.addPart(projectId, n, { sentence: 'Check the colours', who: 'ivy' });
    const r = await mark(n, asAgent('mona'), { note: 'done \u001b[2J\u001b]0;owned\u0007 \u0085 really' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const typed = pastedMessages(sends);
    assert.equal(typed.length, 1, JSON.stringify(typed));
    assert.doesNotMatch(typed[0], /[\u0000-\u001f\u007f-\u009f]/, 'a control character reached the pane: ' + JSON.stringify(typed[0]));
    // CONTROL: the rest of the note did.
    assert.match(typed[0], /done .*really/, JSON.stringify(typed[0]));
  } finally {
    chat.resetForTests();
  }
});

test('alone on a task with no parent: an empty list, nothing sent', async () => {
  const n = tasks.create(projectId, { sentence: 'Rename a file', who: 'mona' }).number;
  const r = await mark(n, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.delivered, [], JSON.stringify(r.json));
  assert.equal(r.json.summary, undefined, 'a solo mark gets a sentence the CLI would print for nothing: ' + r.json.summary);
  // Even with agent task messages switched off, a solo mark is not told it was refused: nobody would have been told.
  const srv = require('./server');
  const n2 = tasks.create(projectId, { sentence: 'Rename another file', who: 'mona' }).number;
  srv.setTaskMsgCapForTests(0);
  try {
    const r2 = await mark(n2, asAgent('mona'));
    assert.deepEqual(r2.json.delivered, []);
    assert.equal(r2.json.summary, undefined, 'a solo mark was told the valve refused it: ' + r2.json.summary);
  } finally {
    srv.setTaskMsgCapForTests();
  }
});

/* The Mac CLI end to end, as server.task-built-3951.test.js runs it: it prints the board's sentence about who was told. */
const { execFile } = require('node:child_process');
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `kosmos task built` prints who was told of the mark', async () => {
  const n = tasks.create(projectId, { sentence: 'Write the release notes', who: 'mona' }).number;
  tasks.addPart(projectId, n, { sentence: 'Proofread them', who: 'zed' });
  const m = sendertoken.mint('mona');
  const r = await mac(['task', 'built', projectId, String(n), 'drafted'], { KOSMOS_AGENT_TOKEN: m.token });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /built, waiting to be released or checked\. Closing it clears the mark\. .*zed/, r.out);
});
