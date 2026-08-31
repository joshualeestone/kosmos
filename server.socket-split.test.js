'use strict';

/**
 * #668: the board and the launchd supervisor each resolve which tmux server
 * to talk to from their OWN environment, and when they disagree the board
 * published "Not running" -- state stopped, confidence structured -- about an
 * agent whose job launchd said was RUNNING the whole time. A confident
 * negative manufactured from a socket assumption: creation said "started it",
 * the board said "Not running" forever, and a full-permission agent ran where
 * nothing could see, reach, or stop it (witnessed live on the first-run
 * journey walk, 2026-08-24).
 *
 * The fix has two seams; this file drives the roster one: an offline row
 * whose job holds a live process refuses the confident "stopped" (state
 * unknown, confidence none, jobRunningUnseen) and its sentence names the two
 * disagreeing facts. The plist seam (TMUX_TMPDIR carried into the job) is
 * pinned in engine/create.test.js.
 *
 * Same harness as server.leftover-removable.test.js: the real server against
 * a sandboxed store with a stub tmux reporting an empty fleet. launchd's
 * answer is faked through create.setRunner INSIDE the child, because the
 * probes call /bin/launchctl by absolute path and this suite must not depend
 * on -- or touch -- the launchd of the machine running it.
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
 * A board with one created-looking agent (profile, folder, job) that has no
 * visible session, with launchd answering `list` as the caller says. Returns
 * the parsed /api/status.
 */
function boardWithUnseenAgent(launchctlListStdout) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-split-'));
  const profiles = nodePath.join(sb, 'data', 'AgentWorkforce', 'profiles');
  const launch = nodePath.join(sb, 'launch');
  const worker = nodePath.join(sb, 'workers', 'ghost');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(launch, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });

  fs.writeFileSync(nodePath.join(profiles, 'ghost.json'),
    JSON.stringify({ role: 'Researcher', displayName: 'Ghost' }));
  fs.writeFileSync(nodePath.join(launch, 'com.kosmos.agent.ghost.plist'),
    create.plistFor('ghost', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'));

  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // An empty fleet: the board can see no session for ghost, which is the
  // half of the disagreement the board holds.
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const create = require(${JSON.stringify(nodePath.join(REPO, 'engine', 'create.js'))});
    // launchd's half of the disagreement, faked at the one seam every
    // launchctl read goes through. Anything that is not the fleet list
    // answers empty, so no probe touches the real launchd.
    create.setRunner((file, args) => {
      if (/launchctl$/.test(String(file)) && args && args[0] === 'list') {
        return { ok: true, stdout: ${JSON.stringify(launchctlListStdout)} };
      }
      return { ok: true, stdout: '' };
    });
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(s);
          srv.close(); process.exit(0);
        });
      });
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      /* kosmos#1651: DRY_RUN stops tmux WRITES; the roster is a READ and only
         TMUX_BIN redirects one, so the whole-sandbox guard now requires it. */
      AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: launch,
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'), // sandboxed whole (#634)
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

test('#668: a job launchd says is running with no visible session says so, instead of claiming stopped', () => {
  const status = boardWithUnseenAgent('PID\tStatus\tLabel\n90870\t0\tcom.kosmos.agent.ghost\n');
  const row = (status.agents || []).find((a) => a.sessionName === 'ghost');
  assert.ok(row, 'the agent fell out of the roster entirely');
  assert.equal(row.jobRunningUnseen, true,
    'the flag the card branches on is absent, so the pill stays a confident "Not running"');
  assert.equal(row.state, 'unknown',
    'the row still claims stopped about an agent launchd says is running (the #668 inversion)');
  assert.equal(row.stateConfidence, 'none',
    'a state we could not read carries a confidence that says we read it');
  assert.equal(row.running, false, 'there is still no pane to act on, and running answers that');
  assert.match(row.because, /background job is running/,
    'the sentence does not carry launchd\'s half of the disagreement');
  assert.match(row.because, /no session for it is visible/,
    'the sentence does not carry the board\'s half of the disagreement');
  assert.doesNotMatch(row.because, /tmux/i,
    'a terminal word reached a person-facing sentence (Mona Lisa\'s ruling)');
});

/* ── the pill, rendered from the real row ────────────────────────────────
   Same lift-the-renderer shape as web.not-running.test.js, driven by the row
   the route actually fabricates (fixture discipline: the row under test is
   asked for, never written here). STATE_COPY is injected rather than stubbed
   with copied words: the assertion pins that the pill SAYS the page's
   could-not-check label and stops claiming "Not running", not what that
   label's words are -- those belong to the page. */
const page = require('./test-support/page');
const PAGE_SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(REPO, 'web', 'index.html'), 'utf8'));

function renderOffline(which, a) {
  const fn = new Function('a', 'esc', 'GLYPH', 'PRESSAY', 'STATE_COPY', 'roleLine', 'discTint', 'discInk', 'initials', 'ROLE_TITLES',
    `${page.lift(PAGE_SCRIPT, 'face')}\n${page.lift(PAGE_SCRIPT, which)}\nreturn ${which}(a);`);
  return fn(a, (x) => String(x == null ? '' : x),
    { stopped: '<span class="stop"></span>', unknown: '<span class="qmark">?</span>' },
    { off: 'Not running' },
    { unknown: { label: 'PAGES-OWN-UNKNOWN-WORD' }, stopped: { label: 'Not running' } },
    (x) => x.role || '', () => '#eee', () => '#111', (n) => n[0], null);
}

test('#668: the card and the row wear the could-not-check pill, not a confident "Not running"', () => {
  const status = boardWithUnseenAgent('PID\tStatus\tLabel\n90870\t0\tcom.kosmos.agent.ghost\n');
  const row = (status.agents || []).find((a) => a.sessionName === 'ghost');
  assert.ok(row && row.jobRunningUnseen === true, 'no unseen row to render; the route half of this fix regressed');
  for (const which of ['card', 'lrow']) {
    const html = renderOffline(which, row);
    assert.ok(html.includes('st-unknown'), which + ' still dresses the pill in the stopped class');
    assert.ok(html.includes('PAGES-OWN-UNKNOWN-WORD'), which + ' does not say the page\'s could-not-check word');
    assert.ok(!html.includes('>Not running<') && !html.includes('Not running.'),
      which + ' still claims "Not running" about an agent launchd says is running');
  }
  /* Control: an ordinary stopped row keeps the pill it always had. */
  const parked = (boardWithUnseenAgent('PID\tStatus\tLabel\n-\t0\tcom.kosmos.agent.ghost\n').agents || [])
    .find((a) => a.sessionName === 'ghost');
  for (const which of ['card', 'lrow']) {
    const html = renderOffline(which, parked);
    assert.ok(html.includes('st-stopped') && html.includes('Not running'),
      which + ' changed the ordinary stopped pill, which this fix has no business doing');
  }
});

test('#668 control: the same agent with a parked job keeps the plain not-running verdict', () => {
  const status = boardWithUnseenAgent('PID\tStatus\tLabel\n-\t0\tcom.kosmos.agent.ghost\n');
  const row = (status.agents || []).find((a) => a.sessionName === 'ghost');
  assert.ok(row, 'the agent fell out of the roster entirely');
  assert.equal(row.jobRunningUnseen, false, 'a parked job was dressed in running-unseen');
  assert.equal(row.state, 'stopped');
  assert.equal(row.stateConfidence, 'structured');
  assert.match(row.because, /nothing on this computer has a session for it/,
    'the ordinary offline sentence changed, which this fix has no business doing');
});
