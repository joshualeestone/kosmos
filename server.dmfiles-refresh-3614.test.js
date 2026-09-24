'use strict';

/**
 * Every agent's direct-message files block is refreshed when the board starts (#3614),
 * for the reason #1649 gives for the connections block: a sweep that runs only on an
 * unrelated form save reaches an agent that already exists only by accident. Same
 * shape as server.connections-refresh-1649.test.js, deliberately: it runs the REAL
 * server as a child and asserts the FILE, not the running agent.
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
const dmfiles = require('./engine/dmfiles');

/* ⚠️ THE `-discord` SUFFIX IS LOAD-BEARING, not decoration. `status.isNamedOurs`
   recognises an agent either by a tmux user option Kosmos sets at creation, which
   a fixture cannot fake, or by that legacy suffix. Without it every fixture agent
   is anonymous, `syncEveryone` skips it, and this whole file passes vacuously by
   asserting nothing about a fleet of zero. The existing browser-check fixtures use
   `april-discord` for the same reason. */
function sandbox(agents) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dmfiles-3614-'));
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

const MARKER = dmfiles.START;

test('#3614: an agent that existed before the edit has the block after a plain board start', async () => {
  const sb = sandbox([{ name: 'pp-agent-discord', file: '# I am an agent\n\nSome prose.\n' }]);
  const f = path.join(sb, 'workers', 'pp-agent', 'CLAUDE.md');

  assert.equal(fs.readFileSync(f, 'utf8').includes(MARKER), false,
    'precondition: the agent starts WITHOUT the block, or this test proves nothing');

  await boot(sb);

  assert.equal(fs.readFileSync(f, 'utf8').includes(MARKER), true,
    'the board start must put the managed block into an existing agent, with nobody saving a form');
  const text = fs.readFileSync(f, 'utf8');
  assert.ok(text.includes('`' + path.join(sb, 'workers', 'pp-agent', 'Files') + '`'),
    'the block names THIS agent\'s own Files folder, the real resolved path');
  fs.rmSync(sb, { recursive: true, force: true });
});

test('#3614 CONTROL: an agent whose file we never created is not invented', async () => {
  /* The negative arm for the write: booting must not CREATE an instructions file
     for an agent that has none. `tellAgent` refuses that explicitly, and a fix
     that started writing files for agents would be a much worse bug than the one
     being fixed. */
  const sb = sandbox([{ name: 'pp-nofile-discord', file: null }]);
  await boot(sb);
  assert.equal(fs.existsSync(path.join(sb, 'workers', 'pp-nofile', 'CLAUDE.md')), false,
    'the board must not create an instructions file for an agent that has none');
  fs.rmSync(sb, { recursive: true, force: true });
});

test('#3614: a board whose agents cannot all be written still starts and says so', async () => {
  /* Startup is a far worse place than a form save to discover an unwritable
     agent, because nobody is watching it. The requirement is that the board
     STARTS anyway: a board that refuses to boot because it could not rewrite
     somebody's instructions is strictly worse than one running with the old
     text. */
  const sb = sandbox([
    { name: 'pp-ok-discord', file: '# ok\n' },
    { name: 'pp-nofile-discord', file: null },
  ]);
  const { out } = await boot(sb);
  assert.match(out, /Kosmos on http/, 'the board must start even when an agent could not be told');
  assert.equal(fs.readFileSync(path.join(sb, 'workers', 'pp-ok', 'CLAUDE.md'), 'utf8').includes(MARKER), true,
    'and the agents it COULD tell are still told');
  fs.rmSync(sb, { recursive: true, force: true });
});
