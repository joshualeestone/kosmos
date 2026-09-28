'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4340, end to end through the DM thread route: "Nothing back yet." is driven by the thread's `owes`, and
 * `owes` must come from the ONE-TO-ONE thread, not the `kosmos msg` / room log.
 *   1. a person's DM that reached the agent makes the route say owes (RED on main: owesReply stayed clear)
 *   2. the agent's reply in the thread clears it
 *   3. a colleague's `kosmos msg` to the agent, which the old log-based answer counted, does not bring it back
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-owes-4340-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, keepAgentReply } = require('./server');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const create = require('./engine/create');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
/* The same check as the engine test: every thread file below must land in THIS sandbox, measured against the
   operator's real data root, never the environment variable alone (#4365 review). */
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, chat.threadFile(chat.DIRECT, 'novadm')]);

const AGENT = 'novadm';
let base;
test.before(async () => {
  fs.mkdirSync(create.workerDir(AGENT), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(AGENT), 'CLAUDE.md'), `# ${AGENT}\n`);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

async function owes() {
  const res = await fetch(`${base}/api/agent/${AGENT}/thread`);
  assert.equal(res.status, 200, 'the thread route did not answer for the fixture agent');
  return (await res.json()).owes;
}

test('#4340: the route answers for an agent never spoken to, and nothing is owed', async () => {
  assert.equal((await owes()).state, 'clear');
});

test('#4340: a person DM that reached the agent makes the thread owe (red on main)', async () => {
  chat.appendMessage(chat.DIRECT, AGENT, {
    text: 'Could you check the invoice?',
    at: new Date(Date.now() - 5 * 60000).toISOString(),
    delivery: { state: chat.DELIVERY.PLACED },
  });
  const o = await owes();
  assert.equal(o.state, 'owes', 'a placed person DM did not make the thread owe: ' + JSON.stringify(o));
});

test('#4340: the agent\'s reply in the thread clears it', async () => {
  keepAgentReply(AGENT, 'Checked: it is paid.', new Date(Date.now() - 60000).toISOString());
  assert.equal((await owes()).state, 'clear');
});

test('#4340: an owed DM behind more than 200 later menu answers is still owed (owes is taken before the tail)', async () => {
  const T = 'novatail';
  fs.mkdirSync(create.workerDir(T), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(T), 'CLAUDE.md'), `# ${T}\n`);
  const base0 = Date.now() - 60 * 60000;
  chat.appendMessage(chat.DIRECT, T, { text: 'can you check the invoice?', at: new Date(base0).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
  for (let k = 1; k <= 201; k += 1) {
    chat.appendMessage(chat.DIRECT, T, { text: 'Yes', wire: '1', at: new Date(base0 + k * 1000).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
  }
  const body = await (await fetch(`${base}/api/agent/${T}/thread`)).json();
  assert.ok(body.olderCount > 0, 'fixture: the thread is not longer than the tail, so this proves nothing');
  assert.equal(body.owes.state, 'owes', 'the owed DM fell outside the 200-row tail and was forgotten');
});

test('#4340: a thread that cannot be read answers unknown, never a confident clear', async () => {
  const file = chat.threadFile(chat.DIRECT, AGENT);
  const kept = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, '{"messages": [');   // cut short
    assert.equal((await owes()).state, 'unknown');
  } finally {
    fs.writeFileSync(file, kept);
  }
  assert.equal((await owes()).state, 'clear', 'CONTROL: the restored thread reads again');
});

test('#4340: a colleague\'s kosmos msg to the agent does not put the person\'s thread back in debt', async () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({
    id: 'm-4340', kind: 'message', from: 'colleague', to: AGENT, text: 'ping', at: new Date().toISOString(),
  }) + '\n');
  const rec = messages.record();
  assert.ok(rec.ok && rec.rows.some((r) => r.id === 'm-4340' && r.kind === 'message' && r.to === AGENT),
    'fixture: the colleague row is not in the message log addressed to the agent, so this test proves nothing');
  assert.equal((await owes()).state, 'clear', 'a colleague\'s message made the person\'s answered thread owe');
});
