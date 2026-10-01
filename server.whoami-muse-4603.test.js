'use strict';
/**
 * #4603 N12 (0.7.15 diagnostic, retested on a Meta seat): `kosmos whoami` named a Muse (Meta) agent's sign-in but not
 * its model. Muse says its model only inside each turn, and the card never read one (status.js gave a Muse pane
 * model: null). The front now keeps the last model a turn named (engine/musefront.js keepModel), the card reads it
 * (status.js readMuseSession), and whoami takes it as it does for Grok and Gemini (the card's own model).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whoami-muse-4603-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const srv = require('./server');
const { whoamiFor, sentenceForWhoami, setLiveReader } = srv;
const create = require('./engine/create');
const musefront = require('./engine/musefront');
const fleet = require('./test-support/fleet');

const NO_LIVE = () => ({ ok: false, because: 'nothing that looks like Claude Code or Codex is running under it' });
test.before(() => setLiveReader(NO_LIVE));
test.after(() => { setLiveReader(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#4603 N12: a Muse agent\'s card and whoami name the model its last turn named; with none kept, nothing is claimed', (t) => {
  fs.writeFileSync(create.plistPath('mia'), create.plistFor('mia', '/usr/local/bin/node', '/opt/homebrew/bin/tmux', null, null, 'muse'), 'utf8');
  assert.equal(create.readJob('mia').runner, 'muse', 'fixture: the job does not read back as muse');
  t.after(() => { try { fs.unlinkSync(create.plistPath('mia')); } catch { /* not written */ } });
  const card = () => {
    const board = fleet.install([fleet.agent('mia', { state: 'idle', runner: 'muse', command: 'node' })]);
    try { return board.agents.find((a) => a.name === 'mia' || a.sessionName === 'mia'); } finally { board.restore(); }
  };
  // CONTROL: no turn has named a model yet, so the card says none and whoami claims none.
  const before = card();
  assert.ok(before, 'the fleet gave no card');
  assert.equal(before.model || null, null, 'a model was claimed before any turn named one');
  assert.equal(whoamiFor(before, [], NO_LIVE()).model, null);

  const dir = create.workerDir('mia');
  assert.equal(musefront.keepModel(dir, 'muse-spark-1'), true, 'fixture: the model was not kept');
  const after = card();
  assert.equal(after.model, 'muse-spark-1', 'the card did not read the kept model');
  const who = whoamiFor(after, [], NO_LIVE());
  assert.equal(who.model && who.model.id, 'muse-spark-1', JSON.stringify(who.model));
  assert.equal(who.source.model, 'session', 'answered from somewhere other than the card\'s own record');
  assert.equal(who.model.name, 'Muse Spark 1');
  assert.match(sentenceForWhoami(who.account, who.model, who.resolvedRunner), /Meta Muse agent, .*its model is Muse Spark 1\./);

  // Review 1: the agent can write that file. A fifo in its place must not hang the board's tick, and names no model.
  fs.rmSync(musefront.modelFile(dir));
  require('node:child_process').execFileSync('mkfifo', [musefront.modelFile(dir)]);
  const t0 = Date.now();
  const fifo = card();
  assert.ok(Date.now() - t0 < 10000, 'the board waited on a fifo');
  assert.equal(fifo.model || null, null, 'a fifo was read as a model');
});
