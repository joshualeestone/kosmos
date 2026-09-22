'use strict';
/**
 * #3380 TRUE END-TO-END: a codex (OpenAI) agent, driven through the real
 * supervision path, actually POSTS A REPLY THAT LANDS ON THE BOARD.
 *
 * 🛑 WHY THIS EXISTS, AND WHAT THE PRIOR #3380 TEST COULD NOT SEE. The sibling
 * `win32codexsup.integration.test.js` injected fakes for exactly the layer that
 * was broken: a bare `process.env` instead of the real `win32launch.childEnv`, a
 * no-op stream, a fake prepare/sessions, and it asserted on the codex turn's
 * RETURNED text. So it proved the codex DRIVER returns text -- not that the agent
 * ANSWERS. An agent answers by shelling out to `kosmos reply` (chat.js/win32codex
 * doctrine); the supervisor DISCARDS the turn text. So a test that reads the turn
 * text is green while no reply ever reaches the board. That false signal shipped a
 * non-working fix (0.6.87).
 *
 * 🔑 SO THIS FAKES NOTHING ON THE REPLY PATH. Real board (server.js on an ephemeral
 * port), real `win32create.prepareSession` (mints the sender token the board
 * resolves), real `win32launch.childEnv(..., 'codex')` (the env under which the turn
 * runs -- this is where the bug lived), the real `kosmos.ps1`/`kosmos-cli.js` shims
 * on the agent's PATH, and the real `codex.exe` turn. The agent reads an AGENTS.md
 * that tells it to answer with `kosmos reply`, runs it, and the assertion is that
 * the reply TEXT is in the board's DIRECT thread for this agent.
 *
 * 🔑 THE BUG THIS WOULD HAVE CAUGHT (measured on the box 2026-09-22). codex runs
 * every shell command as `powershell.exe -Command '<cmd>'`; PowerShell resolves
 * bare `kosmos` to `kosmos.ps1`; and this machine's ExecutionPolicy is Undefined
 * (= Restricted), so kosmos.ps1 fails with a PSSecurityException and the reply
 * never runs. The fix sets `PSExecutionPolicyPreference=Bypass` in the codex child
 * env (win32launch.childEnv, codex only). WITHOUT that fix this test's thread stays
 * empty and it fails; WITH it the reply lands.
 *
 * 🛑 WIN32-GATED AND ACCOUNT-GATED, like the sibling: it spawns the real codex
 * binary and makes real API calls, so it SKIPS off-win32 and skips when the binary
 * or the signed-in test home is absent. It touches NEITHER the operator's store nor
 * the live board: everything runs against a throwaway sandbox data dir and a board
 * on port 0.
 *
 *   node --test engine/win32codexreply.e2e.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// ── Sandbox EVERYTHING before requiring anything that freezes store.ROOT ──────
// sendertoken/liveness resolve their dir from store.ROOT at require time, so the
// AGENT_WORKFORCE_* roots must be set first (the loopback test's sequencing).
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-e2e-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const { start, server, boardAuthState } = require('../server');
const chat = require('./chat');
const liveness = require('./liveness');
const win32launch = require('./win32launch');
const { superviseCodexStreaming } = require('./win32codexsup');
const fleet = require('../test-support/fleet');

const CODEX_BIN = 'C:/Users/joshu/.local/share/kosmos/runners/openai/pkg/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const CODEX_HOME = 'C:/Users/joshu/work/codex-test-home';

const ready = process.platform === 'win32'
  && fs.existsSync(CODEX_BIN)
  && fs.existsSync(path.join(CODEX_HOME, 'auth.json'));

const MARKER = 'CODEX_E2E_REPLY_OK';
const AGENT = 'codex-e2e';

test('#3380 a codex agent\'s kosmos reply LANDS on the board (real env, real shims, real board)', { skip: !ready, timeout: 240000 }, async () => {
  // 1. The real board, on an ephemeral port, fully sandboxed (enforcement OFF).
  await start(0);
  const port = server.address().port;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');

  // 2. The zip-shaped bundle the agent's `kosmos` command resolves through:
  //    <bundle>/bin/{kosmos.ps1,kosmos-cli.js}, <bundle>/runtime/node.exe,
  //    <bundle>/app/engine (kosmos-cli.js's engineDir). Junctions need no admin.
  const tools = path.join(__dirname, '..', 'tools', 'windows');
  const bundle = path.join(SANDBOX, 'bundle');
  const bin = path.join(bundle, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(path.join(tools, 'kosmos.ps1'), path.join(bin, 'kosmos.ps1'));
  fs.copyFileSync(path.join(tools, 'kosmos-cli.js'), path.join(bin, 'kosmos-cli.js'));
  fs.symlinkSync(path.dirname(process.execPath), path.join(bundle, 'runtime'), 'junction');
  fs.mkdirSync(path.join(bundle, 'app'), { recursive: true });
  fs.symlinkSync(__dirname, path.join(bundle, 'app', 'engine'), 'junction');

  // 3. The folder the turn runs in, with the brief that teaches the reply. codex
  //    reads AGENTS.md from its cwd; the doctrine an agent is born with says the
  //    same thing, but a tight brief keeps the turn cheap and deterministic.
  const cwd = path.join(SANDBOX, 'agentcwd');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'),
    '# Test agent\n\n'
    + 'You answer your operator by running the shell command `kosmos reply "<your reply>"`.\n'
    + 'When you receive a message, do EXACTLY one thing and then stop: run\n\n'
    + '    kosmos reply "' + MARKER + '"\n\n'
    + 'Do not run anything else. Do not write any files.\n');

  // 4. The account and the board port ride in this process\'s env, so the REAL
  //    childEnv the supervisor builds (below, un-faked) carries them into the turn
  //    -- CODEX_HOME picks the signed-in account, KOSMOS_PORT points the agent\'s
  //    kosmos CLI at THIS sandbox board.
  process.env.CODEX_HOME = CODEX_HOME;
  process.env.KOSMOS_PORT = String(port);

  // 5. The board can only attribute a reply if it can READ THE ROSTER. In
  //    production that roster is the live fleet; a fully-sandboxed board on port 0
  //    has none, so `snapshot()` throws and /api/reply refuses every reply with
  //    "we could not check which agents are running" -- BEFORE it looks at the
  //    sender. This is NOT the bug under test (the bug is that the reply never
  //    RUNS); it is the standard test seam the sibling reply tests use. A one-agent
  //    fake fleet makes the roster readable and carries a card whose name matches
  //    the token the supervisor mints, so the real /api/reply resolver attributes
  //    the reply to this agent. The heartbeat is a belt for the token-only path.
  fleet.install([fleet.agent(AGENT, { state: 'idle' })]);
  liveness.seen(AGENT);

  const events = [];
  const h = superviseCodexStreaming(
    { name: AGENT, cwd, runner: 'codex', claudeBin: CODEX_BIN },
    {
      bin: CODEX_BIN,
      cliDir: bin,               // the bundle\'s bin -> real kosmos.ps1 on the agent\'s PATH
      // NO `env` override: the supervisor builds the REAL win32launch.childEnv(
      //   process.env, token, configDir, cliDir, 'codex') -- the exact production
      //   env, and the one place the bug lived. NO `runTurn`, `prepare`, `stream`,
      //   or `sessions` override either: the real driver, the real session mint,
      //   the real state publisher.
      onEvent: (e) => events.push(e.action + (e.because ? ' -- ' + e.because : '')),
    },
  );
  // Belt: keep the heartbeat fresh in case attribution is checked after a delay.
  const beat = setInterval(() => { try { liveness.seen(AGENT); } catch { /* best effort */ } }, 5000);

  try {
    // The wire a real operator message arrives as: the envelope chat.deliver builds,
    // naming the reply command, followed by the words.
    const wire = '[message from your operator \u00b7 to answer, run: kosmos reply] '
      + 'Please acknowledge that you received this.';
    await new Promise((res) => h.send(wire, res));

    // 6. THE ASSERTION: the reply text is in the board\'s DIRECT thread for this
    //    agent -- written by the real /api/reply route, reached by the agent\'s own
    //    kosmos CLI over HTTP. This is what \"a reply reaches the board\" means.
    const landed = await waitFor(() => {
      let msgs = [];
      try { msgs = chat.readThread(chat.DIRECT, AGENT).messages || []; } catch { msgs = []; }
      return msgs.find((m) => typeof m.text === 'string' && m.text.includes(MARKER));
    }, 200000);

    assert.ok(landed, 'a reply carrying the marker reached the board (events: ' + JSON.stringify(events) + ')');
    assert.equal(landed.from, AGENT, 'the reply is attributed to this agent, not a bare pane');
  } finally {
    clearInterval(beat);
    h.stop();
    try { fleet.restore(); } catch { /* best effort */ }
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
