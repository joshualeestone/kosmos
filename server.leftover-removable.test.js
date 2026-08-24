'use strict';

/**
 * #127: a folder-or-job leftover with no live session was invisible in the
 * product, and therefore unremovable from it, while `create.js` still refused
 * the name because the leftover existed. The name became permanently unusable.
 *
 * #278 taught the roster to supplement itself from disk, but only for agents
 * with a WORKER FOLDER (`server.js` filtered the survey on `k.folder`). An
 * agent whose folder was deleted while its launchd job survived (the shape a
 * removed worktree takes: the directory gone, the work not) fell straight back
 * out of the roster, even though `create.js` refuses its name (`:715`, a job
 * with no folder) and `remove.js` can clear it (`exists()` gates on `jobFor`).
 *
 * The fix: the offline roster now includes a leftover with a folder OR a job.
 * A job-only leftover appears as a not-running agent, which is exactly what
 * gives it a Remove control in the detail panel (the panel resolves an agent
 * out of the live roster, so a name that is not in it has no reachable
 * control). Visible and removable, which the card asks for together.
 *
 * This drives the real server against a sandboxed store with a stub tmux, the
 * same harness `web.not-running.test.js` uses. It fails against the pre-fix
 * `k.folder`-only filter: the leftover is simply absent from the roster.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const create = require('./engine/create');

/**
 * Stand up a board with one `leftover` agent that has a profile and a launchd
 * job but NO worker folder, plus a fetch of that agent's removal plan. Returns
 * `{ status, removal }`, both parsed. A real server, a sandboxed store, a stub
 * tmux that reports an empty fleet so nothing is offline "merely by being
 * unseen".
 */
function boardWithJobOnlyLeftover() {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-lr-'));
  const profiles = nodePath.join(sb, 'data', 'AgentWorkforce', 'profiles');
  const launch = nodePath.join(sb, 'launch');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(launch, { recursive: true });

  // A profile: Kosmos's own record that this agent exists, which is how the
  // survey knows the name at all.
  fs.writeFileSync(nodePath.join(profiles, 'leftover.json'),
    JSON.stringify({ role: 'Researcher', displayName: 'Leftover' }));
  // A launchd job, and DELIBERATELY NO WORKER FOLDER under sb/workers.
  // `plistFor` is a pure template, so it needs no environment here.
  fs.writeFileSync(nodePath.join(launch, 'com.kosmos.agent.leftover.plist'),
    create.plistFor('leftover', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'));

  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // An empty fleet: tmux lists no panes, so `leftover` is offline because of
  // its own state, not because a partial read hid a running pane.
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    const get = (path) => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve(s));
      });
    });
    srv.listen(0, '127.0.0.1', async () => {
      const status = await get('/api/status');
      const removal = await get('/api/agent/leftover/removal');
      process.stdout.write(JSON.stringify({ status, removal }));
      srv.close(); process.exit(0);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: launch,
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'), // sandboxed whole (#634)
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  const both = JSON.parse(out);
  return { status: JSON.parse(both.status), removal: JSON.parse(both.removal) };
}

test('#127: a job-only leftover (no folder) is visible in the roster', () => {
  const { status } = boardWithJobOnlyLeftover();
  const row = (status.agents || []).find((a) => a.sessionName === 'leftover');
  assert.ok(row, 'a leftover with a job but no folder was absent from the roster (the #127 defect)');
  assert.equal(row.running, false, 'the leftover is not running and must say so');
  assert.equal(row.state, 'stopped');
  assert.match(row.because, /folder is gone|leftover startup job/,
    'the row does not explain the folder-gone state that #127 surfaces');
  // Counted as not-running, not dropped from the arithmetic.
  assert.ok(typeof status.counts.notRunning === 'number' && status.counts.notRunning >= 1,
    'the leftover was not counted among the not-running agents');
});

test('#127: the visible leftover is removable, so the name can be freed', () => {
  const { removal } = boardWithJobOnlyLeftover();
  // The removal plan (what a DELETE would do) must recognise the leftover and
  // offer to clear it. This is what the now-reachable Remove control drives.
  assert.equal(removal.ok, true,
    'the product cannot remove a leftover it now shows, so its name stays unusable: ' + JSON.stringify(removal));
});
