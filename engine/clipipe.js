'use strict';
/**
 * kosmos#8599: a `kosmos` command whose reader stops early (`| head -1`, `less` quit early, `grep -q`) stops quietly.
 *
 * Node ignores SIGPIPE, so a write to a pipe whose reader has gone does not end the process the way it ends a C
 * program: it raises EPIPE on the stream, and with no 'error' listener that is an unhandled 'error' event and a stack
 * trace on stderr. The output the person wanted was already printed; the trace reads as a failure.
 *
 * install() gives stdout and stderr one listener: a closed reader exits with 141 (128 + SIGPIPE, what a shell reports
 * for a program a closed pipe stopped); any other stream error is thrown again, so it still fails as loudly as before.
 * A closed reader is CLOSED_READER_CODES: EPIPE on a pipe, and ENOTCONN or ECONNRESET when stdio is a socket (Node's
 * own child stdio on macOS is; kosmos#8714 saw `write ENOTCONN` there, macOS CI run 44377549059).
 * Every node install/kosmos runs is guarded this way except the board (below), not only one-shot verbs; no engine
 * file has its own stdout/stderr 'error' handler for this listener to pre-empt. The exit is immediate (no async
 * cleanup, no flush): when stderr's reader is the one that closed, a note the verb was about to write is lost with
 * it. For a closed reader that is the point. Reading process.stdout and process.stderr here creates both streams
 * at startup (Node makes them lazily otherwise); deliberate, since the guard has to be on them before the first write.
 * Only the installed layout is preloaded (install/kosmos looks in app/engine; a source checkout runs unguarded).
 *
 * How it reaches the CLI:
 * - Mac and Linux: install/kosmos runs many separate node children. It adds `--require <this file>` to NODE_OPTIONS
 *   once, and sets KOSMOS_CLIPIPE_SET=1 with the person's own NODE_OPTIONS saved beside it. Loaded that way, this
 *   module puts NODE_OPTIONS back as it was before the node's own code runs, so nothing that node starts (an agent,
 *   a setup run) inherits the preload. The wrapper's own non-node children (curl, git) still carry it; a node one of
 *   them starts restores it the same way.
 * - The board: install/kosmos starts server.js with the preload too. It restores the environment and is NOT guarded,
 *   so the board's behaviour on a closed stdout is unchanged.
 * - Windows: tools/windows/kosmos-cli.js is one node program and calls install() itself.
 */

const QUIT_ON_CLOSED_READER = 141;
const CLOSED_READER_CODES = new Set(['EPIPE', 'ENOTCONN', 'ECONNRESET']);

/** One stream: a closed reader is a quiet exit, anything else is thrown again. Only when this is the stream's ONLY 'error'
 *  listener, which is exactly when Node itself would have crashed: a program with its own handler (a node-based git
 *  hook the wrapper runs, say) handles its errors as before, EPIPE included. */
function guardStream(stream, proc) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (e) => {
    if (typeof stream.listenerCount === 'function' && stream.listenerCount('error') > 1) return;
    if (e && CLOSED_READER_CODES.has(e.code)) { proc.exit(QUIT_ON_CLOSED_READER); return; }
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

module.exports = { install, restoreNodeOptions, QUIT_ON_CLOSED_READER, CLOSED_READER_CODES };

/** The node is the board (server.js), which keeps its own closed-stdout behaviour. */
function isBoard(argv) {
  const entry = (argv && argv[1]) || '';
  return /(^|[\\/])server\.js$/.test(entry);
}

// Loaded as install/kosmos's preload: restore the environment, then guard (not the board).
if (restoreNodeOptions(process.env) && !isBoard(process.argv)) install(process);
