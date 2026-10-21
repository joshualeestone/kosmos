'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4421, notifications: a needs-you push and a reply push sent after an agent is renamed carry the NEW name. The
 * card body lists notifications among the surfaces that must follow a rename, and server.rename-4421.test.js covers
 * the card and the room but sends no push. These two name the agent with `sender.card.name || who` (/api/report and
 * /api/reply), so this drives both through the REAL rename route and the REAL routes, and reads the payload the stub
 * sender captures. The other push kinds (posted, ready, the crash-loop family) are not sent here.
 * The control is in the same test: the same push BEFORE the rename must carry the born name, so a payload that
 * never moves (a constant, or the session id) fails one arm or the other.
 *
 *   node --test server.rename-push-4421.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rename-push-4421-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.HOME = mk('home');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';   // nothing here may start a real claude
const STATE = mk('remote');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test/kosmos';
// A fake tunnel: answers the notify-token mint that turning notifications on makes.
const FAKE_TUNNEL = path.join(SANDBOX, 'fake-kosmos-tunnel');
fs.writeFileSync(FAKE_TUNNEL, '#!/bin/bash\ncat >/dev/null\nprintf \'{"token":"knt1_renamepush0123456789"}\\n\'\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;

const store = require('./engine/store');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const phonenotify = require('./engine/phonenotify');
const { start, server, boardAuthState } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

// The names echo the card's screenshot; the provider does not matter to the push path, so the profile is the default.
const WHO = 'gemini-sub';
const BORN = 'Gemini-Sub Born';
const RENAMED = 'Demis Hassabis - Gemini';
const briefOf = () => path.join(create.workerDir(WHO), create.briefFilename(create.recordedRunner(WHO)));

let base;
let board = null;
const sent = [];
test.before(async () => {
  fs.mkdirSync(create.workerDir(WHO), { recursive: true });
  store.writeProfile(WHO, { provider: 'anthropic' });
  fs.writeFileSync(briefOf(), `# ${BORN}\n\nYou are **${BORN}**, a project manager.\n`);
  board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: WHO }));
  phonenotify.setAvailableForTests(true);   // the ship gate is covered in server.phonenotify-gate-718.test.js
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
  // Kosmos+ live (signed in AND switched on), AFTER start as server.phonenotify-718.test.js's enrol() is: written
  // before, the board's boot would start the fake tunnel as its connector.
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  const remoteFile = require('./engine/remote').FILE;
  fs.mkdirSync(path.dirname(remoteFile), { recursive: true });
  fs.writeFileSync(remoteFile, JSON.stringify({ on: true }));
  phonenotify.setSender((url, headers, body) => sent.push(JSON.parse(body)));
});
test.after(() => {
  phonenotify.setSender(null);
  messages.setRunner(null);
  try { sendertoken.revoke(WHO); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  if (board) board.restore();
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {}; try { json = JSON.parse(await res.text()); } catch { /* not json */ }
  return { code: res.status, json };
}

test('#4421: a push sent after a rename carries the new name (reply and needs-you), and before it the born name', async () => {
  assert.equal((await call('PUT', '/api/phone-notify', { body: { on: true } })).json.on, true, 'fixture: notifications did not turn on');
  const h = { 'x-kosmos-agent-token': sendertoken.mint(WHO).token };
  const pushes = async () => {
    sent.length = 0;
    phonenotify.resetCooldownForTests();   // so round two's needs_you is not held by round one's cooldown
    // A needs_you pushes only on the change INTO it, so 'working' first: round two would otherwise send nothing.
    assert.equal((await call('POST', '/api/report', { headers: h, body: { state: 'working', text: 'w' } })).json.recorded, true, 'fixture: a report was not recorded');
    assert.equal((await call('POST', '/api/report', { headers: h, body: { state: 'needs_you', text: 'n' } })).json.recorded, true, 'fixture: a needs-you report was not recorded');
    assert.equal((await call('POST', '/api/reply', { headers: h, body: { text: 'r' } })).json.kept, true, 'fixture: a reply was not kept');
    assert.equal(sent.length, 2, 'fixture: expected one needs_you and one replied push; got ' + JSON.stringify(sent.map((b) => b.kind))
      + ' (needs_you sends only on a change into it and outside its cooldown; replied on a kept reply)');
    // Every push, in order: a second push of either kind (say a stale-named one beside the right one) fails here.
    return sent.map((b) => [b.kind, b.agent]);
  };

  // CONTROL: before the rename both pushes carry the born name, so the arm below cannot pass on a constant.
  const before = await pushes();
  assert.deepEqual(before, [['needs_you', BORN], ['replied', BORN]], 'before the rename the pushes were not exactly these');

  const res = await call('PUT', `/api/agent/${WHO}/profile`, { body: { displayName: RENAMED } });
  assert.equal(res.code, 200, 'the rename route refused: ' + JSON.stringify(res.json));
  // So a red after arm can be told apart: the rename reached the card, and only the push could be stale.
  const card = ((await call('GET', '/api/status')).json.agents || []).find((c) => c.sessionName === WHO) || {};
  assert.equal(card.name, RENAMED, 'fixture: the rename did not reach the card');

  const after = await pushes();
  assert.deepEqual(after, [['needs_you', RENAMED], ['replied', RENAMED]], 'the pushes after the rename were not exactly these, with the new name');
});
