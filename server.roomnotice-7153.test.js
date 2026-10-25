'use strict';

/**
 * kosmos#7153 (part of #5941, the fleet off Discord): a job on this Mac writes a line into a room in Kosmos's own voice,
 * through POST /api/project/<id>/notice with the board token. A launchd job has no agent token and no pane, so `kosmos
 * post` cannot serve it, and the room route posts as the person. The notice is a roomNote: from Kosmos, its first
 * words naming the source, typed into nobody's session.
 *
 * Same harness as server.agent-writes-4491.test.js: the board boots fully sandboxed, then enforcement is flipped on in
 * memory, so no real store is touched. The note is written for real, into the sandbox's own message log.
 *
 *   node --test server.roomnotice-7153.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomnotice-7153-'));
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

const BOARD = 'BOARDTOKEN_test_7153_notice_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let room;   // the id of the one project the notices go to, made in the sandbox

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  room = projectsEngine.create({ name: 'Fleet Josh 7153' }).id;
});
test.after(() => {
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
const withBoard = { 'x-kosmos-board-token': BOARD };

/* An agent, mara, with its own token; the notes written to the room so far. */
function world(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => { board.restore(); });
  return { mara: sendertoken.mint('mara').token };
}
const notes = () => (messagesEngine.record().rows || []).filter((r) => r && r.kind === 'note' && r.project === room);
const at = () => '/api/project/' + room + '/notice';

test('CONTROL: with no credential, or with only an agent\'s own token, the notice is refused at the gate and nothing is written', async (t) => {
  const w = world(t);
  const before = notes().length;
  const bare = await call('POST', at(), { body: { text: 'hello', source: 'builder alarm' } });
  assert.equal(bare.code, 403, 'a notice with no credential was not refused: ' + bare.code);
  assert.match(bare.text, GATE_REFUSAL);
  const agent = await call('POST', at(), { headers: { 'x-kosmos-agent-token': w.mara }, body: { text: 'hello', source: 'builder alarm' } });
  assert.equal(agent.code, 403, 'an agent\'s own token let it write as Kosmos: ' + agent.code + ' ' + agent.text.slice(0, 160));
  assert.equal(notes().length, before, 'a refused notice was written');
});

test('with the board token, the notice is written as Kosmos, its first words naming the source', async (t) => {
  world(t);
  const before = notes().length;
  const r = await call('POST', at(), { headers: withBoard, body: { text: '  Splinter is unreachable.\nCheck the fleet.  ', source: 'builder alarm' } });
  assert.equal(r.code, 200, 'the notice was not written: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(JSON.parse(r.text), { ok: true, project: room });
  const now = notes();
  assert.equal(now.length, before + 1, 'not exactly one note was written');
  const row = now[now.length - 1];
  assert.equal(row.from, 'kosmos', 'the notice is not in Kosmos\'s own voice');
  assert.equal(row.text, 'builder alarm: Splinter is unreachable.\nCheck the fleet.', 'the source does not lead the words, or the words were not trimmed');
  assert.equal(row.audience, undefined, 'the notice is hidden from the person (written for the agents only)');
});

test('a notice the board cannot take is refused with a reason and nothing is written', async (t) => {
  world(t);
  const before = notes().length;
  const cases = [
    [{ text: '', source: 'builder alarm' }, 400, /needs words/],
    [{ text: '   ', source: 'builder alarm' }, 400, /needs words/],
    [{ text: 'x'.repeat(4001), source: 'builder alarm' }, 400, /at most 4000/],
    [{ text: 'hello' }, 400, /short source/],
    [{ text: 'hello', source: 'builder: alarm' }, 400, /short source/],
    [{ text: 'hello', source: 'builder\nalarm' }, 400, /short source/],
    [{ text: 'hello', source: 's'.repeat(41) }, 400, /short source/],
  ];
  for (const [body, code, why] of cases) {
    const r = await call('POST', at(), { headers: withBoard, body });
    assert.equal(r.code, code, JSON.stringify(body).slice(0, 60) + ' answered ' + r.code);
    assert.match(JSON.parse(r.text).error, why, JSON.stringify(body).slice(0, 60));
  }
  const nowhere = await call('POST', '/api/project/no-such-room/notice', { headers: withBoard, body: { text: 'hello', source: 'builder alarm' } });
  assert.equal(nowhere.code, 404, 'a notice to a project that does not exist answered ' + nowhere.code);
  assert.equal(notes().length, before, 'a refused notice was written');
  // CONTROL: the largest accepted notice is written.
  const most = await call('POST', at(), { headers: withBoard, body: { text: 'y'.repeat(4000), source: 's'.repeat(40) } });
  assert.equal(most.code, 200, 'a notice at both limits was refused: ' + most.code);
  assert.equal(notes().length, before + 1);
});
