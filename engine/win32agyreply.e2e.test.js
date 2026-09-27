'use strict';
/**
 * #3568 TRUE END-TO-END on Windows: a Gemini-on-a-Google-subscription (Antigravity, agy) agent, born
 * through the REAL create flow with its REAL generated brief (AGENTS.md), given a PLAIN operator
 * message, (1) enumerates LIVE and (2) its reply LANDS on the board. The codex version of this test
 * (win32codexreply.e2e.test.js) is the model: nothing on the path under test is faked. The turn runs
 * through the real win32codexsup loop, the real win32launch.childEnv('antigravity') and the real
 * win32agy.runAgyTurn (its own agy home, the no-browser stub first on PATH, the sign-in check first).
 *
 * WIN32-GATED AND SIGN-IN-GATED: it runs the real agy.exe and spends one real turn on the Google
 * subscription signed in on this computer, so it SKIPS off-win32, when agy is not at AGY_BIN (or
 * KOSMOS_TEST_AGY_BIN), and when `agy models` says it is not signed in. It touches neither the
 * operator's store nor the live board: a sandboxed data root and a board on port 0.
 *
 *   node -r <no-schtasks-preload> --test engine/win32agyreply.e2e.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-e2e-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const AGY_BIN = process.env.KOSMOS_TEST_AGY_BIN || 'C:\\Users\\joshu\\work\\agy-e2e\\runners\\antigravity\\agy.exe';
const AGENT = 'agye2e';

async function signedIn() {
  if (process.platform !== 'win32' || !fs.existsSync(AGY_BIN)) return false;
  const w = require('./win32agy');
  const r = await w.modelsCheck(AGY_BIN, path.join(SANDBOX, 'probe', '.gemini'), { tmp: path.join(SANDBOX, 'probe', 'tmp') });
  return r.signedIn === true;
}

test('#3568 an Antigravity agent BORN FROM ITS REAL BRIEF, given a plain message, enumerates live and its reply LANDS', { timeout: 300000 }, async (t) => {
  if (!(await signedIn())) { t.skip('needs Windows, agy at ' + AGY_BIN + ', and a Google sign-in on this computer'); return; }
  const { start, server, boardAuthState } = require('../server');
  const chat = require('./chat');
  const liveness = require('./liveness');
  const win32streamstate = require('./win32streamstate');
  const win32codexlive = require('./win32codexlive');
  const win32sessions = require('./win32sessions');
  const create = require('./create');
  const job = require('./win32job');
  const win32agy = require('./win32agy');
  const { superviseCodexStreaming } = require('./win32codexsup');
  const fleet = require('../test-support/fleet');

  win32agy.setSwitchForTests(() => true);   // the Windows switch, on for this test only
  await start(0);
  const port = server.address().port;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');

  require('./status').paneRoster = () => [];
  let seq = 0;
  job.setAnchorer(() => ({ ok: true, node: 'C:\\Anchor\\node.exe', boot: 'C:\\Anchor\\boot.js' }));
  job.setRunner((args) => {
    if (args && args[0] === '/Run') win32sessions.record('born-' + (++seq) + '-0000', { name: AGENT, runner: 'antigravity' });
    if (args && args[0] === '/Query') return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: '' };
  });
  const born = create.createAgent({ name: AGENT, role: 'ea', provider: 'antigravity', antigravityBin: AGY_BIN });
  assert.equal(born.outcome, create.OUTCOME.CREATED, 'the Antigravity agent was created (' + (born.because || '') + ')');
  const cwd = create.workerDir(AGENT);
  const brief = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
  assert.ok(brief.includes('kosmos reply'), 'the REAL brief teaches kosmos reply');

  const tools = path.join(__dirname, '..', 'tools', 'windows');
  const bundle = path.join(SANDBOX, 'bundle');
  const bin = path.join(bundle, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(path.join(tools, 'kosmos.ps1'), path.join(bin, 'kosmos.ps1'));
  fs.copyFileSync(path.join(tools, 'kosmos-cli.js'), path.join(bin, 'kosmos-cli.js'));
  fs.symlinkSync(path.dirname(process.execPath), path.join(bundle, 'runtime'), 'junction');
  fs.mkdirSync(path.join(bundle, 'app'), { recursive: true });
  fs.symlinkSync(__dirname, path.join(bundle, 'app', 'engine'), 'junction');
  process.env.KOSMOS_PORT = String(port);

  fleet.install([fleet.agent(AGENT, { state: 'idle' })]);
  liveness.seen(AGENT);
  const events = [];
  const publisher = win32streamstate.publisher(AGENT, { onProblem: (why) => events.push('state-problem -- ' + why) });
  const h = superviseCodexStreaming(
    { name: AGENT, cwd, runner: 'antigravity', claudeBin: AGY_BIN },
    { bin: AGY_BIN, cliDir: bin, stream: publisher, onEvent: (e) => events.push(e.action + (e.because ? ' -- ' + e.because : '')) },
  );
  const beat = setInterval(() => { try { liveness.seen(AGENT); } catch { /* best effort */ } }, 5000);
  try {
    const mine = win32codexlive.liveSessions().find((r) => r.name === AGENT);
    assert.ok(mine, 'the Antigravity agent is enumerated LIVE (events: ' + JSON.stringify(events) + ')');
    assert.equal(mine.runner, 'antigravity');
    await new Promise((res) => h.send('[message from your operator \u00b7 to answer, run: kosmos reply] hi', res));
    const landed = await waitFor(() => {
      let msgs = [];
      try { msgs = chat.readThread(chat.DIRECT, AGENT).messages || []; } catch { msgs = []; }
      return msgs.find((m) => typeof m.text === 'string' && m.text.trim().length > 0);
    }, 240000);
    assert.ok(landed, 'a reply from the Antigravity agent reached the board (events: ' + JSON.stringify(events) + ')');
    assert.equal(landed.from, AGENT, 'the reply is attributed to this agent');
    // Its own agy home, under the sandboxed data root, with its folder pre-trusted there.
    const settings = JSON.parse(fs.readFileSync(path.join(win32agy.agentHome(AGENT).geminiDir, 'antigravity-cli', 'settings.json'), 'utf8'));
    assert.ok(settings.trustedWorkspaces.includes(fs.realpathSync(cwd)), 'the agent folder was pre-trusted in its own agy home');
  } finally {
    clearInterval(beat);
    h.stop();
    win32agy.setSwitchForTests(null);
    try { fleet.restore(); } catch { /* best effort */ }
    try { job.setRunner(null); } catch { /* best effort */ }
    try { job.setAnchorer(null); } catch { /* best effort */ }
    await new Promise((res) => server.close(res));
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function waitFor(pred, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      let v = false;
      try { v = pred(); } catch { v = false; }
      if (v) return resolve(v);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 500);
    };
    tick();
  });
}
