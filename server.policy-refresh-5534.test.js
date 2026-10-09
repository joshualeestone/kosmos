'use strict';

/**
 * #5534 slice 3: at board start every agent's AI policy block is refreshed, so the company's AI policy text (from the
 * company policy this enrolled Kosmos applied) is in the file at the agent's next start. Same shape as
 * server.connections-refresh-1649.test.js (the real server, a fake tmux, every root sandboxed): it asserts the FILE.
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
const policy = require('./engine/policy');

function sandbox(agents) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pol-5534-'));
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

test('#5534 slice 3: a board start hands the company\'s AI policy to an agent that existed before it was applied', async () => {
  const sb = sandbox([{ name: 'pp-pol-discord', file: '# I am an agent\n\nSome prose.\n' }, { name: 'pp-none-discord', file: null }]);
  const file = path.join(sb, 'workers', 'pp-pol', 'CLAUDE.md');
  // Where the board child's store puts it (store.dataRootFor: the data folder plus the app's own folder).
  const dataRoot = require('./engine/store').dataRootFor(process.platform, os.homedir(), { AGENT_WORKFORCE_DATA: path.join(sb, 'data') });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'org-policy-applied.json'), JSON.stringify({ org: 'org_1', version: 4, iat: 1, applied_at: 1791500000,
    policy: { providers_allowed: null, ai_policy: { name: 'Acme legal', text: 'Never paste client names into a prompt.' } } }));
  assert.equal(fs.readFileSync(file, 'utf8').includes(policy.START), false, 'precondition: the agent starts without the block');
  try {
    const r = await boot(sb);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes(policy.START) && text.includes('Never paste client names into a prompt.'), 'the board start did not hand the company text to an existing agent');
    assert.match(text, /version 4/);
    assert.ok(text.includes('Some prose.'), 'the agent\'s own words did not survive');
    // CONTROL: an agent with no file is not given one.
    assert.equal(fs.existsSync(path.join(sb, 'workers', 'pp-none', 'CLAUDE.md')), false);
    assert.match(r.out, /Kosmos on http/);
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
});
