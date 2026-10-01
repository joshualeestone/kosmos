'use strict';

/**
 * #4491 slice 5b: an agent that makes a project is named as its maker and is ON it. Every agent's working rules say
 * a project it makes "exists on the board with your name on it" and that it can "post to it and hand it work the same
 * way as any other project" (engine/defaults.js, "Making a project"). Until now such a project listed nobody and
 * recorded no maker, so its own maker could not post in its room.
 *
 * The route is still opened by the board token (an agent token alone does not make a project). Same harness as the
 * other #4491 server tests: a fully sandboxed board with enforcement flipped on in memory; projects are made for
 * real in the sandbox's projects folder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentprojects-4491-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const messagesEngine = require('./engine/messages');
const setupAssistant = require('./engine/setup-assistant');
const chatEngine = require('./engine/chat');

const BOARD = 'BOARDTOKEN_test_4491_projects_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let board;
let mara;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  mara = sendertoken.mint('mara').token;
});
test.after(() => {
  try { board.restore(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });
const stored = (id) => projectsEngine.readAll().find((p) => p.id === id) || null;
async function make(name, headers, extra = {}) {
  const r = await call('POST', '/api/projects', { headers, body: { name, ...extra } });
  return { r, id: r.code === 200 ? JSON.parse(r.text).id : null };
}

test('an agent that makes a project is recorded as its maker and is on it', async () => {
  const { r, id } = await make('Made By Mara', withBoard({ 'x-kosmos-agent-token': mara }), { from_pane: '' });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const p = stored(id);
  assert.deepEqual(p.agents, ['mara'], 'the maker is not on the project it made');
  assert.equal(p.made.via, 'process');
  assert.equal(p.made.by, 'mara', 'the project does not say who made it');
  /* So the rest of what its instructions promise holds: it may hand the project work. */
  const add = await call('POST', '/api/project/' + id + '/tasks', { headers: { 'x-kosmos-agent-token': mara }, body: { sentence: 'first task' } });
  assert.equal(add.code, 200, 'the maker could not add a task to its own project on its token: ' + add.code + ' ' + add.text.slice(0, 160));
  /* And read its room on its token alone (slice 4's rule: a project it is on). */
  assert.equal((await call('GET', '/api/project/' + id + '/room?as=text', { headers: { 'x-kosmos-agent-token': mara } })).code, 200, 'the maker could not read the room of the project it made');
  /* And another agent, not on it, may not. */
  const otto = sendertoken.mint('otto').token;
  assert.equal((await call('POST', '/api/project/' + id + '/tasks', { headers: { 'x-kosmos-agent-token': otto }, body: { sentence: 'not mine' } })).code, 403, 'the maker\'s project was open to an agent that is not on it');
  assert.equal((await call('GET', '/api/project/' + id + '/room?as=text', { headers: { 'x-kosmos-agent-token': otto } })).code, 403);
});

