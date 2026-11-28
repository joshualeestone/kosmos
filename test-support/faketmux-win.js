'use strict';
/**
 * kosmos#8378 group 5 (kosmos#9262): fake tmux's READS, served in process on Windows.
 *
 * Board route tests stage their board through test-support/fake-tmux.sh, set as AGENT_WORKFORCE_TMUX_BIN. It is a
 * `#!/bin/sh` script, which Windows cannot run, so on Windows every read the board makes of it fails and /api/status
 * answers 500 "we could not run tmux at all on this computer" (measured on GitHub's Windows runner, run 46119452790),
 * while the same board with its panes served through engine/status's own seams (as test-support/fleet.js install()
 * does on every platform) answers 200.
 *
 * serveOnWindows() does, on Windows only, what fake-tmux.sh does for the two reads engine/status makes of it, from the
 * same files and with the same defaults (only these; see below):
 *   list-panes    the lines in AGENT_WORKFORCE_FAKE_PANES, or none (an empty board), read on every call so a test that
 *                 rewrites the file sees it, as the script does;
 *   capture-pane  the text in AGENT_WORKFORCE_FAKE_SCREEN, or empty;
 *   display-message  "whose session is this pane in" (engine/messages.js paneSession, through its setRunner seam):
 *                 fixture-discord, for any pane, as the script answers #{session_name}.
 * It installs them through status.setPaneSource and status.setPaneCapture, and test-support/fleet.js restore() returns
 * to them (current()) instead of to "none", so a test that installs and restores a fleet keeps a board it can read.
 * On macOS and Linux it does nothing, so the script stays what those tests run.
 *
 * ⚠️ What it does not stand in for, so nobody reads more into a green than it holds:
 *   - fake tmux's WRITES (send-keys, new-session, kill-session). On Windows the board delivers through the agent's
 *     supervisor, not tmux, so a test that checks a delivery through tmux needs a Windows arm (kosmos#9262 is the card
 *     for that class; no test in this group needed it).
 *   - its other reads: list-sessions (AGENT_WORKFORCE_FAKE_SESSIONS), the pane_current_path folder read
 *     (AGENT_WORKFORCE_FAKE_PANE_FOLDERS), and chat.js's three-field display-message.
 *   - messages.resetForTests() clears the pane-session runner; a file that calls it falls back to the script after.
 *   - In a board child (test-support/faketmux-win-preload.js) only the roster and screen are switched to the fixture:
 *     the board's other Windows roster calls (win32roster.cachedRun's read problem, refreshAsync, which the known-agent
 *     check uses) still run the real `claude agents --json` read, against whatever AGENT_WORKFORCE_CLAUDE_BIN names.
 *   - It does not make a Windows board read tmux: on Windows the product's own roster is engine/win32roster; this only
 *     lets a route test reach the route.
 */
const fs = require('node:fs');

let source = null;
let capture = null;

function readOr(file, fallback) {
  if (!file) return fallback;
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

/** On Windows, serve fake tmux's pane list and screen through engine/status's seams; elsewhere, nothing. */
function serveOnWindows(platform = process.platform) {
  if (platform !== 'win32') return false;
  const status = require('../engine/status');
  source = () => readOr(process.env.AGENT_WORKFORCE_FAKE_PANES, '');
  capture = () => readOr(process.env.AGENT_WORKFORCE_FAKE_SCREEN, '');
  status.setPaneSource(source);
  status.setPaneCapture(capture);
  require('../engine/messages').setRunner(() => ({ ok: true, session: 'fixture-discord' }));
  return true;
}

/** For a board a test starts as a child process: on Windows, the node arguments that load the preload, which calls
    serveOnWindows() in that child before server.js runs; elsewhere none, so the child's argv is what it always was. */
function childArgs(platform = process.platform) {
  return platform === 'win32' ? ['--require', require('node:path').join(__dirname, 'faketmux-win-preload.js')] : [];
}

/** The seams serveOnWindows installed, for fleet.restore() to return to; nulls when it did not run. */
function current() { return { source, capture }; }

module.exports = { serveOnWindows, current, childArgs };
