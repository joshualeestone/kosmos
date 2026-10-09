'use strict';
/**
 * #4603 N12 (0.7.15 diagnostic, retested on a Meta seat): `kosmos whoami` named a Muse (Meta) agent's sign-in but not
 * its model. Muse says its model only inside each turn, and the card never read one (status.js gave a Muse pane
 * model: null). The front now keeps the last model a turn named (engine/musefront.js keepModel), the card reads it
 * (status.js readMuseSession), and whoami takes it as it does for Grok and Gemini (the card's own model).
 */
const test = require('node:test');
const jobfix = require('./test-support/jobfixture');   // #5432: the agent's job as this platform writes it (plist / systemd unit)
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whoami-muse-4603-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
// #5432: on Linux the agent's job is a systemd user unit, kept in this sandbox too (a sandboxed board without it refuses
// every systemd call, so a create ends partial on a Linux runner). macOS and Windows never read it.
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = require('node:path').join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
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
  fs.writeFileSync(jobfix.jobPath('mia'), jobfix.jobFor('mia', '/usr/local/bin/node', '/opt/homebrew/bin/tmux', null, null, 'muse'), 'utf8');
  assert.equal(create.readJob('mia').runner, 'muse', 'fixture: the job does not read back as muse');
  t.after(() => { try { fs.unlinkSync(jobfix.jobPath('mia')); } catch { /* not written */ } });
  const card = () => {
    const board = fleet.install([fleet.agent('mia', { state: 'unknown', runner: 'muse', command: 'node' })]);
    try { return board.agents.find((a) => a.name === 'mia' || a.sessionName === 'mia'); } finally { board.restore(); }
  };
  // CONTROL: no turn has named a model yet, so the card says none and whoami claims none.
  const before = card();
  assert.ok(before, 'the fleet gave no card');
  assert.equal(before.model || null, null, 'a model was claimed before any turn named one');
  assert.equal(whoamiFor(before, [], NO_LIVE()).model, null);
  // #5636 F5 (0.7.33): the real path from a Muse card with no model reaches the sentence that says why and what to do.
  const w0 = whoamiFor(before, [], NO_LIVE());
  assert.equal(w0.resolvedRunner, 'muse', 'premise: the card resolves as a Muse agent');
  assert.match(require('./server').sentenceForWhoami(w0.account, w0.model, w0.resolvedRunner), /Tell your person: a restart from its page in Kosmos may fix it, and if a later turn still says so after that, Kosmos cannot read this agent's model/);

  const dir = create.workerDir('mia');
  assert.equal(musefront.keepModel(dir, 'muse-spark-1'), true, 'fixture: the model was not kept');
  const after = card();
  assert.equal(after.model, 'muse-spark-1', 'the card did not read the kept model');
  const who = whoamiFor(after, [], NO_LIVE());
  assert.equal(who.model && who.model.id, 'muse-spark-1', JSON.stringify(who.model));
  assert.equal(who.source.model, 'session', 'answered from somewhere other than the card\'s own record');
  assert.equal(who.model.name, 'Muse Spark 1');
  assert.match(sentenceForWhoami(who.account, who.model, who.resolvedRunner), /Meta Muse agent, .*its model is Muse Spark 1\./);
});

/* Review 1: the agent can write that file. A fifo in its place must not hang the board's tick, and names no model.
   A guard, green on origin/main by design (main reads no Muse model at all): it pins against a bare read returning.
   (On a bare read this arm does not fail cleanly: card() blocks and the runner's timeout kills the file.) */
test('#4603 N12 review 1: a fifo at the model file neither hangs the board nor names a model', (t) => {
  fs.writeFileSync(jobfix.jobPath('mib'), jobfix.jobFor('mib', '/usr/local/bin/node', '/opt/homebrew/bin/tmux', null, null, 'muse'), 'utf8');
  t.after(() => { try { fs.unlinkSync(jobfix.jobPath('mib')); } catch { /* not written */ } });
  assert.equal(create.readJob('mib').runner, 'muse', 'fixture: the job does not read back as muse, so the fifo would never be read');
  const dir = create.workerDir('mib');
  fs.mkdirSync(path.dirname(musefront.modelFile(dir)), { recursive: true });
  try { require('node:child_process').execFileSync('mkfifo', [musefront.modelFile(dir)]); }
  catch { t.skip('mkfifo is not available here'); return; }
  const board = fleet.install([fleet.agent('mib', { state: 'unknown', runner: 'muse', command: 'node' })]);
  try {
    const c = board.agents.find((a) => a.name === 'mib' || a.sessionName === 'mib');
    assert.ok(c, 'the fleet gave no card');
    assert.equal(c.model || null, null, 'a fifo was read as a model');
  } finally { board.restore(); }
});
