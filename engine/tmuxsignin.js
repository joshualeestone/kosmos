'use strict';
/*
 * The hidden-tmux plumbing that a sign-in run in its own tmux session needs (kosmos #4195).
 * engine/agysignin.js (Gemini's Antigravity sign-in) uses it; engine/musesignin.js (#3939) is
 * meant to, so a fix to one of these (a new transient tmux error, say) reaches both sign-ins
 * (convention 5). Each sign-in keeps its own session name, screens and seams; only the plumbing
 * under them lives here.
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/* One tmux call's limit: a slow machine is a retry on the next tick, not a hang. */
const TMUX_CALL_MS = 5000;

/* A sign-in's own tmux socket, so its session is invisible to every agent-listing tmux call. Named
   after this macOS account's home: each sign-in is one per account, so one started in one Kosmos and
   left behind by a switch to another is the one the next start ends, not an orphan on a socket
   nobody asks about. A test names its own socket through envVar, so it never meets a real one. */
function homeSocket(prefix, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  return prefix + crypto.createHash('sha256').update(String(require('node:os').homedir())).digest('hex').slice(0, 10);
}

/* Looked up once and kept: binPaths() resolves every runner, and a sign-in asks every tick. ONE cache
   for every sign-in that uses this module (they all ask binPaths() for the same tmux), so
   forgetTmuxBin() in one sign-in's start makes the next call look again for all of them (tmux may
   have been installed since). */
let tmuxBinCached = null;
function tmuxBin() { return tmuxBinCached || (tmuxBinCached = require('./create').binPaths().tmuxBin); }
function forgetTmuxBin() { tmuxBinCached = null; }

/* Every real side effect goes through the live-execution gate (CLAUDE.md convention 3): a test that
   forgot its seam throws instead of driving a real sign-in; production warns and fails closed.
   `owner` names the sign-in in the gate's report. */
function live(owner, file, args) {
  const gate = require('./live-execution');
  if (gate.liveExecutionAllowed()) return true;
  gate.refuseOrWarn(owner, file, args);
  return false;
}

/* One tmux call on the sign-in's socket. Finding tmux is Kosmos's own work, not the sign-in's: a
   failure there is marked kosmosInternal, so a screen reader takes it as "try again", never as the
   signed-in program exiting. stderr is piped, not inherited, so a speculative kill before a start is
   not an error line in the board's log. */
function runTmux(owner, socketName, args) {
  const full = ['-L', socketName].concat(args);
  let bin;
  try { bin = tmuxBin(); } catch (e) { const x = new Error('Kosmos could not find tmux: ' + (e && e.message)); x.kosmosInternal = true; throw x; }
  if (!live(owner, bin, full)) throw new Error('live execution is off');
  return execFileSync(bin, full, { encoding: 'utf8', timeout: TMUX_CALL_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

/* A tmux call that timed out or was killed may or may not have reached the session: its delivery is
   unknown, which is not the same as "it failed". */
function deliveryUnknown(e) { return !!(e && (e.code === 'ETIMEDOUT' || e.signal)); }

/* One argument quoted for /bin/sh. */
function shq(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }

module.exports = { homeSocket, tmuxBin, forgetTmuxBin, live, runTmux, deliveryUnknown, shq };
