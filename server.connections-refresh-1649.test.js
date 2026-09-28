'use strict';

/**
 * Every agent's connections block is refreshed when the board starts (#1649).
 *
 * 🛑 THE SAME DEFECT AS THE SUPERVISOR REFRESH, IN A DIFFERENT FILE.
 * `connections.syncEveryone` had exactly one caller, `POST /api/you`, so an edit
 * to `blockBody()` reached an agent that already existed only when somebody
 * happened to save the About-you form.
 *
 * ⚠️ IT ASSERTS THE FILE, NOT THE AGENT, and that is deliberate rather than a
 * weaker test. `engine/instructions.js` says an instruction file is read ONCE at
 * session start, so nothing this product does can make a LIVE agent know
 * something new. What is testable, and what the fix actually buys, is that the
 * file is already right at the agent's next start.
 *
 * ⚠️ THIS RUNS THE REAL SERVER as a child process, because the behaviour lives
 * behind `require.main === module` and is unreachable from a require. Same shape
 * as server.supervisor-refresh.test.js, deliberately.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = __dirname;
const fleet = require('./test-support/fleet');
const { runUntilBanner } = require('./test-support/board-child');
const connections = require('./engine/connections');

/* ⚠️ THE `-discord` SUFFIX IS LOAD-BEARING, not decoration. `status.isNamedOurs`
   recognises an agent either by a tmux user option Kosmos sets at creation, which
   a fixture cannot fake, or by that legacy suffix. Without it every fixture agent
   is anonymous, `syncEveryone` skips it, and this whole file passes vacuously by
   asserting nothing about a fleet of zero. The existing browser-check fixtures use
   `april-discord` for the same reason. */
function sandbox(agents) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-conn-1649-'));
  const workers = path.join(sb, 'workers');
  fs.mkdirSync(workers, { recursive: true });
  const lines = [];
  for (const a of agents) {
    if (a.file !== null) {
      /* 🔑 THE FOLDER DROPS THE SUFFIX. A session named `x-discord` is the agent
         `x`, so its instructions live in `workers/x/`, not `workers/x-discord/`.
         Creating the folder under the session name instead produced "it has no
         folder of its own on this computer yet" for every fixture agent, which
         is a real refusal from the product and an entirely fake test failure. */
      const dir = path.join(workers, a.name.replace(/-discord$/, ''));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), a.file);
    }
    lines.push(fleet.line({ session: a.name }));
  }
  fs.writeFileSync(path.join(sb, 'panes.txt'), lines.join('\n') + '\n');
  return sb;
}

function boot(sb) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      /* 🛑 BOTH OF THESE, AND THE FIRST ONE IS THE ONE THAT MATTERS.
         `AGENT_WORKFORCE_FAKE_PANES` is read by the fake tmux, NOT by
         engine/status.js, so setting it alone leaves the roster resolving the
         REAL tmux and the REAL fleet. Booting this test without TMUX_BIN gave a
         roster of 18 live agents; nothing was written only because
         AGENT_WORKFORCE_WORKERS pointed at the sandbox, so every one came back
         COULD_NOT. A boot-time WRITE path plus a half-sandboxed roster is how a
         test edits real agents' instructions. */
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return runUntilBanner(child, { settleMs: 300 }).then((r) => {
    assert.equal(r.dead, true, 'the board was still running, so deleting its sandbox now would race it');
    return r;
  });
}

const MARKER = connections.START;

test('#1649: one board start refreshes writable agents, skips a missing file, and survives the refusal', async (t) => {
  /* These are three observations of ONE startup, not three startup scenarios. The old
     file booted the full board once per observation. On a quiet box that was about
     0.5 s each; under full-suite contention a cold boot crossed the banner bound and
     then paid the stop grace, producing the measured 13-15 s failures. A mixed roster
     exercises every branch in one real boot without weakening any assertion. */
  const sb = sandbox([
    { name: 'pp-agent-discord', file: '# I am an agent\n\nSome prose.\n' },
    { name: 'pp-ok-discord', file: '# ok\n' },
    { name: 'pp-nofile-discord', file: null },
  ]);
  const existing = path.join(sb, 'workers', 'pp-agent', 'CLAUDE.md');
  const writable = path.join(sb, 'workers', 'pp-ok', 'CLAUDE.md');
  const missing = path.join(sb, 'workers', 'pp-nofile', 'CLAUDE.md');

  assert.equal(fs.readFileSync(existing, 'utf8').includes(MARKER), false,
    'precondition: the existing agent starts WITHOUT the block, or this test proves nothing');
  let result;
  try {
    result = await boot(sb);

    await t.test('an agent that existed before the edit gets the block', () => {
      assert.equal(fs.readFileSync(existing, 'utf8').includes(MARKER), true,
        'the board start must put the managed block into an existing agent, with nobody saving a form');
    });

    await t.test('CONTROL: an agent whose file we never created is not invented', () => {
      /* The negative arm for the write: booting must not CREATE an instructions file
         for an agent that has none. `tellAgent` refuses that explicitly. */
      assert.equal(fs.existsSync(missing), false,
        'the board must not create an instructions file for an agent that has none');
    });

    await t.test('a refusal is nonfatal and does not stop writable siblings', () => {
      /* A board that refuses to boot because one agent cannot be rewritten is worse than stale text. */
      assert.match(result.out, /Kosmos on http/, 'the board must start even when an agent could not be told');
      assert.equal(fs.readFileSync(writable, 'utf8').includes(MARKER), true,
        'the agents it COULD tell are still told');
    });
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
});
