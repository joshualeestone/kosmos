'use strict';
/**
 * #4771 (Josh's 0.7.15 report), the board's half of `kosmos project pause`. Two kinds of arm (review 6): GUARDS of
 * what the board already did before the verb existed (the pause flags, the 403, the Prompter skip), pinned for the
 * new caller; and the ROOM NOTE arms, new behaviour that fails on origin/main (no note was ever written there), over HTTP on a fully sandboxed board:
 * a PUT {paused:true} carrying an agent token is an AGENT's pause (pausedByPerson stays off), the person's own pause
 * comes only from the screen, and an agent cannot lift it. And the reading-2 check the card asks for, at the level
 * this repo can run it: a pause made the way the screen makes it takes the project's task out of the Prompter's
 * open work (engine/agentnudge.js openParts), so the idle nudge has nothing to name.
 *
 *   node --test server.project-pause-4771.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-project-pause-4771-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const nudge = require('./engine/agentnudge');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

const AGENT = 'cd'.repeat(16);
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const stored = (id) => projects.readAll().find((p) => p.id === id);
/* As the CLI sends it: the agent token, no browser headers. */
const asAgent = (id, paused) => fetch(`${base}/api/project/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': AGENT }, body: JSON.stringify({ paused }) });
/* As the page sends it: a browser's fetch metadata, which is what isViaScreen reads. */
const asScreen = (id, paused) => fetch(`${base}/api/project/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ paused }) });

