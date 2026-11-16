'use strict';
/**
 * kosmos#8599: a `kosmos` command whose reader stops early (`| head -1`, `less` quit early, `grep -q`) stops quietly.
 *
 * Node ignores SIGPIPE, so a write to a pipe whose reader has gone does not end the process the way it ends a C
 * program: it raises EPIPE on the stream, and with no 'error' listener that is an unhandled 'error' event and a stack
 * trace on stderr. The output the person wanted was already printed; the trace reads as a failure.
 *
 * install() gives stdout and stderr one listener: EPIPE exits with 141 (128 + SIGPIPE, what a shell reports for a
 * program a closed pipe stopped); any other stream error is thrown again, so it still fails as loudly as before.
 * The exit is immediate (no async cleanup); for a CLI that is the point. The board loads it too when install/kosmos
 * starts it, and a board whose stdout pipe closes now exits 141 instead of crashing with a trace (it ended either
 * way; server.js has no uncaughtException handler).
 *
 * How it reaches the CLI:
 * - Mac and Linux: install/kosmos runs many separate node children. It adds `--require <this file>` to NODE_OPTIONS
 *   once, and sets KOSMOS_CLIPIPE_SET=1 with the person's own NODE_OPTIONS saved beside it. Loaded that way, this
 *   module puts NODE_OPTIONS back as it was before the node's own code runs, so nothing that node starts (an agent,
 *   a setup run) inherits the preload. The wrapper's own non-node children (curl, git) still carry it; they do not
 *   read it.
 * - Windows: tools/windows/kosmos-cli.js is one node program and calls install() itself.
 */

const QUIT_ON_CLOSED_READER = 141;

/** One stream: EPIPE is a quiet exit, anything else is thrown again. */
function guardStream(stream, proc) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (e) => {
    if (e && e.code === 'EPIPE') { proc.exit(QUIT_ON_CLOSED_READER); return; }
    throw e;
  });
}

/** Guard this process's stdout and stderr. A second call does nothing. */
function install(proc) {
  const p = proc || process;
  if (p.__kosmosClipipe) return;
  p.__kosmosClipipe = true;
  guardStream(p.stdout, p);
  guardStream(p.stderr, p);
}

/** Put NODE_OPTIONS back to what it was before install/kosmos added the preload, and drop the markers. */
function restoreNodeOptions(env) {
  if (env.KOSMOS_CLIPIPE_SET !== '1') return false;
  if (env.KOSMOS_USER_NODE_OPTIONS_SET === '1') env.NODE_OPTIONS = env.KOSMOS_USER_NODE_OPTIONS || '';
  else delete env.NODE_OPTIONS;
  delete env.KOSMOS_CLIPIPE_SET;
  delete env.KOSMOS_USER_NODE_OPTIONS;
  delete env.KOSMOS_USER_NODE_OPTIONS_SET;
  return true;
}

module.exports = { install, restoreNodeOptions, QUIT_ON_CLOSED_READER };

// Loaded as install/kosmos's preload: restore the environment, then guard.
if (restoreNodeOptions(process.env)) install(process);