test('the maker can post in the room of the project it made, which is what its working rules promise; another agent cannot', async (t) => {
  /* The defect this change exists for: a room takes posts only from agents the project lists, and the maker was not
     listed. Nothing is typed into a real pane: the chat engine's runner is stubbed, as the other #4491 tests do. */
  chatEngine.setRunner((args) => (args[0] === 'display-message'
    ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
    : { ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
  chatEngine.setDryRun(false);
  t.after(() => { messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true); });
  const { r, id } = await make('Room For Its Maker', withBoard({ 'x-kosmos-agent-token': mara }));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const NOT_ON_IT = /not on that project, so this room is not yours to post into/;
  const post = await call('POST', '/api/post', { headers: { 'x-kosmos-agent-token': mara }, body: { project: id, text: 'first post in my own project' } });
  assert.doesNotMatch(post.text, NOT_ON_IT, 'the maker was refused its own project\'s room: ' + post.text.slice(0, 200));
  assert.equal(post.code, 200, 'the maker\'s post was not accepted: ' + post.code + ' ' + post.text.slice(0, 200));
  const kept = messagesEngine.record().rows.filter((m) => m && m.kind === 'post' && m.project === id).map((m) => [m.from, m.text]);
  assert.deepEqual(kept, [['mara', 'first post in my own project']], 'the maker\'s post is not in the room');
  /* CONTROL: an agent that is not on it is refused with the membership sentence, so the rule is still there. */
  const otto = sendertoken.mint('otto').token;
  const outsider = await call('POST', '/api/post', { headers: { 'x-kosmos-agent-token': otto }, body: { project: id, text: 'not my room' } });
  assert.match(outsider.text, NOT_ON_IT, 'an agent that is not on the project posted in its room: ' + outsider.code + ' ' + outsider.text.slice(0, 200));
});

test('a maker named by its pane is on the project too; members the request names are kept, once', async (t) => {
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = (pane, roster) => {
    const card = pane === '%8' ? roster.find((c) => c.sessionName === 'mara') : null;
    return card ? { ok: true, card } : { ok: false, because: 'no such pane' };
  };
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  const byPane = await make('Made From A Pane', withBoard(), { from_pane: '%8' });
  assert.equal(byPane.r.code, 200, byPane.r.text.slice(0, 200));
  assert.deepEqual([stored(byPane.id).agents, stored(byPane.id).made.by], [['mara'], 'mara']);
  const withOthers = await make('Made With Others', withBoard({ 'x-kosmos-agent-token': mara }), { agents: ['otto'] });
  assert.equal(withOthers.r.code, 200, withOthers.r.text.slice(0, 200));
  assert.deepEqual(stored(withOthers.id).agents, ['otto', 'mara'], 'the named member was dropped, or the maker was not added after it');
  const named = await make('Made Naming Itself', withBoard({ 'x-kosmos-agent-token': mara }), { agents: ['mara', 'otto'] });
  assert.deepEqual(stored(named.id).agents, ['mara', 'otto'], 'a maker that named itself was listed twice');
});

test('the maker is not typed at and not told to ask for a brief; a member it names is', async (t) => {
  /* What telling a member costs: a line typed into its pane, and the agents-only "no brief yet" note in the room. */
  const real = { speak: projectsEngine.speakOfMembershipAsync, note: messagesEngine.roomNote };
  const spoken = [];
  const notes = [];
  projectsEngine.speakOfMembershipAsync = async (agent) => { spoken.push(agent); return { state: 'placed' }; };
  messagesEngine.roomNote = (id, text) => { notes.push(id); return { ok: true }; };
  t.after(() => { projectsEngine.speakOfMembershipAsync = real.speak; messagesEngine.roomNote = real.note; });
  const alone = await make('Maker Alone', withBoard({ 'x-kosmos-agent-token': mara }));
  assert.equal(alone.r.code, 200, alone.r.text.slice(0, 200));
  assert.deepEqual(stored(alone.id).agents, ['mara']);
  assert.deepEqual([spoken, notes], [[], []], 'a maker alone on its new project was typed at, or told to ask what the goal is');
  /* Its instructions are still synced: the answer carries its verdict, with nothing said. */
  const told = JSON.parse(alone.r.text).told;
  assert.equal(told.length, 1);
  assert.deepEqual([told[0].agent, told[0].said], ['mara', null]);
  /* CONTROL: a member the maker names IS told, and then there is somebody to coordinate with, so the note goes. */
  const withOtto = await make('Maker And Otto', withBoard({ 'x-kosmos-agent-token': mara }), { agents: ['otto'] });
  assert.equal(withOtto.r.code, 200, withOtto.r.text.slice(0, 200));
  assert.deepEqual([spoken, notes], [['otto'], [withOtto.id]], 'the named member was not told, or the maker was');
  /* And the page is as before: everyone it ticks is told, and the note goes for any staffed project with no brief. */
  const page = await make('Page Staffed', withBoard({ 'sec-fetch-site': 'same-origin', origin: base }), { agents: ['mara'] });
  assert.deepEqual([spoken.slice(1), notes.slice(1)], [['mara'], [page.id]], 'the page\'s create stopped telling a member, or stopped posting the note');
});

test('a maker alone is not told to ask what done looks like either, and is still told when its done was not written', async (t) => {
  /* #4583 added two more notes to a new project's room: "ask what done looks like" (an ask, like the brief one)
     and "the done you typed was not written" (a fact). The maker alone gets the fact and never the ask. */
  const real = { note: messagesEngine.roomNote, speak: projectsEngine.speakOfMembershipAsync, written: projectsEngine.doneWrittenIn };
  const notes = [];
  messagesEngine.roomNote = (id, text) => { notes.push([id, text]); return { ok: true }; };
  projectsEngine.speakOfMembershipAsync = async () => ({ state: 'placed' });
  t.after(() => { messagesEngine.roomNote = real.note; projectsEngine.speakOfMembershipAsync = real.speak; projectsEngine.doneWrittenIn = real.written; });
  /* A goal and no done: the brief is not pending, done is. */
  const alone = await make('Maker Alone With A Goal', withBoard({ 'x-kosmos-agent-token': mara }), { description: 'Ship the thing.' });
  assert.equal(alone.r.code, 200, alone.r.text.slice(0, 200));
  assert.deepEqual(notes, [], 'a maker alone on its new project was told to ask what done looks like');
  /* CONTROL: the same request with a member to coordinate with does post the done ask, so the silence above is
     the maker rule and not a project that needs no note. */
  const withOtto = await make('Maker And Otto With A Goal', withBoard({ 'x-kosmos-agent-token': mara }), { description: 'Ship the thing.', agents: ['otto'] });
  assert.equal(withOtto.r.code, 200, withOtto.r.text.slice(0, 200));
  assert.deepEqual(notes, [[withOtto.id, projectsEngine.DONE_PENDING_NOTE]], 'a staffed project with a goal and no done was not asked for done');
  /* A done the maker typed that did not reach the brief: said to the maker alone, and it is not an ask. */
  notes.length = 0;
  projectsEngine.doneWrittenIn = () => false;
  const lost = await make('Maker Alone Done Lost', withBoard({ 'x-kosmos-agent-token': mara }), { description: 'Ship the thing.', done: 'Every page loads.' });
  assert.equal(lost.r.code, 200, lost.r.text.slice(0, 200));
  assert.equal(notes.length, 1, 'a maker alone was not told its done was not written, or was told more than that');
  assert.equal(notes[0][0], lost.id);
  assert.ok(notes[0][1].includes('Every page loads.'), 'the note does not quote the done that was lost: ' + notes[0][1].slice(0, 160));
  assert.ok(![projectsEngine.DONE_PENDING_NOTE, projectsEngine.BRIEF_PENDING_NOTE, projectsEngine.BRIEF_AND_DONE_PENDING_NOTE].includes(notes[0][1]));
});

test('the setup guide is recorded as the maker of a project it makes, and is NOT put on it', async (t) => {
  const was = { isGuideFolder: setupAssistant.isGuideFolder, guideName: setupAssistant.guideName };
  setupAssistant.guideName = () => 'otto';
  setupAssistant.isGuideFolder = (n) => n === 'otto';
  t.after(() => { setupAssistant.isGuideFolder = was.isGuideFolder; setupAssistant.guideName = was.guideName; });
  const otto = sendertoken.mint('otto').token;
  const g = await make('Made By The Guide', withBoard({ 'x-kosmos-agent-token': otto }));
  assert.equal(g.r.code, 200, g.r.text.slice(0, 200));
  assert.deepEqual([stored(g.id).agents, stored(g.id).made.by], [[], 'otto'], 'the guide was put on a project');
  /* CONTROL: another agent on the same board, same moment, is put on its project. */
  const m = await make('Made Beside The Guide', withBoard({ 'x-kosmos-agent-token': mara }));
  assert.deepEqual(stored(m.id).agents, ['mara']);
});

test('a maker with no roster row (a Windows agent) is on its project under the token store\'s key', async (t) => {
  const liveness = require('./engine/liveness');
  const realAlive = liveness.alive;
  liveness.alive = (key) => (key === 'ghost' ? true : realAlive(key));
  t.after(() => { liveness.alive = realAlive; sendertoken.revoke('ghost'); });
  const ghost = sendertoken.mint('ghost').token;
  const g = await make('Made From Windows', withBoard({ 'x-kosmos-agent-token': ghost }));
  assert.equal(g.r.code, 200, g.r.text.slice(0, 200));
  assert.deepEqual([stored(g.id).agents, stored(g.id).made.by], [['ghost'], 'ghost']);
  /* Its instructions are synced like any member's. Here the agent has no folder on this computer, so the verdict
     says it could not be done, and the membership stands all the same: recorded, reportable, and not a failed create. */
  const told = JSON.parse(g.r.text).told;
  assert.deepEqual([told.length, told[0].agent, told[0].said], [1, 'ghost', null]);
  assert.equal(typeof told[0].state, 'string', 'the maker has no sync verdict at all');
  /* And it can use what it made, on its token alone. */
  assert.equal((await call('POST', '/api/project/' + g.id + '/tasks', { headers: { 'x-kosmos-agent-token': ghost }, body: { sentence: 'first task' } })).code, 200);
});

test('a caller nobody can name makes a project with exactly the members it asked for, as before', async () => {
  /* The person in a terminal outside tmux: no token, no pane. */
  const terminal = await make('Made In A Terminal', withBoard(), { from_pane: '' });
  assert.equal(terminal.r.code, 200, terminal.r.text.slice(0, 200));
  assert.deepEqual([stored(terminal.id).agents, stored(terminal.id).made.via, stored(terminal.id).made.by], [[], 'process', null]);
  /* The page: whoever the person ticked, nobody added. */
  const page = await make('Made On The Page', withBoard({ 'sec-fetch-site': 'same-origin', origin: base }), { agents: ['otto'], from_pane: '%8' });
  assert.equal(page.r.code, 200, page.r.text.slice(0, 200));
  assert.deepEqual([stored(page.id).agents, stored(page.id).made.via, stored(page.id).made.by], [['otto'], 'screen', null]);
  const pageEmpty = await make('Made On The Page Empty', withBoard({ 'sec-fetch-site': 'same-origin', origin: base }));
  assert.deepEqual(stored(pageEmpty.id).agents, []);
});

test('a token the board cannot resolve makes nothing, and is never swapped for a pane', async (t) => {
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = (pane, roster) => ({ ok: true, card: roster.find((c) => c.sessionName === 'mara') });
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  const before = projectsEngine.readAll().length;
  const bad = await make('Made With A Bad Token', withBoard({ 'x-kosmos-agent-token': 'd'.repeat(64) }), { from_pane: '%8' });
  assert.equal(bad.r.code, 403, 'a bad token fell back to the pane: ' + bad.r.code + ' ' + bad.r.text.slice(0, 160));
  assert.doesNotMatch(bad.r.text, GATE_REFUSAL, 'the 403 is the gate\'s, so the handler was never asked');
  assert.equal(projectsEngine.readAll().length, before, 'a refused create still made a project');
});

test('the route is still opened by the board token: an agent token alone makes no project', async () => {
  const before = projectsEngine.readAll().length;
  const r = await call('POST', '/api/projects', { headers: { 'x-kosmos-agent-token': mara }, body: { name: 'Token Only' } });
  assert.ok(r.code === 403 && GATE_REFUSAL.test(r.text), 'project create opened to an agent token alone: ' + r.code + ' ' + r.text.slice(0, 120));
  assert.equal(projectsEngine.readAll().length, before);
});

test('when the running agents cannot be read, a token makes nothing (503); a caller with none is as before', async (t) => {
  const blind = fleet.blind();
  t.after(() => { blind.restore(); board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]); });
  const before = projectsEngine.readAll().length;
  const withToken = await make('Unchecked', withBoard({ 'x-kosmos-agent-token': mara }));
  assert.equal(withToken.r.code, 503, 'a token nobody could check made a project: ' + withToken.r.code + ' ' + withToken.r.text.slice(0, 160));
  assert.match(JSON.parse(withToken.r.text).error, /so the project was not made/);
  assert.equal(projectsEngine.readAll().length, before);
  const noToken = await make('Made While Blind', withBoard(), { from_pane: '%3' });
  assert.equal(noToken.r.code, 200, 'the person\'s terminal lost project create to an unreadable roster: ' + noToken.r.code + ' ' + noToken.r.text.slice(0, 160));
  assert.deepEqual([stored(noToken.id).agents, stored(noToken.id).made.by], [[], null]);
});