test('#4771: an agent\'s pause is recorded as an agent\'s, and the person\'s own pause cannot be lifted by an agent', async () => {
  const p = projects.create({ name: 'Pause By Agent' });
  const notes = (pid) => messages.record().rows.filter((m) => m.kind === 'note' && m.project === pid).map((m) => m.text);
  const r = await asAgent(p.id, true);
  assert.equal(r.status, 200, await r.text());
  assert.equal(stored(p.id).paused, true);
  // Review 3/4: an agent's pause is said in the room (here the token names nobody known, so "Someone"); a repeat is not.
  assert.equal(notes(p.id).filter((t) => /paused this project/.test(t)).length, 1, 'an agent\'s pause was not said in the room');
  assert.match(notes(p.id).find((t) => /paused this project/.test(t)), /^Someone paused this project: .*The person can resume it on the project's page\.$/);
  await asAgent(p.id, true);
  assert.equal(notes(p.id).filter((t) => /paused this project/.test(t)).length, 1, 'a repeat pause said it again');
  assert.notEqual(stored(p.id).pausedByPerson, true, 'an agent\'s pause was recorded as the person\'s');

  // Review 1: with no agent token at all (the CLI with KOSMOS_AGENT_TOKEN unset) and no browser headers, still an
  // agent's pause, never the person's.
  const q = projects.create({ name: 'Pause No Token' });
  const bare = await fetch(`${base}/api/project/${q.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) });
  assert.equal(bare.status, 200, await bare.text());
  assert.equal(stored(q.id).paused, true);
  assert.notEqual(stored(q.id).pausedByPerson, true, 'a tokenless pause was recorded as the person\'s');
  assert.equal(notes(q.id).filter((x) => /^Someone paused this project/.test(x)).length, 1, 'a tokenless pause was not said as Someone');
  // Review 4: a non-screen resume is said too; a save that does not carry paused says nothing; a pause whose edit is
  // refused (a bad parent, so the whole edit fails) says nothing.
  assert.equal((await asAgent(q.id, false)).status, 200);
  assert.equal(notes(q.id).filter((x) => /^Someone resumed this project, not from the project's page/.test(x)).length, 1, 'a non-screen resume was not said');
  const quiet = projects.create({ name: 'Pause Quiet' });
  const rename = await fetch(`${base}/api/project/${quiet.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': AGENT }, body: JSON.stringify({ description: 'no pause here' }) });
  assert.equal(rename.status, 200, await rename.text());
  const failed = await fetch(`${base}/api/project/${quiet.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': AGENT }, body: JSON.stringify({ paused: true, parent: 'no-such-parent-4771' }) });
  assert.notEqual(failed.status, 200, 'fixture: the bad parent did not refuse the edit');
  assert.notEqual(stored(quiet.id).paused, true, 'fixture: a refused edit still paused');
  assert.deepEqual(notes(quiet.id).filter((x) => /this project/.test(x)), [], 'a save without paused, or a refused pause, was said in the room');

  // CONTROL: the person's own pause, on a running project, is not announced to them.
  const s = projects.create({ name: 'Pause By Screen' });
  assert.equal((await asScreen(s.id, true)).status, 200);
  assert.equal(stored(s.id).paused, true, 'fixture: the screen pause did not land');
  assert.equal(notes(s.id).filter((x) => /paused this project/.test(x)).length, 0, 'the person\'s own pause was announced to them');

  // The person pauses on the screen: theirs now, and an agent cannot lift it.
  assert.equal((await asScreen(p.id, true)).status, 200);
  assert.equal(stored(p.id).pausedByPerson, true);
  const lift = await asAgent(p.id, false);
  assert.equal(lift.status, 403);
  assert.match((await lift.json()).error, /only they can resume it, on the screen/);
  assert.equal(stored(p.id).paused, true, 'a refused lift still lifted');
  // CONTROL: the screen lifts it.
  assert.equal((await asScreen(p.id, false)).status, 200);
  assert.notEqual(stored(p.id).paused, true);
});

test('#4771 reading 2: a pause made as the screen makes it takes the task out of the Prompter\'s open work', async () => {
  // One idle agent of ours holding one task, built as engine/onhold-4771.test.js builds it.
  const board = fleet.install([fleet.agent('pz-agent', { state: 'idle' })]);
  try {
    const who = (board.agents.find((c) => (c.sessionName || '').startsWith('pz-agent')) || {}).sessionName;
    assert.ok(who, 'the fleet gave no card');
    const p = projects.create({ name: 'Pause Nudge' });
    projects.addAgent(p.id, who, board.agents);
    tasks.create(p.id, { sentence: 'grow the thing', who, made: { via: 'screen' } }, board.agents);
    assert.equal(nudge.openParts(who, projects.readAll()).length, 1, 'control: the open task is the agent\'s work to be nudged about');
    assert.equal((await asScreen(p.id, true)).status, 200);
    assert.deepEqual(nudge.openParts(who, projects.readAll()), [], 'a screen pause still leaves the task to be nudged about');
    assert.deepEqual(nudge.realStalls([{ session: who, from: 'working', to: 'idle' }], projects.readAll()), []);
    // And an agent's pause does the same, which is the whole point of the verb.
    assert.equal((await asScreen(p.id, false)).status, 200);
    assert.equal(nudge.openParts(who, projects.readAll()).length, 1, 'control: resumed, it is open work again');
    assert.equal((await asAgent(p.id, true)).status, 200);
    assert.deepEqual(nudge.openParts(who, projects.readAll()), []);
  } finally { board.restore(); }
});

test('#4771 review 5: an agent whose token says exactly which agent it is is named in the room by its display name', async () => {
  const board = fleet.install([fleet.agent('pz-named', { state: 'idle', displayName: 'Pete Pause' })]);
  try {
    const who = (board.agents.find((c) => (c.sessionName || '').startsWith('pz-named')) || {}).sessionName;
    assert.ok(who, 'the fleet gave no card');
    const minted = sendertoken.mint(who);
    assert.equal(minted.ok, true, 'fixture: no token was minted');
    const p = projects.create({ name: 'Pause Named' });
    const r = await fetch(`${base}/api/project/${p.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': minted.token }, body: JSON.stringify({ paused: true }) });
    assert.equal(r.status, 200, await r.text());
    const said = messages.record().rows.filter((m) => m.kind === 'note' && m.project === p.id).map((m) => m.text);
    assert.equal(said.length, 1, JSON.stringify(said));
    assert.match(said[0], /^Pete Pause paused this project: /, 'the note did not use the display name: ' + said[0]);
    assert.doesNotMatch(said[0], new RegExp(who), 'the raw session name reached the person\'s room');
  } finally { board.restore(); }
});

test('#4771 review 7: a paneless agent (every Windows agent, listed by key) is named; two names under one key are not', async () => {
  // The REAL paneless row, made as engine/sendertoken.test.js makes it: a token plus a live beat (no typed card).
  const remote = sendertoken.mint('Kip4771', { launcher: 'remote' });
  assert.equal(remote.ok, true, 'fixture: no token was minted');
  require('./engine/liveness').seen('kip4771');
  // A display name unlike the key (review 8), so the note is shown to use the card's name and not its session.
  require('./engine/store').writeProfile('kip4771', { displayName: 'Kip Remote' });
  const notesFor = (pid) => messages.record().rows.filter((m) => m.kind === 'note' && m.project === pid).map((m) => m.text);
  const pauseWith = (pid, token) => fetch(`${base}/api/project/${pid}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': token }, body: JSON.stringify({ paused: true }) });

  const a = projects.create({ name: 'Pause Paneless' });
  assert.equal((await pauseWith(a.id, remote.token)).status, 200);
  const said = notesFor(a.id);
  assert.equal(said.length, 1, JSON.stringify(said));
  assert.match(said[0], /^Kip Remote paused this project: /, 'a paneless agent was not named by its display name: ' + said[0]);

  // A second name with tokens under the same key: the board cannot say which agent it was, so "Someone".
  sendertoken.mint('kip4771');
  const b = projects.create({ name: 'Pause Paneless Twin' });
  assert.equal((await pauseWith(b.id, remote.token)).status, 200);
  assert.match(notesFor(b.id)[0] || '', /^Someone paused this project/);
});
