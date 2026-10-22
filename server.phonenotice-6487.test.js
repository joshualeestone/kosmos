'use strict';
/**
 * kosmos#6487, through the REAL GET /api/phone/notice route: the phone asks this computer for the words behind a
 * notification. A real report and a real direct reply are recorded the way the routes record them, then asked for by
 * the ids phonenotify sends (report:<at>:<session>, reply:<at>:<session>). CONTROL: an id with a time that has nothing,
 * a malformed id, and the person's own message at the reply's time all answer 404, so the phone shows the plain
 * notification. Sandboxed (fixture-discipline), as server.createdbeacon-route-3038.test.js is.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phonenotice-6487-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-pn6487-claude-' + process.pid + '.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const selfreport = require('./engine/selfreport');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');
const { MASK } = require('./engine/secretmask');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function ask(id, headers = {}) {
  const res = await fetch(base + '/api/phone/notice?id=' + encodeURIComponent(id), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#6487 the words of a needs_you report and of a direct reply come back by the ids the push carries', async () => {
  const kept = selfreport.record('irma', { state: 'needs_you', because: 'Can I send the Henderson lease to Hana today?' });
  assert.ok(kept && kept.at, 'the report was not recorded: ' + JSON.stringify(kept));
  const r = await ask('report:' + kept.at + ':irma');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.text, 'Can I send the Henderson lease to Hana today?');
  assert.equal(r.json.kind, 'report');
  assert.equal(r.json.session, 'irma');
  assert.equal(r.json.agent, 'irma', 'an agent with no card is named by its session');
  assert.equal(r.json.picture, null, 'no picture saved, so no address');

  const at = new Date().toISOString();
  chat.appendMessage(chat.DIRECT, 'leo', { text: 'what about the lease?', at });   // the person's row: no `from`, as the routes write it
  chat.appendMessage(chat.DIRECT, 'leo', { text: 'Sent it. Hana has it now.', at, from: 'leo' });
  const p = await ask('reply:' + at + ':leo');
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.text, 'Sent it. Hana has it now.', 'the agent\'s own message, not the person\'s at the same time');
});

test('#6487 a thread holding only the person\'s message at that time answers 404', async () => {
  const at = new Date().toISOString();
  chat.appendMessage(chat.DIRECT, 'raph', { text: 'are you there?', at });
  const r = await ask('reply:' + at + ':raph');
  assert.equal(r.status, 404, JSON.stringify(r.json));
});

test('#6487 CONTROL: nothing at that time, a malformed id, or another kind of event answers 404 (the plain notification)', async () => {
  for (const id of ['report:2020-01-01T00:00:00.000Z:irma', 'reply:2020-01-01T00:00:00.000Z:leo', 'nonsense', 'built:2026-10-22T18:00:00.000Z:irma', '']) {
    const r = await ask(id);
    assert.equal(r.status, 404, id + ' -> ' + JSON.stringify(r.json));
  }
});

test('#6487 on a board that enforces its token, the words are refused without it and served with it', async (t) => {
  const BOARD = 'BOARDTOKEN_test_6487_notice_0123456789abcdef';
  const kept = selfreport.record('irma', { state: 'needs_you', because: 'Gated words.' });
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; });
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const without = await ask('report:' + kept.at + ':irma');
  assert.equal(without.status, 403, JSON.stringify(without.json));
  assert.ok(!JSON.stringify(without.json).includes('Gated words'), 'the refusal carries none of the words');
  // CONTROL: the same id with the board token is served, so the 403 above is the gate and not a missing row.
  const withToken = await ask('report:' + kept.at + ':irma', { 'x-kosmos-board-token': BOARD });
  assert.equal(withToken.status, 200, JSON.stringify(withToken.json));
  assert.equal(withToken.json.text, 'Gated words.');
});

test('#6487 a name a stranger\'s pane is holding answers 404, as the thread readers do', async (t) => {
  t.after(() => fleet.restore());
  // A direct reply, not a report: a report would change the state the fixture verifies the pane in.
  const at = new Date().toISOString();
  chat.appendMessage(chat.DIRECT, 'vivi', { text: 'Whose words are these?', at, from: 'vivi' });
  fleet.install([fleet.stranger('vivi')]);
  const held = await ask('reply:' + at + ':vivi');
  assert.equal(held.status, 404, JSON.stringify(held.json));
  // CONTROL: the same name tied to its own pane is served, so the 404 is the borrowed name and not the row.
  fleet.install([fleet.agent('vivi')]);
  const tied = await ask('reply:' + at + ':vivi');
  assert.equal(tied.status, 200, JSON.stringify(tied.json));
});

test('#6487 the setup guide\'s words are masked on the way out, as its message thread masks them (#3769)', async (t) => {
  const GUIDE = 'guidebot';
  const KEY = ['sk-ant-', 'api03-', 'FakeKeyFor6487Tests_abcdefGHIJ012345'].join('');
  const was = { guideName: setupAssistant.guideName, isGuideFolder: setupAssistant.isGuideFolder };
  t.after(() => { setupAssistant.guideName = was.guideName; setupAssistant.isGuideFolder = was.isGuideFolder; });
  setupAssistant.guideName = () => GUIDE;
  setupAssistant.isGuideFolder = (n) => n === GUIDE;
  const at = new Date().toISOString();
  // Written straight to the thread, as a row kept before the write-side mask existed would be.
  chat.appendMessage(chat.DIRECT, GUIDE, { text: 'Your key is ' + KEY + ' now.', at, from: GUIDE });
  const r = await ask('reply:' + at + ':' + GUIDE);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!r.json.text.includes(KEY), 'the key reached the phone: ' + r.json.text);
  assert.ok(r.json.text.includes(MASK), 'the mask marker is shown in its place: ' + r.json.text);
  // CONTROL: the same words from an agent that is not the guide pass as written.
  chat.appendMessage(chat.DIRECT, 'helper', { text: 'Your key is ' + KEY + ' now.', at, from: 'helper' });
  assert.ok((await ask('reply:' + at + ':helper')).json.text.includes(KEY));
});
