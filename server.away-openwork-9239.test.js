'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9239 (feedback 11-27: a restarted agent did not think of its own open tasks): GET /api/away, the startup hook's
 * greeting and `kosmos away` by hand, also says what is waiting on the agent now. That is the open tasks it holds (task
 * numbers by project, GET /api/tasks/mine's rule) and how many of the person's direct messages are newer than its last
 * reply (`kosmos inbox --unanswered`'s rule). Each comes with the command that shows it, and never a title or a
 * message's words.
 *
 *   node --test server.away-openwork-9239.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9239away-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const chat = require('./engine/chat');
const away = require('./engine/awaydigest');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, selfreport.fileFor('leo'), chat.threadFile(chat.DIRECT, 'leo')]);

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

function withBoard(fn2) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  return Promise.resolve().then(() => fn2()).finally(() => board.restore());
}
const tokenFor = (name) => { const m = sendertoken.mint(name); assert.ok(m.ok, m.because); return m.token; };
const get = (q, tok) => fetch(base + '/api/away' + q, { headers: { 'x-kosmos-agent-token': tok } });

test('#9239 the startup greeting and kosmos away name the agent\'s open tasks and unanswered messages, never their words', async () => {
  await withBoard(async () => {
    const mine = projects.create({ name: 'Site' }).id;
    const notOn = projects.create({ name: 'Elsewhere' }).id;
    projects.mutate(mine, (p) => ({ ...p, agents: ['leo', 'mara'] }));
    projects.mutate(notOn, (p) => ({ ...p, agents: ['mara'] }));
    const a = tasks.create(mine, { sentence: 'SECRET-TITLE fix the header', who: 'leo' }).number;
    const b = tasks.create(mine, { sentence: 'SECRET-TITLE fix the footer', who: 'leo' }).number;
    const closed = tasks.create(mine, { sentence: 'SECRET-TITLE done already', who: 'leo' }).number;
    tasks.close(mine, closed);
    tasks.create(mine, { sentence: 'SECRET-TITLE maras task', who: 'mara' });   // not leo's
    tasks.create(notOn, { sentence: 'SECRET-TITLE elsewhere', who: 'mara' });   // a project leo is not on
    const t0 = Date.now() - 60000;
    chat.appendMessage(chat.DIRECT, 'leo', { text: 'SECRET-WORDS old one', at: new Date(t0).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
    chat.appendMessage(chat.DIRECT, 'leo', { from: 'leo', text: 'my reply', at: new Date(t0 + 1000).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
    chat.appendMessage(chat.DIRECT, 'leo', { text: 'SECRET-WORDS new one', at: new Date(t0 + 2000).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
    chat.appendMessage(chat.DIRECT, 'leo', { text: 'SECRET-WORDS newer one', at: new Date(t0 + 3000).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
    const tok = tokenFor('leo');

    const hook = await (await get('?as=hook&at=startup', tok)).text();
    const ctx = JSON.parse(hook).hookSpecificOutput.additionalContext;
    // In the list's own order (checked against GET /api/tasks/mine below), so either order of the two numbers here.
    assert.match(ctx, new RegExp('it holds 2 open tasks \\(' + mine + ' (#' + a + ', #' + b + '|#' + b + ', #' + a + ')\\): kosmos task list --mine'));
    assert.match(ctx, /2 direct messages from the person since its last reply: kosmos inbox --unanswered/);
    assert.doesNotMatch(ctx, /SECRET-TITLE|SECRET-WORDS/, 'a title or a message\'s words reached the startup');
    assert.doesNotMatch(ctx, new RegExp('#' + closed + '\\b'), 'a closed task was named');

    const text = await (await get('?as=text', tok)).text();
    assert.match(text, /waiting on this agent now: it holds 2 open tasks/, 'kosmos away by hand says it too');
    const json = await (await get('', tok)).json();
    assert.equal(json.openWork.unanswered, 2);
    assert.deepEqual(json.openWork.open.map((t) => t.projectId + '#' + t.number).sort(), [mine + '#' + a, mine + '#' + b].sort());

    // The same rule as GET /api/tasks/mine (one helper): the same tasks, in the same order.
    const listed = await (await fetch(base + '/api/tasks/mine', { headers: { 'x-kosmos-agent-token': tok } })).json();
    assert.deepEqual(listed.tasks.map((t) => [t.projectId, t.number]), json.openWork.open.map((t) => [t.projectId, t.number]));

    // CONTROL: an agent with nothing open and no messages gets no such line.
    const none = await (await get('?as=text', tokenFor('mara'))).text();
    assert.match(none, /it holds 2 open tasks \(/, 'mara holds one task in each of her two projects');
    tasks.close(mine, tasks.allTasks(projects.readAll()).find((t) => t.projectId === mine && (t.whoNames || []).includes('mara')).number);
    tasks.close(notOn, 1);
    const empty = await (await get('?as=text', tokenFor('mara'))).text();
    assert.doesNotMatch(empty, /waiting on this agent now/);
  });
});

test('#9239 the line names at most OPEN_SHOWN task numbers, and always the whole count', () => {
  const open = Array.from({ length: away.OPEN_SHOWN + 3 }, (_, i) => ({ projectId: 'p', number: i + 1 }));
  const t = away.openWorkText({ open, unanswered: 0 });
  assert.match(t, new RegExp('it holds ' + open.length + ' open tasks'));
  assert.match(t, /and 3 more/);
  assert.equal((t.match(/#\d+/g) || []).length, away.OPEN_SHOWN);
  assert.equal(away.openWorkText({ open: [], unanswered: 0 }), '');
  assert.equal(away.openWorkText(null), '');
  assert.match(away.openWorkText({ open: [], unanswered: 1 }), /1 direct message from the person since its last reply/);
});
