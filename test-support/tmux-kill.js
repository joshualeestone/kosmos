'use strict';
// kosmos#6857: the ONE way the repo's JavaScript ends a private tmux server by its socket path.
//
// Why a helper and not a rule about how to write the call: a test that isolates tmux with TMUX_TMPDIR=<folder> and
// then runs a bare `tmux kill-server` ends the MACHINE's server whenever that folder is gone by kill time (tmux 3.6a
// skips a TMUX_TMPDIR whose realpath() fails and falls back to /tmp/tmux-<uid>/default). That is how every bot on
// Agent1s was restarted at 14:22 on 2026-10-21 (#6851, #6855). Eleven review rounds of a static check that tried to
// tell, from source, whether a socket path could be the machine's own kept finding new ways it could; this decides
// it at run time instead, where the path is a value and not a guess.
//
// killServerAt(tmuxBin, sockPath, opts):
//   - refuses (throws) when sockPath is the machine's own server: /tmp/tmux-<uid>/default, the default socket under
//     TMUX_TMPDIR as it was when this module loaded (a test then points TMUX_TMPDIR at its own folder, so a later
//     value names the server being ended), or the socket $TMUX names (read at load AND at the call, since a test
//     may delete process.env.TMUX in between). Compared by resolved path and, for a socket that
//     exists, by the file itself (device and inode), so another spelling or a symlink of it is refused too;
//   - does nothing and returns null when there is no socket at sockPath (nothing to end, and tmux is never run);
//   - otherwise runs `tmux -S <sockPath> kill-server` with execFileSync and returns its result. -S names the socket
//     file itself and never falls back to another server. opts go to execFileSync (env, stdio, timeout), and its
//     errors reach the caller as they would from execFileSync.
// engine/tmux-kill-socket-6857.test.js holds every other kill-server in the repo's JavaScript to a named -L socket.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tmuxSocketOf = (value) => (typeof value === 'string' && value ? value.split(',')[0] : '');
const AT_LOAD = tmuxSocketOf(process.env.TMUX);
/* TMUX_TMPDIR as this process had it when the module loaded: the machine's setting, before a test points it at a
   folder of its own. Read only here, never at the call: by then it (and opts.env's) names the test's private server,
   which is the one being ended (live-connect sets process.env.TMUX_TMPDIR after it requires this; last-look passes it
   in opts.env). */
const TMPDIR_AT_LOAD = process.env.TMUX_TMPDIR || '';

/* A path with its folder's symlinks resolved, so /tmp/x and /private/tmp/x compare equal on a Mac. A folder that
   does not exist is compared as written. */
function real(p) {
  const abs = path.resolve(p);
  try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { return abs; }
}

/* The sockets that are, or may be, the machine's own server, resolved: /tmp/tmux-<uid>/default, the default socket
   under TMUX_TMPDIR as the machine had it (TMPDIR_AT_LOAD), and the socket $TMUX names. */
function machineSockets() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const out = [];
  if (uid !== null) {
    out.push(real(path.join('/tmp', 'tmux-' + uid, 'default')));
    if (TMPDIR_AT_LOAD) out.push(real(path.join(TMPDIR_AT_LOAD, 'tmux-' + uid, 'default')));
  }
  for (const s of [AT_LOAD, tmuxSocketOf(process.env.TMUX)]) if (s) out.push(real(s));
  return out;
}

/* Device and inode of a path's file, following symlinks, or null when there is none. */
function identity(p) {
  try { const st = fs.statSync(p); return st.dev + ':' + st.ino; } catch { return null; }
}

function killServerAt(tmuxBin, sockPath, opts) {
  if (typeof sockPath !== 'string' || !sockPath) throw new Error('killServerAt: no socket path given');
  const machine = machineSockets();
  const refuse = () => { throw new Error('killServerAt: refusing to end ' + sockPath + ': that is this machine\'s own tmux server (kosmos#6857)'); };
  if (machine.includes(real(sockPath))) refuse();
  if (!fs.existsSync(sockPath)) return null;
  /* Review 12: by the file itself too, not only its spelling. A case-insensitive volume (/tmp/tmux-501/DEFAULT) or a
     symlink to the machine's socket names the same file under another path. */
  const id = identity(sockPath);
  if (id && machine.some((m) => identity(m) === id)) refuse();
  return execFileSync(tmuxBin, ['-S', sockPath, 'kill-server'], opts || {});
}

module.exports = { killServerAt, machineSockets };
