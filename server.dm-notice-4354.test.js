'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4354, through the REAL daily-limit sweep (swarm.sweepOnce with the server's own swarmSweepDeps) and the REAL DM
 * thread route. Kosmos's daily-limit notice is written in the agent's name; it stands in for an answer only while
 * the agent is paused:
 *   1. paused by the limit, the notice alone: nothing owed (the notice says why no answer is coming)
 *   2. switched back on by the next day's sweep, still unanswered: owed again (RED before #4354: clear for good)
 *   3. the agent's own reply after that: clear
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-notice-4354-')));
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
const store = require('./engine/store');
const create = require('./engine/create');
const swarm = require('./engine/swarm');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const { start, server, keepAgentReply, swarmSweepDeps } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, 'hive4354')]);

const LEAD = 'hive4354';
let base;
test.before(async () => {
  const dir = create.workerDir(LEAD);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# ${LEAD}\n\n${swarm.START}\n${swarm.blockBody(3)}\n${swarm.END}\n`);
  store.writeProfile(LEAD, swarm.birthProfile({ dailyTokenLimit: 1000 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

async function owes() {
  const res = await fetch(`${base}/api/agent/${LEAD}/thread`);
  assert.equal(res.status, 200, 'the thread route did not answer for the fixture swarm');
  return (await res.json()).owes;
}

/** One pass of the REAL sweep, through the server's own deps, with the lead's pane on a fake board. */
function sweep(tokensToday, now) {
  const board = fleet.install([fleet.agent(LEAD, { state: 'idle' })]);
  chat.setRunner(() => ({ ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
  chat.setDryRun(false);
  try {
    return swarm.sweepOnce([{ name: LEAD, tokensToday }], swarmSweepDeps(board.agents), now);
  } finally { chat.setRunner(null); chat.setDryRun(true); board.restore(); }
}

test('#4354: the daily-limit notice stands in while paused, and the unanswered question is owed again once running', async () => {
  chat.appendMessage(chat.DIRECT, LEAD, {
    text: 'Did the supplier invoice go out?',
    at: new Date(Date.now() - 10 * 60000).toISOString(),
    delivery: { state: chat.DELIVERY.PLACED },
  });
  assert.equal((await owes()).state, 'owes', 'CONTROL: the question is owed before any notice');

  /* A sweep clock AHEAD of the wall clock (review iteration 2): the notice must be stamped with the sweep's own
     `now`, the clock pausedAt is written with, or it reads as older than its own pause and does not stand. */
  const now = Date.now() + 5 * 60000;
  assert.deepEqual(sweep(5000, now).map((d) => d.action), ['paused'], 'fixture: the sweep did not pause the swarm');
  const rows = chat.readThread(chat.DIRECT, LEAD).messages;
  const notice = rows[rows.length - 1];
  assert.equal(notice.from, LEAD, 'fixture: the notice is not in the agent\'s name');
  assert.equal(notice.kosmos, true, 'the notice was stored without the mark that says Kosmos wrote it');
  assert.equal(notice.at, swarm.settingsOf(store.readProfile(LEAD)).pausedAt, 'the notice and its pause were stamped from two clocks');
  assert.equal((await owes()).state, 'clear', 'while paused, the notice already says why no answer is coming');

  assert.deepEqual(sweep(0, now + 36 * 3600 * 1000).map((d) => d.action), ['resumed'], 'fixture: the next day\'s sweep did not switch it back on');
  assert.equal(swarm.settingsOf(store.readProfile(LEAD)).active, true);
  assert.equal((await owes()).state, 'owes', 'running again and still unanswered, but the notice kept the line away for good');

  keepAgentReply(LEAD, 'Yes, it went out this morning.');
  assert.equal((await owes()).state, 'clear', 'CONTROL: the agent\'s real reply clears it');
});
