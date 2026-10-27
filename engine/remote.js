'use strict';
/**
 * The tunnel supervisor: the engine side of "Use Kosmos from anywhere"
 * (the relay plan, Josh-Brain 2026-08-23). The board process owns one
 * kosmos-tunnel child; this module is the only thing that starts it, stops
 * it, restarts it after a crash, and says honestly what it is doing.
 *
 * ⚠️ OFF BY DEFAULT, AND THE SWITCH IS THE ONLY THING THAT STARTS IT -- and
 * the reason is COMMERCIAL, not security (Josh, 2026-09-03). The Kosmos Plus
 * relay this tunnel connects to is a PAID service, and you do not auto-enable
 * something the customer has to pay for. That is the COMMERCIAL exception to
 * the on-by-default product rule, and it generalises to any future paid
 * feature without re-arguing the security question. (notify and ping are also
 * off today, but for a DIFFERENT reason: held pending an opt-out decision,
 * kosmos#2020, not flipped by #2013. remote's reason is commercial, theirs is
 * the missing control.) Do NOT delete this carve-out on an on-by-default
 * sweep -- an exception with no stated reason gets swept back on.
 *
 * 🔑 NO CRYPTO HERE, ON PURPOSE. Enrolment (the keypair, the pin, the CSR)
 * and the connection itself live in the kosmos-tunnel binary, which is
 * tested against the coordinator's signed contracts in its own repo. This
 * module shells out to it and reads its status file, so the app never
 * grows a second implementation of any of that. The binary writes the
 * status file atomically on every state change; absence or a dead pid in
 * it means the process, not the connection, is the problem.
 *   (The ONE use of node:crypto here is a random device *label* --
 *   crypto.randomUUID() in signinDeviceId (#3149) -- which is an opaque,
 *   non-secret id, no key material, so it is not the enrolment crypto this
 *   note keeps out. The identity keypair the binary mints at register time
 *   still stays the binary's job.)
 *
 * States a caller sees, each with a because sentence when not up:
 *   off         the switch is off (or the board is missing what it needs)
 *   connecting  a child is running (or setup is mid-flight) and not up yet
 *   up          the tunnel holds, with the address a phone can use
 *   restarting  the child died and comes back with backoff
 * Unknown never renders as fine: every path that cannot prove "up" says
 * which sentence applies.
 *
 * Env seams, each so tests can run a fake through this module:
 *   AGENT_WORKFORCE_TUNNEL_BIN          the kosmos-tunnel binary
 *   AGENT_WORKFORCE_TUNNEL_RELAY        relay host:port. Default: the real
 *                                       relay, relay.kosmosplus.com:8443
 *                                       (migrated from relay.plus.installkosmos.com
 *                                       under kosmos#2550, for naming consistency
 *                                       with the coordinator; the relay serves a
 *                                       SAN cert covering both names, so installed
 *                                       clients on the old name keep working)
 *   AGENT_WORKFORCE_TUNNEL_COORDINATOR  coordinator URL for setup. Default: the
 *                                       real one, https://login.kosmosplus.com
 *                                       (flipped from coordinator.plus.installkosmos.com to the
 *                                       kosmosplus.com domain 2026-08-30, #1565, then from
 *                                       coordinator.kosmosplus.com to login.kosmosplus.com
 *                                       2026-09-01 per Josh's ask; login.* and coordinator.* are
 *                                       the SAME box with the same pinned pubkey, so the flip is
 *                                       transparent, and coordinator.* stays up for
 *                                       already-installed clients until it is retired last)
 *   AGENT_WORKFORCE_TUNNEL_STATE        the state dir (keys, certs)
 *   AGENT_WORKFORCE_TUNNEL_CA           extra CA for a dev/self-host relay
 *                                       ONLY. The real relay serves a
 *                                       Let's Encrypt cert that system roots
 *                                       trust (proven with a stock dial, no
 *                                       CA, #578/#648); nothing must bake
 *                                       this for the production relay, and
 *                                       a stale path here breaks the dial
 *                                       for a reason nobody would suspect.
 */
const fs = require('node:fs');
const { envDelete, envSet } = require('./win32env');   // #5386: env copies keep names as spelled; on Windows any spelling counts
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile, execFileSync } = require('node:child_process');
// Narrow test seam for setupRun's child lifecycle. The supervised tunnel uses
// spawn directly and cannot be replaced through this seam.
let setupSpawn = spawn;
const SETUP_CLOSE_GRACE_MS = 2000;
const os = require('node:os');
const store = require('./store');
const trustkeys = require('./trustkeys');   // kosmos#6596 step 8: the tunnel's trust files, which no wipe here removes
const childenv = require('./childenv');   // kosmos#5889: what a desktop opener is started with

// #1848: route through store.ROOT (= store.dataRootFor(platform, home, env)) rather
// than reading AGENT_WORKFORCE_DATA directly. The direct read bypassed both #1820's
// p.isAbsolute refusal (a relative override scattered this file's state to a
// cwd-relative path) and the `Kosmos` leaf the rest of the store appends, so
// under an override remote.json landed in a DIFFERENT directory than avatars/profiles.
// It is also the #1704 prerequisite: under a multi-Kosmos switcher AGENT_WORKFORCE_DATA
// is the switch, and every data-root read must go through the one derivation, not
// read the variable at its own moment.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'remote.json');
const STATE_DIR = () => process.env.AGENT_WORKFORCE_TUNNEL_STATE || path.join(BASE, 'remote');
/* Whether STATE_DIR() is the override rather than the default: one derivation, read by the report. */
const STATE_DIR_IS_CUSTOM = () => !!process.env.AGENT_WORKFORCE_TUNNEL_STATE;
const STATUS_FILE = () => path.join(BASE, 'remote-status.json');
/* Where the connector lives. An explicit AGENT_WORKFORCE_TUNNEL_BIN wins (the
 * test seam, and any operator override). Otherwise prefer the copy this app
 * ships beside itself -- installed, remote.js sits at
 * $KOSMOS_HOME/app/engine/remote.js and the tunnel at
 * $KOSMOS_HOME/app/bin/kosmos-tunnel (#583), and the board runs under launchd
 * with a minimal PATH that a bare name would not resolve. Fall back to the
 * bare name (PATH) only when no bundled copy is present, which is the source
 * checkout: there the tunnel is not staged, so a developer sets the env var
 * or puts it on PATH, exactly as before. */
/* kosmos#4597: the connector's FILE NAME is per platform. The Windows build is a PE
 * `kosmos-tunnel.exe` (kosmos-relay tools/build-tunnel-release-windows.ps1), staged
 * at app\bin\kosmos-tunnel.exe by tools/build-kosmos-windows.sh. Looking for the
 * extensionless Mac name there found nothing, fell through to a bare name on a PATH
 * that holds no connector, and the Plus pane said "the Plus connector is not
 * installed on this computer yet" on every Windows install. */
const connectorFile = (platform = process.platform) => (platform === 'win32' ? 'kosmos-tunnel.exe' : 'kosmos-tunnel');
/* Where an installed app keeps its connector: `<app>/bin/<connectorFile>`, or null when
 * it is not there. `appDir` is the folder holding engine/ (a parameter only so a test
 * can lay out a Windows app in a temp dir and ask). */
function bundledConnector(appDir = path.join(__dirname, '..'), platform = process.platform, exists = fs.existsSync) {
  const bundled = path.join(appDir, 'bin', connectorFile(platform));
  try { return exists(bundled) ? bundled : null; } catch { return null; }
}
const BIN = () => {
  if (process.env.AGENT_WORKFORCE_TUNNEL_BIN) return process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  return bundledConnector() || connectorFile();
};
/* kosmos#4597: the options every connector spawn carries. windowsHide: the Windows
 * board runs with no console of its own (a hidden Scheduled Task), so a console
 * program it starts gets a NEW console window unless told not to, and a person would
 * see a black window flash up for every Plus verb and sit open for the running
 * tunnel. It means nothing off Windows. No `shell` anywhere: the arguments go to
 * CreateProcess as one quoted argv (paths with spaces included), never through
 * cmd.exe, which would re-parse them. */
const connectorSpawnOptions = (opts) => ({ ...opts, windowsHide: true });
/* kosmos#6595 (R01): what this computer's connector says it does, one name per line from `kosmos-tunnel
   capabilities`. The board trusts the session headers the gate writes only when the connector lists
   "session-headers" (it strips client copies, kosmos-relay sessioniat-6595). A connector older than that verb, or one
   that cannot be run, lists nothing, so its headers are never trusted: this is what makes an old connector fail
   closed on every platform, whatever order things merge or ship in. Asked once and kept; a connector that lacked it
   is asked again after ten minutes, one that did not answer at all after thirty seconds. A YES is kept: never
   downgraded within a generation, and kept across a tunnel restart on the same binary (path, mtime, size). Asked only
   once this board has started its own tunnel (a tunnel left by an earlier board vouches for nothing), and always in
   the background, never while a request waits. */
// A connector that answered without the capability changes only with an update: asked again after ten minutes.
const CAPABILITIES_RECHECK_MS = 10 * 60 * 1000;
// One that did not answer at all (timed out, or could not be started) says nothing about its age: thirty seconds.
const CAPABILITIES_UNANSWERED_RECHECK_MS = 30 * 1000;
// How long one ask may take before it counts as unanswered (a cold start on Windows can scan the exe first).
const CAPABILITIES_ASK_TIMEOUT_MS = 5000;
let capabilitiesSeen = null;
let askingCapabilities = false;
// Each ask carries the generation it started in; forgetting the answer starts a new one, so a late answer from an
// earlier ask (an earlier connector) is dropped, never written over the new state.
let capabilitiesGeneration = 0;
// Kept, never downgraded within a generation: once the connector has said it strips the headers, a later slow or
// failed ask does not undo it.
function noteCapabilities(caps, answered, now, generation = capabilitiesGeneration, binary = connectorBinaryKey()) {
  if (generation !== capabilitiesGeneration) return capabilitiesSeen ? capabilitiesSeen.caps : new Set();
  if (capabilitiesSeen && capabilitiesSeen.caps.has('session-headers')) return capabilitiesSeen.caps;
  // `binary` is the one that was ASKED (taken when the ask started), so a binary swapped mid-ask is not credited.
  capabilitiesSeen = { caps, answered, at: now, binary };
  return caps;
}
/* Which connector binary an answer came from: its path and when it last changed. */
function connectorBinaryKey() {
  const bin = BIN();
  try { const st = fs.statSync(bin); return bin + ':' + st.mtimeMs + ':' + st.size; } catch { return bin + ':?'; }
}
/* Forget the answer: the connector process that forwards is about to change (a tunnel is started), so what the
   binary says is asked again for the process it will be. Unless the binary is the one that already said yes: a tunnel
   that restarts on the same binary keeps its answer (a flapping tunnel must not close gated actions each restart). */
function forgetConnectorCapabilities({ always = false, ask = true } = {}) {
  if (!always && capabilitiesSeen && capabilitiesSeen.caps.has('session-headers') && capabilitiesSeen.binary === connectorBinaryKey()) return;
  capabilitiesSeen = null; askingCapabilities = false; capabilitiesGeneration += 1;
  // Asked again at once, in the background (review iteration 17: a forget right after the start-up ask used to drop
  // that answer and leave nothing asking until a request was refused).
  if (ask) askConnectorCapabilities();
}
/* One background ask at a time; its answer lands through noteCapabilities. */
function askConnectorCapabilities() {
  if (askingCapabilities) return;
  askingCapabilities = true;
  const generation = capabilitiesGeneration;
  warmConnectorCapabilities(() => { if (generation === capabilitiesGeneration) askingCapabilities = false; });
}
/* Whether this board has started the tunnel process that forwards. Until it has, nothing is vouched for: a tunnel
   left running by an earlier board (an older binary, say) must not borrow what this board's binary says. */
let tunnelStartedHere = false;
/* kosmos#6616 (R01b part 6): the binary's answer AND the running tunnel's own. Once this board has started a tunnel,
   a capability counts only if the child it runs now also lists it in its status file (`capabilities`, written by the
   process about itself, kosmos-relay runcaps-6616). The binary's answer alone described the file on disk, which an
   update can replace while this board's tunnel keeps forwarding, and the ten-minute recheck would then ask the NEW
   binary about the OLD process. A status file from another process (its pid), not yet written, unreadable, or with no
   `capabilities` (a connector older than that field) lists nothing, and so does a moment with no child running
   (crash backoff, a stop): nothing legitimate arrives then, so it fails closed. This only ever narrows the binary's
   answer. A tunnel orphaned by an EARLIER board that still forwards is described by neither check (it shares this
   board's status file under its own pid), so it is ended (endForeignTunnel, kosmos#6669); where it cannot be (Windows,
   a Linux subreaper) it stays open, as does a pid reused between ps and the signal. */
function connectorCapabilities(now = Date.now()) {
  const caps = binaryCapabilities(now);
  const running = runningCapabilities();
  return running === null ? caps : new Set([...caps].filter((c) => running.has(c)));
}
// kosmos#6616: tests only, the pid of a tunnel "running here" when none was spawned (a real child always wins).
let runningPidForTests = null;
/* A process's capabilities are compiled into it, so once this board's child has said what it lists, that holds for
   the life of that pid (kosmos#6669, review 3: a tunnel orphaned by an earlier board rewrites the same status file
   under its own pid, and this board's child writes it only on a state change, so without this one foreign write
   refused every gated remote action until the child next reconnected). */
let runningSeen = null;   // { pid, caps }
/* What the tunnel process this board runs says it can do; null only before this board has started any (the binary's
   answer is then gated by tunnelStartedHere alone). Read until that process has said: a small file. */
function runningCapabilities() {
  if (!tunnelStartedHere) return null;
  const pid = child ? child.pid : (process.env.NODE_TEST_CONTEXT ? runningPidForTests : null);
  if (pid === null || pid === undefined) return new Set();
  let raw = null;
  // Unreadable includes a moment where Windows holds the file for the tunnel's atomic replace: refused, asked again.
  try { raw = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')); } catch { /* below */ }
  // Read even when the child's list is kept (review 7), so a foreign writer is noticed on the gated path too.
  if (raw && Number.isInteger(raw.pid) && raw.pid !== pid) {
    endForeignTunnel(raw.pid);
    // Review 10: ending is asynchronous, and both tunnels forward to the same port, so a request now may be the
    // orphan's. Until that pid is settled as one to leave alone (a live board's, not ours, gone, Windows), nothing.
    if (foreignVerdict.get(raw.pid) !== 'leave') return new Set();
  }
  if (runningSeen && runningSeen.pid === pid) return runningSeen.caps;
  if (!raw || raw.pid !== pid) return new Set();
  return noteRunning(raw, pid);
}
/* Keep what this board's child said (review 5: status() reads the file far more often than a gated request does, so it
   notes the child's write too, and a foreign tunnel that cannot be ended, on Windows say, blocks gated actions only
   until the child's first write is seen, not until its next state change). */
function noteRunning(raw, pid) {
  const caps = new Set(Array.isArray(raw.capabilities) ? raw.capabilities.filter((c) => typeof c === 'string') : []);
  runningSeen = { pid, caps };
  return caps;
}
/* kosmos#6669 (R01c): a tunnel this board did not start that writes this board's status file is one an earlier board
   left behind (killed hard, so it could not reap it). Its reconnect loop takes the relay connection back from this
   board's tunnel after each "replaced by a newer connection", so it forwards part of the time, as whatever binary it
   was, and neither capability check describes it. It is ended (SIGTERM, to the pid the file names) ONLY when ps shows
   all of: its parent is 1 (it was re-parented: its board is gone; review 4, a second LIVE board on the same account
   shares this file, and killing its child would start a kill loop between the two), the text before its first
   ` run ` is BIN() itself or one token with BIN()'s basename (review 9: no wrapper such as `strace /x/kosmos-tunnel
   run ...`; argv, not the kernel's executable name, which a portable test
   fixture cannot fake; review 6) and its first argument is `run`, and it was started with this board's own `--status-file` path,
   the whole argument. A pid outside 2..2^22 is never looked at (0 and -1 would signal a group). Our own pid and our
   child are excluded both when asked and again right before the signal. Not closed (stated): a pid that exits and is
   reused between ps and the signal. Kept an hour per pid: "not our tunnel" (program or path). Asked again after a
   minute (reviews 5 and 6): a live parent (its board may die later), a pid that is gone (it may be reused by one), and
   one just ended (a tunnel that ignores TERM). Never judged while this board is itself pid 1 (a container entrypoint,
   whose own earlier children read as orphans).
   A failed ps is asked again after fifteen seconds.
   Not on Windows (no command line is read there; stated on kosmos#6669). */
const foreignLooked = new Map();   // pid -> until when its answer stands (Infinity: Windows, never judged there)
const FOREIGN_RECHECK_MS = 60 * 1000;
const FOREIGN_NOT_OURS_MS = 60 * 60 * 1000;
const FOREIGN_PS_FAILED_MS = 15 * 1000;
const foreignAsking = new Set();
const foreignVerdict = new Map();   // pid -> 'leave' (a live board's, not ours, gone, Windows) or 'ended'
// Tests only, and honoured only under the test runner: (pid, statusFile) => { ppid, command } or null, instead of ps.
let endForeignForTests = null;
let killForTests = () => {};   // with a stand-in, the signal goes here: a made-up pid can be a real process on Linux
const PS = fs.existsSync('/bin/ps') ? '/bin/ps' : '/usr/bin/ps';   // never PATH: a writable PATH entry could answer
function notOurs(pid) { return pid === process.pid || (child && pid === child.pid); }
/* Whether ps's line names this board's tunnel, whatever its parent. */
function isOurTunnel(proc, statusFile, bin = BIN()) {
  if (!proc || typeof proc.command !== 'string') return false;
  const command = proc.command.split('\n')[0];
  const at = command.indexOf(' run ');
  if (at <= 0) return false;
  // The program, exactly: BIN() itself, or one token (no other word before it) with the tunnel's basename (review 9:
  // `vim /x/kosmos-tunnel run ...` matched when any text ending in the basename counted).
  const prog = command.slice(0, at);
  if (prog !== bin && (/\s/.test(prog) || path.basename(prog) !== path.basename(bin))) return false;
  const esc = statusFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The whole path, ending where the argument ends: `<file>.elsewhere` is another file (a prefix match ended it).
  return new RegExp(' --status-file ' + esc + '( |$)').test(command.slice(at));
}
/* ... and orphaned: re-parented to 1, its board gone. Exported for tests. */
function isOrphanedTunnel(proc, statusFile, bin = BIN()) {
  return Boolean(proc) && proc.ppid === 1 && isOurTunnel(proc, statusFile, bin);
}
function endForeignTunnel(pid, done = () => {}) {
  // A pid no tunnel can have (out of range) is one to leave alone; our own child is not foreign (review 11).
  if (!Number.isInteger(pid) || pid < 2 || pid > 4194304) { foreignVerdict.set(pid, 'leave'); done(false); return; }
  if (notOurs(pid) || foreignAsking.has(pid)) { done(false); return; }
  const until = foreignLooked.get(pid);
  // Expired: pruned as it is read, verdict and all (review 11: a stale "leave" trusted the request that re-asks).
  if (until !== undefined && until <= Date.now()) { foreignLooked.delete(pid); foreignVerdict.delete(pid); }
  if ((until || 0) > Date.now() || process.pid === 1) { done(false); return; }
  const stand = process.env.NODE_TEST_CONTEXT ? endForeignForTests : null;
  if (process.platform === 'win32' && !stand) { foreignLooked.set(pid, Infinity); foreignVerdict.set(pid, 'leave'); done(false); return; }
  const statusFile = STATUS_FILE();
  const judge = (proc) => {
    foreignAsking.delete(pid);
    // ps failed (missing, or a ps that refuses the flags): no answer, asked again after FOREIGN_PS_FAILED_MS (review 9:
    // with no wait, a host without a working ps forked one per status read).
    if (proc === undefined) { foreignLooked.set(pid, Date.now() + FOREIGN_PS_FAILED_MS); done(false); return; }
    // "Not ours" stands an hour (review 7), not for good: macOS pids wrap at 99999, and a board runs for weeks.
    if (proc !== null && !isOurTunnel(proc, statusFile)) { foreignLooked.set(pid, Date.now() + FOREIGN_NOT_OURS_MS); foreignVerdict.set(pid, 'leave'); done(false); return; }
    if (!isOrphanedTunnel(proc, statusFile) || notOurs(pid)) { foreignLooked.set(pid, Date.now() + FOREIGN_RECHECK_MS); foreignVerdict.set(pid, 'leave'); done(false); return; }
    foreignLooked.set(pid, Date.now() + FOREIGN_RECHECK_MS);
    foreignVerdict.set(pid, 'ended');
    try { (stand ? killForTests : process.kill.bind(process))(pid, 'SIGTERM'); process.stderr.write('remote: ended a Kosmos+ tunnel an earlier board left running (pid ' + pid + ', kosmos#6669)\n'); done(true); } catch (e) {
      // Not ours to end (another user's, EPERM) or already gone: left alone, and said (review 11).
      foreignVerdict.set(pid, 'leave');
      process.stderr.write('remote: could not end a tunnel an earlier board left running (pid ' + pid + '): ' + (e && e.code) + '\n');
      done(false);
    }
  };
  foreignAsking.add(pid);
  if (stand) { let proc; try { proc = stand(pid, statusFile); } catch { proc = undefined; } judge(proc); return; }
  try {
    execFile(PS, ['-ww', '-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }, (err, out) => {
      // ps exits 1 for a pid that is gone: a definite "not a tunnel". Any other failure is no answer.
      if (err && err.code === 1 && !String(out || '').trim()) { judge(null); return; }
      if (err) { judge(undefined); return; }
      const m = String(out).trim().match(/^(\d+)\s+([\s\S]*)$/);
      judge(m ? { ppid: Number(m[1]), command: m[2] } : null);
    });
  } catch { judge(undefined); }
}
function binaryCapabilities(now) {
  if (!tunnelStartedHere) return new Set();
  if (capabilitiesSeen) {
    const wait = capabilitiesSeen.answered ? CAPABILITIES_RECHECK_MS : CAPABILITIES_UNANSWERED_RECHECK_MS;
    if (capabilitiesSeen.caps.has('session-headers') || now - capabilitiesSeen.at < wait) return capabilitiesSeen.caps;
  }
  // Never asked synchronously: a request never waits on the connector. With no answer kept (or one due again), this
  // answers "nothing" now, so the request is refused with "try again in a minute", and asks in the background.
  askConnectorCapabilities();
  return capabilitiesSeen ? capabilitiesSeen.caps : new Set();
}
const capabilityLines = (out) => new Set(String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
/* One ask of the connector, without blocking. Run when this board starts its tunnel (forgetConnectorCapabilities) and
   when a kept answer is due again (connectorCapabilities); never at board start, and never while a request waits. */
function warmConnectorCapabilities(done = () => {}) {
  // As the other connector spawns here: under the test runner, only a connector a test names is ever run.
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) { done(new Set()); return; }
  const generation = capabilitiesGeneration;
  const binary = connectorBinaryKey();
  try {
    const child = execFile(BIN(), ['capabilities'], connectorSpawnOptions({ encoding: 'utf8', timeout: CAPABILITIES_ASK_TIMEOUT_MS }), (err, stdout) => {
      // Answered = it ran to an exit code (an old connector's unknown verb is an answer); killed or unstartable is not.
      const answered = !err || (typeof err.code === 'number' && !err.killed);
      done(noteCapabilities(err ? new Set() : capabilityLines(stdout), answered, Date.now(), generation, binary));
    });
    // Nothing to say on stdin: closed at once, so a connector that reads it cannot sit until the timeout.
    if (child && child.stdin) child.stdin.end();
  } catch { done(noteCapabilities(new Set(), false, Date.now(), generation, binary)); }
}
const resetConnectorCapabilitiesForTests = ({ startedHere = true, runningPid = null, commandOf = null, kill = null } = {}) => {
  tunnelStartedHere = startedHere;
  runningPidForTests = runningPid;
  runningSeen = null;
  foreignLooked.clear(); foreignAsking.clear(); foreignVerdict.clear();
  endForeignForTests = commandOf;
  killForTests = kill || (() => {});
  forgetConnectorCapabilities({ always: true, ask: false });
};
/* The production addresses are the defaults (#648): a bundle needs nothing
 * baked for a Mac to reach the real relay and coordinator. Precedence: env
 * (tests, self-host), then the relay saved in remote.json, then production. */
const DEFAULT_RELAY = 'relay.kosmosplus.com:8443';
const DEFAULT_COORDINATOR = 'https://login.kosmosplus.com';
const RELAY = () => process.env.AGENT_WORKFORCE_TUNNEL_RELAY || read().relay || DEFAULT_RELAY;
/* The ONE answer to "is a relay configured on this machine" (#790). The
 * server's Plus route once re-derived it from the raw parts (saved relay or
 * env) and missed the default this module had just learned (#722), so on
 * served 0.5.24 the connector dialed the real relay while the Plus tab told
 * every stranger "Sign-up is not open yet". Two derivations of one fact
 * disagree the moment one of them learns something; there is one now. */
const configured = () => Boolean(RELAY());
const COORDINATOR = () =>
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR || DEFAULT_COORDINATOR;

/* The coordinator's two input shapes, ONE derivation each (repo convention:
   two derivations of one rule drift the moment the coordinator changes one).
   Both the setup flow and the sign-in flow (#3149) check these, so they live
   here rather than inline in each function. CODE_RULE: the six-digit email/phone
   code. NAME_RULE: the address label (the "hers" in hers.<domain>). */
const CODE_RULE = /^[0-9]{6}$/;
const NAME_RULE = /^[a-z0-9-]{3,32}$/;

let child = null;
let restartTimer = null;
let restartBecause = null;
let backoffMs = 1000;
/* kosmos#4277: how many times the supervisor has relaunched the tunnel, so the remote
   report (engine/remote-report.js) can say a relaunch happened, and whether it took. */
let restarts = 0;   // since process start, never reset (resetForTests leaves it): read it as a delta
let restartPending = false;
/* kosmos#4277: the tunnel rewrites its status to "connecting" (no reason) at the start of
   every retry (kosmos-relay lib.rs run_forever), so a stuck tunnel shows WHY only in the backoff
   window. The last failure sentence the CURRENT process wrote is kept here, sampled whenever
   status() reads the file (the report, a page, and the 15 s ensure tick), so the report can name
   it while the tunnel is dialling again. Memory only: the report classifies it and never sends
   it. Cleared when that process is up, and for a new process. It is a sample: a failure is seen
   only if a read lands in the tunnel's `restarting` window (its backoff, 1 s and doubling), so
   a tunnel that failed once or twice may still read `starting`; one that keeps failing is caught
   within about a minute, as the backoff passes the 15 s tick. */
let lastTunnelFailure = null;
/* When the current process was last seen NOT up (its start, or its first sample after being up),
   on the board's monotonic clock, so a wall-clock step cannot move it. Null while up. Lets the
   report tell a tunnel stuck on its first dial (which writes no failure) from one just started. */
let dialingSince = null;
let localPort = null;
// kosmos#4640: the waiting-to-be-allowed refusal is recognised in engine/allowwait.js (pure; remote-report.js asks it too).
const { allowWaitSentence } = require('./allowwait');

/** Ensure the state dir exists and is owner-only. It holds the identity key
    and the TLS key; the binary writes those 0600, but the directory around
    them must be 0700 or a group/other could enumerate them. The binary
    creates the dir, so this states and enforces the assumption on our side
    rather than relying on it unsaid. Best-effort: a perms failure must not
    block the switch. */
/* Empty the tunnel's state folder entry by entry, leaving `keep` and the tunnel's trust files (kosmos#6596 step 8:
   trustkeys.KEEP). The tunnel forgets a held service key set itself at the next registration and writes its floor
   first; removing the floor here would let a forgotten set be taken again, and removing the lock while the tunnel
   holds it would let two writers in. Best effort: whatever cannot be removed, the register writes again. */
function clearStateDir(keep) {
  /* kosmos#4903 S5 (review 2): and the cloud installer's latch (engine/cloudmachine.js LATCH). It is written ONCE, at
     install, and nothing writes it again, so a Remove or a fresh sign-in on a Kosmos cloud machine must not take it:
     the box would stop being one for good. Keeping it admits nobody; the tunnel's gate also needs the coordinator's
     signed claim, which a removal ends. */
  const skip = new Set([...keep, ...trustkeys.KEEP, require('./cloudmachine').LATCH]);
  let entries = [];
  try { entries = fs.readdirSync(STATE_DIR()); } catch (e) {
    // A file where the folder should be holds no trust file: it goes, as the whole-folder wipe removed it.
    if (e && e.code === 'ENOTDIR') { try { fs.unlinkSync(STATE_DIR()); } catch { /* the register reports it */ } }
    return;
  }
  for (const name of entries) {
    if (skip.has(name)) continue;
    try { fs.rmSync(path.join(STATE_DIR(), name), { recursive: true, force: true }); } catch { /* the register writes it again */ }
  }
}
function secureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR(), { recursive: true, mode: 0o700 });
    fs.chmodSync(STATE_DIR(), 0o700);
  } catch { /* best-effort; the binary still writes its files 0600 */ }
}

/* What read() answers when there is no file, or none it can use: every field at its empty value, in ONE place, so a
   field added to read() cannot be missing from one of the four early answers (kosmos#5995: computer_name was). */
const blankSettings = (ok) => ({ on: false, relay: '', email: '', denied: {}, device_id: '', past_device_ids: [], vouched: {}, computer_name: null, forget_kept: '', ok });

/** Off until somebody turns it on. `relay` may be stored here so a
    self-hoster can point at their own relay without an env var. */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return blankSettings(true);
    return blankSettings(false);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return blankSettings(false); }
  // A JSON array passes `typeof === 'object'`, but that is harmless HERE, unlike
  // in heartbeat-setting: `on` below is read as `parsed.on === true` (an explicit
  // true test), never defaulted to true, so an array reads off -- the safe value
  // for a relay that is off until turned on. #2013 fixed heartbeat's twin of this
  // guard because heartbeat DID default true; this copy needs no Array.isArray.
  if (!parsed || typeof parsed !== 'object') return blankSettings(false);
  return {
    on: parsed.on === true,
    relay: typeof parsed.relay === 'string' ? parsed.relay : '',
    email: typeof parsed.email === 'string' ? parsed.email : '',
    /* #567: ids this Mac said no to, with when. A re-ask from one of them
       gets a sentence on the card; nothing else reads this. */
    denied: parsed.denied && typeof parsed.denied === 'object' && !Array.isArray(parsed.denied) ? parsed.denied : {},
    /* #3149: this computer's stable sign-in device id. Preserved as-is so a
       later write() (which reconstructs the file from read()) does not drop it;
       shape is checked where it is minted/used (signinDeviceId), not here, the
       same way relay/email carry through unvalidated. */
    device_id: typeof parsed.device_id === 'string' ? parsed.device_id : '',
    /* kosmos#5422: the ids this computer signed in with before device_id (the opaque one before it had a key, an
       older key's). Their rows stay pending at the coordinator, so they are still known as this computer's own
       (#4610) and never ask to be allowed. Newest first, never trimmed (see useDeviceId). */
    past_device_ids: Array.isArray(parsed.past_device_ids) ? parsed.past_device_ids.filter((x) => typeof x === 'string') : [],
    /* Federation Kosmos+ gate: the account's last-known coordinator standing,
       cached from the sign-in flow (the only place the coordinator surfaces it,
       per ICK's contract). '' means unknown -> kosmosPlus() is false (fail-safe:
       an unknown standing never opens the paid fed UI). The live server-side
       backstop (fed routes 403 a non-member) covers any staleness between
       sign-ins; this cache only drives which UI the board shows. */
    standing: typeof parsed.standing === 'string' ? parsed.standing : '',
    /* Federation Kosmos+ gate, W1 refresh: the client-clock ms when `standing` was
       last written. Drives the TTL re-fetch -- an enrolled board re-checks standing
       from the coordinator once this is older than STANDING_TTL_MS, so an UPGRADE
       (paid after enrolment) takes effect within ~one TTL, no re-sign-in. 0 = never
       stamped -> immediately stale. */
    standing_at: typeof parsed.standing_at === 'number' ? parsed.standing_at : 0,
    /* Federation launch flag (option 2, the CUSTOMER un-hide): the last-known GLOBAL
       "federation is live" bool from the coordinator. UNLIKE `standing` this is not
       per-account -- it gates the whole fed UI (members AND the non-member signup
       prompt), so every board reads it and it is not gated on enrolment. Absent/unknown
       -> federationLive() is false (fail-safe: the fed UI stays hidden until the
       coordinator says live). The env override (AGENT_WORKFORCE_FEDERATION_LIVE) is
       ORed on top in server.federationLiveNow() for operator/dev boards. */
    fedLive: parsed.fedLive === true,
    /* client-clock ms when fedLive was last written; drives the TTL refresh. 0 = never
       stamped -> immediately stale. */
    fedLive_at: typeof parsed.fedLive_at === 'number' ? parsed.fedLive_at : 0,
    /* kosmos#5786 (b): devices this computer allowed because the browser it opened proved itself (vouchTick), as
       { <device_id>: { at: <seconds>, name } }, for the "connected" notice and the "on this computer" label. */
    vouched: parsed.vouched && typeof parsed.vouched === 'object' && !Array.isArray(parsed.vouched) ? parsed.vouched : {},
    /* kosmos#5995: the name the person gave this computer at the Kosmos+ sign-in, when they changed what the field
       showed or cleared it ('' is a choice: send no name of theirs). null when they never did, and then the name comes
       from the computer. Read by thisComputerDeviceName(), the one place every path that names this computer asks. */
    computer_name: typeof parsed.computer_name === 'string' ? parsed.computer_name : null,
    /* kosmos#6389: why the last Remove was kept (it could not reach Kosmos+), so a reload still says it is not removed.
       '' when there is none. Cleared by a Remove that finishes and by switching on. */
    forget_kept: typeof parsed.forget_kept === 'string' ? parsed.forget_kept : '',
    ok: true,
  };
}
/* SET the cached coordinator standing from a FRESH enrolment/register response
   (setupComplete / signinRegister's register path). SET-OR-CLEAR, never inherit: a
   fresh enrolment writes the coordinator's value, or '' when it is absent/non-string
   -- so a stale 'good' from a prior life (e.g. a state dir wiped without a full
   forget()) can NEVER survive into a new account and leak the paid fed UI. The
   already-set-up SHORT-CIRCUIT paths do NOT call this: there the account is
   unchanged, so the existing cache is kept. forget() clears it outright. */
function fedSetStanding(standing) {
  // Stamp standing_at on every write so the TTL refresh (below) can tell a fresh
  // cache from a stale one, and a definite coordinator answer resets the clock.
  write({ standing: typeof standing === 'string' ? standing : '', standing_at: Date.now() });
}
/* Federation Kosmos+ gate, W1 refresh (ICK's v1 ruling, 2026-09-21). An enrolled
   board's `standing` is otherwise frozen at enrolment time, so a member who UPGRADES
   after enrolling could not see the feature until re-sign-in. This TTL re-fetch keeps
   the cached standing current: the /api/status poll serves the CACHED kosmos_plus
   immediately (never blocks) and, when the cache is older than the TTL, fires this
   lazy refresh so the next poll reflects reality within ~one TTL. A LAPSE is also
   caught within a TTL (UI off), but the fed-route 403 stays the hard security gate --
   this only keeps the UI honest. */
const STANDING_TTL_MS = 60 * 1000;   // ICK's ~60s; deliberately not per-poll (5s) to spare the coordinator
/* #4731: with remote access OFF an enrolled computer is still heard from, but only this often: well inside the
   coordinator's one-day "quiet" line (#4681), and far from the minute-scale cadence of a computer that is on. */
const OFF_STANDING_TTL_MS = 12 * 60 * 60 * 1000;
/* #4731 review: a ping that could not get an answer while OFF (a laptop waking before its Wi-Fi) is retried after this,
   not after the whole 12 h, so one failed attempt cannot use up the slot and two cannot cross the one-day line. */
const OFF_RETRY_MS = 30 * 60 * 1000;
let standingRefreshInFlight = false;
/* kosmos#4743: a switch flip the coordinator has not been told yet. Set by setOn when the value changes (it also asks at once),
   by a sign-in that switches on and by a cancelled sign-in that switches off (neither asks inside the sign-in:
   see turnOnAfterSignin). While set, the next standing poll is due whatever its stamp, and a refresh that
   was already out re-asks when it ends. */
let flipPending = false;
function askAfterFlip() {
  const cur = read();
  // flipPending makes the refresh below due. Off (enrolled or not): the stamp is also set back, so if this
  // ask's answer is thrown away by a Forget while it is out, the next poll asks again (a new identity comes
  // from a sign-in, which stamps fresh; there the flag set by the sign-in paths is what re-asks).
  if (cur.ok === true && cur.on !== true) write({ standing_at: Date.now() - OFF_STANDING_TTL_MS - 1 });
  try { Promise.resolve(module.exports.refreshStandingIfStale({ ttlMs: 0 })).catch(() => {}); } catch { /* best-effort */ }
}
const FED_LIVE_TTL_MS = 60 * 1000;   // mirrors STANDING_TTL_MS; a launch flag changes rarely, but a lapse/rollback should still reach a board within ~one TTL
let fedLiveRefreshInFlight = false;
/* The isolated coordinator read: the CURRENT standing string, or null when it could
   not be determined. A null NEVER changes the cache, so a transient failure keeps the
   last-known standing (no flicker) and the 403 backstop remains the hard gate. */
async function fetchStanding() {
  // Lives in engine/mac-standing.js. Lazy require breaks the remote<->mac-standing cycle.
  try { return await require('./mac-standing').fetchStanding(); } catch { return null; }
}
/* Lazily refresh the cached standing when it is older than `ttlMs`. NON-BLOCKING by
   contract: callers do NOT await it; the poll serves the cached value and this updates
   it for next time. A no-op unless enrolled, single-flighted so concurrent polls do
   not stack fetches, and best-effort (never throws into the status tick). */
/* kosmos#4277: the timer that sends the remote report on its own, so a board nobody is watching
   still reports (tested here rather than in server.js). Every ten minutes it
   runs the refresh, which is single-flighted and TTL-gated: with a tab open, /api/status already
   refreshes on its own (shorter) TTL and this timer adds nothing; with none, it is the only
   caller, at most one standing call per ten minutes (with remote access OFF, one per OFF_STANDING_TTL_MS, #4731). The TTL sits under
   the interval: the refresh stamps its time AFTER the fetch returns, so a TTL equal to the interval
   skipped every other tick. Called through module.exports so a test can observe it; a
   refresh that throws or rejects never stops the timer. One early tick a minute after boot, so a
   board that an update just restarted says how it came back without waiting a whole interval.
   That tick asks with a TTL of 0: the last report's time is saved in remote.json and survives
   the restart, so under the ordinary TTL it would send nothing about four restarts in five. Both timers are unref'd so neither holds the process open; the early one rides on the
   returned interval as `.first`, so a caller can clear it too. */
const REPORT_INTERVAL_MS = 10 * 60 * 1000;
const REPORT_TTL_MS = 9 * 60 * 1000;
const REPORT_FIRST_MS = 60 * 1000;
function startReportTimer({ intervalMs = REPORT_INTERVAL_MS, ttlMs = REPORT_TTL_MS, firstMs = REPORT_FIRST_MS } = {}) {
  const tick = (ttl) => {
    try { Promise.resolve(module.exports.refreshStandingIfStale({ ttlMs: ttl })).catch(() => {}); } catch { /* best-effort */ }
  };
  const first = setTimeout(() => tick(0), firstMs);
  if (typeof first.unref === 'function') first.unref();
  const t = setInterval(() => tick(ttlMs), intervalMs);
  if (typeof t.unref === 'function') t.unref();
  t.first = first;
  return t;
}

async function refreshStandingIfStale(opts) {
  opts = opts || {};
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : STANDING_TTL_MS;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const fetcher = typeof opts.fetcher === 'function' ? opts.fetcher : fetchStanding;
  if (standingRefreshInFlight) return;
  if (busy()) return;                        // not on a key being replaced or retired
  if (!enrolled()) {                        // no account on this board -> nothing to refresh,
    reportNotEnrolledIfDue(now);            // but a switch that is ON says why it cannot serve (#4277)
    return;
  }
  const s = read();
  if (s.ok !== true) return;
  // #4731: off, the cadence is OFF_STANDING_TTL_MS whatever the caller asked (a 0 TTL included).
  // kosmos#4743: a flip not yet told (no ask has started since it was made) is due at once, whatever stamp
  // another writer left meanwhile. Once an ask starts the flag is cleared; if that ask then fails, the flip
  // is retried on the ordinary cadence (OFF_RETRY_MS off, the TTL on), not at once.
  const due = flipPending ? 0 : (s.on === true ? ttl : Math.max(ttl, OFF_STANDING_TTL_MS));
  // Math.abs (kosmos#4277): a wall clock stepped backwards (a wrong Mac clock being
  // corrected) leaves standing_at in the future; without it every refresh read as fresh, the early
  // tick's TTL 0 included, until the clock caught up. The same guard as reportNotEnrolledIfDue.
  if (Math.abs(now - (s.standing_at || 0)) < due) return;   // still fresh
  standingRefreshInFlight = true;
  // This refresh reads the switch as it is now (mac-standing reads it at send time). Cleared when an ask
  // starts. One that then stops early is not re-asked at once, and writes no stamp of its own: the stamp
  // already there decides the next poll.
  flipPending = false;
  // The answer is about the identity on disk when it was asked: a Forget, or a
  // Forget and a new sign-in, while it was out means it is about one that is gone,
  // and it must not be written onto another (#3827).
  const idBefore = macIdHere();
  try {
    const standing = await fetcher();
    if (forgetting || !enrolled() || macIdHere() !== idBefore) return;
    if (typeof standing === 'string') {
      fedSetStanding(standing);             // a definite answer: update the value + reset the clock
    } else {
      // could not determine: KEEP the last-known value, back the retry off to the next TTL; while OFF,
      // stamped so the retry lands OFF_RETRY_MS from now rather than a whole OFF_STANDING_TTL_MS (#4731).
      // s.on is the switch as read before the ask; a flip made meanwhile set flipPending, which re-asks below.
      write({ standing_at: s.on === true ? Date.now() : Date.now() - (OFF_STANDING_TTL_MS - OFF_RETRY_MS) });
    }
  } catch { /* refresh is best-effort; a poll must never see this throw */ }
  finally {
    standingRefreshInFlight = false;
    // Not cleared here: the ask clears it when it really proceeds (above), so a re-ask stopped early (busy,
    // not enrolled) leaves it pending for the next refresh rather than dropping the flip (review 5).
    if (flipPending) askAfterFlip();
  }
}
/* kosmos#4277: the one report a board sends while it believes it is NOT enrolled, when its
   switch is on and it still holds a key: a board in that state never asks for a relay
   ticket, and this is the only way the reason reaches us. At most every
   NOT_ENROLLED_REPORT_MS, signed with the key alone, and the answer is ignored (it is not
   a standing refresh: a board that is not enrolled has no standing to keep). Never under
   the test runner unless a test supplies its own tunnel (the fetchStanding guard). */
const NOT_ENROLLED_REPORT_MS = 5 * 60 * 1000;
let notEnrolledReportAt = 0;
let notEnrolledReportInFlight = false;
let notEnrolledLastLogged = null;   // one stderr line per distinct reason, not one every five minutes
function reportNotEnrolledIfDue(now) {
  // Its own guard, stated rather than incidental: nothing here may throw into the status tick.
  try {
    // NODE_TEST_CONTEXT on purpose, not live-execution.js's execArgv: this guard keeps a
    // test from phoning the production coordinator, so a board a test SPAWNS must inherit it too,
    // as createdbeacon.js and feedbacksend.js reason. A test that supplies its own tunnel opts in.
    if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) return;
    // Math.abs: a wall clock stepped backwards must not silence the report until it catches up.
    if (notEnrolledReportInFlight || Math.abs(now - notEnrolledReportAt) < NOT_ENROLLED_REPORT_MS) return;
    const s = read();
    if (s.ok !== true || s.on !== true || !holdsKey()) return;
    const report = require('./remote-report').build();
    if (!report) return;
    notEnrolledReportAt = now;
    notEnrolledReportInFlight = true;
    // Through the export, so a test can observe the call without any binary being run.
    module.exports.macRequest('POST', KEY_ONLY_ROUTE, { remote: report }, { keyOnly: true })
      .then((r) => {
        if (r && r.ok) { notEnrolledLastLogged = null; require('./remote-report').commitHeal(report); return; }
        const why = (r && r.because) || 'unknown';
        if (why !== notEnrolledLastLogged) {
          notEnrolledLastLogged = why;
          process.stderr.write('remote: the remote report did not go (kosmos#4277): ' + why + '\n');
        }
      })
      .catch(() => {})
      .finally(() => { notEnrolledReportInFlight = false; });
  } catch { notEnrolledReportInFlight = false; }
}

/* Federation Kosmos+ gate: is THIS account an authenticated Kosmos+ member?
   True iff the cached coordinator standing is exactly "good" (ICK's contract:
   kosmos_plus == standing=="good"). Fail-safe: any other/unknown value is false,
   so the board never shows the paid federation UI to a non-member. */
function kosmosPlus() {
  const s = read();
  return s.ok === true && s.standing === 'good';
}
/* The isolated coordinator read for the GLOBAL federation-live flag: true/false, or
   null when it could not be determined (offline, an error answer, or a coordinator that does
   not publish the field yet). A null NEVER changes the cache, so a transient failure keeps the
   last-known value (no flicker) and the default stays FALSE (hidden).
   kosmos#4649: the source is the PUBLIC `GET /v1/meta`, field `federation_live` (a launch flag
   for everyone, so neither signed nor per-account). A coordinator without the field answers
   null here, which is exactly the old stub's behaviour, so this is safe to ship before it.
   ⚠️ Switching OFF is an explicit `federation_live: false`, never a missing field or a revert: null
   keeps the last-known value on purpose (no flicker), so a board that saw true keeps it until told false.
   So the coordinator MUST always publish the field (false unless turned on) and never remove it;
   that is a requirement on its /v1/meta (the relay side of kosmos#4649), not yet true today.
   ⚠️ A plain HTTPS read, NOT through the tunnel binary and its pinned key: this flag only decides what
   the screens OFFER, and the shared-room routes still refuse non-members on the server, so a spoofed
   answer can show or hide screens, never grant access. Redirects are refused, and only a JSON answer
   is parsed. `opts.fetch` and `opts.timeoutMs` are the test seam. */
const FED_LIVE_TIMEOUT_MS = 5000;
/* One boolean off /v1/meta, or null when it cannot tell. Shared by federation_live (#4649) and
   bought_addresses (#4756); the rules above apply to both. */
async function fetchMetaFlag(field, opts) {
  opts = opts || {};
  const get = typeof opts.fetch === 'function' ? opts.fetch : fetch;
  try {
    const url = String(COORDINATOR()).replace(/\/+$/, '') + '/v1/meta';
    const res = await get(url, { signal: AbortSignal.timeout(opts.timeoutMs || FED_LIVE_TIMEOUT_MS), redirect: 'error' });
    // opts.unread (kosmos#4756): what a read that failed answers, when the caller must tell it from a field left out.
    if (!res || !res.ok) return 'unread' in opts ? opts.unread : null;
    if (!/^application\/json\b/i.test(String((res.headers && res.headers.get && res.headers.get('content-type')) || ''))) return 'unread' in opts ? opts.unread : null;
    const body = await res.json();
    return (body && typeof body[field] === 'boolean') ? body[field] : null;
  } catch {
    return 'unread' in opts ? opts.unread : null;
  }
}
async function fetchFederationLive(opts) { return fetchMetaFlag('federation_live', opts); }
/* Lazily refresh the cached federation-live flag when it is older than `ttlMs`.
   NON-BLOCKING by contract (callers do NOT await it), single-flighted, best-effort.
   Not gated on enrolled() (unlike refreshStandingIfStale): a board with remote access ON that
   is not signed in yet still learns it. But gated on remote access being ON (kosmos#4649,
   decided): a board that never opted in makes no call to our servers, so it cannot use the
   flag for a signup prompt (an open product question on #4649). A definite bool updates the
   cache + resets the clock; a null KEEPS the last-known value and backs the retry off to
   the next TTL. */
async function refreshFederationLiveIfStale(opts) {
  opts = opts || {};
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : FED_LIVE_TTL_MS;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const fetcher = typeof opts.fetcher === 'function' ? opts.fetcher : fetchFederationLive;
  if (fedLiveRefreshInFlight) return;
  const s = read();
  if (s.ok !== true) return;                       // state file unreadable -> keep default (false), do not stamp
  /* kosmos#4649, decided: only a board whose person turned Kosmos+ remote access ON asks the coordinator.
     A board that never opted in makes no call to our servers (the old stub made none; a live fetch would
     have been 1,440 calls a day from every open board, and every test suite hitting /api/status). The
     cost: a board that never turned it on cannot learn the flag, so it cannot show a signup prompt from
     it. Whether never-opted-in boards should ask is a product call left open on #4649. */
  if (s.on !== true) return;
  if (now - (s.fedLive_at || 0) < ttl) return;     // still fresh
  fedLiveRefreshInFlight = true;
  try {
    const live = await fetcher();
    if (typeof live === 'boolean') {
      write({ fedLive: live, fedLive_at: Date.now() });   // a definite answer: update the value + reset the clock
    } else {
      write({ fedLive_at: Date.now() });                  // could not determine: KEEP the last-known value, back off to the next TTL
    }
  } catch { /* refresh is best-effort; a poll must never see this throw */ }
  finally { fedLiveRefreshInFlight = false; }
}
/* The GLOBAL federation-live flag as the board last knew it. Fail-safe: unknown/unreadable
   -> false, so the fed UI stays hidden until the coordinator says live. server.js ORs the
   AGENT_WORKFORCE_FEDERATION_LIVE env override on top for operator/dev boards. */
function federationLive() {
  const s = read();
  /* kosmos#4649 round 2: the flag counts only while remote access is ON, the same gate the refresh uses.
     Otherwise a board that cached true and then turned remote access off would stop asking and keep true
     forever, out of reach of the coordinator's explicit false. */
  return s.ok === true && s.on === true && s.fedLive === true;
}
/* #4308 (Liu Kang's ruling): an unreadable settings file must stay visible to the person until THEY repair it.
   write() rebuilds the file from read(), and read() of a damaged file is the defaults with on:false, so any
   background write (the standing cache, the device id, the denied list) would silently rewrite it as "off" and
   the page would never say anything went wrong. So only a person's own action repairs: the switch, the relay,
   sign-in and Forget pass { repair: true }. Everything else leaves a damaged file exactly as it is. */
const UNREADABLE = 'your remote-access settings could not be read';
/* A write killed between opening its temporary file and the rename leaves remote.json.<pid>.<random>.tmp behind, and
   each holds a copy of the settings. After a successful save, remove those whose writer is GONE and that are older
   than ten minutes. The pid is in the name: a writer that is still running keeps its file however old it is (a
   process stalled on a hung volume would otherwise lose its save to our sweep). This process's own writes are
   synchronous, so any of its temporaries is finished. A pid can be reused by an unrelated long-lived process, which
   would shelter a dead writer's file forever, so past a day a temporary file goes whatever its pid: no save stalls
   that long. */
const STALE_TEMP_MS = 10 * 60 * 1000;
const ABANDONED_TEMP_MS = 24 * 60 * 60 * 1000;
function writerAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return !!(err && err.code === 'EPERM'); }   // EPERM: it exists, it is just not ours to signal
}
function sweepStaleTemps() {
  try {
    const dir = path.dirname(FILE); const base = path.basename(FILE) + '.';
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(base) || !name.endsWith('.tmp')) continue;
      const p = path.join(dir, name);
      const pid = Number(name.slice(base.length).split('.')[0]);
      try {
        const age = Date.now() - fs.statSync(p).mtimeMs;
        if (age <= STALE_TEMP_MS) continue;
        const live = Number.isInteger(pid) && pid > 0 && pid !== process.pid && writerAlive(pid);
        if (live && age <= ABANDONED_TEMP_MS) continue;
        fs.unlinkSync(p);
      } catch { /* gone, or not ours to remove */ }
    }
  } catch { /* best-effort housekeeping */ }
}
function write(patch, opts) {
  const current = read();
  if (current.ok === false && !(opts && opts.repair === true)) return { ok: false, because: UNREADABLE, unreadable: true };
  const next = { ...current, ...patch };
  delete next.ok;
  if (patch.on === true) next.forget_kept = '';   // kosmos#6389: whatever switches Plus on, a kept Remove's note goes
  /* A repair starts from the defaults (the damaged file could not be read), so it would drop this computer's sign-in
     device id. If this process already minted one (signinDeviceId holds it in memory when its own write is refused
     on the damaged file), keep it: otherwise a sign-in on a damaged file repairs the file with no id, and the next
     start mints another, a second "this computer" in the account's device list (#3149, review of #4308).
     kosmos#5422: whatever kind of id it is (a key's id too), and the ids before it, so those rows stay this
     computer's own after the repair. */
  if (current.ok === false && heldIdentity) {
    if (!next.device_id && DEVICE_ID.test(heldIdentity.device_id)) next.device_id = heldIdentity.device_id;
    // The ids before come back whether or not one is in use yet: a key id the tunnel answered is hidden as this
    // computer's own from that moment, even if no sign-in with it was taken.
    if (!(next.past_device_ids || []).length && heldIdentity.past_device_ids.length) next.past_device_ids = heldIdentity.past_device_ids;
  } else if (heldIdentity && (!('device_id' in patch) || patch.device_id === current.device_id)) {
    /* kosmos#5422: an earlier save of this process's ids failed while the file stayed readable (a full disk, a locked
       file). Any later write that does not set the id itself carries them, so they reach the file once it can be
       written, and are not lost to a restart or a Forget. */
    const held = DEVICE_ID.test(heldIdentity.device_id) ? heldIdentity.device_id : '';
    if (held && next.device_id !== held) next.device_id = held;
    const all = [...heldIdentity.past_device_ids, ...(next.past_device_ids || []), current.device_id];
    next.past_device_ids = all.filter((x, i) => typeof x === 'string' && x && x !== next.device_id && DEVICE_ID.test(x) && all.indexOf(x) === i);
  }
  /* Atomic (#4308): the new content goes to a temporary file of its own in the same folder, is fsynced, and only
     then renamed over the old one. An interrupted write leaves the previous file whole, and the bytes are handed to
     the disk before the name moves, so the renamed file is not left empty by an ordinary crash. (On macOS fsync
     does not flush the drive's own cache, only F_FULLFSYNC does, which Node does not expose; that last step is as
     good as the platform allows.) The name is unique per write, so two processes saving at once cannot interleave
     into one temporary file. */
  const tmp = FILE + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  let fd = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    /* kosmos#6548: owner-only, like board.token: the file holds the account's email and this computer's device ids.
       The open's mode keeps it owner-only (a umask only narrows it); the fchmod restores the owner's own read and
       write bits if a strict umask took them, so the board can still read the file it saved. Not securewrite.writeSecret:
       this writer keeps its own unique temp names and sweepStaleTemps, which that helper does not. */
    fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.fchmodSync(fd, 0o600); } catch { /* the open's own mode stands */ }
    fs.writeSync(fd, JSON.stringify(next) + '\n');
    fs.fsyncSync(fd);
    const closing = fd; fd = null;   // never closed twice, even if this close throws
    fs.closeSync(closing);
    fs.renameSync(tmp, FILE);
    try { const dir = fs.openSync(path.dirname(FILE), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    catch { /* the rename is done; a folder flush is best-effort (some filesystems refuse it) */ }
    sweepStaleTemps();
    return { ok: true };
  } catch {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already failing */ } }
    try { fs.unlinkSync(tmp); } catch { /* nothing was left, or it cannot be removed */ }
    return { ok: false, because: 'we could not save that setting' };
  }
}

/** Enrolled means setup finished: the state dir holds the identity and the
    certificate, or the identity and the tunnel's `held` mark for a computer waiting
    to be allowed (kosmos#4737, engine/enrolment.js). Half a state dir is not enrolled. */
/* mac_key is deliberately not listed: enrolled() asks whether the Mac can serve,
   halfRegistered() whether it holds a key the coordinator knows (#3827). */
const { ENROL_FILES, HELD_FILE, enrolledBy, currentMacIdBy } = require('./enrolment');
const inState = (f) => fs.existsSync(path.join(STATE_DIR(), f));
function enrolled() {
  return enrolledBy(inState);
}

function address() {
  try { return fs.readFileSync(path.join(STATE_DIR(), 'address'), 'utf8').trim() || null; }
  catch { return null; }
}

/* kosmos#6602: what the tunnel's certificate check found for this computer, and its switch
   (engine/cert-watch.js reads the tunnel's files). */
const certWatchFiles = require('./cert-watch');
function certWatch() { return certWatchFiles.certWatchFrom(STATE_DIR(), Date.now()); }
/* Only on a set-up computer (the page shows the switch only then): a leftover state dir is not one. */
function setCertWatch(on) {
  if (!enrolled()) return { ok: false, because: 'this computer is not set up for Kosmos+ yet' };
  return certWatchFiles.setCertWatchIn(STATE_DIR(), on);
}
/* kosmos#6613: a person saw the lost-report sentence for marker `at`. */
function ackCertWatchLost(at) {
  if (!enrolled()) return { ok: false, because: 'this computer is not set up for Kosmos+ yet' };
  return certWatchFiles.ackLostIn(STATE_DIR(), at);
}
/* kosmos#6587 (S-7a slice 2a): whether the pinned coordinator key is on the signed service key set this version
   shipped (engine/servicekeys-check.js). A state only. Shown to the person; never put in status().because, which
   the coordinator also receives, since the coordinator is the party a mismatch suspects. */
const serviceKeyFiles = require('./servicekeys-check');
function serviceKeys() { return serviceKeyFiles.serviceKeyCheck(STATE_DIR(), { production: COORDINATOR() === DEFAULT_COORDINATOR }); }
/* kosmos#6587 (S-7a slice 3): the environment for a setup or sign-in run. With a verified service key set (and the
   production coordinator), the connector is handed its keys and refuses to register under any other (kosmos-relay
   expectkey-6587). Otherwise null, and the run inherits this process's environment exactly as before, except that a
   KOSMOS_EXPECT_COORDINATOR_KEYS inherited from the launcher (a developer's export, say) is removed in every spelling:
   the board decided "no check", and an inherited list would refuse every registration on another coordinator. Set
   and removed through win32env, so a Windows child never gets two spellings (#5386). */
function setupEnv(accepted = null, shipped = undefined) {
  // The shipped list as setupRun read it for this run (review 3: one read, so the run's shippedList and the list it is
  // handed cannot disagree); read here when not given.
  const keys = shipped !== undefined ? shipped : serviceKeyFiles.expectedCoordinatorKeys({ production: COORDINATOR() === DEFAULT_COORDINATOR });
  if (keys) return envSet({ ...process.env }, 'KOSMOS_EXPECT_COORDINATOR_KEYS', keys);
  /* kosmos#6596 step 8: a key the person accepted vouches for itself at the registration it was taken for, beside the
     pin this computer already holds, so a service that goes back to that key still registers. Never with the
     shipped list above: under a list the connector never names a key to accept, and adding one would widen it. */
  if (accepted) return envSet({ ...process.env }, 'KOSMOS_EXPECT_COORDINATOR_KEYS', [pinHeld(), accepted].filter(Boolean).join(','));
  const inherited = Object.keys(process.env).some((k) => k.toUpperCase() === 'KOSMOS_EXPECT_COORDINATOR_KEYS');
  return inherited ? envDelete({ ...process.env }, 'KOSMOS_EXPECT_COORDINATOR_KEYS') : null;
}

/* kosmos#6596 step 8, slice 2: the connector refuses a registration whose coordinator key differs from the one this
   computer trusts when nothing vouches for it (kosmos-relay PinMismatch), and names the key it was offered after
   OFFERED_KEY_LABEL (its own copy is setup.rs OFFERED_KEY_LABEL), in the pin's spelling: 43 base64url characters,
   no padding, for 32 bytes. The person may accept it. The sign-in code is spent by the refused attempt, so the
   acceptance is held for the NEXT registration run, which names it in KOSMOS_EXPECT_COORDINATOR_KEYS. It is held in
   this process only, used once, voided by Forget, and ignored after an hour. Not by Start over or Sign out (the
   sign-in epoch): Start over is how the person gets the new code that the accepted key is for. */
const OFFERED_KEY_LABEL = 'the key it offered: ';
// The connector's own words for a key not on the list it was handed (its copy: kosmos-relay setup.rs).
// The whole sentence, so less of a service's echoed refusal text can match it (review 3).
const NOT_LISTED_WORDS = 'not on the list of keys this computer expects, so nothing was registered';
const notListedRefusal = (r) => String(r.stderr || '').includes(NOT_LISTED_WORDS) || String(r.because || '').includes(NOT_LISTED_WORDS);
const SHIPPED_LIST_REFUSAL = 'the Kosmos+ service offered a key that is not on the signed list that came with this version of Kosmos, so this computer did not sign in. Something may be posing as the Kosmos+ service.';
const ACCEPTED_KEY_MS = 60 * 60 * 1000;
let acceptedKey = null;
// The key a refused sign-in last named, with when: the only key that can be accepted (review 1).
let lastOffered = null;
const fresh = (rec) => !!rec && Date.now() - rec.at <= ACCEPTED_KEY_MS && Date.now() >= rec.at;
/* The pin this computer holds, in its spelling, or null (none, unreadable, not a key). */
function pinHeld() {
  try { return pinSpelledKey(fs.readFileSync(path.join(STATE_DIR(), 'coordinator_pubkey'), 'utf8').trim()); } catch { return null; }
}
function pinSpelledKey(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const raw = Buffer.from(text, 'base64url');
  // Canonical only, as the connector's decoder: the spare bits of the last character are zero.
  return raw.length === 32 && raw.toString('base64url') === text ? text : null;
}
/* The key a refusal names, from anywhere in the text (the connector's message can arrive wrapped in context), or
   null. A text naming two is not trusted to mean either. */
function offeredKeyIn(text) {
  if (typeof text !== 'string') return null;
  const at = text.indexOf(OFFERED_KEY_LABEL);
  if (at < 0 || text.indexOf(OFFERED_KEY_LABEL, at + 1) >= 0) return null;
  const m = /^([A-Za-z0-9_-]+)\)/.exec(text.slice(at + OFFERED_KEY_LABEL.length));
  return m ? pinSpelledKey(m[1]) : null;
}
/* Whether this computer holds a service key set file, usable or not. The connector never asks a person to accept a
   key that contradicts a set signed by the recovery key (accepting would forget the set); the board keeps to that
   even if a message names a key, and errs to "held" for a file it cannot judge. */
function serviceKeySetHeld() {
  try { fs.lstatSync(path.join(STATE_DIR(), trustkeys.STORE_FILE)); return true; } catch (e) { return !(e && e.code === 'ENOENT'); }
}
/* A failed registration that named the key it was offered, while no set is held: the page can offer to accept it. */
function withKeyChange(result) {
  // A registration that went through ends any offer: a later Accept must not vouch for a key nobody is asking about.
  if (result && result.ok === true) { lastOffered = null; acceptedKey = null; }
  /* Under the shipped list (the list this run was handed, decided at its start), the connector's refusal of a key not on
     the list it was handed (kosmos#6596 follow-up, kosmos-relay setup.rs expected_coordinator_key) gets the shipped
     list's meaning, never the raw key and never an offer: the connector cannot tell the shipped list from the board's
     own (the pin and an accepted key), and the board can. Keyed on the connector's sentence, not on a named key, and
     before the held-set return: with a signed set held (the usual state beside a shipped list) the key is not named at
     all (review 2). */
  if (result && result.ok === false && result.shippedList && notListedRefusal(result)) return { ...result, because: SHIPPED_LIST_REFUSAL };
  if (!result || result.ok !== false || serviceKeySetHeld()) return result;
  // The whole of stderr; `because` (its last line) only when there is no stderr, so a text naming two keys across
  // lines is not read as naming one.
  const offered = result.stderr ? offeredKeyIn(String(result.stderr)) : offeredKeyIn(String(result.because || ''));
  if (!offered) return result;
  // Never offered under the shipped list, whatever the refusal (an Accept is refused there anyway).
  if (result.shippedList) return result;
  lastOffered = { key: offered, at: Date.now() };
  return { ...result, keyChanged: { offered } };
}
/* Only the key the last refused sign-in named, within the hour, with no shipped list in force (under one the
   connector names no key) and no signed set held, and not while this computer is being forgotten. */
function acceptOfferedKey(key) {
  const k = pinSpelledKey(key);
  if (!k || !fresh(lastOffered) || lastOffered.key !== k) return { ok: false, because: 'that is not a key Kosmos+ offered' };
  if (forgetting || forgetInFlight) return { ok: false, because: 'this computer is being forgotten' };
  if (serviceKeySetHeld()) return { ok: false, because: 'this computer holds a signed list of Kosmos+ keys, so a different key cannot be accepted here' };
  if (serviceKeyFiles.expectedCoordinatorKeys({ production: COORDINATOR() === DEFAULT_COORDINATOR })) {
    return { ok: false, because: 'this version of Kosmos checks Kosmos+ keys against its own signed list, so a different key cannot be accepted here' };
  }
  acceptedKey = { key: k, at: Date.now() };
  lastOffered = null;   // accepted once: a second Accept needs a second refusal
  return { ok: true, because: null };
}
/* The accepted key for the registration run starting now, once: taken, so a second run does not reuse it. A set
   that arrived since the Accept (a ticket fetch stores one) voids it: under a held set the connector would take a
   named key as vouched and forget the set (review 3). */
function takeAcceptedKey() {
  const a = acceptedKey;
  acceptedKey = null;
  return fresh(a) && !serviceKeySetHeld() ? a.key : null;
}

/** The switch. Turning on does not start anything by itself unless setup
    already happened; the Settings flow calls setupStart/setupComplete and
    then ensure() brings the tunnel up. Turning off stops it now. */
let offEpoch = 0;
/* #3827: signed calls in flight on this Mac's key (device verbs, a second-factor
   reset). Forget waits for them before it retires and wipes, so none finishes
   after the wipe and writes into a state dir that no longer belongs to anyone.
   Each carries its own kill timeout (the tunnel sets none): the device verbs and
   the second reset use the retire bound, macRequest MAC_REQUEST_TIMEOUT_MS and
   assistantChat ASSISTANT_TIMEOUT_MS. So the wait below always ends with the call
   ended, not merely abandoned. */
const signedInFlight = new Set();
function tracked(p) {
  signedInFlight.add(p);
  p.finally(() => signedInFlight.delete(p)).catch(() => {});
  return p;
}
function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  if (!on) stopVouch();   // kosmos#5786 (b): off ends an open-browser secret at once
  // #3827: Forget stops the tunnel, then waits on the retire; turning on in that
  // wait would start one from the key it is about to delete. And a register still
  // out may already have written the certificate: a second tunnel would start
  // beside it before it finishes.
  if (on) { const b = busy(); if (b) return b; }
  // Off during a register is an answer the register must respect: it would
  // otherwise switch Kosmos+ back on when it finishes (turnOnAfterSignin).
  // An unreadable file (#4308) says nothing about the old value, so a save over it counts as a flip.
  const before = read();
  const was = before.ok === true ? before.on === true : !on;
  const wrote = write({ on }, { repair: true });   // #4308: the person's switch repairs a damaged file
  if (!wrote.ok) return wrote;
  if (!on) offEpoch += 1;   // only an off that was saved counts
  ensure(localPort);
  /* kosmos#4743: tell the coordinator about a real flip now, not at the next cadence (up to
     OFF_STANDING_TTL_MS when off), or the account page reads the old state for hours ("Answering
     now" for a computer just switched off). If a refresh is already out it carries the old state, so
     the flip is told when it ends (flipPending). Best-effort and never awaited. Asked at once here, unlike
     turnOnAfterSignin: this is the person's own toggle, and a Forget straight after it waits at most one
     signed call's bound (MAC_REQUEST_TIMEOUT_MS, 20 s) for it. */
  if (was !== on) { flipPending = true; askAfterFlip(); }
  return { ok: true };
}

function setRelay(relay) {
  // It starts the tunnel too (ensure), so it waits like turning on does.
  { const b = busy(); if (b) return b; }
  if (typeof relay !== 'string') return { ok: false, because: 'the relay has to be host:port' };
  const v = relay.trim();
  /* Refuse garbage at set time rather than letting it become a spawn-crash
     loop later: empty clears it, otherwise require host:port. */
  if (v !== '' && !/^[^\s:]+:\d{1,5}$/.test(v)) {
    return { ok: false, because: 'the relay has to be host:port' };
  }
  const wrote = write({ relay: v }, { repair: true });
  if (!wrote.ok) return wrote;
  ensure(localPort);
  return { ok: true };
}

/* kosmos#7285 item 2: on a Kosmos cloud machine the tunnel is the person's only way in, and the switch that would
   repair a damaged remote.json is reachable only through it. So there, a settings file that cannot be read (or is
   gone) keeps the tunnel wanted instead of reading as off, which on a Mac is the safe answer and here is a lockout.
   Switching it off on purpose is refused there anyway (server.js PUT /api/remote, kosmos#7277). Review 1: a MISSING file
   is written again with on there and then, because it reads as a readable off and the next ordinary save (a standing
   refresh, within a poll) would write off into it. Review 2: a file that is there but cannot be read is NOT rewritten
   (every ordinary save already refuses it, and a rewrite from blank would drop this computer's ids and settings, or
   replace a good file after a passing read error): it is kept on in memory each tick. Said in the log once per loss. */
let cloudKeptOnSaid = '';   // the kind of loss last said ('missing' or 'unreadable'), '' once the file reads well
function cloudKeepsOn() {
  let s;
  try { s = read(); } catch { s = { ok: false }; }
  // Missing means not there (ENOENT); any other failure to look is unreadable, and is never written over (review 3).
  let missing = false;
  try { fs.statSync(FILE); } catch (err) { missing = !!(err && err.code === 'ENOENT'); }
  if (s.ok !== false && !missing) { cloudKeptOnSaid = ''; return false; }
  let cloud = false;
  try { cloud = require('./cloudmachine').isCloudMachine(); } catch { cloud = false; }
  if (!cloud) return false;
  let repaired = false;
  if (missing) { try { repaired = write({ on: true }).ok === true; } catch { repaired = false; } }
  const kind = missing ? 'missing' : 'unreadable';
  if (cloudKeptOnSaid !== kind) {
    process.stderr.write('remote: remote.json is ' + (missing ? 'missing' : 'unreadable') + ' on this Kosmos cloud machine; remote access is kept wanted, the only way in'
      + (missing ? (repaired ? ', and the file is written again with it on\n' : ', but the file could not be written\n') : '\n'));
  }
  // A written file reads on from now, so this is not called again and a later loss in the same run is said again.
  cloudKeptOnSaid = repaired ? '' : kind;
  return true;
}

/** Reconcile reality with the switch. Idempotent; the server calls it at
    boot with the board's port and after every toggle. Never throws. */
function ensure(port) {
  try {
    if (typeof port === 'number') localPort = port;
    // Never during a Forget (#3827): the board's tick calls this every 15s, and a
    // tunnel started in the retire wait would run on the key being deleted.
    const wanted = !forgetting && (read().on || cloudKeepsOn()) && enrolled() && !!RELAY() && typeof localPort === 'number';
    if (!wanted) { stopChild(); return; }
    // Samples the tunnel's last failure (kosmos#4277). It also means a healthy board's
    // backoff is reset every tick (status() does that on `up`), not only when a page asks.
    if (child) {
      status();
      if (selfPendingInSnapshot()) allowSelfQuietly();   // #4610, Josh's ruling: the retry, off the read path
      return;
    }
    if (restartTimer) return;
    // Not while a register is out (#3827): the tunnel writes the new key, id and
    // address first and fetches the certificate last, so a tunnel started in that
    // minute would run the new identity on the old certificate. The register
    // brings it up itself when it finishes.
    if (registerInFlight) return;
    startChild();
  } catch (err) {
    process.stderr.write('remote: ensure failed: ' + (err && err.message) + '\n');
  }
}

/* #3311: this Mac's seat in one federated project's room (`kosmos-tunnel
   fed-room`). stdin and stdout are the interface (lines of JSON; see
   engine/fedseats.js); stderr joins the board's log like the tunnel's own. The
   same binary, relay, state dir and coordinator as the drive tunnel. */
/* The connector arguments for a room seat. `target` is an edge id (a guest's link, or an
   owner's active edge), or { own: <project_ref> } for a seat in this computer's OWN
   account's room (kosmos#4649: `fed-room --own-project`, given instead of --edge). */
function fedSeatArgs(target) {
  const own = target && typeof target === 'object' && typeof target.own === 'string' ? target.own : null;
  const args = [
    'fed-room',
    '--relay', RELAY(),
    '--state-dir', STATE_DIR(),
    '--coordinator', COORDINATOR(),
    ...(own !== null ? ['--own-project', own] : ['--edge', String(target)]),
  ];
  if (process.env.AGENT_WORKFORCE_TUNNEL_CA) {
    args.push('--tunnel-ca', process.env.AGENT_WORKFORCE_TUNNEL_CA);
  }
  return args;
}
function spawnFedSeat(target) {
  return spawn(BIN(), fedSeatArgs(target), connectorSpawnOptions({ stdio: ['pipe', 'pipe', 'inherit'] }));
}

function startChild() {
  // kosmos#6595 (R01): the process that forwards is about to be this binary's, so what it vouches for is asked anew.
  tunnelStartedHere = true;
  forgetConnectorCapabilities();
  runningSeen = null;   // a new process: its own list, even if it gets an earlier child's pid (review 10)
  if (restartPending) { restarts += 1; restartPending = false; }
  lastTunnelFailure = null;   // a new process has written nothing yet
  dialingSince = performance.now();
  const args = [
    'run',
    '--relay', RELAY(),
    '--state-dir', STATE_DIR(),
    '--local', '127.0.0.1:' + localPort,
    '--status-file', STATUS_FILE(),
    '--coordinator', COORDINATOR(),
  ];
  if (process.env.AGENT_WORKFORCE_TUNNEL_CA) {
    args.push('--tunnel-ca', process.env.AGENT_WORKFORCE_TUNNEL_CA);
  }
  secureStateDir();
  // kosmos#6669: a status file left by a tunnel this board did not start names that tunnel; end it if it is still one.
  try { const left = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')); if (left && Number.isInteger(left.pid)) endForeignTunnel(left.pid); } catch { /* none */ }
  try { fs.rmSync(STATUS_FILE(), { force: true }); } catch { /* stale is worse than absent */ }
  let spawned;
  try {
    /* stdout is dropped (the status file is the interface); stderr joins the
       board's log, which launchd keeps, so a refused ticket is findable. */
    /* #3838: the tunnel presents the board's own token on requests from devices this
       Mac has Allowed; since #1946 the board answers nothing without it, and a remote
       browser saw "This board is not signed in". The PATH goes by environment, never
       the value and never argv: it is the SAME file the board reads its token from
       (the primary leaf is mode 600; a legacy-leaf copy has no mode guarantee, but
       the board already trusts it, so the tunnel adds no new trust), and an
       older bundled tunnel ignores an unknown variable where it would refuse an
       unknown flag and never connect. */
    let tokenFile = '';
    try { tokenFile = require('./boardauth').enforcedTokenPath(); } catch (err) {
      // Not "the tunnel could not start": it can, it just shows a board that is not signed in.
      process.stderr.write('remote: could not find the board token file: ' + (err && err.message) + '\n');
    }
    const env = { ...process.env };
    envDelete(env, 'KOSMOS_BOARD_TOKEN_FILE');   // never a stale one inherited from the launcher, in any spelling (with no token file, nothing replaces it)
    if (tokenFile) envSet(env, 'KOSMOS_BOARD_TOKEN_FILE', tokenFile);
    spawned = spawn(BIN(), args, connectorSpawnOptions({ stdio: ['ignore', 'ignore', 'inherit'], env }));
  } catch (err) {
    restartBecause = 'the tunnel program could not be started: ' + (err && err.message);
    process.stderr.write('remote: ' + restartBecause + '\n');
    scheduleRestart();
    return;
  }
  child = spawned;
  restartBecause = null;
  child.on('error', (err) => {
    /* spawn() does not throw on ENOENT (a missing or non-executable binary):
       the error event fires and exit NEVER does, so the child never runs and
       never exits. If we only set the reason here, child stays non-null,
       ensure() early-returns on the dead handle forever, and status() renders
       a permanent false "connecting" -- exactly the shrug the plan forbids.
       Null the child and schedule the restart here, as the exit handler would;
       scheduleRestart's guard keeps it safe if an exit somehow also fires. */
    restartBecause = 'the tunnel program could not be started: ' + (err && err.message);
    process.stderr.write('remote: ' + restartBecause + '\n');
    child = null;
    if (read().on) scheduleRestart();
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (!read().on) return; // stopped on purpose
    if (!restartBecause) {
      restartBecause = signal
        ? 'restarting after the tunnel was killed (' + signal + ')'
        : 'restarting after a crash (exit ' + code + ')';
    }
    process.stderr.write('remote: ' + restartBecause + '\n');
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    backoffMs = Math.min(backoffMs * 2, 60000);
    restartPending = true;   // counted in startChild, only if a tunnel really is started again
    ensure(localPort);
  }, backoffMs);
  /* A pending restart must not hold the board open on shutdown. */
  if (typeof restartTimer.unref === 'function') restartTimer.unref();
}

/* kosmos#4277: a register that succeeded starts the tunnel itself, so a
   relaunch the supervisor had pending (its flag AND its timer, which can outlive the register when
   the identity is kept and nothing stopped the tunnel) is dropped: the register's start is not a
   relaunch, and it must not wait for an old backoff to fire. */
function registerTakesOver() {
  restartPending = false;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

function stopChild() {
  restartPending = false;   // a deliberate stop: the next start is not a supervisor relaunch
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  backoffMs = 1000;
  restartBecause = null;
  if (child) {
    /* An intentional stop must not look like a crash: the exit handler
       belongs to the supervised life of this child, and a kill we chose
       would otherwise race a later toggle and schedule a ghost restart. */
    child.removeAllListeners('exit');
    try { child.kill(); } catch { /* already gone */ }
    child = null;
  }
}

/* ⚠️ The child must never outlive the board (#156 is the recorded incident
   for orphans). launchd stopping the board sends SIGTERM; killing the child
   on our way out covers that and plain exit. SIGKILL leaves an orphan whose
   own reconnect loop keeps running. The next board's tunnel replaces the
   orphan's relay connection (newest wins), but the orphan just dials again
   and takes it back, so the two alternate: it does NOT idle. Since kosmos#6669
   the next board ends it (endForeignTunnel), where it can read its parent. */
function reap() { try { if (child) child.kill(); } catch { /* going down anyway */ } }
process.on('exit', reap);
/* On a termination signal, reap the child then RE-RAISE rather than
   process.exit(0): a library module must not seize the exit code or cut off
   the board's own async graceful shutdown. Removing our handler and
   re-sending the signal lets the real owner (or the default action) proceed,
   and yields the conventional signal exit status instead of a forged 0. */
for (const sig of ['SIGTERM', 'SIGINT']) {
  const handler = () => {
    reap();
    process.removeListener(sig, handler);
    process.kill(process.pid, sig);
  };
  process.on(sig, handler);
}

/** What the board paints. Every not-up state carries its because. */
function status() {
  try {
    const settings = read();
    /* A corrupt settings file reads as off, but saying "the switch is off"
       would be untrue. Fail toward off AND say the file is unreadable, so a
       person is not told they turned something off that they did not. */
    if (!settings.ok) {
      return {
        state: 'off',
        address: null,
        /* #4308: say what repairs it, here and only here. The page shows this sentence as it is (paintPlus), so the
           repair instruction has one source. Only a person's own action (the switch among them) rewrites a damaged
           file (see write()). "Kosmos+" is what the pane calls the switch. */
        because: 'your remote-access settings could not be read. Turn Kosmos+ on again to repair them',
      };
    }
    if (!settings.on) return { state: 'off', address: null, because: 'the switch is off' };
    if (!enrolled()) {
      return {
        state: 'connecting',
        address: null,
        because: settings.email
          ? 'waiting for the code sent to ' + settings.email
          : 'waiting for the sign-in in Settings',
      };
    }
    if (!RELAY()) {
      return { state: 'off', address: null, because: 'no relay address is set yet' };
    }
    if (!child) {
      return restartTimer || restartBecause
        ? { state: 'restarting', address: null, because: restartBecause || 'restarting' }
        : { state: 'off', address: null, because: 'the board has not started the tunnel' };
    }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')); } catch { raw = null; }
    if (raw && Number.isInteger(raw.pid) && raw.pid !== child.pid) endForeignTunnel(raw.pid);   // kosmos#6669
    if (raw && raw.pid === child.pid && !(runningSeen && runningSeen.pid === child.pid)) noteRunning(raw, child.pid);
    if (!raw || raw.pid !== child.pid) {
      return { state: 'connecting', address: null, because: 'starting the connection' };
    }
    if (raw.state === 'up') { lastTunnelFailure = null; dialingSince = null; }
    else if (dialingSince === null) dialingSince = performance.now();
    if (raw.state === 'restarting' && typeof raw.because === 'string' && raw.because) lastTunnelFailure = raw.because;
    if (raw.state === 'up') {
      /* A healthy run earns a fresh backoff: without this the window only
         ever grows (stopChild is the sole other reset), so a board that has
         been up for days would reconnect on a 60s delay after one blip. */
      backoffMs = 1000;
      /* #4419: admits_hooks is written by the running connector about itself (relay#195 computes it
         from its own admission check), so only an explicit true counts; an older connector never
         writes it, and its absence means no internet link for webhooks. */
      return { state: 'up', address: raw.address || address(), because: null, admitsHooks: raw.admits_hooks === true };
    }
    /* kosmos#4640: waiting for the other computer's Allow. Kept while the tunnel only says it is
       dialling again (connecting, no reason), the same way lastTunnelFailure is, and dropped once it
       is up or its process writes any other failure (lastTunnelFailure is replaced or cleared). */
    const waitFor = raw.state === 'restarting' ? raw.because : (raw.state === 'connecting' && !raw.because ? lastTunnelFailure : null);
    const waitSaid = allowWaitSentence(waitFor);
    if (waitSaid) return { state: 'waiting-allow', address: null, because: waitSaid };
    return {
      state: raw.state === 'restarting' ? 'restarting' : 'connecting',
      address: null,
      because: raw.because || 'connecting to the relay',
    };
  } catch (err) {
    return { state: 'off', address: null, because: 'status unreadable: ' + (err && err.message) };
  }
}

/** Run a setup subcommand; resolve {ok, because} and never reject. The
    binary owns the crypto and the wire; we own turning its exit into a
    sentence a person reads next to the switch. When `stdin` is a string it is
    written to the child's stdin and the stream closed (the #3149 `signin
    register` path pipes the session token in this way, so the 30-day credential
    never sits on argv); when it is null the child gets no stdin, exactly as
    before -- so every existing caller is unaffected.
    `opts.keepStdout` (kosmos#5744, mac-request only): a failed run's stdout is kept as `said`. Other verbs print
    their logs there, so no other caller gets it on a failure. */
function setupRun(args, stdin = null, timeoutMs = 0, opts = {}) {
  return new Promise((resolve) => {
    let spawned;
    let timer = null;
    let closeTimer = null;
    let settled = false;
    /* kosmos#6596 follow-up (review 1): whether this registration ran under the shipped list, decided when it starts, as
       the list it is handed is: withKeyChange reads this, never the setting again when the run ends. */
    const shipped = serviceKeyFiles.expectedCoordinatorKeys({ production: COORDINATOR() === DEFAULT_COORDINATOR });
    const shippedList = Boolean(opts && opts.register && shipped);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (closeTimer) clearTimeout(closeTimer);
      resolve(opts && opts.register ? { ...result, shippedList } : result);
    };
    try {
      // Only a registration run takes an accepted key (opts.register): no other verb registers.
      const env = setupEnv(opts && opts.register ? takeAcceptedKey() : null, shipped);
      spawned = setupSpawn(BIN(), args, connectorSpawnOptions({ stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(env ? { env } : {}) }));
    } catch (err) {
      finish({ ok: false, because: 'the tunnel program could not be started: ' + (err && err.message) });
      return;
    }
    let out = '';
    let errOut = '';
    spawned.stdout.on('data', (d) => { out += d; });
    spawned.stderr.on('data', (d) => { errOut += d; });
    spawned.on('error', (err) => {
      finish({ ok: false, because: 'the tunnel program could not be started: ' + (err && err.message) });
    });
    if (stdin !== null && spawned.stdin) {
      // A child that exits before reading breaks the pipe with EPIPE; that is
      // the child's exit code's story, not an error to surface here, so swallow it.
      spawned.stdin.on('error', () => {});
      try { spawned.stdin.end(String(stdin)); } catch { /* the exit handler reports the real outcome */ }
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { spawned.kill('SIGKILL'); } catch { /* already gone */ }
        finish({ ok: false, because: 'the tunnel program did not answer in time', timedOut: true });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
    const resultFor = (code) => {
      if (code === 0) { finish({ ok: true, because: null, said: out.trim() }); return; }
      /* kosmos#5744: a {"refusal":...} line (mac-request prints one on stdout when refused) is data, never words
         for a person, so for any verb and from either stream it is never `because`, even when stderr is empty.
         A line of only spaces is skipped too, so it cannot be `because` either. */
      const words = (t) => t.split('\n').filter((l) => l.trim() && !isRefusalLine(l));
      const errLines = words(errOut.trim());
      const lines = errLines.length ? errLines : words(out.trim());
      /* `stderr` is the WHOLE of it: a caller that must recognise a message clap prints
         across several lines (an unknown subcommand, #3660) cannot use the last line. */
      finish({ ok: false, because: lines[lines.length - 1] || ('setup failed (exit ' + code + ')'), stderr: errOut, code,
        ...(opts && opts.keepStdout ? { said: out.trim() } : {}) });
    };
    spawned.on('exit', (code) => {
      if (settled) return;
      // The process has ended, so its operation timeout no longer applies. Give
      // inherited pipe holders a short drain window, then answer instead of
      // hanging callers that deliberately have no operation timeout.
      if (timer) { clearTimeout(timer); timer = null; }
      closeTimer = setTimeout(() => {
        console.error('remote: setup child stdio did not close within 2 seconds after exit; using collected output');
        resultFor(code);
      }, SETUP_CLOSE_GRACE_MS);
    });
    spawned.on('close', (code) => {
      resultFor(code);
    });
  });
}

/** One signed request to a coordinator route the tunnel allow-lists (a /v1/mac/ route, or since kosmos#5535 an
    org backup grant route), through the tunnel's
    `mac-request` verb (#718): the key stays in the tunnel binary, never here.
    A POST body goes on stdin, never argv. Resolves to
    { ok: true, data } with the coordinator's parsed JSON, or
    { ok: false, because }, and, when the coordinator refused it and the tunnel printed the refusal's fields
    (kosmos#5744), `refusal: { status, code, currentEpoch }` (refusalOf). No `refusal` key from an older tunnel, an
    outage, a timeout, a tunnel that could not start, or a request refused here before it was sent (`notSent`). */
// A signed request is one round trip; 20 s covers a slow network and still
// frees a caller (a Settings turn-on) stuck on a hung tunnel.
const MAC_REQUEST_TIMEOUT_MS = 20 * 1000;
/* kosmos#4277: `opts.keyOnly` signs with only the identity files (mac_id and mac_key),
   for the one call that must still go out when the board believes it is NOT enrolled:
   the remote report, which is how we learn WHY. The tunnel's mac-request verb needs no
   more than those two files. Every other caller keeps the enrolled() gate. */
/* ONE derivation of "this Mac holds its key and id" (halfRegistered() below builds on it). */
function holdsKey() {
  const dir = STATE_DIR();
  return ['mac_id', 'mac_key'].every((f) => fs.existsSync(path.join(dir, f)));
}
const KEY_ONLY_ROUTE = '/v1/mac/standing';
/* The one refusal that carries current_epoch (the coordinator's 400). */
const WRONG_EPOCH_CODE = 'member_key_wrong_epoch';
/* kosmos#5744: the `{"refusal":{"status","code","current_epoch"}}` line a failed mac-request prints on stdout, as
   { status, code, currentEpoch }, or null when there is none (an older tunnel, an outage, a check that refused
   before sending). Each field is checked: status a whole number 100 to 599, code letters, digits and _ (at most
   40), currentEpoch a safe whole number of 0 or more beside WRONG_EPOCH_CODE; anything else reads as null. The
   last JSON line on stdout is read, as for an answer (lastJsonLine). */
function refusalOf(said) {
  const got = lastJsonLine(said);
  const r = got && got.value && typeof got.value === 'object' ? got.value.refusal : null;
  if (!r || typeof r !== 'object' || !Number.isInteger(r.status) || r.status < 100 || r.status > 599) return null;
  // The tunnel's own rule for a public code (refusal_code: letters, digits and _, at most 40).
  const code = typeof r.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(r.code) ? r.code : null;
  return {
    status: r.status,
    code,
    // Only beside the code that carries it, as the tunnel keeps it: a caller can act on any currentEpoch it gets.
    currentEpoch: code === WRONG_EPOCH_CODE && Number.isSafeInteger(r.current_epoch) && r.current_epoch >= 0 ? r.current_epoch : null,
  };
}
/* A line that is a refusal object: JSON with a `refusal` key. One rule for setupRun's `because` filter and
   refusalOf, whatever the line's spacing or key order. */
function isRefusalLine(line) {
  const t = String(line || '').trim();
  if (!t.startsWith('{')) return false;
  try { const v = JSON.parse(t); return !!v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'refusal'); } catch { return false; }
}
async function macRequest(method, routePath, body, opts) {
  const keyOnly = !!(opts && opts.keyOnly);
  // keyOnly opens ONE route, the report's, and nothing else, whatever a future caller passes.
  if (keyOnly && !(method === 'POST' && routePath === KEY_ONLY_ROUTE)) {
    return { ok: false, notSent: true, because: 'only the remote report may be signed without enrolment' };
  }
  const identityThere = keyOnly ? holdsKey() : enrolled();
  // notSent: refused here, before anything left this computer (a caller can then say "nothing was sent" for certain).
  if (!identityThere) return { ok: false, notSent: true, because: 'this computer is not connected to Kosmos+' };
  const args = ['mac-request', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR(),
    '--method', method, '--path', routePath];
  // AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS is a test seam (a hung tunnel in a test).
  const timeout = Number(process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS) || MAC_REQUEST_TIMEOUT_MS;
  // A signed call like the device verbs: refused while a register or a Forget is
  // out (it would sign with a key being replaced or retired), and Forget waits for
  // one already out (it carries its own bound).
  { const b = busy(); if (b) return Object.assign({}, b, { notSent: true }); }
  const r = await tracked(setupRun(args, method === 'GET' ? null : JSON.stringify(body || {}), timeout, { keepStdout: true }));
  if (!r.ok) {
    // kosmos#5744: a coordinator refusal's fields, from a tunnel that prints them (an older one prints none).
    const refusal = refusalOf(r.said);
    return refusal ? { ok: false, because: r.because, refusal } : { ok: false, because: r.because };
  }
  const got = lastJsonLine(r.said);
  if (got) return { ok: true, data: got.value };
  return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
}

/* A model answer, not a single signed round trip: capped output, but a slow provider.
   AGENT_WORKFORCE_ASSISTANT_TIMEOUT_MS is its own test seam, apart from mac-request's. */
const ASSISTANT_TIMEOUT_MS = 45 * 1000;

/* Whether the hosted setup assistant can be asked from here at all (#3660, the bubble): a connector at a
 * real path, the copy this app ships (an installed Kosmos) or an explicit override. A source checkout
 * falls back to a bare name on PATH, which counts as NO here on purpose: a developer's board, and every
 * browser-check sandbox, must never offer a chat that goes to the production coordinator unasked. It says
 * nothing about whether that connector knows the verb; an old one answers 501 and the bubble steps aside. */
function hostedAvailable() {
  const b = BIN();
  try { return path.isAbsolute(b) && fs.statSync(b).isFile(); } catch { return false; }
}

/**
 * One message to the hosted setup assistant (#3660), through the tunnel's
 * `assistant-chat` verb. NO CRYPTO HERE, as above: the verb picks the key (this
 * Mac's own when enrolled, else the install key it registers on first use), signs
 * afresh on every run, and prints `{"status": <http status>, "body": <json>}` for
 * ANY answer from the coordinator, refusals included. A non-zero exit means the
 * coordinator could not be reached or the request could not be signed.
 * Resolves to one of:
 *   { ok: true, status, body }                       the coordinator answered
 *   { ok: false, unsupported: true, because }        this tunnel predates the verb
 *   { ok: false, because }                           no answer (network, signing)
 * The body goes on stdin, never argv. Never throws.
 */
async function assistantChat(body) {
  /* 🛑 SUITE GUARD, the one engine/mac-standing.js uses: under the test runner never
     run the real bundled tunnel, which would send a sandbox's message to the
     production coordinator on our key. A test that supplies a fake tunnel still runs. */
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) {
    return { ok: false, because: 'the tunnel is not available under test' };
  }
  // Signed with this Mac's key (or the install key) in the state dir, like every
  // other signed call: refused while a register or a Forget is out, and Forget
  // waits for one already out (it carries its own bound). (#3827)
  { const b = busy(); if (b) return b; }
  const args = ['assistant-chat', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()];
  const timeout = Number(process.env.AGENT_WORKFORCE_ASSISTANT_TIMEOUT_MS) || ASSISTANT_TIMEOUT_MS;
  let r;
  try { r = await tracked(setupRun(args, JSON.stringify(body || {}), timeout)); }
  catch (err) { return { ok: false, because: String((err && err.message) || err) }; }
  if (!r.ok) {
    const because = String(r.because || 'the tunnel program failed');
    /* clap prints "error: unrecognized subcommand 'assistant-chat'" FIRST and the usage
       after it, so the last line alone never says so (measured on the shipped tunnel). */
    if (/unrecognized subcommand|invalid subcommand/i.test(String(r.stderr || '') + '\n' + because)) {
      return { ok: false, unsupported: true, because };
    }
    return r.timedOut ? { ok: false, timedOut: true, because } : { ok: false, because };
  }
  const got = lastJsonLine(r.said);
  if (!got) return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
  const said = got.value;
  if (!said || typeof said !== 'object' || !Number.isInteger(said.status) || !said.body || typeof said.body !== 'object') {
    return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
  }
  return { ok: true, status: said.status, body: said.body };
}

/** Forget this Mac (#793): retire it at the coordinator while its key still
 * exists, THEN destroy the key. Order is the whole point: after the state
 * dir is gone the Mac cannot speak for itself and only a signed-in phone
 * can retire it (a dead sandbox, a wiped laptop). Its outcome is reported,
 * never hidden. kosmos#6389: a retire that got no answer (offline, timed out, a
 * server error) KEEPS the key, as clearHalfIdentity does, and answers kept: the
 * computer is not removed yet. Wiping it
 * there left the name held on the account with nothing here able to free it.
 * Only `anyway` (the person chose to remove it from this computer only, told
 * the cost) wipes after such a retire. A kept Remove has still ended what forget() ends first: a sign-in or company
 * setup in progress and an open browser secret. A final refusal is wiped as before:
 * keeping a key Kosmos+ will never accept would say "try again" forever. */
async function forget({ anyway = false } = {}) {
  forgetTlsPins();   // kosmos#6589
  // #3827: a sign-in in flight ends with the Mac's identity. Cancel it (its register
  // must not turn the switch back on), and WAIT for a register already out, so what
  // is retired and wiped below includes it; otherwise it writes a fresh identity
  // into the directory this empties. The wait is bounded: the register itself is
  // (registerTimeoutMs). Worst case, five bounds in a row, about nine minutes: the
  // register first waiting on signed calls already out (a minute) and retiring a
  // half identity (retireTimeoutMs, a minute), the register itself (five), signed
  // calls already out again (a minute, below), then this retire (a minute). Only
  // when something is already broken. kosmos#5422 adds a sixth, the wait on key-making calls (a minute, below).
  //
  // One forget at a time: a second (a double click, two tabs, a retried request)
  // gets the first one's answer instead of retiring the same Mac beside it. kosmos#6389: except that a second
  // asking `anyway` does not settle for a first one's kept: it runs once the first has ended.
  if (forgetInFlight) return anyway ? forgetInFlight.then((got) => (got && got.kept ? forget({ anyway: true }) : got)) : forgetInFlight;
  acceptedKey = null;   // kosmos#6596 step 8: an accepted or offered key belonged to the trust being forgotten
  lastOffered = null;
  signinEpoch += 1;
  signinSession = null;
  companySetup = null;   // kosmos#5628 review 1: a forgotten Mac keeps no half-made company setup (nor its secret)
  stopVouch();   // kosmos#5786 (b): nor an open-browser secret
  lastVouched = null;
  resetSelfGrant();   // bumps the epoch; `forgetting` is what keeps an allow already out from being noted
  forgetting = true;
  // Offline now, not after the wait: the person asked to be forgotten.
  stopChild();
  forgetInFlight = (async () => {
    try {
      if (registerInFlight) await registerInFlight;
      // Bounded: each tracked call carries its own kill timeout (at most one retire
      // bound), so this wait ends with the calls ended.
      if (signedInFlight.size) await Promise.allSettled([...signedInFlight]);
      // kosmos#5422: a device-key ask or a keyed start may be making the key in the folder Forget empties. This wait
      // is bounded (KEY_CALL_WAIT_MS, a minute), a sixth bound in the worst case above.
      if (deviceIdInFlight.size) {
        let timer;
        await Promise.race([Promise.allSettled([...deviceIdInFlight]), new Promise((ok) => { timer = setTimeout(ok, keyCallWaitMs()); })]);
        clearTimeout(timer);
      }
      return await forgetNow(anyway);
    } finally {
      forgetting = false;
      forgetInFlight = null;
    }
  })();
  return forgetInFlight;
}
let forgetInFlight = null;

async function forgetNow(anyway) {
  flushWaiting();   // kosmos#6590 branch c: a Forget clears the state folder, so nothing read before it is served after
  const was = { enrolled: enrolled(), address: address() };
  // A register killed mid-certificate (or any partial one) has registered the Mac
  // at the coordinator and left its key and id here, without the certificate
  // enrolled() needs. It can still sign a retire, so it is retired too.
  const canRetire = was.enrolled || halfRegistered();
  const wasOn = read().on === true;   // kosmos#6389: a kept answer tells the account about this switch-off
  stopChild();
  // Off before the retire wait, not after: nothing may bring this Mac online on
  // the key being retired (the ensure tick, a stale page).
  write({ on: false }, { repair: true });
  /* kosmos#5995: computer_name is NOT cleared here, on purpose. It is the person's own choice of what to call this
     computer, not a note about a sign-in, and the next sign-in's box is filled with it. (On a damaged file this
     write starts from the defaults, so the choice is lost with everything else.) Pinned in remote.test.js. */
  const flipBefore = flipPending;   // kosmos#6389: put back if the identity is kept
  flipPending = false;   // kosmos#4743: a flip not yet told belonged to the identity being forgotten
  let retired = false;
  let because = null;
  if (canRetire) {
    const r = await retireHere();
    retired = r.ok === true || retiredAlready(r);
    because = retired ? null : retireReason(r);
    // kosmos#6389: no answer is "not now". The key stays, so a later Remove can still sign the retire. Plus stays off
    // (written above): the person asked for this computer to go, so it does not come back online by itself.
    if (!retired && !anyway && retireTransient(r)) {
      stopChild();
      // The switch-off is queued like any flip (kosmos#4743) and goes on the next poll: busy() stops this ask while
      // forgetting.
      if (wasOn || flipBefore) { flipPending = true; askAfterFlip(); }
      const keptBecause = 'this computer is not removed yet, because your Kosmos+ account could not be reached or did not answer (' + because + ')';
      write({ forget_kept: keptBecause });
      return { ok: false, kept: true, retired: false, address: was.address, because: keptBecause };
    }
  }
  clearStateDir([]);   // best effort; enrolled() re-reads
  try { fs.rmSync(STATUS_FILE(), { force: true }); } catch { /* stale is worse than absent */ }
  const r = read();
  /* Fed gate: CLEAR the cached standing on forget. This account is gone from this
     Mac; leaving a 'good' standing behind would make kosmosPlus() (and so the paid
     federation UI) true for the NEXT account that has not signed in yet -- a leak
     of a member-only feature to a non-member. A real sign-in re-caches the new
     account's standing; until then, unknown -> not a member. */
  write({ ...r, on: false, standing: '', vouched: {}, forget_kept: '' }, { repair: true });   // kosmos#5786 (b): a forgotten computer keeps no notes
  // kosmos#5422: only now, after the repairs above put this process's ids back into remote.json (which keeps them, so
  // the old rows stay this computer's own), is what this process held let go.
  heldIdentity = null;
  // Anything started during the retire wait (it can be minutes) goes too.
  stopChild();
  return {
    ok: true,
    retired,
    address: was.address,
    // Keyed on what was ATTEMPTED (canRetire), not on enrolled(): a half-registered
    // Mac is retired too, and its result must be reported as it is.
    because: !canRetire ? 'this computer was not set up for Plus, so there was nothing to retire'
      : retired ? null
      : 'this computer is forgotten here, but your Kosmos+ account could not be updated (' + because + '); its address may still show on your account page until you remove it there',
  };
}

/** Reset the account's second factor from this Mac (#733 recovery). A person
 * at this keyboard already holds what the factor protects, so the Mac's own
 * signed request clears it and nothing else can; the coordinator refuses it
 * unsigned and for a stranger key. Only an enrolled Mac can ask. */
async function secondReset() {
  // Signed with this Mac's key, which a Forget or a register may be replacing.
  { const b = busy(); if (b) return b; }
  if (!enrolled()) {
    return { ok: false, because: 'this computer is not set up for Plus, so it cannot reset a second factor' };
  }
  const r = await tracked(setupRun(['second', 'reset', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], null, retireTimeoutMs()));
  if (!r.ok) return { ok: false, because: r.because };
  // #6611: the connector prints the coordinator's answer, {"ok":true,"had":"totp"|"sms"|null}. `had` is null when
  // there was no factor to clear, and then no session ended (kosmos#6605), so the page must not say one did. An answer
  // this cannot read (no JSON line, no `had`, or a `had` of any other type) is undefined: unknown, never "none", because
  // "none" makes the page say nobody was signed out. Every connector since 2026-08-25 prints `had`, so unknown means
  // an answer that went wrong, not an old connector. And `had` cannot tell whether the coordinator ends sessions
  // (kosmos#6605 deployed): a coordinator without it answers `had` too. That is held by the merge order, not here.
  const got = lastJsonLine(r.said);
  const v = got && got.value && typeof got.value === 'object' ? got.value : null;
  const had = v && typeof v.had === 'string' && v.had.trim() ? v.had : v && v.had === null ? null : undefined;
  return { ok: true, because: null, had };
}

/** The email step: ask the coordinator to send the code. */
async function setupStart(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  const result = await setupRun(['setup', 'start', '--coordinator', COORDINATOR(), '--email', email]);
  if (result.ok) write({ email }, { repair: true });
  return result;
}

/** The code step: finish enrolment, then bring the tunnel up if the switch
    is on. `name` is the address label the person asked for. */
async function setupComplete(code, name) {
  // #3827: the older Settings setup writes the same state directory as the in-app
  // register, so it takes the same guards.
  { const b = busy(); if (b) return b; }
  const settings = read();
  if (!settings.email) return { ok: false, because: 'start with the email step' };
  // #1010: a reinstall whose state SURVIVED is already set up -- do not re-enrol.
  // install/setup.sh never removes Application Support, so mac_id / address /
  // tls.crt / tls.key survive an install-over-the-top and enrolled() reads true.
  // Re-running enrolment here would mint a NEW identity key (crates/tunnel
  // setup.rs generates a fresh one by design, #1003), spend a scarce certificate
  // (#1003), and hit the coordinator's 409 about "a Mac on this account" -- for
  // THIS same Mac's own previous life, with no other Mac in sight. So when we are
  // already enrolled at the address this name maps to, recognise the Mac as
  // itself and just bring the tunnel up. A DIFFERENT name is a rename (a real
  // address change) and deliberately falls through to the setup path below.
  //
  // ACCOUNT-SWITCH EDGE (by design, not a defect): if the surviving state is for
  // account A at name X and someone runs the flow with a DIFFERENT account's
  // email and that account's valid code but the SAME name X, this recognises the
  // Mac and keeps account A's enrolment -- the new code is never used. Switching
  // the account on a Mac is what `forget()` (which wipes the state dir) is for;
  // once the state is gone, enrolled() is false and this guard does not fire.
  /* #3796 addendum 6 (Josh: "support either capital or lowercase"): the coordinator lowercases a
     name anyway, so only this app refused "MacbookPro". Lowercase (and trim) FIRST, before the
     recognition below as well as the rule: "Hers" on a Mac enrolled as hers is this Mac (review). */
  if (typeof name === 'string') name = name.trim().toLowerCase();
  const recognised = alreadySetUpAs(name);
  if (recognised) return recognised;
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  if (typeof name !== 'string' || !NAME_RULE.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 letters, digits or hyphens' };
  }
  return runSetupComplete([
    'setup', 'complete',
    '--coordinator', COORDINATOR(),
    '--email', settings.email,
    '--code', String(code),
    '--name', name,
    '--state-dir', STATE_DIR(),
  ], null, name);
}

/* #1010 (shared since kosmos#5628 review 1): a reinstall whose state survived, at the address this name maps to, is
   this Mac already set up: bring the tunnel up rather than enrol again (a new identity key, a scarce certificate, and
   the coordinator's 409 about this Mac's own previous life). Both setups ask it; MDM fleets reinstall often. */
function alreadySetUpAs(name, bringUp = true) {
  if (!enrolled()) return null;
  const have = address();
  if (have && have.split('.')[0] === name) {
    if (bringUp) ensure(localPort);
    return { ok: true, because: null, alreadySetUp: true, address: have };
  }
  return null;
}

/* kosmos#5628: the guarded run both setups share (the code one above, the company sign-in one below): the same
   tracking, the same half-identity rule, the same cancel and identity bookkeeping. `stdin` carries a secret when one
   is needed (never argv). */
async function runSetupComplete(args, stdin, name) {
  secureStateDir();
  // Tracked like the in-app register (Forget waits for it; nothing else starts
  // beside it), bounded the same, and a half identity is retired first.
  const epoch = signinEpoch;
  const before = macIdHere();
  const addressBefore = address();
  const startedAt = Date.now();
  const running = (async () => {
    const half = await clearHalfIdentity();
    if (half && half.kept) return KEPT_HALF(half.kept);
    if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
    return explainStranded(await setupRun(args, stdin, registerTimeoutMs(), { register: true }), half, name);
  })();
  registerInFlight = running;
  // A Forget or Sign out that lands while this waits: the Settings page must not
  // be told it is set up, and nothing here may bring the tunnel up.
  let result;
  try { result = await running; } finally { if (registerInFlight === running) registerInFlight = null; }
  if (epoch !== signinEpoch) return cancelledAfter(result, before, addressBefore, startedAt);
  if (result.ok && macIdHere() !== before) stopChild();
  if (!result.ok) abandonChangedIdentity(before, addressBefore, startedAt);
  // A new identity: the previous account's cached standing does not carry over.
  if (result.ok && macIdHere() !== before) fedSetStanding('');
  if (result.ok && macIdHere() !== before) forgetPendingSnapshot();   // #4610
  // kosmos#4277: the register's own start is not a supervisor relaunch, even if a restart timer fired
  // while it was out; a register that fails leaves the pending relaunch for the next tick.
  if (result.ok) { registerTakesOver(); ensure(localPort); }
  /* #3889: cache this account's standing now. `setup complete` prints no JSON (setupRun never sets .data, so the
     branch that read result.data here never ran), and a new identity was just cleared to '' with a FRESH
     standing_at, so the poll would not re-ask for a whole TTL: the member-only federation UI read "not a member"
     until then. ttlMs 0 asks now. Not awaited: single-flighted, never throws, and the setup answer does not wait
     on a second network call. */
  if (result.ok) refreshStandingIfStale({ ttlMs: 0 });
  return withKeyChange(result);
}


/* ---- kosmos#5628 (MDM zero-touch, slice 2b): a company's managed Macs set up through the company's own sign-in.
   The company's MDM pushes a profile (domain com.installkosmos.kosmos) naming the company; it carries no secret.
   With it, the person signs in with their company account in the browser and approves this computer there by its
   code; nobody types an email code. The setup's secret lives in THIS engine only (never sent to the page), the same
   rule the in-app sign-in keeps for its session (#874). ---- */

const MANAGED_DOMAIN = 'com.installkosmos.kosmos';
const ORG_SLUG_RULE = /^[a-z0-9-]{1,64}$/;

/** The plist a managed preference lives in: the device scope, then this user's. */
function managedPrefsPaths() {
  let user = '';
  try { user = require('node:os').userInfo().username; } catch { user = ''; }
  const base = '/Library/Managed Preferences';
  return [base + '/' + MANAGED_DOMAIN + '.plist'].concat(user ? [base + '/' + user + '/' + MANAGED_DOMAIN + '.plist'] : []);
}

/** Read one managed-preferences plist as an object, or null (macOS only; plutil ships with it). */
function readManagedPlist(path) {
  if (process.platform !== 'darwin' || !fs.existsSync(path)) return null;
  try {
    const raw = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(raw);
  } catch { return null; }
}
/* Review 2: the first plist that names a company (a device-scope plist of this domain without OrgSlug does not hide
   a user-scope one that has it). */
const defaultManagedReader = () => {
  for (const p of managedPrefsPaths()) {
    const v = readManagedPlist(p);
    if (v && typeof v.OrgSlug === 'string' && ORG_SLUG_RULE.test(v.OrgSlug.trim())) return v;
  }
  return null;
};
let managedReader = defaultManagedReader;

/** The company this Mac is managed for, from its MDM profile: { orgSlug } or null (a malformed value is no profile).
    Review 2, decided: the profile's CoordinatorURL is NOT read. This board always sets up against its own coordinator
    (COORDINATOR()); letting a profile choose where a Mac enrolls is a decision of its own, not this slice's, and two
    answers to "which coordinator" could disagree. */
let managedCache = null;   // { at, value }: review 3, the profile read at most every 30 seconds (it runs plutil)
function managedOrg() {
  if (managedCache && Date.now() - managedCache.at < 30000) return managedCache.value;
  const value = readManagedOrg();
  managedCache = { at: Date.now(), value };
  return value;
}
function readManagedOrg() {
  let v = null;
  try { v = managedReader(); } catch { v = null; }
  if (!v || typeof v !== 'object') return null;
  const slug = typeof v.OrgSlug === 'string' ? v.OrgSlug.trim() : '';
  if (!ORG_SLUG_RULE.test(slug)) return null;
  return { orgSlug: slug };
}

let companyFinishing = null;   // review 10: the setup whose own finish is running
let companySetup = null;   // { email, setupId, secret, expiresAt }: engine memory only

/* Review 8: before approval, the board's clock is only an upper bound (the server extends a setup when the person
   approves, and the board learns it at its next poll, slow in a background tab), so it gets this grace past the
   poll lag; the server's answer decides inside it. After approval the clock was restarted from the first ready. */
const COMPANY_PRE_APPROVAL_GRACE_MS = 120000;
function companyExpired(c) {
  return !c || Date.now() > c.expiresAt + (c.approved ? 0 : COMPANY_PRE_APPROVAL_GRACE_MS);
}

/** Start a company sign-in setup for this email. Answers what the page shows (the code to compare, the address to
    open, how often to ask), never the secret. */
let companyStartInFlight = null;
/* kosmos#5628 slice 2b-ui review 1: the company's page is opened by the ENGINE, from the address it already checked
   (https, the coordinator's own origin), not by the page: in the Mac app a page's window.open after a slow request
   is blocked as a pop-up, and the page would say "opened" of a page that never opened. */
function companyOpenCommand(url) {
  if (companyOpenCommandForTests) return [companyOpenCommandForTests[0], companyOpenCommandForTests.slice(1)];
  return process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['/usr/bin/open', [url]] : ['xdg-open', [url]];
}
let companyOpenCommandForTests = null;
let companyOpenSourceForTests = null;   // { platform, env }: the platform and environment the opener is judged by
/* Review 2: "opened" only when the opener says so: its exit 0. A missing opener (an 'error') or a refusal (a non-zero
   exit, e.g. no default browser) is a failure the page then words as "use the link". One still running after a few
   seconds has launched the browser. */
function runCompanyOpener(url) {
  /* kosmos#5889: on macOS and Linux the opener gets only what a desktop needs (engine/childenv.js), never the board's
     whole environment (its tokens among it), since the child can be a browser that runs for a long time. On Linux
     with nothing that can show a page (childenv.hasDesktop) it is not started, and the answer is "use the link" at
     once. Windows keeps the environment as it was: rundll32 needs Windows' own variables (SystemRoot and others), and
     no list for it has been checked on a Windows machine; that list is kosmos#5895. Two callers: companyOpen (the
     company sign-in) and vouchTick (connecting this computer's browser), whose existing "could not open the browser"
     branch is what a Linux board with no display now reaches at once. */
  const src = companyOpenSourceForTests || { platform: process.platform, env: process.env };
  if (src.platform === 'linux' && !childenv.hasDesktop(src.env)) return Promise.resolve(false);
  const env = src.platform === 'win32' ? undefined : childenv.openerEnv(src.env);
  return new Promise((resolve) => {
    const [cmd, args] = companyOpenCommand(url);
    let done = false;
    const end = (ok) => { if (!done) { done = true; clearTimeout(t); resolve(ok); } };
    const t = setTimeout(() => end(true), 5000);
    let ch;
    try { ch = spawn(cmd, args, env ? { stdio: 'ignore', env } : { stdio: 'ignore' }); } catch { end(false); return; }
    ch.on('error', () => end(false));
    ch.on('exit', (code) => end(code === 0));
  });
}
let companyOpenedAt = 0;
async function companyOpen() {
  const c = companySetup;
  // Review 2: the setup's own expiry rule (the grace before approval), as status uses.
  if (!c || !c.url || companyExpired(c)) return { ok: false, because: 'that company sign-in has expired; start again' };
  // Review 2: a page cannot open a tab a second at a time; the link is there for another.
  if (Date.now() - companyOpenedAt < 3000) return { ok: false, because: 'your company\'s sign-in was just opened; use the link below' };
  companyOpenedAt = Date.now();
  return (await runCompanyOpener(c.url)) ? { ok: true, because: null }
    : { ok: false, because: 'Kosmos could not open your browser; use the link below' };
}

async function companyStart(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  { const b = busy(); if (b) return b; }
  // Review 1: one start at a time (a double click, two tabs): the second gets the first one's answer, so the engine
  // never holds a different setup from the one the page shows. Review 2: only for the SAME address; another one
  // (a typo corrected) is told to wait rather than handed the first address's setup.
  if (companyStartInFlight) {
    if (companyStartInFlight.email === email) return companyStartInFlight.promise;
    return { ok: false, because: 'a company sign-in is already starting; try again in a moment' };
  }
  const running = { email, promise: companyStartRun(email) };
  companyStartInFlight = running;
  try { return await running.promise; } finally { if (companyStartInFlight === running) companyStartInFlight = null; }
}
async function companyStartRun(email) {
  const epoch = signinEpoch;
  // Review 2: bounded like every other one-round-trip call (the tunnel sets no timeout of its own).
  const r = await setupRun(['setup', 'company-start', '--coordinator', COORDINATOR(), '--email', email], null, retireTimeoutMs());
  if (olderTunnel(r)) return { ok: false, unsupported: true, because: COMPANY_UNSUPPORTED };
  if (!r.ok) return r;
  // Review 1: a Forget or a sign out that landed while this waited: nothing of it is kept.
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  const a = (lastJsonLine(r.said) || {}).value;
  // Review 1: the address the page opens in the browser is an https page; review 2: on the coordinator's own origin.
  if (!a || typeof a.setupId !== 'string' || typeof a.secret !== 'string' || typeof a.url !== 'string'
    || !sameOriginHttps(a.url, COORDINATOR())
    // Review 4: a code to compare is the point of the approval page; none is refused.
    || typeof a.matchCode !== 'string' || !a.matchCode.trim()) {
    return { ok: false, because: 'Kosmos+ answered in a way this version does not understand' };
  }
  // Review 3: the server's lifetime, kept within sense (a minute to an hour).
  const ttl = Math.min(3600, Math.max(60, Number.isFinite(a.expiresIn) ? a.expiresIn : 900));
  // Review 2: the address as parsed (and checked by sameOriginHttps above), never the raw string, goes to the opener.
  companySetup = { email, setupId: a.setupId, secret: a.secret, ttl, expiresAt: Date.now() + ttl * 1000, url: new URL(a.url).href };
  companyOpenedAt = 0;   // review 4: a new setup's page may open at once (the limit is per setup)
  return { ok: true, because: null, matchCode: a.matchCode.trim(), url: a.url,
    interval: Math.min(60, Math.max(1, Number.isFinite(a.interval) ? a.interval : 5)) };
}

/* Review 6 (#4756's rule): a tunnel program older than these verbs (the app installs it separately) says so in words. */
const COMPANY_UNSUPPORTED = 'this version of Kosmos cannot set up through your company yet; update Kosmos';
function olderTunnel(r) {
  return !r.ok && /unrecognized subcommand|invalid subcommand|unexpected argument/i.test(String(r.stderr || '') + '\n' + String(r.because || ''));
}

/** Whether `url` is https on the same origin as `base`. */
function sameOriginHttps(url, base) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.origin === new URL(base).origin;
  } catch { return false; }
}

let companyStatusInFlight = null;
/** Has the person signed in and approved in the browser? { ready, gone }; `retry` means ask again later (never gone).
    Review 2: one ask at a time (a slow coordinator never piles up processes holding the secret), each bounded. */
async function companyStatus() {
  const c = companySetup;
  // Review 3: an ask joins one in flight only for the SAME setup (a restart's poll never gets the old setup's answer).
  if (companyStatusInFlight && companyStatusInFlight.c === c) return companyStatusInFlight.promise;
  const running = { c, promise: companyStatusRun(c) };
  companyStatusInFlight = running;
  try { return await running.promise; } finally { if (companyStatusInFlight === running) companyStatusInFlight = null; }
}
async function companyStatusRun(c) {
  // Review 9: while a finish runs, its grant may already be spent (the server then says gone); the setup is not gone,
  // it is finishing, and no second process needs the secret meanwhile.
  if (c && companyFinishing === c) return { ok: true, ready: true, gone: false };
  if (companyExpired(c)) { if (companySetup === c) companySetup = null; return { ok: true, ready: false, gone: true }; }
  const r = await setupRun(['setup', 'company-status', '--coordinator', COORDINATOR(), '--setup-id', c.setupId], c.secret + '\n', retireTimeoutMs());
  // Review 6: an older tunnel program will never answer, so the page stops (with why) instead of polling forever.
  if (olderTunnel(r)) { if (companySetup === c) companySetup = null; return { ok: true, ready: false, gone: true, because: COMPANY_UNSUPPORTED }; }
  if (!r.ok) return { ok: true, ready: false, gone: false, retry: true };
  const a = (lastJsonLine(r.said) || {}).value || {};
  if (a.gone === true && companySetup === c) companySetup = null;
  // Review 4: approval gives the setup fresh time on the server (its whole life from approval), so the engine's own
  // clock restarts when it first sees ready. Review 6: that is AFTER the approval (a background tab polls slowly), so
  // it can outlive the server's by that lag; a finish the server then refuses as expired clears the setup (below).
  // Review 5: once, at the first ready (a page still polling must not keep pushing it out).
  if (a.ready === true && companySetup === c && !c.approved) { c.approved = true; c.expiresAt = Date.now() + c.ttl * 1000; }
  return { ok: true, ready: a.ready === true, gone: a.gone === true, retry: a.retry === true };
}

/* kosmos#5651: an approved setup asks for its account's second-step text before finishing. Answers
   { ok, sent, second, sentTo } (sent:false for an authenticator account or one with no second step), or a refusal in
   the coordinator's words. An older tunnel or coordinator answers unsupported, and the page keeps its old words. */
let companySecondInFlight = null;   // board review 1: { c, run } so calls at once share one request (one text)
function companySecond() {
  const c = companySetup;
  if (companyExpired(c)) {
    if (companySetup === c) companySetup = null;   // board review 2: as companyComplete does
    return Promise.resolve({ ok: false, because: 'that company sign-in has expired; start again' });
  }
  // Board review 3: never beside a finish (a new code could replace the one being checked), from any tab.
  if (companyFinishing === c) return Promise.resolve({ ok: false, because: 'this computer is finishing its setup; wait a moment' });
  if (companySecondInFlight && companySecondInFlight.c === c) return companySecondInFlight.run;
  const run = companySecondRun(c).finally(() => { if (companySecondInFlight && companySecondInFlight.run === run) companySecondInFlight = null; });
  companySecondInFlight = { c, run };
  return run;
}
async function companySecondRun(c) {
  const r = await setupRun(['setup', 'company-second', '--coordinator', COORDINATOR(), '--setup-id', c.setupId], c.secret + '\n', retireTimeoutMs());
  // Board review 1: unsupported only when the tunnel does not know the verb, or the coordinator has no such route
  // (a bare 404; a setup that is gone answers 401 in words).
  if (olderTunnel(r) || (!r.ok && /\(404\)/.test(String(r.because || '')))) return { ok: false, unsupported: true, because: null };
  if (!r.ok) {
    // Board review 6: whether this setup can still finish is the SERVER's answer (some refusals for a dead setup do not
    // say "start again"): ask once, and a gone setup is said so the page returns to the email step.
    // Review 7: not after a timeout (it says nothing about the setup, and a second wait would outlast the page's); a
    // gone setup gets one plain sentence, never one that reads like the metered "all the texts ... start again".
    if (companySetup === c && !r.timedOut) {
      const st = await companyStatusRun(c);
      if (st.gone) return { ok: false, because: 'that company sign-in has ended; start again on the computer' };
    }
    return { ok: false, because: r.because };
  }
  const got = lastJsonLine(r.said);
  const a = got && got.value;
  // Board review 1: an answer we cannot read is a failure, never "an authenticator account".
  if (!a || typeof a.sent !== 'boolean') return { ok: false, because: 'Kosmos+ answered in a way this version cannot read; try again' };
  if (a.retry === true) return { ok: false, because: 'the sign-in service is busy; wait a few seconds and try again' };
  return { ok: true, sent: a.sent, second: typeof a.second === 'string' ? a.second : null,
    sentTo: typeof a.sentTo === 'string' ? a.sentTo : null };
}

/** Finish the approved setup: this computer gets its identity and its name, as the code setup does. */
async function companyComplete(name, acceptTerms, second) {
  { const b = busy(); if (b) return b; }
  // Board review 4: never beside a text request for this setup (its new code could replace the one being checked).
  if (companySecondInFlight && companySecondInFlight.c === companySetup) return { ok: false, because: 'a code is being texted; wait a moment, then finish' };
  const c = companySetup;
  if (companyExpired(c)) {
    if (companySetup === c) companySetup = null;
    return { ok: false, because: 'that company sign-in has expired; start again' };
  }
  if (typeof name === 'string') name = name.trim().toLowerCase();
  // Review 1: a reinstall already set up at this name is recognised here too (#1010), the setup then not needed.
  if (alreadySetUpAs(name, false)) {
    // Review 10 (replacing reviews 5, 7 and 9): the board cannot tell which account owns the identity on this computer
    // (its saved email is written before anything is proven, and is empty after a reset), so recognising a reinstall
    // changes nothing: no email recorded, nothing switched on, exactly as the code path. A reset reinstall is switched
    // on in Settings; another account's computer is not taken over by its name.
    if (companySetup === c) companySetup = null;
    return alreadySetUpAs(name);
  }
  if (typeof name !== 'string' || !NAME_RULE.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 letters, digits or hyphens' };
  }
  const args = ['setup', 'complete', '--coordinator', COORDINATOR(), '--email', c.email,
    '--sso-setup', c.setupId, '--name', name, '--state-dir', STATE_DIR()];
  if (typeof acceptTerms === 'string' && acceptTerms.trim()) args.push('--accept-terms=' + acceptTerms.trim());
  // Review 4: an existing account with a second step needs its current code to add a computer (#3830); the grant is
  // still unspent when that is refused, so the page asks for it and finishes again.
  if (typeof second === 'string' && second.trim()) args.push('--second=' + second.trim());
  const offAt = offEpoch;   // review 6: an Off pressed while this runs stands (#3827, as the in-app register)
  companyFinishing = c;
  let result;
  try { result = await runSetupComplete(args, c.secret + '\n', name); } finally { if (companyFinishing === c) companyFinishing = null; }
  // Review 6: the server refused it as finished or expired: nothing more can come of this setup, so start again.
  // Review 8: whether this setup can still finish is the SERVER's answer, not a match on its sentences (a refused finish
  // may already have spent the grant; a wait for too many second-step codes leaves it good): ask once, and a gone
  // setup is cleared (companyStatusRun does that).
  if (!result.ok && companySetup === c) await companyStatusRun(c);
  // Review 4: as the in-app sign-in's register (#3827): set up means switched on, or the managed Mac is enrolled and
  // unreachable until someone finds the switch.
  if (result.ok) {
    if (companySetup === c) companySetup = null;   // review 7: never a newer setup
    write({ email: c.email }, { repair: true });
    if (offEpoch === offAt) turnOnAfterSignin();
  }
  return result;
}

/* ---- Devices (#567): the Allow moment. The tunnel binary is the ONLY
   writer of this Mac's allow_list; this module asks it in the shape setup
   already uses, and reads the pending snapshot the running tunnel refreshes
   every five seconds, so every open board can poll without spawning. ---- */
/* kosmos#5422: a sign-in device id is either the older opaque label or one proven by a key (`k1.` and 32 base64url
   characters, the coordinator's fingerprint of the key). Exactly that shape, so a dot never lets a path through. */
const LEGACY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const KEYED_ID = /^k1\.[A-Za-z0-9_-]{32}$/;
const DEVICE_ID = /^(?:[A-Za-z0-9_-]{1,128}|k1\.[A-Za-z0-9_-]{32})$/;
/* #6315: a request can also be another of the person's computers asking to join, and the coordinator names that
   request by a minted id, `computer:<the joining computer's id>` (kosmos-relay MINTED_PREFIX, kosmos#4681). The colon kept every such request out of the list, so no second computer could ever be
   allowed. Requests and their answers take any of the three shapes; this computer's OWN device ids stay DEVICE_ID. */
const REQUEST_ID = /^(?:[A-Za-z0-9_-]{1,128}|k1\.[A-Za-z0-9_-]{32}|computer:[0-9a-f]{32})$/;
const DEVICE_NAME = /^[^\n\r]{1,60}$/;
function pendingFile() { return path.join(STATE_DIR(), 'pending.json'); }
/* #4610 (Josh, 12:50, a brand-new account was shown older requests): a new identity does not inherit the old one's
   pending snapshot. pending.json is the running tunnel's last answer for the OLD identity, and it stays until the new
   tunnel's first poll rewrites it (up to 5s, and longer if that poll fails: a failed poll keeps the last file,
   kosmos-relay devices.rs). Called at every place the identity changes (setupComplete, cancelledAfter,
   signinRegister), after the old tunnel is stopped so it cannot rewrite it. A missing snapshot already reads as
   nothing waiting (pendingDevices). kosmos#5786 (b): it also drops the identity's "on this computer" notes. */
function forgetPendingSnapshot() {
  try { fs.rmSync(pendingFile(), { force: true }); } catch { /* the next poll rewrites it */ }
  resetSelfGrant();   // round 2: every identity change also starts the self-grant over (all four call sites)
  stopVouch();   // kosmos#5786 (b): and ends the open-browser secret now, not on the next tick
  // kosmos#5786 (b): the "on this computer" notes belong to the identity they were made under.
  lastVouched = null;
  const cur = read();
  if (cur.ok !== false && Object.keys(cur.vouched || {}).length) {
    const w = write({ vouched: {} });
    if (!w.ok) process.stderr.write('kosmos+: could not drop the old identity\'s on-this-computer labels: ' + w.because + '\n');
  }
}
/* #4610, Josh's ruling (2026-09-29 13:00): "This computer one, the Kosmos app, should get auto-approved instantaneously
   behind the scenes and never display to the user." This Mac's own in-app sign-in is a device at the coordinator
   (every session is one) and registering the Mac records no grant for it, so it waited for an Allow from the person
   who had just signed in. It is granted here, through the same Allow the person's button uses (deviceAllow), and
   never shown (pendingDevices leaves it out).
   🔑 SCOPED TO THIS COMPUTER BY A VALUE ONLY THIS BOARD HOLDS: remote.json's device_id, which this board minted
   itself for its own sign-in (signinStart) and never takes from a request, not a name or label a device sends, so a
   remote device cannot claim it. Every other device still asks.
   Retried from the supervisor's 15s tick (ensure) while the running tunnel's snapshot still lists it (a failed call,
   a register still in flight when it first ran, or a Mac signed in before this change), at most once a minute and
   never two at once within one identity (after an identity change the old call may still be finishing; its answer is
   ignored by epoch). NOT from pendingDevices: every open board reads that every five seconds and it must never spawn. */
let selfAllowAt = 0;
let selfAllowing = false;
/* Blind review round 1: once the grant for an id succeeds it is not asked again (a tunnel whose poll keeps failing
   keeps the old snapshot listing it, which re-spawned the grant every minute forever), and a grant that fails is
   logged once per id rather than retried in silence. Both reset on a new identity (signinRegister). */
let selfGrantedId = '';
let selfGrantedAt = 0;
let selfFailLoggedId = '';
/* Round 2: every identity change bumps this, and a grant's answer counts only if it still matches, so a grant started
   for one account that lands after a re-sign-in cannot mark the next account's device as granted (device_id survives a
   Forget by design). A reported success is re-checked after SELF_REGRANT_MS if the snapshot still lists the id. */
let selfEpoch = 0;
const SELF_REGRANT_MS = 10 * 60 * 1000;
function resetSelfGrant() {
  selfEpoch += 1;
  selfAllowAt = 0; selfAllowing = false; selfGrantedId = ''; selfGrantedAt = 0; selfFailLoggedId = '';
}
const SELF_ALLOW_RETRY_MS = 60000;
/* Whether the running tunnel's last snapshot still lists this Mac's own sign-in. A read of the file, never a spawn. */
/* kosmos#5422: the id this computer signs in as now. What this process holds is never older than remote.json (it is set
   when a sign-in is taken, before the save that may fail on a full disk or a locked file), so it wins when valid. */
function idInUse() {
  if (heldIdentity && DEVICE_ID.test(heldIdentity.device_id)) return heldIdentity.device_id;
  const d = read().device_id;
  return typeof d === 'string' ? d : '';
}
function selfPendingInSnapshot() {
  const id = idInUse();
  if (!id) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    return !!(raw && Array.isArray(raw.devices) && raw.devices.some((d) => d && String(d.device_id) === id));
  } catch { return false; }
}
/** kosmos#6590 (c2): tell Kosmos+ that this computer's own sign-in `id` is allowed, writing nothing to this computer's
    lists. Ok only when Kosmos+ took it (`acked` true: an `acked` false exits 0 and is retried like any failure); a pause
    arrives as the tunnel's error and is said as paused, not as a refusal. */
async function deviceAckSelf(id) {
  // As deviceAllow (c2 review 1): never while a register or a Forget is rewriting the identity; the grant retries.
  { const b = busy(); if (b) return b; }
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  // `--device-id=<id>`: an id can start with "-", which the separate-argument form would read as a flag.
  const r = await tracked(setupRun(['devices', 'ack', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR(), '--device-id=' + id], null, retireTimeoutMs()));
  if (!r.ok) {
    if (/paused for maintenance/.test(String(r.stderr || '') + '\n' + String(r.because || ''))) return { ok: false, because: PAUSED_ALLOW_WORDS, paused: true };
    return { ok: false, because: r.because };
  }
  const got = parseSaid(r);
  if (!got.ok) return got;
  if (got.data && got.data.acked === true) return { ok: true, because: null, data: got.data };
  // Kosmos+ holds no sign-in with this id (its ack answered 404): said as deviceAllow says it, for the log.
  if (got.data && got.data.account_ack === UNKNOWN_DEVICE) return { ok: false, because: UNKNOWN_WORDS };
  return { ok: false, because: 'Kosmos+ was not told yet' };
}
function allowSelfQuietly() {
  const id = idInUse();
  if (!id || selfAllowing || !enrolled()) return false;
  if (selfGrantedId === id && Date.now() - selfGrantedAt < SELF_REGRANT_MS) return false;
  if (Date.now() - selfAllowAt < SELF_ALLOW_RETRY_MS) return false;
  const epoch = selfEpoch;
  selfAllowing = true;
  selfAllowAt = Date.now();
  Promise.resolve()
    /* kosmos#6590 (S-7d branch c, c2): under the board-v2 marker this computer's own sign-in is only told to Kosmos+
       (`devices ack`), never put on this computer's allow list: no browser holds that id, so allowing it would open the
       gate to whoever could present a sign-in for it. Without the marker, as before. */
    .then(() => (boardV2() ? deviceAckSelf(id) : deviceAllow(id, thisComputerDeviceName())))
    .then((r) => {
      if (epoch !== selfEpoch) return;   // an identity change since this grant started: its answer is not ours
      if (r && r.ok) { selfGrantedId = id; selfGrantedAt = Date.now(); return; }
      if (selfFailLoggedId !== id) {
        selfFailLoggedId = id;
        const why = r && r.paused ? 'Kosmos+ is paused for maintenance' : String((r && r.because) || 'no answer');   // kosmos#6666
        process.stderr.write('kosmos+: could not approve this computer\'s own sign-in yet (' + why + '); retrying about once a minute\n');
      }
    })
    .catch(() => null)
    .finally(() => { if (epoch === selfEpoch) selfAllowing = false; });
  return true;
}
/* kosmos#5786 (b) (Josh, 2026-10-10 14:02: "this should automatically just allow since i am on this computer"): after
   this computer signs in, it may open the default browser at the sign-in page with #allow=<S>, where S is a secret
   minted here, in memory (it also passes through the opener's argv, for the browser's whole life on Linux and Windows
   when the opener starts it, and through the browser's history). That page, signed in as the person, sends the coordinator
   HMAC-SHA256(S, its own device id), never S. The tunnel's snapshot carries that back as the row's `vouch`, and this
   computer allows the ONE row whose vouch it can reproduce.
   What it proves: the device asking holds a session on this account AND holds S, which this computer minted and put
   in the browser it opened, inside the window; a stranger with a stolen match code has no S (#3311). The residual Josh accepted (10-10 19:04):
   the coordinator serves the page that reads S, so a compromised coordinator could vouch for one device of its own
   inside the window (kosmos-relay docs/coordinator-api.md, device-vouch).
   What it does not prove: who is sitting at this computer. Anyone who can open its browser can also press Allow.
   The browser is opened only once the snapshot holds a phone or browser sign-in from the last VOUCH_RECENT_S
   (in `signins` or `devices`, kosmos#6407), so an app-only sign-up never gets a stray sign-in tab. That recency is the
   coordinator's first_seen, so a coordinator can also make the tab open inside the window; the tab carries S only in
   its fragment, and allowing still needs the vouch. A joining computer is never allowed this way: computers pair by
   code (#4794, Baron's tunnel review). */
const VOUCH_WINDOW_MS = 3 * 60 * 1000;   // kosmos#6599: 3 minutes (was 10); the notice with its Undo (VOUCH_NOTICE_MS) still lasts 10
const VOUCH_RECENT_S = 30 * 60;
const VOUCH_POLL_MS = 3000;
const VOUCH_NOTICE_MS = 10 * 60 * 1000;
// The device the last automatic allow let in, kept in memory as well as noted in remote.json, so a Not me still takes
// it back out when the note could not be saved.
let lastVouched = null;   // { id, at }
// Every Not me pressed during the current secret, whatever the tunnel answered: a deny the tunnel refuses (the allow
// already landed there) writes no `denied`, and the allow's answer must still lose to it. Kept past stopVouch on purpose
// (an allow can still be out); cleared when the next secret starts, except for the id an allow is still out for.
const notMeDuringVouch = new Set();
// The device an automatic allow is out for right now. It outlives the secret (a window end, Sign out or switch-off stops
// S, not an allow already out), so a Not me pressed then is still remembered.
let vouchAllowingId = '';
let vouchState = null;   // { secret, until, epoch, opened, matched, allowing, tries, matchedOk }
let vouchTimer = null;
let vouchOpenedUrl = '';   // the last address opened, for tests (the opener's own argv drops it under a test command)
function stopVouch() {
  vouchState = null;
  vouchOpenedUrl = '';   // it carries S
  if (vouchTimer) { clearInterval(vouchTimer); vouchTimer = null; }
}
/* The sign-in page's address: the coordinator's own origin (it serves the page at /). https only, or plain http on
   this computer's loopback for a local coordinator. */
function vouchUrl(secret) {
  /* kosmos#6590 (S-7d branch c, c3): under the board-v2 marker the browser is opened on this computer's OWN address,
     so S reaches only the page this computer's tunnel serves (gate.html, which keeps S to itself and posts the vouch
     with its key's proof), never the coordinator's page. Without an address there is nowhere to open. */
  if (boardV2()) {
    const a = address();
    if (!a || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(a)) return null;
    return 'https://' + a.toLowerCase() + '/#allow=' + secret;
  }
  let u;
  try { u = new URL(COORDINATOR()); } catch { return null; }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) return null;
  return u.origin + '/#allow=' + secret;
}
function startVouch() {
  stopVouch();
  // A new secret forgets the old one's Not me presses, except for an allow still out: its answer must still lose.
  const outAndRefused = vouchAllowingId && notMeDuringVouch.has(vouchAllowingId) ? vouchAllowingId : '';
  notMeDuringVouch.clear();
  if (outAndRefused) notMeDuringVouch.add(outAndRefused);
  notMeTakenBack.clear();   // kosmos#6590 (c3)
  // A computer still waiting for another computer's Allow (held, #4737) cannot allow anyone: no secret.
  if (inState(HELD_FILE)) return;
  vouchState = { secret: crypto.randomBytes(32).toString('base64url'), until: Date.now() + VOUCH_WINDOW_MS, epoch: selfEpoch, ident: macIdHere(), opened: false, matched: '', allowing: false, tries: 0, matchedOk: false };
  vouchTimer = setInterval(vouchTick, VOUCH_POLL_MS);
  if (vouchTimer.unref) vouchTimer.unref();
}
/* From one read of the snapshot, two lists through the same filter: valid ids, not this computer's own sign-ins, not a
   device the person said Not me to, and never a computer (a joining one carries joining_computer, or a code wait).
   `devices`: the rows a vouch may allow. `signins` (kosmos#6407): the phone and browser rows of the tunnel's pending
   list before its knock filter (id and first_seen), read only to decide whether to open the tab, never matched for an
   allow. `devices` holds only what knocked at this computer's gate, and the sign-in that arms the tab usually happened
   on the website, so it is in `signins` only. A tunnel that predates the field writes none: an empty list. null while
   there is no snapshot. */
function vouchRows() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch { return null; }
  if (!raw || !Array.isArray(raw.devices)) return null;
  const settings = read();
  const selves = ownDeviceIds(settings);
  // A device the person said Not me to is never allowed this way; they can still Allow it by hand.
  const denied = settings.denied || {};
  /* #6315: DEVICE_ID, not REQUEST_ID, on purpose: a minted computer: id never qualifies, so a computer is never
     allowed by a vouch even on a row that carries no joining_computer. */
  const keep = (d) => d && DEVICE_ID.test(String(d.device_id || '')) && !selves.includes(String(d.device_id))
    && !Object.prototype.hasOwnProperty.call(denied, String(d.device_id))
    && !notMeDuringVouch.has(String(d.device_id))   // a Not me the tunnel refused writes no `denied`
    && (d.joining_computer === undefined || d.joining_computer === null) && !d.code_wait;
  return { devices: raw.devices.filter(keep), signins: (Array.isArray(raw.signins) ? raw.signins : []).filter(keep) };
}
function vouchMatches(secret, d) {
  if (typeof d.vouch !== 'string') return false;
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(String(d.device_id), 'utf8').digest('base64url'));
  const got = Buffer.from(d.vouch);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
/* Allows in-engine, like #4610's own-sign-in grant, so it does not pass server.js's screen-only Allow gate (isViaScreen):
   what stands in for the person's press is S (minted here after their own sign-in, one device, three minutes since
   #6599) and the row filters above. */
function vouchTick() {
  const v = vouchState;
  if (!v) return;
  // Sign-out, the switch, enrolment and a hold end the secret first, with nothing said.
  if (v.epoch !== selfEpoch || !enrolled() || !read().on || inState(HELD_FILE)) { stopVouch(); return; }
  if (Date.now() > v.until) {
    // kosmos#6599: the window ran out after this computer started opening the browser and before any phone or browser
    // sign-in matched, so the person (if they are still signing in) gets the ordinary Allow card. One line per such
    // window end (stopVouch ends the secret); a window that ends while a matched allow is still being retried says
    // nothing. It is not a measure of how often 3 minutes is too short: a browser nobody signed in on writes it too,
    // and a sign-in that arrives after the window never opens the browser, so writes nothing.
    if (v.opened && !v.matched) process.stderr.write('kosmos+: the automatic allow window ended before a sign-in matched; the Allow card is the way in\n');
    stopVouch(); return;
  }
  const lists = vouchRows();
  if (!lists) return;
  const rows = lists.devices;
  if (!v.opened) {
    const now = Math.floor(Date.now() / 1000);
    const recent = (d) => now - (Number(d.first_seen) || 0) <= VOUCH_RECENT_S;
    if (!rows.some(recent) && !lists.signins.some(recent)) return;
    v.opened = true;   // armed before the opener runs, so it is never re-run; one still running after 5 s is not an
    // error (runCompanyOpener), it just logs nothing. The window still bounds S.
    // The window is NOT restarted here: Josh accepted a secret that lives about 10 minutes from the app sign-in (10-10 19:04); it is 3 since #6599.
    /* kosmos#6590 (c3): except under the board-v2 marker, where the tab opens on this computer's own address with no
       session, so the person signs in again there: the window starts once, when the tab opens (design review 1). S is
       still one per link, and `opened` is set once, so it can restart only this once. */
    if (boardV2()) v.until = Date.now() + VOUCH_WINDOW_MS;
    const url = vouchUrl(v.secret);
    if (!url) {
      process.stderr.write('kosmos+: the sign-in page is not https here, so the browser is not opened to connect it; the Allow card stays\n');
      stopVouch();
      return;
    }
    vouchOpenedUrl = url;
    runCompanyOpener(url).then((ok) => {
      if (ok || vouchState !== v) return;
      process.stderr.write('kosmos+: could not open the browser to connect it to this computer; the Allow card stays\n');
      stopVouch();
    });
    return;
  }
  // A register or a Forget in flight (busy) is waited out, not counted as a refused try.
  if (v.allowing || busy()) return;
  if (boardV2()) { vouchStepV2(v); return; }   // kosmos#6590 (c3): the tunnel matches the vouch, never this board
  // One device per secret: the first row that matched, retried until it is allowed or the window ends.
  const hit = rows.find((d) => (!v.matched || String(d.device_id) === v.matched) && vouchMatches(v.secret, d));
  if (!hit) return;
  const id = String(hit.device_id);
  const name = typeof hit.name === 'string' && DEVICE_NAME.test(hit.name.trim()) ? hit.name.trim() : '';
  v.matched = id;
  v.allowing = true;
  vouchAllowingId = id;
  let threw = false;
  Promise.resolve()
    .then(() => deviceAllow(id, name || undefined))
    .then((r) => {
      if (r && !r.ok && r.listed) {
        /* kosmos#6286: Kosmos+ did not take this allow (its ack got a 404), yet the tunnel's entry stands. The row
           matched here as waiting a moment ago, so it was refused since (Not me, or a deny elsewhere): an automatic
           allow takes its entry back and stops, whether or not the Not me was pressed on this computer. */
        if (vouchState === v) stopVouch();
        return deviceRemove(id).then((rr) => {
          if (!rr || !rr.ok) process.stderr.write('kosmos+: a device Kosmos+ did not take could not be removed again (' + String((rr && rr.because) || 'no answer') + '); remove it under Devices\n');
        });
      }
      if (!r || !r.ok) {
        // Only the tunnel's refusals count: a busy register or Forget is waited out. (A setup-not-finished refusal is
        // not counted either, but the next tick's !enrolled() ends S: it fails closed rather than waiting.)
        const why = String((r && r.because) || '');
        // kosmos#6666: nor is a refusal because Kosmos+ is paused. Only a race reaches this (while paused the tunnel lists
        // no row a vouch could match; code-check rows carry none): a row listed just before the pause began. It waits within the secret's own
        // window, so a pause that ends inside it still lets this browser in without the Allow card.
        if (!busy() && !(r && r.paused) && !/being forgotten|still signing in|finish the Plus sign-up/.test(why)) v.tries += 1;
        // Three tries, then the ordinary Allow card is the way in (no spawn every 3 s for the whole window).
        if (vouchState === v && v.tries >= 3) {
          process.stderr.write('kosmos+: could not allow the browser this computer opened (' + String((r && r.because) || 'no answer') + '); the Allow card stays\n');
          stopVouch();
        }
        return;
      }
      // Allowed: noted even if a Sign out or a switch-off landed while it ran (they stop the secret, not an allow already
      // out), so the notice and Undo still show.
      v.matchedOk = true;
      if (vouchState === v) stopVouch();
      // Not during a Forget (it clears the notes), and not under another identity (the note would describe a device of
      // the account before it).
      // (The identity is the mac_id file: a Forget mints a new one, and `forgetting` covers the Forget itself.)
      // An allow that lands after a sign-in under ANOTHER identity is not ours to note. A re-register of the same identity
      // also moves the epoch, but the device is in all the same, so it is still noted (and Not me can still take it out).
      if (forgetting || (v.epoch !== selfEpoch && !(v.ident && macIdHere() === v.ident))) return;
      // The person pressed Not me while this allow ran: their answer wins. Take the device back out, note nothing.
      if (notMeDuringVouch.has(id) || Object.prototype.hasOwnProperty.call(read().denied || {}, id)) {
        return deviceRemove(id).then((rr) => {
          if (!rr || !rr.ok) process.stderr.write('kosmos+: a device refused while it was being allowed automatically could not be removed again (' + String((rr && rr.because) || 'no answer') + '); remove it under Devices\n');
        });
      }
      // Set even after a Sign out cleared it: the device is in, so its Not me must still be able to take it out.
      lastVouched = { id, at: Math.floor(Date.now() / 1000) };
      const kept = Object.entries({ ...(read().vouched || {}), [id]: { at: Math.floor(Date.now() / 1000), name } })
        .sort((a, b) => (Number(b[1] && b[1].at) || 0) - (Number(a[1] && a[1].at) || 0)).slice(0, 20);
      const saved = write({ vouched: Object.fromEntries(kept) });
      if (!saved.ok) process.stderr.write('kosmos+: allowed the browser this computer opened, but could not note it: ' + saved.because + '\n');
    })
    .catch(() => { threw = true; })
    .finally(() => {
      v.allowing = false;
      if (vouchAllowingId === id) vouchAllowingId = '';
      // An allow that threw rather than answering counts as a refused try too.
      if (threw) v.tries += 1;
      if (vouchState === v && v.tries >= 3 && !v.matchedOk) stopVouch();
    });
}
/* kosmos#6590 (c3): the automatic Allow under the board-v2 marker. The browser this computer opened posts its vouch,
   HMAC(S, its key), on its own waiting row; `devices allow-vouched` (S on stdin, never argv) lets in the one key whose
   vouch S reproduces. This board never sees or compares a vouch. One run per NEW waiting row that carries a vouch:
   - Allowed: noted as on this computer (the notice and Undo), and S ends.
   - No row matched (another account holder's junk vouch, or a row gone): S stays; that row is not tried again.
   - Two keys reproduced S: S has leaked to a second browser, so it ends at once (design review 3), and the browsers
     waiting to connect are the way in.
   - Anything else (the certificate alarm, a pause, a lock held, a read error): tried again a little later inside the
     window, never counted, and that row is not marked tried.
   A Not me racing it is settled by the tunnel's one lock: pressed first, the row is gone and this finds nothing; second,
   drop-waiting answers that the browser was already let in, and the page says to remove it under Devices. */
const VOUCH_V2_RETRY_MS = 6000;
// Devices a Not me took back out because an Allow had just won the race (deviceDropWaiting), so a vouch answer arriving
// after it never notes them as connected. Cleared when the next secret starts.
const notMeTakenBack = new Set();
async function deviceAllowVouched(secret) {
  // As every device verb (c3 review 1): never while a register or a Forget is rewriting the folder.
  { const b = busy(); if (b) return { kind: 'retry' }; }
  if (!enrolled()) return { kind: 'retry' };
  const r = await tracked(setupRun(['devices', 'allow-vouched', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], secret, retireTimeoutMs()));
  flushWaiting();
  if (!r.ok) return { kind: 'retry' };
  const got = parseSaid(r);
  if (!got.ok) return { kind: 'retry' };
  const d = got.data || {};
  if (d.paused === true) return { kind: 'retry' };
  // Any allow ends S; only a device id of the right shape is noted (review 1).
  if (d.allowed === true) {
    return { kind: 'allowed', device_id: typeof d.device_id === 'string' && DEVICE_ID.test(d.device_id) ? d.device_id : '', unknown: d.account_ack === UNKNOWN_DEVICE };
  }
  if (d.reason === 'ambiguous') return { kind: 'ambiguous' };
  if (d.reason === 'no_row') return { kind: 'no_row' };
  return { kind: 'retry' };   // ct_alarm, too_many, or a connector that names no reason
}
function vouchStepV2(v) {
  if (Date.now() < (v.retryAt || 0)) return;
  if (!v.tried) v.tried = new Set();
  v.allowing = true;
  const later = () => { v.retryAt = Date.now() + VOUCH_V2_RETRY_MS; };
  Promise.resolve()
    .then(() => devicesWaiting())
    .then(async (w) => {
      if (!w || !w.ok || !w.data) { later(); return; }
      const row = (w.data.waiting || []).find((x) => x.vouched && !v.tried.has(x.knockId));
      if (!row) return;
      /* The read above awaited: everything vouchTick checked before it is checked again, so a secret retired meanwhile
         (sign-out, Forget, switch-off, a hold, the window's end) is never used (review 1, P1). */
      if (vouchState !== v || v.epoch !== selfEpoch || !enrolled() || !read().on || inState(HELD_FILE) || busy() || Date.now() > v.until) return;
      const r = await deviceAllowVouched(v.secret);
      if (r.kind === 'retry') { later(); return; }
      v.tried.add(row.knockId);
      if (r.kind === 'no_row') return;
      if (r.kind === 'ambiguous') {
        process.stderr.write('kosmos+: a second browser has the link this computer opened, so neither was let in automatically; the browsers waiting to connect are the way in\n');
        if (vouchState === v) stopVouch();
        return;
      }
      v.matchedOk = true;
      if (vouchState === v) stopVouch();
      const id = r.device_id;
      if (!id) return;
      // The person pressed Not me on this browser while the allow ran: their answer wins (review 1; the drop did the Remove).
      if (notMeTakenBack.has(id)) return;
      if (r.unknown) {
        // As the coordinator-origin path (kosmos#6286): Kosmos+ holds no sign-in with that id, so take it back out.
        const rr = await deviceRemove(id);
        if (!rr || !rr.ok) process.stderr.write('kosmos+: a device Kosmos+ did not take could not be removed again (' + String((rr && rr.because) || 'no answer') + '); remove it under Devices\n');
        return;
      }
      if (forgetting || (v.epoch !== selfEpoch && !(v.ident && macIdHere() === v.ident))) return;
      lastVouched = { id, at: Math.floor(Date.now() / 1000) };
      const kept = Object.entries({ ...(read().vouched || {}), [id]: { at: Math.floor(Date.now() / 1000), name: '' } })
        .sort((a, b) => (Number(b[1] && b[1].at) || 0) - (Number(a[1] && a[1].at) || 0)).slice(0, 20);
      const saved = write({ vouched: Object.fromEntries(kept) });
      if (!saved.ok) process.stderr.write('kosmos+: allowed the browser this computer opened, but could not note it: ' + saved.because + '\n');
    })
    .catch(() => { later(); })
    .finally(() => { v.allowing = false; });
}
/* The newest device allowed this way in the last VOUCH_NOTICE_MS, for the "connected" notice with its Undo. */
function recentlyVouched(settings = read()) {
  const now = Math.floor(Date.now() / 1000);
  let best = null;
  for (const [id, e] of Object.entries(settings.vouched || {})) {
    const at = Number(e && e.at) || 0;
    if (!DEVICE_ID.test(id) || now - at > VOUCH_NOTICE_MS / 1000) continue;
    if (!best || at > best.at) best = { device_id: id, name: e && typeof e.name === 'string' && e.name ? e.name : null, at };
  }
  return best;
}
/* kosmos#4794: the reasons kosmos-tunnel's devices.rs gives for a joining computer's empty code (pairing.rs wait_reason,
   plus was_a_computer). Anything else is dropped rather than shown. */
const CODE_WAITS = new Set(['attempts_used', 'asked_another_computer', 'another_computer', 'daily_limit', 'wait_a_few_minutes', 'was_a_computer', 'code_ran_out']);   // #6383: code_ran_out
/* kosmos#4794: a computer's pairing code is two groups of three digits with one space, "482 915" (kosmos-relay
   crates/proto/src/pairsas.rs sas(): format!("{:03} {:03}")); the tunnel compares it exactly. A phone's match code never is. */
const JOIN_CODE = /^\d{3} \d{3}$/;
/* kosmos#6666: how old pending.json may be and still say Kosmos+ is paused (the tunnel's snapshot_says_paused uses the
   same 120 s; it rewrites the file every PENDING_POLL_SECS, 5 s, in crates/tunnel/src/lib.rs). */
const PAUSED_FRESH_MS = 120 * 1000;
/** What is waiting for this Mac's Allow. A missing snapshot is an empty
    list, not an error: the tunnel writes it only once it is up, and a
    board with Plus off has nothing waiting. `snapshot` says which. */
function pendingDevices() {
  const settings = read();
  // kosmos#5786 (b): a device allowed while Kosmos+ was being switched off still shows its notice and Undo.
  if (!settings.on || !enrolled()) return { devices: [], snapshot: false, email: settings.email || '', connected_here: recentlyVouched(settings), paused: false };
  let raw;
  // kosmos#6666: the file's age, taken BEFORE it is read, so a rewrite in between can only make it look older.
  let snapAge = Infinity;
  try { snapAge = Date.now() - fs.statSync(pendingFile()).mtimeMs; } catch { snapAge = Infinity; }
  try { raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch { raw = null; }
  const list = raw && Array.isArray(raw.devices) ? raw.devices : [];
  /* #4610 (Josh, 12:50: "This computer (Kosmos app)" asked him to approve it): this Mac's OWN in-app sign-in is a
     device row at the coordinator (every session is one), and registering the Mac records no grant for it, so it
     stays pending for good. It is never a request: the app's window loads the board on this computer, not through
     Kosmos+. Its id is remote.json's device_id (the page used it only to relabel the row). Not listed, not counted. */
  const selves = ownDeviceIds(settings);
  const v2 = boardV2();
  const devices = list
    .filter((d) => d && REQUEST_ID.test(String(d.device_id || '')))
    .filter((d) => !selves.includes(String(d.device_id)))
    .map((d) => ({
      device_id: String(d.device_id),
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : null,
      first_seen: Number(d.first_seen) || 0,
      code: typeof d.code === 'string' ? d.code : '',
      /* kosmos#4773/#4637: the waiting computer's name when the request is another of the person's own computers
         joining (the coordinator's `joining_computer`), else null for a phone or a browser. A computer name only. */
      // Lowercased first, as the coordinator names computers (signinRegister does the same), so "Josh-PC" keeps its wording.
      // 🛑 It changes the page's heading and the Allow button's spoken name (#6404, #6522), so the coordinator must set it from its OWN
      // record of the person's signed-in computer (#4773), never from anything the requesting device says about itself.
      joining_computer: typeof d.joining_computer === 'string' && NAME_RULE.test(d.joining_computer.trim().toLowerCase()) ? d.joining_computer.trim().toLowerCase() : null,
      /* When this Mac last said no to this id, or 0: the re-ask sentence. */
      denied_at: Number(settings.denied[String(d.device_id)]) || 0,
      /* kosmos#4794: why a joining computer's code is still "" (the tunnel's wait_reason, or was_a_computer), from a
         fixed list so the page words each one; null while the code is shown or being worked out. */
      code_wait: CODE_WAITS.has(d.code_wait) ? d.code_wait : null,
      /* kosmos#6404: an allowed computer asking to finish its code check here (the tunnel's recheck row): Allow only
         confirms the typed code, Not me only drops the check. */
      recheck: d.recheck === true,
    }))
    /* #6315: a minted computer: id is a computer whatever else the row says. Without a usable joining_computer name
       (the coordinator stops naming it once its lineage is no longer waiting, or the name fails NAME_RULE) it would be
       drawn as a phone whose Allow can never work, so it is shown the way a former computer is: Allow off, Not me. */
    .map((d) => (d.device_id.startsWith('computer:') && !d.joining_computer ? { ...d, code: '', code_wait: d.code_wait || 'was_a_computer' } : d))
    /* kosmos#6590 (S-7d branch c): under the board-v2 marker a phone or a browser is let in only by the typed code its own
       page shows (devicesWaiting), so the coordinator's rows for them are not offered: an Allow by their id admits
       nobody there, and a Not me by id would tell Kosmos+ to end that sign-in everywhere. Computers keep their rows. */
    .filter((d) => !v2 || isComputerRow(d));
  // kosmos#5786 (b): the device just allowed automatically is not also shown as waiting while the tunnel's snapshot
  // still lists it (until its next poll).
  const here = recentlyVouched(settings);
  // A request that is NEWER than the note (the browser removed elsewhere, asking again) still shows. A minute of slack:
  // first_seen is the coordinator's clock, the note's is this computer's.
  /* kosmos#6666: while Kosmos+ is paused for maintenance the tunnel withholds new requests and says so (kosmos-relay
     #509, kosmos#6656; code checks in progress here still show), so the page can say why no new request shows. Exactly true, or not paused.
     Only from a snapshot under PAUSED_FRESH_MS old: a stopped tunnel or a slept Mac leaves its last file behind. */
  const paused = !!raw && raw.paused === true && snapAge > -1000 && snapAge < PAUSED_FRESH_MS;   // a future mtime (the clock stepped back) is not fresh; a file written this instant can read a fraction of a ms ahead of Date.now()
  return { devices: here ? devices.filter((d) => d.device_id !== here.device_id || d.first_seen > here.at + 60) : devices, snapshot: raw !== null, email: settings.email || '', connected_here: here, paused };
}
/* The tunnel's answer is its last line of stdout that starts with "{", one line
   of JSON. Other lines
   can come before it: a fresh register prints its certificate line first
   ("certificate for ... written to ...", kosmos-relay setup.rs fetch_certificate),
   and most verbs log to stdout (tracing's default writer). Parsing all of stdout
   made every first sign-in read as a failure while the Mac was registered, and
   Kosmos+ was never switched on (#3827). Only the last line starting with "{" is
   read: if it does not parse, the answer is unreadable, never an older object.
   ⚠️ This relies on the tunnel never logging a JSON-shaped line to stdout: its
   tracing uses the default human-readable format (kosmos-relay main.rs,
   tracing_subscriber::fmt()). A JSON log formatter there would be read here as
   the answer. Used by parseSaid, macRequest and assistantChat. */
function lastJsonLine(said) {
  const lines = String(said || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try { return { value: JSON.parse(lines[i]) }; } catch { return null; }
  }
  return null;
}
/** The binary answers JSON for every devices and signin verb; a non-JSON answer
    is reported as such rather than guessed at. */
function parseSaid(result) {
  if (!result.ok) return result;
  const got = lastJsonLine(result.said);
  if (got) return { ok: true, because: null, data: got.value };
  return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
}
function deviceArgs(verb, id, withCoordinator) {
  const args = ['devices', verb];
  if (withCoordinator) args.push('--coordinator', COORDINATOR());
  args.push('--state-dir', STATE_DIR());
  if (id !== null) args.push('--device-id', id);
  return args;
}
function checkId(id) {
  return typeof id === 'string' && REQUEST_ID.test(id) ? null : { ok: false, because: 'that is not a device we know' };
}
/** The devices this Mac lets in, joined with the sidecar (name, when let
    in, last used). Not enrolled means none, without asking the binary. */
async function devicesList() {
  if (!enrolled()) return { ok: true, because: null, data: { devices: [] } };
  const r = parseSaid(await setupRun(deviceArgs('list', null, false)));
  if (!r.ok) return r;
  const list = r.data && Array.isArray(r.data.devices) ? r.data.devices : [];
  const vouched = read().vouched || {};
  /* #6315: REQUEST_ID here too, so Remove accepts every id shape a request can have. */
  return { ok: true, because: null, data: { devices: list
    .filter((d) => d && REQUEST_ID.test(String(d.device_id || '')))
    .map((d) => ({
      device_id: String(d.device_id),
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : null,
      allowed_at: Number(d.allowed_at) || 0,
      last_seen: Number(d.last_seen) || 0,
      code: typeof d.code === 'string' ? d.code : '',
      /* #4794 (part C): the name of the computer that allowed this device, when it was another of the person's
         computers (its signed allow reached this one). null when this computer allowed it, and for a tunnel
         without part C, which sends nothing. */
      allowed_on: typeof d.allowed_on === 'string' && d.allowed_on.trim() ? d.allowed_on.trim().slice(0, 60) : null,
      /* kosmos#5786 (b): allowed because the browser this computer opened proved itself, so the page can say
         "on this computer". A lasting fact, not a notice: it stays until the device is removed here, and only for
         the allow it was noted for (removed elsewhere and allowed again by hand, its allowed_at moves on). Ten
         minutes of slack: allowed_at is the coordinator's clock, the note's this computer's. */
      on_this_computer: vouchedFor(vouched, d),
      /* kosmos#7285 (PigeonPete's sessdevice-7285): EVERY device key holding this id ([] when none; the tunnel leaves
         `keys` out then). One id can be held by several keys, and removing the id deletes every key that holds it
         (devices.rs). A key records at most 16 ids, so a browser's own id can drop off its key's list while its session
         lives on by the key; the cloud machine's own-device guard compares these with x-kosmos-session-key. */
      keys: Array.isArray(d.keys) ? d.keys.filter((k) => typeof k === 'string' && k) : [],
    })) } };
}
function vouchedFor(vouched, d) {
  if (!Object.prototype.hasOwnProperty.call(vouched, String(d.device_id))) return false;
  const at = Number(vouched[String(d.device_id)] && vouched[String(d.device_id)].at) || 0;
  const allowed = Number(d.allowed_at) || 0;
  return !allowed || Math.abs(allowed - at) <= 600;   // a tunnel that sends no allowed_at cannot be checked
}
/** kosmos#6286: the tunnel's `account_ack` when the coordinator holds no sign-in with the id an Allow named. */
const UNKNOWN_DEVICE = 'unknown_device';
/** kosmos#6666: what the person reads when an Allow is refused because Kosmos+ is paused for maintenance. */
const PAUSED_ALLOW_WORDS = 'Kosmos+ is paused for maintenance, so no new device can be allowed right now. This request may need to ask again once Kosmos+ is back.';
/** kosmos#6286: what the person reads when Kosmos+ holds no sign-in with the id they allowed. */
const UNKNOWN_WORDS = 'Kosmos+ holds no sign-in waiting with that id (it was refused, or never asked). It is on this computer\'s list of devices you let in: remove it there if you did not mean to allow it.';
/** Let a device in: the binary writes this Mac's list FIRST, then tells the
    coordinator; a failed ack heals on the tunnel's next poll and the allow
    stands. The coordinator's 404 (kosmos#6286) does not heal: it holds no
    such sign-in, so this is a refusal that says the entry is on the list.
    `name` is the kind the phone gave, recorded for the list. */
async function deviceAllow(id, name, code) {
  { const b = busy(); if (b) return b; }
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  /* #6315: a minted computer: id is always a computer, and a computer is allowed only with the code both screens
     show; without one the tunnel could take it as a phone (when it has no record of it as a computer) and put the id on
     this computer's gate. */
  if (id.startsWith('computer:') && !(typeof code === 'string' && JOIN_CODE.test(code))) {
    return { ok: false, because: 'code_pending' };   // the page words it: the code is still being worked out
  }
  const args = deviceArgs('allow', id, true);
  if (typeof name === 'string' && DEVICE_NAME.test(name.trim())) args.push('--name', name.trim());
  /* kosmos#4794: Allow for another of the person's computers carries the code the person typed here (#6404); the tunnel
     refuses it unless it is the code this computer worked out with that one (and ignores it for a phone). */
  if (typeof code === 'string' && JOIN_CODE.test(code)) args.push('--code', code);
  const r = await tracked(setupRun(args, null, retireTimeoutMs()));
  /* kosmos#4794: the tunnel's pairing refusals start with a fixed tag (pairing.rs allow_joining). The page words two
     of them; any other failure keeps the tunnel's own reason, as before. */
  if (!r.ok) {
    const said = String(r.stderr || '') + '\n' + String(r.because || '');
    if (/\bsas_mismatch: more than one computer/.test(said)) return { ok: false, because: 'code_many' };
    if (/\bsas_mismatch:/.test(said)) return { ok: false, because: 'code_changed' };
    if (/\bsas_pending:/.test(said)) return { ok: false, because: 'code_pending' };
  }
  const got = parseSaid(r);
  /* kosmos#6666: refused because Kosmos+ is paused for maintenance (the tunnel answers paused true with exit 0, and
     writes nothing to this computer's list: kosmos#6656). Said in its own words, never as allowed. */
  if (got.ok && got.data && got.data.paused === true) return { ok: false, because: PAUSED_ALLOW_WORDS, paused: true };
  /* kosmos#6286: the coordinator holds no sign-in with that id (its ack answered 404: refused, or never asked), so
     Kosmos+ did not take this Allow. The tunnel keeps the entry on this computer's list (its own), so the person is
     told both, as a refusal, never as allowed. Not "nobody was let in": a device the account refused that still holds
     a live sign-in could pass this computer's gate while it is on the list. A joining computer's 404 does not
     answer this (its pairing trust stands). */
  if (got.ok && got.data && got.data.account_ack === UNKNOWN_DEVICE) {
    // `listed`: the entry stands on this computer's list, so a caller that must take it back (the vouch path) can.
    return { ok: false, because: UNKNOWN_WORDS, listed: true };
  }
  return got;
}
/** Say no: the coordinator drops the request and the phone is told. On a real
    refusal (not a mere code-check drop) this records a small local note in
    remote.json (the `denied` map, newest 50): it words a later re-ask and keeps
    the device out of the automatic browser-vouch allow (it can still be Allowed
    by hand). It is not a block, so a fresh sign-in may ask again. */
async function deviceDeny(id) {
  { const b = busy(); if (b) return b; }
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  if (vouchState || vouchAllowingId === id) notMeDuringVouch.add(id);   // kosmos#5786 (b)
  const r = parseSaid(await tracked(setupRun(deviceArgs('deny', id, true), null, retireTimeoutMs())));
  /* kosmos#6404: the tunnel says when it only dropped a code check from a computer already allowed ("check"): nothing was
     refused, so nothing is noted (a later request from that computer must not read "You said no to this computer"). */
  if (r.ok && !(r.data && r.data.check === true)) {
    const denied = { ...read().denied, [id]: Math.floor(Date.now() / 1000) };
    /* Bounded: the newest 50, so a file cannot grow without limit. */
    const keep = Object.entries(denied).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const saved = write({ denied: Object.fromEntries(keep) });
    /* #4308: the coordinator has the answer either way; only this computer's own note of it (used to word a re-ask) is
       lost when the settings file is damaged. Say so rather than drop it silently. */
    if (!saved.ok) process.stderr.write('remote: the device was refused, but this computer could not note it: ' + saved.because + '\n');
  }
  {
    // kosmos#5786 (b): Not me on a device this computer allowed automatically a moment ago (the two raced) takes it
    // back out, whatever the deny answered (an allowed row may refuse a deny). That is a second tunnel call, so this
    // Not me can take up to two retire timeouts. Only inside the notice window: an old note is history, not a race.
    const notes = read().vouched || {};
    const noted = Object.prototype.hasOwnProperty.call(notes, id) ? Number(notes[id] && notes[id].at) || 0
      : lastVouched && lastVouched.id === id ? lastVouched.at : 0;
    if (noted && Math.floor(Date.now() / 1000) - noted <= VOUCH_NOTICE_MS / 1000) {
      const rr = await deviceRemove(id);
      if (!rr || !rr.ok) process.stderr.write('kosmos+: a device allowed automatically was refused, and could not be removed (' + String((rr && rr.because) || 'no answer') + '); remove it under Devices\n');
    }
  }
  return r;
}
/** Take it back: off this Mac's list at once, and the tunnel drops any live
    session for it on the next request. #4824: with the coordinator, the connector also ends the
    device's current sign-ins at the sign-in site and on the account's other computers (kosmos#4803),
    and answers `signed_out` and `local_cutoff` for the page to say what did not happen.
    A connector from before kosmos#4803 refuses the flag before doing anything (clap: "unexpected
    argument '--coordinator'", exit 2, measured on that build), so it is asked again without it: the
    removal here works as it always did, and the answer has neither `signed_out` nor `local_cutoff`, which the
    page (removedWords) says as how an older connector works. */
async function deviceRemove(id) {
  { const b = busy(); if (b) return b; }
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const r = await tracked(setupRun(deviceArgs('remove', id, true), null, retireTimeoutMs()));
  // ANSI colour codes out first: a CLICOLOR_FORCE environment makes clap colour the argument.
  const said = (String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, '');
  if (!r.ok && r.code === 2 && /unexpected argument '--coordinator'/.test(said)) {
    // A Forget may have started between the two spawns; the same refusal as the first call then.
    { const b = busy(); if (b) return b; }
    return forgetVouched(id, removeAnswer(await tracked(setupRun(deviceArgs('remove', id, false), null, retireTimeoutMs()))));
  }
  return forgetVouched(id, removeAnswer(r));
}
/* kosmos#5786 (b): a removed device (the notice's Undo, or the list's Remove) is no longer "on this computer". */
function forgetVouched(id, answer) {
  forgetTlsPins();   // kosmos#6589: a removed device may be one a cached pin rests on
  const vouched = read().vouched || {};
  // A remove that timed out may not have happened: the note stays, so the device keeps saying where it came from.
  if (answer && answer.ok && Object.prototype.hasOwnProperty.call(vouched, id) && !(answer.data && answer.data.timed_out)) {
    const { [id]: _gone, ...rest } = vouched;
    const saved = write({ vouched: rest });
    if (!saved.ok) process.stderr.write('remote: removed, but this computer could not drop its "on this computer" note: ' + saved.because + '\n');
  }
  return answer;
}
/* #4824: a connector killed on the timeout answers `timed_out`, and the page points at the list. */
function removeAnswer(r) {
  if (!r.ok && r.timedOut) return { ok: true, because: null, data: { timed_out: true } };
  return parseSaid(r);
}

/* ---- kosmos#4794 slice 1: this computer is JOINING, waiting for one of the person's computers to allow it. Both
   screens show a six-digit code worked out from the two computers' keys; the person checks they match, presses Allow
   on the other computer and "The codes match" here. Only then does this computer trust the other's key. */
/* A computer name as the coordinator gives it, by the same rule as pendingDevices' joining_computer. */
const computerName = (v) => (typeof v === 'string' && NAME_RULE.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
/* A tunnel from before slice 1 has no `join` verb: clap refuses it with exit 2 before doing anything. */
/* kosmos#6590 (S-7d branch c): the typed-code Allow. A browser that proved its own key on this computer's address waits
   as a row the tunnel lists (`devices waiting`: never its code); the person types the code that browser shows. All of
   it is INERT until the board-v2 marker is in the state folder, which only a later step writes: until then nothing
   here spawns, no route answers more than "not yet", and every existing screen behaves as before. */
const BOARD_V2_FILE = 'board-v2';
/* Read from the file every time (never "I wrote it"): a Forget clears the folder, and the page must not offer typed
   codes while the tunnel answers the old code. */
function boardV2() {
  try { return fs.existsSync(path.join(STATE_DIR(), BOARD_V2_FILE)); } catch { return false; }
}
/* A knock id as the tunnel writes it (KnockId: 128 random bits, unpadded base64url). Checked before it reaches argv. */
const KNOCK_ID = /^[A-Za-z0-9_-]{22}$/;
/* The finding the certificate alarm is about (a SHA-256 in hex), passed back unchanged when the person acknowledges. */
const CT_FINDING = /^[0-9a-f]{64}$/;
/* A row the coordinator lists as another of the person's computers (joining, waiting for its code, or a code check).
   These keep today's Allow with the typed pairing code whatever the marker says. */
function isComputerRow(d) {
  return !!d && (String(d.device_id || '').startsWith('computer:') || !!d.joining_computer || !!d.code_wait || d.recheck === true);
}
/* Under the marker, an Allow or Not me by device id is only for a row the CURRENT snapshot lists as a computer; any other
   id (a phone, a browser, or one not listed at all) is refused at the route, so no phone is let in by its sign-in alone.
   The raw snapshot, not pendingDevices(): that one already drops phone rows under the marker. */
function listedAsComputer(id) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch { return false; }
  const list = raw && Array.isArray(raw.devices) ? raw.devices : [];
  // The page's own rules for a computer's name (pendingDevices), so the route and the page agree on what is a computer.
  return list.some((d) => d && String(d.device_id || '') === String(id) && REQUEST_ID.test(String(id))
    && isComputerRow({ ...d, joining_computer: typeof d.joining_computer === 'string' && NAME_RULE.test(d.joining_computer.trim().toLowerCase()) ? d.joining_computer : null, code_wait: CODE_WAITS.has(d.code_wait) ? d.code_wait : null }));
}
/* One read of `devices waiting` serves every open board for a moment, and concurrent asks share the one spawn (an open
   board polls every few seconds). Flushed after anything that changes the rows. */
const WAITING_FRESH_MS = 2000;
let waitingCache = null;   // { at, gen, value }
let waitingInFlight = null;   // { gen, p }
let waitingGen = 0;
function flushWaiting() { waitingCache = null; waitingGen += 1; }
const NO_WAITING = Object.freeze({ count: 0, waiting: Object.freeze([]), ctAlarm: false, ctFinding: null });
function waitingFrom(data) {
  const rows = data && Array.isArray(data.waiting) ? data.waiting : [];
  const waiting = rows
    .filter((w) => w && KNOCK_ID.test(String(w.knockId || '')))
    .map((w) => ({
      knockId: String(w.knockId),
      firstSeen: Number(w.firstSeen) || 0,
      // What the browser said it is (a coarse class the tunnel picks) and the network the relay reported.
      uaClass: typeof w.uaClass === 'string' ? w.uaClass.slice(0, 40) : '',
      net: typeof w.net === 'string' ? w.net.slice(0, 64) : '',
      vouched: w.vouched === true,
    }));
  return {
    count: waiting.length,
    waiting,
    ctAlarm: !!data && data.ctAlarm === true,
    ctFinding: data && typeof data.ctFinding === 'string' && CT_FINDING.test(data.ctFinding) ? data.ctFinding : null,
  };
}
/** The browsers waiting for a typed code, and the tunnel's certificate alarm. `v2` false: the marker is not here, so
    nothing was asked. Off or not enrolled: nothing is spawned. */
async function devicesWaiting() {
  if (!boardV2()) return { ok: true, because: null, data: { v2: false, ...NO_WAITING } };
  if (!read().on || !enrolled()) return { ok: true, because: null, data: { v2: true, ...NO_WAITING } };
  if (waitingCache && waitingCache.gen === waitingGen && Date.now() - waitingCache.at < WAITING_FRESH_MS) return waitingCache.value;
  /* Only a read started since the last flush is shared (review 1): one started before an Allow would show the allowed
     row again. */
  if (waitingInFlight && waitingInFlight.gen === waitingGen) return waitingInFlight.p;
  const gen = waitingGen;
  const mine = { gen, p: null };
  mine.p = setupRun(['devices', 'waiting', '--state-dir', STATE_DIR()], null, retireTimeoutMs())
    .then((r) => {
      const got = parseSaid(r);
      const value = got.ok ? { ok: true, because: null, data: { v2: true, ...waitingFrom(got.data) } } : { ok: false, because: got.because };
      if (got.ok && gen === waitingGen) waitingCache = { at: Date.now(), gen, value };
      return value;
    })
    .finally(() => { if (waitingInFlight === mine) waitingInFlight = null; });
  waitingInFlight = mine;
  return mine.p;
}
/* A failure's words (stderr, or a line the tunnel did not mean as an answer), never passed on when they hold the typed
   code in any case. The answer's own `because` is from the tunnel's fixed set of sentences and is passed as is (review
   1: scrubbing those hid the minute-long lockout behind a one-character code). */
function failureWordsWithout(because, code) {
  const said = typeof because === 'string' ? because.trim().slice(0, 300) : '';
  // The code as typed, and its letters and digits alone (a tunnel that echoed its own folded form, review 2).
  const bare = code ? code.replace(/[^A-Za-z0-9]/g, '').toLowerCase() : '';
  const flat = said.toLowerCase();
  if (!said || (code && flat.includes(code.toLowerCase())) || (bare.length >= 6 && flat.replace(/[^a-z0-9]/g, '').includes(bare))) return '';
  return said;
}
/** Allow the waiting browser `knockId` by the code it shows, typed by the person. */
async function deviceAllowCode(knockId, code) {
  { const b = busy(); if (b) return b; }
  if (!boardV2()) return { ok: false, because: 'this computer does not take typed codes yet' };
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  if (!read().on) return { ok: false, because: 'switch Kosmos+ on first' };
  if (typeof knockId !== 'string' || !KNOCK_ID.test(knockId)) return { ok: false, because: 'that browser is no longer waiting' };
  /* Refused here, not counted as a wrong try by the tunnel: an empty code, and any control character (a NUL would fail
     the spawn with the value in its error). No length cap: the tunnel caps it. */
  const typed = typeof code === 'string' ? code.trim() : '';
  if (!typed || /[\u0000-\u001f\u007f]/.test(typed)) return { ok: false, because: 'type the code that browser shows' };
  /* `--` before the two values: a knock id or a code can start with "-", and without it the tunnel's argument parser
     could take one for a flag and echo it back in its error. */
  const r = parseSaid(await tracked(setupRun(['devices', 'allow-code', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR(), '--', knockId, typed], null, retireTimeoutMs())));
  flushWaiting();
  if (!r.ok) return { ok: false, because: failureWordsWithout(r.because, typed) || 'the code could not be checked; try again' };
  const d = r.data || {};
  if (d.paused === true) return { ok: false, because: PAUSED_ALLOW_WORDS, paused: true };
  if (d.allowed === true) {
    if (d.account_ack === UNKNOWN_DEVICE) return { ok: false, because: UNKNOWN_WORDS, listed: true };
    return { ok: true, because: null, data: { allowed: true, device_id: typeof d.device_id === 'string' ? d.device_id : null, acked: d.acked === true } };
  }
  const left = Number.isInteger(d.tries_left) && d.tries_left >= 0 ? d.tries_left : null;
  const said = typeof d.because === 'string' ? d.because.trim().slice(0, 300) : '';
  return { ok: false, because: said || 'that code did not let the browser in', triesLeft: left };
}
/** "Not me" on one waiting browser: the tunnel turns that browser's key away on this computer for a day and drops every
    row of it. Kosmos+ is not told. `allowed`: the browser was already let in (remove it under Devices). */
async function deviceDropWaiting(knockId) {
  { const b = busy(); if (b) return b; }
  if (!boardV2()) return { ok: false, because: 'this computer does not take typed codes yet' };
  if (typeof knockId !== 'string' || !KNOCK_ID.test(knockId)) return { ok: false, because: 'that browser is no longer waiting' };
  const r = parseSaid(await tracked(setupRun(['devices', 'drop-waiting', '--state-dir', STATE_DIR(), '--', knockId], null, retireTimeoutMs())));
  flushWaiting();
  if (!r.ok) return r;
  const d = r.data || {};
  const device = typeof d.device_id === 'string' && DEVICE_ID.test(d.device_id) ? d.device_id : null;
  /* kosmos#6590 (c3 review 1): an Allow (typed or automatic) won the race with this Not me. The person's answer wins: the
     browser is taken back out here, and an automatic Allow's answer that lands after this never notes it. */
  if (d.allowed === true && device) {
    notMeTakenBack.add(device);
    const rr = await deviceRemove(device);
    return { ok: true, because: null, data: { dropped: Number(d.dropped) || 0, allowed: true, device_id: device, takenBack: !!(rr && rr.ok) } };
  }
  return { ok: true, because: null, data: { dropped: Number(d.dropped) || 0, allowed: d.allowed === true, device_id: device } };
}
/** kosmos#6590 (c4): the person has looked at the certificate warning the tunnel is pausing new browsers for. Only the
    finding the board showed (`ctFinding` from the same waiting answer) is acknowledged: a newer one is not. The board's
    own lost-report acknowledgement is written only after the tunnel's, so the two never disagree (design review 3). */
async function deviceCtAck(finding) {
  { const b = busy(); if (b) return b; }
  if (!boardV2()) return { ok: false, because: 'this computer does not take typed codes yet' };
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  if (typeof finding !== 'string' || !CT_FINDING.test(finding)) return { ok: false, because: 'The warning changed. Look at it again.' };
  // The lost report as it stands now, read BEFORE the tunnel call, so the board notes only the report that was shown;
  // ackLostIn refuses a different one (review 1).
  const shown = certWatch();
  const r = parseSaid(await tracked(setupRun(['devices', 'ct-ack', '--state-dir', STATE_DIR(), '--finding', finding], null, retireTimeoutMs())));
  flushWaiting();
  if (!r.ok) return r;
  const d = r.data || {};
  if (d.changed === true) return { ok: false, because: 'A new certificate finding came in since this was shown. Look at the warning again.', changed: true };
  if (d.acknowledged !== true) return { ok: false, because: 'There is no certificate warning to acknowledge now.' };
  if (shown.lost && shown.lostAt) {
    const a = certWatchFiles.ackLostIn(STATE_DIR(), shown.lostAt);
    if (!a.ok) process.stderr.write('kosmos+: the certificate warning is acknowledged, but this computer could not note the lost report: ' + a.because + '\n');
  }
  return { ok: true, because: null, data: { acknowledged: true } };
}
/** Drop every waiting browser, and forget the browsers turned away today (the undo for a mistaken Not me). */
async function devicesClearWaiting() {
  { const b = busy(); if (b) return b; }
  if (!boardV2()) return { ok: false, because: 'this computer does not take typed codes yet' };
  const r = parseSaid(await tracked(setupRun(['devices', 'clear-waiting', '--state-dir', STATE_DIR()], null, retireTimeoutMs())));
  flushWaiting();
  if (!r.ok) return r;
  return { ok: true, because: null, data: { cleared: Number(r.data && r.data.cleared) || 0 } };
}
function joinUnsupported(r) {
  const said = (String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, '');
  return !r.ok && r.code === 2 && /unrecognized subcommand '?(join|retry)'?/.test(said);   // #6353: retry is newer than join
}
/** One pairing round, then what the page may show: held, the code (or ""), whom it was asked of, and the
    failed / confirmed / confirm_expired states. Not enrolled means not joining, without asking the binary. */
async function joinStatus() {
  /* A pairing round signs with this computer's key and writes pairing state, so it is a tracked signed call (#3827): a
     Forget or a register in flight waits for it, and it does not start during one. */
  { const b = busy(); if (b) return b; }
  if (!enrolled()) return { ok: true, because: null, data: { supported: true, held: false } };
  const r = await tracked(setupRun(['join', 'status', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], null, retireTimeoutMs()));
  if (joinUnsupported(r)) return { ok: true, because: null, data: { supported: false, held: false } };
  const got = parseSaid(r);
  if (!got.ok) return got;
  const d = got.data || {};
  const names = (v) => (Array.isArray(v) ? v : []).map(computerName).filter(Boolean).slice(0, 10);
  return { ok: true, because: null, data: {
    supported: true,
    held: d.held === true,
    join_code: typeof d.join_code === 'string' && JOIN_CODE.test(d.join_code) ? d.join_code : '',
    /* The computer this one pairs with, once its code is worked out (the tunnel lists at most one). */
    on: (Array.isArray(d.join_codes) ? d.join_codes : []).map((c) => (c ? computerName(c.on) : null)).find(Boolean) || null,
    asked_of: names(d.asked_of),
    failed: d.failed === true,
    confirmed: d.confirmed === true,
    confirm_expired: d.confirm_expired === true,
    /* #6353: the last code ran out and no new one comes until the person presses Try again here. */
    needs_retry: d.needs_retry === true,
    /* kosmos#6404: allowed, but its code ran out before The codes match was pressed here: the person can ask for one
       fresh code check (joinRecheck); and while that check runs. */
    can_recheck: d.can_recheck === true,
    rechecking: d.rechecking === true,
    recheck_with: computerName(d.recheck_with) || null,
  } };
}
/** "The codes match": the person says the code on this screen is the one on the other computer. Local only; the
    tunnel refuses a code it did not show (or one past its time). Answers the other computer's name. */
async function joinConfirm(code) {
  { const b = busy(); if (b) return b; }
  if (typeof code !== 'string' || !JOIN_CODE.test(code)) return { ok: false, because: 'that is not the code on this screen' };
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const r = await tracked(setupRun(['join', 'confirm', '--state-dir', STATE_DIR(), '--code', code], null, retireTimeoutMs()));
  if (joinUnsupported(r)) return { ok: false, because: 'this version of Kosmos cannot pair computers yet' };
  /* The tunnel's refusals (pairing.rs confirm_joining), tagged for the page to word: the code ran out, or it is not the
     code this computer shows now. */
  if (!r.ok) {
    const said = String(r.stderr || '') + '\n' + String(r.because || '');
    if (/\bsas_pending:/.test(said)) return { ok: false, because: 'code_expired' };
    if (/\bsas_mismatch:/.test(said)) return { ok: false, because: 'code_changed' };
  }
  const got = parseSaid(r);
  if (!got.ok) return got;
  const d = got.data || {};
  if (d.confirmed !== true) return { ok: false, because: 'the code was not confirmed' };
  return { ok: true, because: null, data: { confirmed: true, with: computerName(d.with) } };
}

/** #6353, "Try again": the last code ran out, so allow ONE new attempt (the next round starts it). Local only. The
    tunnel refuses when no code ran out or every try is used; both are tagged for the page to word. */
async function joinRetry() {
  { const b = busy(); if (b) return b; }
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const r = await tracked(setupRun(['join', 'retry', '--state-dir', STATE_DIR()], null, retireTimeoutMs()));
  if (joinUnsupported(r)) {
    const noRetry = /unrecognized subcommand '?retry'?/.test((String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, ''));
    return { ok: false, because: noRetry ? 'this version of Kosmos cannot ask for a new code yet' : 'this version of Kosmos cannot pair computers yet' };
  }
  if (!r.ok) {
    const said = String(r.stderr || '') + '\n' + String(r.because || '');
    if (/\bnothing_to_retry:/.test(said)) return { ok: false, because: 'nothing_to_retry' };
    if (/\battempts_used:/.test(said)) return { ok: false, because: 'attempts_used' };
  }
  const got = parseSaid(r);
  if (!got.ok) return got;
  if (!got.data || got.data.retry !== true) return { ok: false, because: 'that did not go through' };
  return { ok: true, because: null, data: { retry: true } };
}

/* kosmos#6406 step 2: a ticket that opens another of this account's computers in this computer's app window with no
   sign-in (kosmos-tunnel open-ticket: signed with this computer's key, for that computer's origin only, good for two
   minutes, once). The other computer takes it only if it trusts this computer's key; the server route asks for one
   only for a request made on this computer's own screen. `address` is the other computer's host, already checked. */
async function openTicket(address) {
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  // Its own short limit: the page opens the plain address after 8 s anyway (a ticket is local work, no network).
  const r = await tracked(setupRun(['open-ticket', '--state-dir', STATE_DIR(), '--to', 'https://' + address], null, 15000));
  const said = (String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, '');
  if (!r.ok && r.code === 2 && /unrecognized subcommand '?open-ticket'?/.test(said)) {
    return { ok: false, because: 'this version of Kosmos cannot open another computer directly yet' };
  }
  const got = parseSaid(r);
  // A fixed sentence for any other failure (review 7): the tunnel's own words (a path, a spawn error) stay here.
  if (!got.ok) return { ok: false, because: 'that did not go through' };
  const t = got.data && got.data.ticket;
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{20,2048}$/.test(t)) return { ok: false, because: 'that did not go through' };
  return { ok: true, because: null, data: { ticket: t } };
}

/* kosmos#6589 (S-7c): which TLS key another of the person's computers vouches for (kosmos-tunnel tls-pin: its
   statement, signed with the key its pairing carries, checked against peers.json; the origin stays pinned to that
   peer). The Mac app compares the certificate it is handed with this before it lets a window open there.
   - pinned: { spki: [64-hex], from } - the app must be handed a certificate with one of these keys;
   - none: never pinned here and no statement (a computer on an older version): nothing to compare;
   - required: do not proceed (a pinned origin with no usable statement, a refused one, or an error).
   Cached 5 min per address, so a page of switches costs one fetch; `fresh` skips the cache (the app's one retry on a
   mismatch, so a renewal is not taken for an attack: Ice Cream Kitty's review). A connector from before tls-pin
   answers `none`: it has never pinned anything, so there is nothing it could fail to enforce. */
const TLS_PIN_TTL_MS = 5 * 60 * 1000;
const tlsPinCache = new Map();
const tlsPinInFlight = new Map();   // review 1: WebKit's parallel connections to one host share one tunnel run
let tlsPinGeneration = 0;           // review 2: bumped by a forget, so an ask that began before it writes nothing
const tlsPinWarmQuiet = new Map();  // review 2: address -> until when warming leaves it alone (it answered required)
const TLS_PIN_WARM_QUIET_MS = 60 * 1000;
/* kosmos#7193: why a check answered "required", in this board's log, once a minute per address at most, for the app's
   own ask only. Josh's Mac refused a computer for minutes and nothing recorded why: the tunnel's words were kept only
   in this answer. No computer name (the app's unified-log line keeps none either, #5481), the home folder as ~. */
const tlsPinSaidAt = new Map();
const tlsPinWhy = new WeakMap();   // review 4: the reason of the run that made THIS answer (keyed by the answer, never stale)
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Review 2/3: no computer is named. An unreachable computer's reason carries its URL (the tunnel's HTTP client prints
   it first), and a certificate made for another computer names THAT one ("only valid for ..."), so every URL's host
   and every address under the account's domain (the address minus its one label) is taken out, after the home folder. */
function tlsPinScrub(address, said) {
  const domain = String(address).split('.').slice(1).join('.');
  const home = require('os').homedir();
  let why = String(said || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' / ').split(home).join('~');
  why = why.replace(/\b(https?:\/\/)[^\s/'")\]]+/gi, '$1a computer');
  if (domain) why = why.replace(new RegExp('\\b(?:[a-z0-9-]+\\.)+' + escapeRe(domain) + '\\b', 'gi'), 'a computer');
  return why.slice(0, 300) || 'no reason given';
}
function tlsPinSayWhy(address, why, now) {
  const at = tlsPinSaidAt.get(address);
  if (at !== undefined && now - at < 60 * 1000) return;
  tlsPinSaidAt.set(address, now);
  console.error('remote: tls-pin answered required for a computer: ' + tlsPinScrub(address, why));
}
const SPKI = /^[0-9a-f]{64}$/;
async function tlsPin(address, { fresh = false, say = false } = {}) {
  // kosmos#7193 review 3: only the app's own ask says why in the board log; background warming never does.
  const answer = await tlsPinAnswer(address, { fresh });
  if (say && answer && answer.data && answer.data.state === 'required') tlsPinSayWhy(address, tlsPinWhy.get(answer) || answer.data.because, Date.now());
  return answer;
}
async function tlsPinAnswer(address, { fresh = false } = {}) {
  // Review 9: not while this computer is being signed out of Plus (its state folder is going away).
  if (forgetting) return { ok: true, because: null, data: { state: 'required', because: 'this computer is signing out of Plus' } };
  if (!enrolled()) return { ok: true, because: null, data: { state: 'none', because: 'not signed up for Plus here' } };
  const now = Date.now();
  const hit = tlsPinCache.get(address);
  if (!fresh && hit && now - hit.at < TLS_PIN_TTL_MS) return hit.answer;
  /* Review 7: ONE run per address at a time. The computer signs a new statement per request and the tunnel refuses
     one older than the newest it has seen, so two runs side by side could have the slower one refused. A plain ask
     joins whatever is running; a fresh ask joins a fresh run, or waits for a plain one to finish and then runs. */
  const running = tlsPinInFlight.get(address);
  if (running && (!fresh || running.fresh)) return running.p;
  const start = () => tlsPinAsk(address, Date.now());
  const p = (running ? running.p.catch(() => {}).then(start) : start())
    // Only its OWN entry: a forget may have cleared it and a newer ask taken the address since (review 3).
    .finally(() => { const cur = tlsPinInFlight.get(address); if (cur && cur.p === p) tlsPinInFlight.delete(address); });
  tlsPinInFlight.set(address, { p, fresh });
  return p;
}
async function tlsPinAsk(address, now) {
  const generation = tlsPinGeneration;
  // The statement fetch has its own 10 s limit in the tunnel; this bounds the whole call.
  const r = await tracked(setupRun(['tls-pin', '--state-dir', STATE_DIR(), '--to', 'https://' + address], null, 20000));
  const said = (String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, '');
  let answer;
  if (!r.ok && r.code === 2 && /unrecognized subcommand '?tls-pin'?/.test(said)) {
    answer = { ok: true, because: null, data: { state: 'none', because: 'this version of the connector cannot check that yet' } };
  } else {
    const got = parseSaid(r);
    const d = got.ok && got.data ? got.data : null;
    if (d && d.state === 'pinned' && Array.isArray(d.spki) && d.spki.length && d.spki.every((k) => typeof k === 'string' && SPKI.test(k))) {
      answer = { ok: true, because: null, data: { state: 'pinned', spki: d.spki.slice(0, 4) } };   // the relay sends one
    } else if (d && d.state === 'none') {
      answer = { ok: true, because: null, data: { state: 'none', because: 'never checked here' } };
    } else {
      // Anything else, an answer of the wrong shape included, is "do not proceed": a check that cannot be read
      // must never read as nothing to check. The tunnel's own words stay here (a path, a key name).
      answer = { ok: true, because: null, data: { state: 'required', because: "this computer's certificate could not be checked" } };
      tlsPinWhy.set(answer, [d && typeof d.because === 'string' ? d.because : '', said].filter(Boolean).join('\n'));
    }
  }
  // Only a definite answer is cached: a required one is asked again next time (it may be a passing failure).
  // A forget while this ran (a sign-out, a removed device): the answer is still returned, never kept.
  // Nor over a NEWER answer (review 3). A BACKSTOP since review 7: with one run per address an older run cannot finish
  // after a newer one, so this cannot fire today; it stays so a change to that rule cannot quietly regress the cache.
  const newer = tlsPinCache.get(address);
  if (generation === tlsPinGeneration && !(newer && newer.at > now)) {
    if (answer.data.state !== 'required') tlsPinCache.set(address, { at: now, answer });
    else tlsPinCache.delete(address);
  }
  return answer;
}

/* kosmos#6589 (review 1): ask about each of the account's other computers in the background whenever the list is read,
   so the FIRST switch to one finds its address already pinned (a pin is made only when a statement verifies, and
   whoever re-routes a name could answer the first ask with a 404). Bounded to 10, and the cache makes it cheap. */
function warmTlsPins(computers) {
  if (!Array.isArray(computers)) return;
  const now = Date.now();
  for (const c of computers.filter((x) => x && !x.this && typeof x.address === 'string').slice(0, 10)) {
    // A computer that answered required (offline, say) is left alone for a minute, so every list read does not
    // start ten connector runs again. The app's own ask is never held back by this.
    if ((tlsPinWarmQuiet.get(c.address) || 0) > now) continue;
    tlsPin(c.address)
      .then((got) => { if (got && got.data && got.data.state === 'required') tlsPinWarmQuiet.set(c.address, Date.now() + TLS_PIN_WARM_QUIET_MS); })
      .catch(() => {});
  }
}
/* A sign-out or a removed device may end the trust a cached pin rests on: forget the cache (the tunnel's own
   check runs again on the next ask). */
/* Review 8: running asks are not dropped from tlsPinInFlight (a new ask still waits its turn behind them, one run per
   address); the generation keeps whatever they answer out of the cache. */
function forgetTlsPins() { tlsPinGeneration += 1; tlsPinCache.clear(); tlsPinWarmQuiet.clear(); }

/** kosmos#6404, "Check the code": this computer was allowed, but its code ran out before The codes match was pressed
    here, so it does not trust the other computer yet. Asks for ONE fresh code check with it (the next round starts it).
    Local only. The tunnel refuses when there is nothing to check or every try is used; both are tagged. */
async function joinRecheck() {
  { const b = busy(); if (b) return b; }
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const r = await tracked(setupRun(['join', 'recheck', '--state-dir', STATE_DIR()], null, retireTimeoutMs()));
  const said = (String(r.stderr || '') + '\n' + String(r.because || '')).replace(/\x1b\[[0-9;]*m/g, '');
  if (!r.ok && r.code === 2 && /unrecognized subcommand '?(join|recheck)'?/.test(said)) {
    return { ok: false, because: 'this version of Kosmos cannot check the code again yet' };
  }
  if (!r.ok) {
    if (/\bnothing_to_recheck:/.test(said)) return { ok: false, because: 'nothing_to_recheck' };
    if (/\battempts_used:/.test(said)) return { ok: false, because: 'attempts_used' };
  }
  const got = parseSaid(r);
  if (!got.ok) return got;
  if (!got.data || got.data.recheck !== true) return { ok: false, because: 'that did not go through' };
  return { ok: true, because: null, data: { recheck: true } };
}

/* ---- Sign in THIS computer (#3149 journey 2). The in-app wizard replaces the
   old jump-to-the-web: email code -> phone code -> "you're signed in". Unlike
   `setup` (create-or-join enrolment), these verbs never create an account -- a
   missing account is the coordinator's anti-enumeration silence, and the app
   shows a generic "Join Kosmos" nudge from the code screen rather than
   confirming existence. The kosmos-tunnel
   `signin {start,verify,second,enrol,confirm-enrol,register}` verbs each print
   one JSON object with a `stage` field; this module drives them and hands the
   PAGE only page-safe fields: the stage always; on the enrol_second_factor stage,
   sms_available and the why-authenticator copy; and on the enrolment_started stage,
   the kind and the material the enrol screen shows (a totp secret/otpauth, or the
   masked sms sent_to tail) -- never a token, and never the full phone number.

   🔒 The bearer material stays HERE, never the browser. THREE bearer credentials
   pass through, all held the same way: `verify`/`second` return a 30-day session
   token, `verify` a phone-code challenge id, and `verify`'s enrol_second_factor
   branch an enrol-only token (which `enrol`/`confirm-enrol` spend). All are
   sensitive and live in `signinSession` in this process for the seconds between
   steps -- the wizard sees only page-safe fields (never bearer material), and
   `register` spends the session token from here (piped to the CLI over stdin, off
   argv), and so does `signinAddresses` (kosmos#4756, the same way). This is the #874 posture: the page cannot carry, replay, or leak a
   credential it never holds. It is memory-only on purpose -- a board restart mid-flow drops it and
   the person simply starts sign-in again, which is safe and quick.

   ⚠️ ONE SLOT, and the collision edge stated in full (by design, not a defect,
   for the same reason setupComplete's ACCOUNT-SWITCH EDGE is). This is built for
   one person at one board signing in this computer at a time -- the only actor
   who can reach the board's loopback API. A fresh `start` clears the slot, so
   the LAST flow wins. If two flows on the same board interleave and BOTH reach a
   session before either registers, the second overwrites the first, and the
   first tab's `register` then spends whichever session is current. It is not
   fully silent: `register`'s answer carries the `address` the account got, which
   the wizard shows, so a person who somehow drove two accounts in two tabs sees
   which one landed. Per-flow keying would close it, but a single slot is correct
   for the product and per-flow ids would push state into the wizard for a race
   only a split-brain single operator could cause. If concurrent per-board
   sign-ins ever become real, key this by a per-flow id. ---- */
let signinSession = null;

/** This computer's stable sign-in device id. `signin start` and its matching
    `verify` must carry the SAME device id (the coordinator ties the emailed
    code to it), and it should be stable across attempts so the account's device
    list shows one "this computer" row rather than a new one each try -- so the
    app owns and persists it, per the CLI contract. It is a plain opaque label,
    not enrolment crypto (see the NO CRYPTO HERE note at the top). Minted once,
    kept in remote.json, reused forever; a stored value that somehow fails the
    shape check is replaced rather than trusted.

    The in-process memo (`mintedDeviceId`) is what makes start and verify use the
    SAME id even if the write to remote.json fails (disk full, permissions): that
    tie is load-bearing (the coordinator binds the emailed code to the device id
    a `start` presented, and `verify` must present the same one), and a single
    sign-in flow always runs in one board process. A fresh process re-reads the
    file, or mints again if the write never landed. */
let mintedDeviceId = null;
/* kosmos#5422: the id this process last signed in with and the ids before it, held in memory so a repair of a damaged
   remote.json (whose own write of them was refused) puts them back (see write()). */
let heldIdentity = null;
/* kosmos#5422: every id this computer has signed in with (the file's and, when the file cannot be read, the ones this
   process holds). Its rows at the coordinator are its own: never a request to allow (#4610), never in the allowed
   list (server.js /api/remote/devices). */
function ownDeviceIds(settings = read()) {
  const ids = [settings.device_id, ...(settings.past_device_ids || [])];
  if (heldIdentity) ids.push(heldIdentity.device_id, ...heldIdentity.past_device_ids);
  return ids.filter((x, i, all) => typeof x === 'string' && x && all.indexOf(x) === i);
}
/* kosmos#5422: record that this computer now signs in as `id`. The id it used before moves to past_device_ids, so
   its row (still pending at the coordinator) stays this computer's own. No cap: a row at the coordinator outlives any
   count, and every new id is a person's act (a Forget, a new key), so the list stays short. Best-effort, like the
   mint below. */
function useDeviceId(id) {
  const cur = read();
  /* The ids before, from what this process holds (never older than the file; it may hold ids a failed save never got
     into it) and from the file when it can be read. */
  const fromFile = cur.ok === false ? [] : [cur.device_id, ...cur.past_device_ids];
  const fromHeld = heldIdentity ? [heldIdentity.device_id, ...heldIdentity.past_device_ids] : [];
  const all = [...fromHeld, ...fromFile];
  const past = all.filter((x, i) => x && x !== id && DEVICE_ID.test(x) && all.indexOf(x) === i);
  heldIdentity = { device_id: id, past_device_ids: past };
  if (cur.device_id !== id || JSON.stringify(cur.past_device_ids) !== JSON.stringify(past)) write({ device_id: id, past_device_ids: past });
}
function signinDeviceId() {
  if (mintedDeviceId && LEGACY_ID.test(mintedDeviceId)) return mintedDeviceId;
  const r = read();
  // When remote.json cannot be read, what this process holds stands in for it (a key's sign-in may have moved the
  // opaque id there), or an older tunnel would mint another "this computer" (#3149).
  const held = r.ok === false && heldIdentity ? heldIdentity : null;
  const inUse = held ? held.device_id : r.device_id;
  // kosmos#5422: after a key, the opaque id is among the past ones (an older tunnel signs in with it again).
  const pool = [r.device_id, ...r.past_device_ids, ...(held ? [held.device_id, ...held.past_device_ids] : [])];
  const kept = pool.find((x) => typeof x === 'string' && LEGACY_ID.test(x));
  const id = kept || crypto.randomUUID();
  mintedDeviceId = id;      // hold it even if the persist below fails
  /* Kept at once, so a restart signs in with it again. With no valid id in use (a fresh install, a hand edit) it is the
     id in use at once; with one in use (a key's id, under an older tunnel) it waits among the ids before, and becomes
     the id in use only when a sign-in with it is taken (the callers record it), so the self-grant never moves to an id
     the coordinator has not seen. */
  if (!inUse || !DEVICE_ID.test(inUse)) useDeviceId(id);
  else if (!kept) addPastId(id);
  return id;
}

/* kosmos#5422: the sign-in's device arguments, asked of the tunnel on every start and verify (no memo, so a Forget
   that removes the key file, or a passing failure, is never remembered). A tunnel that knows `signin device-id
   --device-key` keeps this computer's key in a file in its own state folder and proves it on verify; the crypto stays
   in the tunnel, this module passes a path. The app bundles whichever tunnel was built for the release and nothing
   pins the two, so an older tunnel must keep working: it refuses the verb as a usage error, exit 2 (measured on two
   older builds: "error: unrecognized subcommand 'device-id'"), and only that means the opaque id. Any other failure
   refuses the sign-in in words: falling back would sign in as another device, and a k1 id is never sent without its
   key. The key file is deterministic, so a start and its verify name one device. */
const DEVICE_KEY_FILE = () => path.join(STATE_DIR(), 'signin-device.key');
const DEVICE_ID_ASK_MS = 15000;
/* Calls that can make the device key (the ask, and a keyed start: the tunnel's start makes a missing key too). Forget
   waits for them, since they write into the folder it empties. The ask is bounded (DEVICE_ID_ASK_MS); a start is
   not, so Forget's wait is (KEY_CALL_WAIT_MS): a start still out after that cannot hold the Forget. */
const KEY_CALL_WAIT_MS = 60000;
const keyCallWaitMs = () => Number(process.env.AGENT_WORKFORCE_KEY_CALL_WAIT_MS) || KEY_CALL_WAIT_MS;   // test seam
const deviceIdInFlight = new Set();
function trackKeyCall(p) { deviceIdInFlight.add(p); const done = () => deviceIdInFlight.delete(p); p.then(done, done); return p; }
/* What the tunnel said, for a person: its "Error: " line (anyhow's shape) and the innermost "Caused by" line (the
   system's reason: permission, disk full), with the state folder's path taken out wherever it appears (it holds the
   person's home folder, often with spaces in it, so no pattern on the path itself is safe). */
function tunnelWords(asked) {
  const lines = String(asked.stderr || '').split('\n');
  // Every spelling of the folder the tunnel might print: as set, as joined into the key's path, and resolved.
  const dirs = [...new Set([path.dirname(DEVICE_KEY_FILE()), path.resolve(STATE_DIR()), STATE_DIR()])].sort((x, y) => y.length - x.length);
  const scrub = (l) => dirs.reduce((t, d) => t.split(d + path.sep).join('').split(d).join(''), l)
    .replace(/\s*\bsignin-device\.key[^\s;:,)]*/g, '').replace(/\s+/g, ' ').trim();
  const head = lines.find((l) => /^Error: /.test(l));
  const causes = lines.slice(lines.findIndex((l) => /^Caused by:/.test(l)) + 1).map((l) => l.replace(/^\s*(\d+:\s*)?/, '')).filter(Boolean);
  // No "Error:" line: clap's usage text, whose last line ("For more information, try '--help'.") says nothing.
  if (!head) return 'the tunnel program refused the request';
  const cause = lines.some((l) => /^Caused by:/.test(l)) && causes.length ? causes[causes.length - 1] : '';
  return scrub(head.slice(7)) + (cause ? ' (' + scrub(cause) + ')' : '');
}
async function askDeviceKey() {
  // Bounded: a hung tunnel must not hold the sign-in forever (a cancel cannot free a call that never returns).
  // The tunnel would make a missing folder with default permissions; on macOS and Linux the key's folder is owner-only
  // from the first ask. (On Windows mode bits do nothing: the key file is protected by the tunnel's own ACL.)
  secureStateDir();
  // A Forget waits for this (it may be making the key in the folder the Forget empties).
  return trackKeyCall(setupRun(['signin', 'device-id', '--device-key', DEVICE_KEY_FILE()], null, DEVICE_ID_ASK_MS));
}
const keyedIdIn = (asked) => {
  const r = parseSaid(asked);
  return r.ok && r.data && typeof r.data.device_id === 'string' && KEYED_ID.test(r.data.device_id) ? r.data.device_id : '';
};
/* A key id the tunnel answered is this computer's own from that moment (a start with it may reach the coordinator
   even if its answer never comes back): kept among the ids before, so its row is hidden, but not the id in use until
   a sign-in with it is taken (the self-grant follows that one). */
function noteOwnId(id) {
  if (ownDeviceIds().includes(id)) return;
  addPastId(id);
}
/* An id joins the ids before: in remote.json when it can be read, and in what this process holds whenever it holds
   anything (a repair of a damaged file rebuilds from that, so an id written only to the file would be lost there). */
function addPastId(id) {
  const cur = read();
  // Always in memory too (a save of it may fail), starting from the file's ids when this process holds none yet.
  const base = heldIdentity || { device_id: cur.ok === false ? '' : cur.device_id, past_device_ids: cur.ok === false ? [] : cur.past_device_ids };
  heldIdentity = { device_id: base.device_id, past_device_ids: [id, ...base.past_device_ids.filter((x) => x !== id)] };
  if (cur.ok !== false) write({ past_device_ids: [id, ...cur.past_device_ids.filter((x) => x !== id)] });
}
/* One at a time: two starts at once (a double click, two tabs) must not both remove a corrupt key, the second
   removing the good one the first just made, so the two name different devices. */
let deviceArgsTail = Promise.resolve();
function signinDeviceArgs(forVerify) {
  const turn = deviceArgsTail.then(() => signinDeviceArgsNow(forVerify));
  deviceArgsTail = turn.catch(() => {});
  return turn;
}
async function signinDeviceArgsNow(forVerify) {
  // Nothing may ask for (and so make) a key once a Forget has begun; busy() refuses the step too, this is the same
  // rule at the call that writes into the folder.
  if (forgetting) return { failed: busy() };
  /* A verify never makes a key (the tunnel's own rule): one made now could not answer a code sent for the key that is
     gone (a Forget between the start and the verify). If this computer signs in with a key and the file is gone, say
     so; with no key file and no key id, this is an older tunnel's sign-in and the opaque id carries on. */
  if (forVerify && !fs.existsSync(DEVICE_KEY_FILE())) {
    if (KEYED_ID.test(idInUse())) return { failed: { ok: false, because: "this computer's sign-in key is gone; start the sign-in again" } };
    const opaque = signinDeviceId();
    return { args: ['--device-id', opaque], id: opaque };
  }
  let asked = await askDeviceKey();
  // clap prints "error: unrecognized subcommand 'device-id'" first and the usage after it (exit 2); match it as the
  // other verbs here do, so no other failure is read as an older tunnel.
  if (!asked.ok && asked.code === 2 && /unrecognized subcommand|invalid subcommand/i.test(String(asked.stderr || '') + '\n' + String(asked.because || ''))) {
    const opaque = signinDeviceId();
    return { args: ['--device-id', opaque], id: opaque };
  }
  // The program itself did not run or answer (missing, not startable, timed out): its own words, not the key's.
  // Fixed words: setupRun's own sentence for a spawn failure carries the program's path (under the home folder).
  if (!asked.ok && typeof asked.code !== 'number') return { failed: { ok: false, because: asked.timedOut ? 'the tunnel program did not answer in time' : 'the tunnel program could not be started' } };
  let id = keyedIdIn(asked);
  /* A file that is not a key at all (the tunnel's "is not a P-256 key"; a truncated write, a hand edit) can never be
     used, and the person has no button that removes it (Remove this computer shows only once enrolled). Its own
     remedy is to remove it, so the app does: a start then makes a new key (a new device, allowed once); a verify says
     start again, since a key made now could not answer the code. Any other failure (a key it could not READ) is
     never removed: the tunnel's words say what is wrong. */
  if (!id && /is not a P-256 key/.test(String(asked.stderr || ''))) {
    try { fs.rmSync(DEVICE_KEY_FILE(), { force: true }); } catch {
      // Not removable (a lock, antivirus): the tunnel's "remove it" is not something the person can do here.
      return { failed: { ok: false, because: "this computer's sign-in key could not be used or replaced just now; quit and reopen Kosmos, then sign in again" } };
    }
    if (forVerify) return { failed: { ok: false, because: "this computer's sign-in key could not be used and was removed; start the sign-in again (this computer will be a new device, allowed once)" } };
    // A Forget that began during the first ask must not be outrun by a second one making a key in its folder.
    { const b = busy(); if (b) return { failed: b }; }
    asked = await askDeviceKey();
    id = keyedIdIn(asked);
  }
  if (!id && asked.ok) return { failed: { ok: false, because: 'the tunnel program answered with a device id this version of Kosmos does not know' } };
  if (!id) {
    return { failed: { ok: false, because: "this computer's sign-in key could not be opened: " + tunnelWords(asked) } };
  }
  noteOwnId(id);
  // Recorded by the caller once the coordinator has taken a start or verify with it, not here: a cancelled or refused start
  // never reached the coordinator, so its id must not displace the one this computer signed in with.
  return { args: ['--device-key', DEVICE_KEY_FILE()], id };
}

/** Take the tunnel's `stage` answer, stash any bearer material HERE, and return
    to the caller ONLY page-safe fields (never the session token, never the
    challenge value, never the enrol-only token) -- the stage always, plus on the
    enrol stage the sms_available flag and why-authenticator copy the enrol screen
    renders. Pure-ish: it mutates `signinSession` and returns the page-safe shape.

    FAIL CLOSED: every path sets `signinSession` to exactly this answer's result
    (a session token, a challenge, an enrol-only token, or nothing), so the slot
    never carries a stale value from a PRIOR call across a malformed one. A
    verify/second/confirm-enrol answer whose shape we cannot use clears the slot
    (signinEnrol's own answer does not route through here) -- a
    person who hits an error state
    restarts sign-in rather than silently spending an earlier session. */
function absorbSession(data) {
  const stage = data && typeof data.stage === 'string' ? data.stage : '';
  if (stage === 'session') {
    const token = data && typeof data.token === 'string' ? data.token : '';
    if (!token) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return a usable session' }; }
    signinSession = { token };
    /* #3796 addendum 8: when the account already has an address, the name step asks for nothing and
       says "This computer will connect as <address>". The coordinator's sign-in answer carries it as
       account_address (a coordinator that predates it sends none, and the page falls back). Passed
       through only in its own shape: a lowercase label and a domain, nothing else. */
    const addr = typeof data.account_address === 'string' && /^[a-z0-9-]{3,32}\.[a-z0-9.-]{3,253}$/.test(data.account_address) ? data.account_address : '';
    return { ok: true, because: null, data: { stage: 'session', account_address: addr } };
  }
  if (stage === 'second') {
    const challenge = data && typeof data.challenge === 'string' ? data.challenge : '';
    if (!challenge) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return a phone challenge' }; }
    signinSession = { challenge };
    /* #3796 (Josh's live test): the step must name the account's ONE factor. The coordinator
       says which (open_challenge: "second" is the account's kind, "sent_to" the masked phone
       tail for sms); pass exactly those through, and only in the shapes it sends, so the page
       never renders anything else from here. Absent or unknown, the page falls back to
       generic words rather than guessing. */
    const kind = data.second === 'totp' || data.second === 'sms' ? data.second : '';
    const sentTo = kind === 'sms' && typeof data.sent_to === 'string' && /^\u2022{3}( \d{4})?$/.test(data.sent_to) ? data.sent_to : '';
    return { ok: true, because: null, data: { stage: 'second', second_kind: kind, sent_to: sentTo } };
  }
  if (stage === 'enrol_second_factor') {
    // The account has no second factor yet and the coordinator requires one.
    // Hold the ENROL-ONLY token (verify's answer carries it) so signinEnrol /
    // signinConfirmEnrol can spend it; it is a bearer credential and stays HERE,
    // never returned to the page, exactly like the session token. The wizard gets
    // only what it renders: whether SMS is on, and the "why an authenticator" copy.
    const enrolToken = data && typeof data.token === 'string' ? data.token : '';
    if (!enrolToken) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return an enrolment token' }; }
    signinSession = { enrolToken };
    return { ok: true, because: null, data: {
      stage: 'enrol_second_factor',
      sms_available: data.sms_available === true,
      why_authenticator: typeof data.why_authenticator === 'string' ? data.why_authenticator : '',
    } };
  }
  signinSession = null;
  return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
}

/* kosmos#3831: the app's own sign-in is THIS computer asking to be let in. With
   no name it reached the device list as "a device" with a code nobody had seen,
   next to the person's real browser request, and read as a stranger (Josh,
   2026-09-25). So it is named after this computer: the name the person gave it
   (macOS: scutil ComputerName), else the host name, plus "(Kosmos app)". */
const DEVICE_SUFFIX = ' (Kosmos app)';
/* A name as ONE line: control characters become spaces, runs of white space become one, the ends are trimmed. The
   one derivation of that (kosmos#5995): the computer's own name and a name the person types both go through it, so
   "the box was left as it was" can be told by comparing the two. */
const oneLine = (raw) => String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
/** The label for this computer from a raw name. Pure, so every edge is testable:
    one line, none of the ASCII control characters (the range oneLine clears; the 8-bit C1 controls are
    left as typed), cut to fit DEVICE_NAME's 60 UTF-16 units with
    the suffix (never splitting a surrogate pair), and a plain fallback when
    nothing usable is left. */
function deviceNameFrom(raw) {
  let name = oneLine(raw);
  const room = 60 - DEVICE_SUFFIX.length;
  if (name.length > room) {
    let cut = room;
    const c = name.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut -= 1;   // do not keep half of a pair
    name = name.slice(0, cut).trim();
  }
  const label = name ? name + DEVICE_SUFFIX : '';
  if (label && DEVICE_NAME.test(label)) return label;
  // "this computer", never "this Mac", on every platform (Josh, kosmos#1004).
  return 'This computer' + DEVICE_SUFFIX;
}
/* The computer's own name, read once per process (it does not change under a running
   sign-in). scutil is synchronous but local and bounded at 2 seconds, once. Only this
   is kept: the person's own choice is read from remote.json each time, so a name
   typed at the sign-in is the one every later path sends. */
let thisComputerNameCache = null;
function ownComputerDeviceName() {
  if (thisComputerNameCache !== null) return thisComputerNameCache;
  let raw = '';
  if (process.platform === 'darwin') {
    try { raw = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { raw = ''; }
  }
  if (!String(raw).trim()) { try { raw = os.hostname().replace(/\.local$/i, ''); } catch { raw = ''; } }
  thisComputerNameCache = deviceNameFrom(raw);
  return thisComputerNameCache;
}
/* kosmos#5995: the name this computer is sent under, on EVERY path that sends one (the sign-in's start and verify
   with no caller's label, and the quiet re-approval of this computer later). The person's choice when they made one
   at the sign-in, the computer's own name when they did not. A cleared field is a choice and sends the plain name.
   It reads remote.json each time (the choice is not cached, so one typed at the sign-in is what every later path
   sends): fine for its three callers, which run once per sign-in step, and not something to call in a loop. */
function thisComputerDeviceName() {
  const chosen = read().computer_name;
  return typeof chosen === 'string' ? deviceNameFrom(chosen) : ownComputerDeviceName();
}
const withoutSuffix = (label) => (label.endsWith(DEVICE_SUFFIX) ? label.slice(0, -DEVICE_SUFFIX.length) : label);
/** What the sign-in's "Name for this computer" field shows before anything is sent: the name that would go, without
    the " (Kosmos app)" ending. `fromComputer` says whether it is the computer's own name or one the person gave. */
function computerNameShown() {
  const chosen = read().computer_name;
  /* A cleared choice shows as an EMPTY field (its placeholder says what goes), the same thing computerNameChoice
     answers as `box` for it: shown as the text "This computer", one press would turn the cleared choice into that
     typed name.
     While remote.json cannot be read (damaged, or not readable at all) there is no kept choice to show: read()
     answers none, so this is the computer's own name with fromComputer true, and every path that names this
     computer sends that same name at that time. A choice still in the file comes back when the file reads again.
     Stated and pinned in remote.test.js; not an accident of the blank read. */
  return { name: chosen === '' ? '' : withoutSuffix(thisComputerDeviceName()), fromComputer: typeof chosen !== 'string' };
}
/** What the text left in that field MEANS, with nothing read from or written to remote.json:
    `next`  what would be kept: null for the computer's own name (so an untouched field goes on following the
            computer if it is renamed), '' for a cleared field, else the cleaned name (one line, no control
            characters, cut to fit, and without a " (Kosmos app)" ending the person typed: the engine adds its own);
    `label` the full name a sign-in start sends for it;
    `box`   what the field shows for it afterwards ('' stays an empty field).
    One derivation, so the name a start sends and the name kept after it cannot differ. */
function computerNameChoice(raw) {
  if (typeof raw !== 'string') return { ok: false, because: 'that is not a name' };
  /* Leading hyphens go from a name the person TYPED: it is handed to the tunnel as the value after --device-name,
     and a value that starts with "-" reads as another option there (the hazard the --phone guard below names).
     Only the typed path: the computer's own name is sent as it was before this change. */
  const bare = (t) => {
    let v = t.replace(/^[-\s]+/, '').trim();
    while (v.endsWith(DEVICE_SUFFIX) || v === DEVICE_SUFFIX.trim()) v = v.slice(0, -DEVICE_SUFFIX.trim().length).trim();
    return v;
  };
  const asTyped = oneLine(raw);
  const own = withoutSuffix(ownComputerDeviceName());
  /* The text the box was filled with, left as it was, is "untouched" whatever it holds (a computer named "-Studio",
     or one with an emoji in its name): compared as ONE LINE, the way the computer's own name was made, and BEFORE
     anything else is taken off, so what was shown is what is sent, and nothing is kept. */
  if (asTyped === own) return { ok: true, next: null, label: ownComputerDeviceName(), box: own };
  /* From a typed name, two things only:
     - the direction controls (embeddings, overrides, isolates, the two marks): inside a name they can make the
       account's list read as something else, and no name needs them;
     - half of a character pair on its own, which is replaced.
     Everything else stays as typed. Joiners and selectors are spelling (the Persian word joiner, the joiner inside
     an emoji of several parts, the selector that makes a heart red), so they are NOT removed: an earlier version
     removed every character that draws nothing and changed such names. */
  const cleaned = asTyped.toWellFormed().replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  /* A name with nothing in it that draws LOOKS like a cleared box, and so is one. Asked of what is left once
     Unicode's own "drawn as nothing" characters, white space and the replacement mark (what half a character pair
     became: the box's length limit can cut an emoji in two) are set aside. The name itself is not changed by the
     asking, so such characters INSIDE a name that does draw stay as typed. */
  if (cleaned.replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}\s\ufffd]/gu, '') === '') return { ok: true, next: '', label: deviceNameFrom(''), box: '' };
  const typed = bare(cleaned);
  /* Cut to fit, then the ending is looked for once more: a longer text can be cut exactly where a typed ending ends. */
  const kept = typed ? bare(withoutSuffix(deviceNameFrom(typed))) : '';
  const next = kept === own ? null : kept;
  return { ok: true, next, label: next === null ? ownComputerDeviceName() : deviceNameFrom(next), box: next === null ? own : next };
}
/** Whether keepComputerNameChoice(choice) could keep this choice right now, without writing anything: yes when there is
    nothing to write, or when remote.json can be read or repaired; no for something that is not a name, and for a
    file that cannot be read at all. Asked before the start, so a code is not emailed for a name that cannot be kept. */
function canKeepComputerNameChoice(choice) { return choice && choice.ok ? ableToKeep(choice, read()) : choice; }
/* The one answer both functions give, for a choice already worked out and a read already made (so neither is
   derived twice within one call). */
function ableToKeep(choice, current) {
  if (current.computer_name === choice.next || current.ok !== false) return { ok: true };
  try { fs.readFileSync(FILE, 'utf8'); return { ok: true }; }
  catch (err) { return err && err.code === 'ENOENT' ? { ok: true } : { ok: false, because: 'we could not keep that name just now' }; }
}
/** Keep what the person left in that field (computerNameChoice says what that is).
    Nothing is written when nothing changes: an untouched field on a computer with no remote.json creates none, and
    on a damaged remote.json it is not refused (the sign-in start never was).
    A real choice on a remote.json that HOLDS UNREADABLE TEXT repairs it, as the sign-in's other writes do (#4308).
    One that could not be read AT ALL just now (the disk, a permission, too many open files) is refused: the file
    may be whole, and a repair would rewrite it from nothing for the sake of a name.
    The server calls this only AFTER a sign-in start carried the name, so a name is never kept for a start that did
    not go out, and there is nothing to put back. It asks canKeepComputerNameChoice() BEFORE that start.
    The choice kept is the very one whose `label` the start sent, so the name sent IS the name kept. */
function keepComputerNameChoice(choice) {
  if (!choice || !choice.ok) return choice;
  const current = read();
  const able = ableToKeep(choice, current);
  if (!able.ok) return able;
  if (current.computer_name === choice.next) return { ok: true, name: withoutSuffix(thisComputerDeviceName()) };
  const wrote = write({ computer_name: choice.next }, { repair: true });
  if (!wrote || wrote.ok === false) return { ok: false, because: (wrote && wrote.because) || 'we could not keep that name' };
  return { ok: true, name: withoutSuffix(thisComputerDeviceName()) };
}

/** Append --device-name. A caller's label goes through only when clean (trimmed
    once, no newline, 1-60 chars): a malformed one is dropped, never surfaced (a
    newline in argv would let it inject a second value) and never replaced, since
    it names some other device. With NO label (the app's own sign-in, #3831) this
    computer's name is sent. Shared by start/verify so the two carry it alike. */
function pushDeviceName(args, deviceName) {
  if (deviceName === undefined || deviceName === null || (typeof deviceName === 'string' && !deviceName.trim())) {
    args.push('--device-name', thisComputerDeviceName());
    return;
  }
  if (typeof deviceName !== 'string') return;
  const trimmed = deviceName.trim();
  if (DEVICE_NAME.test(trimmed)) args.push('--device-name', trimmed);
}

/** #3796: the wizard's "Sign out". Drop whatever half-finished sign-in this process holds
    (a session token, a phone challenge, or an enrol-only token), so leaving the wizard
    leaves no bearer material behind. Nothing is sent to the coordinator: an unspent
    token lapses there on its own, and the next signinStart starts clean either way. */
function signinCancel() {
  signinEpoch += 1;
  signinSession = null;
  companySetup = null;   // kosmos#5628 review 1: as the session: no secret is left behind a sign out
  stopVouch();   // kosmos#5786 (b): the same for the open-browser secret
  lastVouched = null;
  return { ok: true, because: null, data: { stage: 'cancelled' } };
}
/* #3796 (review): a step still waiting on the tunnel program when Sign out lands must not
   write its answer back afterwards, or a verify in flight resurrects a live session token the
   person believes they signed out of. Every step records the epoch before it awaits and, if a
   cancel moved it meanwhile, returns this instead of absorbing anything. */
let signinEpoch = 0;
const SIGNIN_CANCELLED = { ok: false, because: 'the sign-in was cancelled' };
/* A Sign out or Forget that landed while a register was out. If the register
   still succeeded, the Mac now has an identity the person asked to leave: the
   switch goes off (it may have been on before the sign-in) and no tunnel runs,
   so the ensure tick cannot bring it online. */
/* A register that failed AFTER writing a new identity (the tunnel writes the new
   mac_identity, then key, id and address, the certificate last; kosmos#5871): what is left is the new id
   beside the old certificate, which no tunnel may run on. The old certificate
   belongs to a key that is gone, so it is dropped: the directory is then half
   registered, and the next register retires that id first. (#3827) */
function abandonChangedIdentity(before, addressBefore, startedAt) {
  if (macIdHere() === before) return;
  stopChild();
  forgetPendingSnapshot();   // #4610 round 1: a failed register that kept a new mac_id is a new identity too
  // The certificate belongs to the ADDRESS (the tunnel keeps it across a register
  // at the same address: setup.rs certificate_survives), so it is dropped only when
  // the address changed; then it is for a name this key no longer holds. And only
  // an OLD one: a register killed after it wrote its new certificate left a whole
  // new identity, which is kept (the certificate is younger than the register).
  let certAt = 0;
  try { certAt = fs.statSync(path.join(STATE_DIR(), 'tls.crt')).mtimeMs; } catch { certAt = 0; }
  if (address() !== addressBefore && certAt && certAt < startedAt) {
    for (const f of ['tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE_DIR(), f), { force: true }); } catch { /* the register writes them again */ } }
  }
  fedSetStanding('');
}
/* kosmos#5871: the id the TUNNEL signs as, by its own rule (engine/enrolment.js currentMacIdBy): from mac_identity,
   which a registration writes first, unless an older tunnel's newer mac_id names another. Reading only mac_id let a
   register cut between the two leave the app and the tunnel naming different computers. */
const macIdHere = () => currentMacIdBy(
  // A missing file is null; any other read failure throws, and the rule then answers no id (the tunnel errors too).
  (f) => { try { return fs.readFileSync(path.join(STATE_DIR(), f), 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; } },
  (f) => { try { return fs.statSync(path.join(STATE_DIR(), f)).mtimeMs; } catch { return null; } });
function cancelledAfter(result, before, addressBefore, startedAt) {
  // Failed after writing a new id: the same clean-up as an uncancelled failure,
  // so no tunnel can later run the new id on the old certificate.
  if (!(result && result.ok)) abandonChangedIdentity(before, addressBefore, startedAt);
  // What is on disk, not only what the program said: a register killed by its
  // bound after it wrote the identity reports a failure and is still set up. But
  // only a NEW identity: a register that failed and changed nothing leaves a Mac
  // that was on, on.
  if ((result && result.ok) || (enrolled() && macIdHere() !== before)) {
    try { write({ on: false }, { repair: true }); } catch { /* status says what happened */ }
    // kosmos#4743: told at the next standing poll, not here (inside the sign-in, like turnOnAfterSignin).
    // Set even if the switch was already off: one extra off check-in, which also tells a new identity.
    flipPending = true;
    stopChild();
    // Another identity now: the previous account's cached standing must not
    // carry over to it (the fed gate reads it).
    if (macIdHere() !== before) { fedSetStanding(''); forgetPendingSnapshot(); }   // #4610
    // kosmos#4743: AFTER fedSetStanding (which stamps standing_at fresh): the stamp is set back past the off
    // cadence, so the off is told by the next standing poll even after a restart (flipPending lives in memory).
    try { write({ standing_at: Date.now() - OFF_STANDING_TTL_MS - 1 }); } catch { /* best-effort */ }
  }
  return SIGNIN_CANCELLED;
}

/** Step one: ask the coordinator to email the six-digit code. Safe to repeat;
    reveals nothing about whether the account exists. A fresh start abandons any
    half-finished flow. */
async function signinStart(email, deviceName) {
  // A register still out would clear this new sign-in's session when it finishes.
  { const b = busy(); if (b) return b; }
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  signinSession = null;
  // kosmos#5422: asking the tunnel for the device arguments waits, so a cancel, or a register or Forget begun in the
  // meantime, is looked for again after it.
  const epoch = signinEpoch;
  const dev = await signinDeviceArgs();
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  { const b = busy(); if (b) return b; }
  if (dev.failed) return dev.failed;
  const args = ['signin', 'start', '--coordinator', COORDINATOR(),
    '--email', email, ...dev.args];
  pushDeviceName(args, deviceName);
  // kosmos#5422: a keyed start can make the key too (the tunnel's start makes a missing one), so Forget waits for it.
  const r = parseSaid(await (dev.args[0] === '--device-key' ? trackKeyCall(setupRun(args)) : setupRun(args)));
  // kosmos#5422: the id (a key's or the opaque one) becomes this computer's once the coordinator has taken a start with
  // it; not after a cancel or a Forget meanwhile (the Forget emptied the folder that held the key).
  if (r.ok && dev.id && epoch === signinEpoch && !forgetting) useDeviceId(dev.id);
  // Deliberately does NOT persist the email. The setup flow writes it because
  // setupComplete reads it back; sign-in carries the email explicitly through
  // verify, so nothing here needs it. Writing it would also make status()'s
  // not-enrolled "waiting for the code sent to <email>" sentence render during
  // sign-in and go stale the moment the flow reaches the phone step, and would
  // leave a stale email behind if the flow is abandoned. The wizard shows the
  // in-flight email itself.
  return r.ok ? { ok: true, because: null, data: { stage: 'code_sent' } } : r;
}

/** Step two: hand back the emailed code. The answer is a finished session, a
    phone challenge (`stage: "second"`), or an enrolment prompt. */
async function signinVerify(email, code, deviceName) {
  { const b = busy(); if (b) return b; }
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  // Taken before anything is awaited (kosmos#5422: the device arguments may ask the tunnel), so a cancel made while
  // this verify waits is seen.
  const epoch = signinEpoch;
  const dev = await signinDeviceArgs(true);
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  { const b = busy(); if (b) return b; }
  if (dev.failed) return dev.failed;
  const args = ['signin', 'verify', '--coordinator', COORDINATOR(),
    '--email', email, ...dev.args, '--code', String(code)];
  pushDeviceName(args, deviceName);
  const r = parseSaid(await setupRun(args));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  // A CLI error (wrong code, coordinator down) is a TRANSIENT "try again" and
  // deliberately leaves any prior held session intact for a retry -- same as
  // signinSecond keeping the challenge on a wrong phone code. Only an untrusted
  // SHAPE (a well-formed exit whose JSON we cannot use) fails closed, and that
  // clearing lives in absorbSession. So "unsuccessful verify" is not "slot
  // cleared"; "unusable answer" is.
  if (!r.ok) return r;
  // kosmos#5422: a verify the coordinator took is a sign-in as the key's id, even when its start was never recorded
  // (the start's answer was lost, or the board restarted while the person fetched the code).
  if (dev.id) useDeviceId(dev.id);
  return absorbSession(r.data);
}

/** Step three (only after `verify` returned `stage: "second"`): the phone code,
    checked against the challenge held here. On success, a session. */
async function signinSecond(code) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.challenge !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no phone step waiting' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(['signin', 'second', '--coordinator', COORDINATOR(),
    '--challenge', signinSession.challenge, '--code', String(code)]));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  return absorbSession(r.data);
}

/** Enrol a second factor (#3149 increment 4), only after `verify` returned
    `enrol_second_factor` -- the account has none and the coordinator requires
    one, so set one up in-app instead of dead-ending. Drives the tunnel `signin
    enrol` verb with the held enrol-only token (piped to stdin, off argv). `kind`
    is "totp" (authenticator app) or "sms" (text message); `phone` is required for
    sms. Returns the coordinator's start-of-enrolment answer for the wizard to
    show: for totp the `secret`/`otpauth` to render as a QR or typed string; for
    sms the masked `sent_to` tail the code went to. The full phone number never
    comes back -- only the masked tail travels. */
async function signinEnrol(kind, phone) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.enrolToken !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no enrolment waiting' };
  }
  if (kind !== 'totp' && kind !== 'sms') {
    return { ok: false, because: 'choose the authenticator app or a text message' };
  }
  const args = ['signin', 'enrol', '--coordinator', COORDINATOR(), '--kind', kind];
  if (kind === 'sms') {
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!trimmedPhone) {
      return { ok: false, because: 'a phone number is needed for a text message' };
    }
    // We do NOT format-check the number (unlike --device-name's strict regex): the
    // coordinator OWNS phone normalization and accepts the spaced/dashed/+ forms a
    // person types, so a shape guard here would wrongly reject valid input. Two argv
    // concerns are worth keeping distinct because they have different mechanisms:
    //   1. Shell injection cannot arise for ANY character -- spawn takes the ARRAY
    //      form, so a character inside one element (even a newline) can never become a
    //      second argv entry. This is the mechanism the --device-name comment gestures
    //      at; array-form is what actually defeats it, not the newline guard itself.
    //   2. A value that STARTS with '-' could be misread by the tunnel CLI's OWN arg
    //      parser as a flag rather than --phone's value -- a parser concern, not a
    //      shell one, and the one thing worth guarding here. No valid phone starts with
    //      '-' (they start with '+' or a digit), so rejecting a leading '-' rejects no
    //      legitimate input. --phone is also pushed LAST, so even a misparse could not
    //      consume a following argument.
    if (trimmedPhone.startsWith('-')) {
      return { ok: false, because: 'that does not look like a phone number' };
    }
    // The phone rides argv and is therefore visible in the local process list (`ps`)
    // for the child's lifetime -- unlike the bearer tokens, which are kept on stdin.
    // This is an ACCEPTED exposure, not an oversight: the phone is not a bearer
    // credential (it cannot admit or authorise anyone), and every non-credential
    // field in the sibling verbs -- email, code, device name -- rides argv the same
    // way. The #874 boundary is about credentials, and no credential is on argv here.
    args.push('--phone', trimmedPhone);
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(args, signinSession.enrolToken));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  // Fail closed if the coordinator's 200 did not carry the material this kind needs
  // (a totp secret/otpauth to show, or the masked sms tail): a clear error beats a
  // blank enrol screen presented as success. We validate the MATERIAL, not d.stage --
  // the tunnel forces stage: "enrolment_started" on this verb, so a stage check could
  // never fire; a missing field is the failure that can actually reach here.
  //
  // ONE predicate ("a usable material string") drives BOTH the presence guard and the
  // copy into out, so the two can never disagree. An earlier split -- a truthiness
  // guard beside a typeof copy -- let an empty string, then a truthy non-string
  // (secret: 123), slip between "believed present" and "actually returned", each
  // yielding the blank screen as a false success. str() collapses that surface: a
  // field is material iff it is a non-empty string, and exactly those get copied.
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  const secret = str(d.secret), otpauth = str(d.otpauth), sentTo = str(d.sent_to);
  if (kind === 'totp' && !secret && !otpauth) {
    return { ok: false, because: 'Kosmos+ sign-in did not return an authenticator secret to set up' };
  }
  if (kind === 'sms' && !sentTo) {
    return { ok: false, because: 'Kosmos+ sign-in did not confirm where the code was sent' };
  }
  const out = {
    stage: 'enrolment_started',
    kind,  // the locally-validated kind we requested, never the coordinator's echo
    why_authenticator: typeof d.why_authenticator === 'string' ? d.why_authenticator : '',
  };
  // Copy only THIS kind's material, mirroring the kind-scoped guard above: totp gets
  // the secret/otpauth to scan or type, sms gets only the masked tail. Gating by kind
  // (not a flat copy) means a stray wrong-kind field the coordinator happens to send
  // -- a secret on an sms answer, a tail on a totp answer -- cannot bleed into the
  // page; we present exactly the material the guard just accepted, never the other.
  if (kind === 'totp') {
    if (secret) out.secret = secret;
    if (otpauth) out.otpauth = otpauth;
  } else if (kind === 'sms') {
    if (sentTo) out.sent_to = sentTo;
  }
  return { ok: true, because: null, data: out };
}

/** Confirm the enrolment code the new factor now shows (the authenticator app's
    code, or the texted SMS code). Drives `signin confirm-enrol` with the held
    enrol-only token; on success the coordinator sets the factor and issues the
    person's FIRST session, which absorbSession captures exactly like verify /
    second, so the wizard proceeds to `register`. */
async function signinConfirmEnrol(code) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.enrolToken !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no enrolment waiting' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(['signin', 'confirm-enrol', '--coordinator', COORDINATOR(),
    '--code', String(code)], signinSession.enrolToken));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  // The confirm answer is a session; absorbSession swaps the held enrol token for
  // the session token (fail-closed on a malformed shape), so register spends it.
  return absorbSession(r.data);
}

/** Last step: register THIS computer with the session held here. The keypair is
    born in the binary (private half never travels); the token is piped in over
    stdin, off argv. On success the state dir is written and the tunnel comes up
    if the switch is on, exactly as `setup complete` does. A failed register
    keeps the session so the person can pick another name without redoing the
    code steps. */
/* #3827: a register in flight (forget() waits for it), and the bound on a register
   or a retire, so neither a hung coordinator nor a hung connector can hang Forget. */
let registerInFlight = null;
let forgetting = false;
// A healthy register includes the certificate, which holds the call open for the
// ACME propagation wait (a minute or two; 65s measured on production 2026-09-25).
// So the bound is generous: it exists only so a HUNG one cannot hang Forget.
const REGISTER_TIMEOUT_MS = 5 * 60 * 1000;
// Env seam for tests, like AGENT_WORKFORCE_TUNNEL_BIN. (0 or unset: the default.)
const registerTimeoutMs = () => {
  const v = Number(process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : REGISTER_TIMEOUT_MS;   // never "no bound"
};
// A retire is one signed round trip, not a certificate: its own bound, so a hung
// coordinator holds "still signing in" for a minute, not five. Never longer than
// the register's (tests shorten both through the register seam).
const RETIRE_TIMEOUT_MS = 60 * 1000;
const retireTimeoutMs = () => {
  const v = Number(process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS);
  return Math.min(Number.isFinite(v) && v > 0 ? v : RETIRE_TIMEOUT_MS, registerTimeoutMs());
};
// A Mac key and id with no certificate: a register that was cut off after the
// coordinator accepted it. It is registered there, so registering again would strand
// it (or meet "already owns the name"); Forget retires it.
// Exactly that: key and id, and no certificate. A Mac with its certificate is not
// half anything (a missing address file alone must never retire and wipe it).
// kosmos#4737: nor is a computer waiting to be allowed. Its registration was accepted with no
// certificate on purpose and the tunnel marked it `held`; retiring it here would remove the very
// computer the owner is about to allow. With its address that folder is enrolled() already; this
// clause adds only the mark beside a missing address file, which is kept, as #3827 keeps a missing
// address beside a certificate.
const halfRegistered = () => !enrolled()
  && holdsKey()
  && !inState(HELD_FILE)
  // The certificate is tls.crt; the tunnel writes tls.key first, so a kill between
  // the two leaves a key and no certificate, which is still half registered.
  && !fs.existsSync(path.join(STATE_DIR(), 'tls.crt'));
/* Why a retire failed, in one line a person can read: the tunnel's "Kosmos+ ..."
   line, not setupRun's last stderr line (a gateway's HTML page ends "</html>"),
   without "Error: " and without a raw body after ": <". */
function retireReason(r) {
  const lines = String((r && r.stderr) || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /Kosmos\+ /.test(l)) || String((r && r.because) || 'no reason given');
  return line.replace(/^Error:\s*/, '').replace(/:\s*<[\s\S]*$/, '').slice(0, 200);
}
/* kosmos#6390: Kosmos+ refused this computer's retire because it was retired already (removed on the account page).
   That is the outcome a retire asks for, not a failure. The coordinator keeps the code (mac_retired) off the wire, so
   this reads its sentence (relay auth.rs: "this computer was retired"; "this Mac" is the older wording), and only for a
   401 on the retire route itself. The relay pins that sentence on its side (fedroom.rs
   the_coordinators_retired_answer_is_final_here, person_copy_4628.rs); nothing in this repo reads auth.rs, so a
   reworded sentence would bring back the old message here, never a wrong "retired". engine/fedseats.js
   MAC_LEVEL_REFUSAL matches the same sentence among others; a reword changes both. */
function retiredAlready(r) {
  const said = String((r && r.stderr) || '');
  // One line, as the tunnel writes a refusal (refusal_error): its prefix ("this Mac", or "this computer" on Windows), a
  // sentence starting with the coordinator's words, then the status and the route, all on that line.
  return /^(?:Error: )?Kosmos\+ refused this (?:Mac|computer): this (?:computer|Mac) was retired\b[^\n]*\(HTTP 401 on \/v1\/mac\/retire\)\s*$/m.test(said);
}
/* The one retire of this Mac at Kosmos+, signed with its own key. */
const retireHere = () => setupRun(['retire', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], null, retireTimeoutMs());
// 408 and 429 are "not now", not "no": retried like a server error.
const RETIRE_TRANSIENT = /unreachable|did not answer in time|could not be started|\(HTTP (5\d\d|408|429) on |answered (5\d\d|408|429) for /i;
/* The line of a failed retire that says it may work a moment later, or null. Named from what the tunnel prints
   (crates/tunnel coordinator.rs signed_request: "Kosmos+ unreachable for", "(HTTP <code> on", "Kosmos+ answered
   <code> for") and from setupRun's own answers. The whole output, not only its last line: a gateway's HTML error
   page is many lines, and its last one ("</html>") says nothing. */
function retireTransient(r) {
  if (!r || r.ok) return null;
  return String((r.stderr || '') + '\n' + (r.because || '')).split('\n').find((l) => RETIRE_TRANSIENT.test(l)) || null;
}
/* Retires a half identity before a new register. Answers why the retire failed
   (the coordinator may still hold that earlier attempt), or null. */
async function clearHalfIdentity() {
  if (!halfRegistered()) return null;
  // kosmos#4277: a half-registered board sends a key-only report every five minutes,
  // and this is exactly when a person signs in again. Let a signed call already out finish before
  // the retire and the wipe below, as Forget does. Bounded: each tracked call carries its own kill
  // timeout. No new one starts meanwhile: the register is out, and macRequest refuses while busy().
  if (signedInFlight.size) await Promise.allSettled([...signedInFlight]);
  const r = await retireHere();
  // No answer (timed out, unreachable, the program would not start, a server
  // error) may work a moment later, and only this key can do it: keep it, and the
  // caller says try again. Anything else is final (Kosmos+ refused this Mac, a
  // key this computer cannot read), so it is wiped: keeping it would say "try
  // again" forever. Forget makes the same split (kosmos#6389).
  const transient = retireTransient(r);
  if (transient) {
    process.stderr.write('remote: an unfinished earlier sign-in could not be retired at Kosmos+ yet (' + transient.trim() + '); kept, so a retry can\n');
    return { kept: retireReason(r) };
  }
  if (!r.ok) process.stderr.write('remote: an unfinished earlier sign-in could not be retired at Kosmos+ (' + r.because + '); its address may show on the account page until it is removed there\n');
  /* kosmos#5422: the sign-in's device key lives in this folder too and is not part of the half identity: it is the
     device the person just signed in as. The folder is emptied entry by entry around it, so finishing a sign-in does
     not make this computer another device next time; the key file itself is never rewritten (a rewrite would lose
     the tunnel's Windows ACL). */
  // The key file is never touched: its contents and its owner-only protection (on Windows an ACL) stay.
  clearStateDir([path.basename(DEVICE_KEY_FILE())]);
  secureStateDir();
  return r.ok ? null : { stranded: retireReason(r) };
}
/* The register's answer when a half identity was kept for a retry. */
const KEPT_HALF = (why) => ({ ok: false, because: 'an earlier sign-in on this computer could not be removed from your Kosmos+ account yet (' + why + '); try again in a moment' });
/* After a half identity could not be retired, a "name taken" answer is most
   likely this computer's own earlier attempt, not another Mac: say so, and
   what to do, instead of letting it read as someone else's name. */
function explainStranded(result, half, name) {
  const stranded = half && half.stranded;
  // Only the same-account answer: another account's name ("that name is taken")
  // or this account's own name rule is not this computer's doing. #4645: "a Mac" is
  // the coordinator's wording today and "a computer" the wording it can move to once
  // installs carry this reader; both are the same answer.
  if (!stranded || !result || result.ok || !/already in use by a (?:Mac|computer) on this account/i.test(String(result.because || ''))) return result;
  // Replaced, not added to: the coordinator's sentence ("If that is this Mac, it
  // is already signed in / set up") is false here. The retire's reason went to
  // the log in clearHalfIdentity.
  return { ...result, because: 'The name ' + name + ' may be held by an earlier sign-in on this computer that Kosmos+ could not remove. Remove it on your account page, or pick another name.' };
}
function busy() {
  // Forgetting first: while a Forget waits on a register both are true, and the
  // Forget is what the person just asked for.
  if (forgetting) return { ok: false, because: 'this computer is being forgotten; try again in a moment' };
  if (registerInFlight) return { ok: false, because: 'this computer is still signing in; give it a minute' };
  return null;
}
/* #3827: signing in IS asking to be reachable, so a successful register switches
   Kosmos+ on. A failed save is logged: the Mac is registered either way, and the
   switch then still says off. */
function turnOnAfterSignin() {
  const before = read();
  const wrote = write({ on: true }, { repair: true });
  if (!wrote.ok) { process.stderr.write('remote: signed in, but could not switch Kosmos+ on: ' + wrote.because + '\n'); return; }
  // kosmos#4743: an off-to-on flip made by signing in makes the NEXT standing poll due at once, whatever
  // its stamp (the account page would otherwise read "Remote access off" until the next on-cadence
  // refresh). Not asked here: a signed call started inside the sign-in would hold up a Forget right
  // after it, which waits for signed calls in flight before it switches off. (A refresh already out when
  // this runs still re-asks when it ends, once the register has finished: the same narrow window any
  // signed call in flight has.)
  if (!(before.ok === true && before.on === true)) flipPending = true;
}

/* kosmos#4754 / #4756 (Josh 2026-09-30, ruling "A"): a new computer is a purchase. Once the coordinator
   says bought addresses are live (/v1/meta bought_addresses, or AGENT_WORKFORCE_BOUGHT_ADDRESSES=1 to test),
   a computer signs in to an address the account has BOUGHT and never makes one, so the wizard needs the
   account's addresses at the session step, before register. The list (the coordinator's GET
   /v1/account/addresses, contract on kosmos#4754) is read THROUGH THE TUNNEL BINARY, as register is: the
   session token goes on stdin, never argv, and the binary reaches the coordinator on its pinned key. Only the
   switch itself is a plain request (fetchMetaFlag), because it carries no credential. A binary without the
   `signin addresses` verb fails the read, and the page then takes the step as before.
   Answers { live:false } with the switch off (the wizard is exactly as before), else the rows in their own
   shapes only, the website's buy link (https only), and this computer's own name if it is set up. */
const BOUGHT_STATES = new Set(['in_use', 'free', 'pending']);
// The switch read, the list read and setupRun's close grace after the binary exits, together, leave at least a second
// of the page's PLUS_ASK_TIMEOUT_MS (engine/remote.test.js asserts it against web/index.html).
const ADDR_META_MS = 1500, ADDR_READ_MS = 10200;
// kosmos#6314: a price.display the page may show: a short currency mark, an amount, and a period ("$20/month", "$19.99/3 months").
const PRICE_SHAPE = /^[^\s\d<>"'&]{1,3}\d{1,7}(?:[.,]\d{1,3})?\/(?:(?:day|week|month|year)|[2-9] (?:day|week|month|year)s|1[0-2] (?:day|week|month|year)s)$/;
let addressesInFlight = null;   // { token, run }: one read at a time per sign-in; a second caller of the SAME one shares it
async function signinAddresses(opts) {
  const token = signinSession && typeof signinSession.token === 'string' ? signinSession.token : null;
  if (token && addressesInFlight && addressesInFlight.token === token && !(opts && (opts.fetch || opts.timeoutMs))) return addressesInFlight.run;
  const run = signinAddressesOnce(opts);
  if (opts && (opts.fetch || opts.timeoutMs)) return run;   // a test seam neither joins nor is joined
  const mine = { token, run };
  addressesInFlight = mine;
  try { return await run; } finally { if (addressesInFlight === mine) addressesInFlight = null; }
}
async function signinAddressesOnce(opts) {
  opts = opts || {};
  const get = typeof opts.fetch === 'function' ? opts.fetch : fetch;
  // No session, no call at all (not even /v1/meta): there is nothing to list without one.
  if (!signinSession || typeof signinSession.token !== 'string') return { ok: false, because: 'finish the code steps first' };
  const token = signinSession.token;   // taken now: a Sign out during the switch read below must not throw here
  // AGENT_WORKFORCE_BOUGHT_ADDRESSES=1 is for testing against a coordinator whose switch is off; it only changes what the
  // step offers (the coordinator still refuses an address not bought).
  const flag = process.env.AGENT_WORKFORCE_BOUGHT_ADDRESSES === '1' ? true
    : await fetchMetaFlag('bought_addresses', { fetch: get, timeoutMs: opts.timeoutMs || ADDR_META_MS, unread: 'unread' });
  // A switch that could not be read is not a switch that is off: the page then takes the step as before, as for a
  // list it could not read, and keeps the way back to the list a refusal needs.
  if (flag === 'unread') return { ok: false, because: 'Kosmos+ could not be reached to check for bought addresses' };
  if (flag !== true) return { ok: true, because: null, data: { live: false } };
  if (!signinSession || signinSession.token !== token) return { ok: false, because: 'the sign-in ended; start again from the email' };
  const ran = await setupRun(['signin', 'addresses', '--coordinator', COORDINATOR()], token, opts.timeoutMs || ADDR_READ_MS);
  // A sign-out, or another sign-in, while the binary ran: this answer is not theirs.
  if (!signinSession || signinSession.token !== token) return { ok: false, because: 'the sign-in ended; start again from the email' };
  if (!ran.ok) {
    /* A tunnel binary older than the verb: clap prints "unrecognized subcommand" first and its usage after, so the
       last line alone never says so (the same reading as assistantChat's). */
    if (/unrecognized subcommand|invalid subcommand/i.test(String(ran.stderr || '') + '\n' + String(ran.because || ''))) {
      return { ok: false, unsupported: true, because: 'this version of Kosmos cannot list your addresses yet; update Kosmos' };
    }
    return { ok: false, because: String(ran.because || 'Kosmos+ could not list your addresses').slice(0, 300) };
  }
  const r = parseSaid(ran);
  if (!r.ok) return { ok: false, because: String(r.because || 'Kosmos+ could not list your addresses').slice(0, 300) };
  const body = r.data;
  const rows = (body && Array.isArray(body.addresses) ? body.addresses : [])
    .filter((x) => x && NAME_RULE.test(String(x.name)) && BOUGHT_STATES.has(x.state)
      && typeof x.address === 'string' && /^[a-z0-9-]{3,32}\.[a-z0-9.-]{3,253}$/.test(x.address) && x.address.split('.')[0] === x.name)
    /* first_free: this row is the account's free first address (neither bought nor grandfathered). The server's own
       first_free wins when it sends one; else only a row that SAYS bought_at null and grandfathered false counts. A row
       missing either field is not counted, so the page tries the name step and the coordinator's 402 not-bought is the
       gate, rather than telling someone to buy the address their subscription pays for. */
    .map((x) => ({ name: x.name, address: x.address, state: x.state,
      first_free: typeof x.first_free === 'boolean' ? x.first_free : (x.bought_at === null && x.grandfathered === false) }));
  const buy = body && typeof body.buy_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(body.buy_url) ? body.buy_url : '';
  const here = enrolled() ? String(address() || '').split('.')[0] : '';
  /* kosmos#6314: what one more computer costs, as Stripe says it (the coordinator's price.display, "$20/month"), so
     the page can say so before it sends anyone to pay, without keeping a number of its own. Only an amount over a
     plain period passes; anything else (none sent, Stripe unread, an odd shape) is '' and the page says no figure. */
  const said = body && body.price && typeof body.price.display === 'string' ? body.price.display : '';
  const price = PRICE_SHAPE.test(said) ? said : '';
  return { ok: true, because: null, data: { live: true, addresses: rows, buy_url: buy, price, this_name: NAME_RULE.test(here) ? here : '' } };
}

async function signinRegister(name) {
  // First, before every path (the #1010 shortcut included): one register at a time (a
  // page that lost its connection can press Try again while the first is still
  // out, and a second must not start into the same directory), and none while
  // this computer is being forgotten.
  { const b = busy(); if (b) return b; }
  /* #3796 addendum 6 (Josh: "support either capital or lowercase"): the coordinator lowercases a
     name anyway, so only this app refused "MacbookPro". Lowercase (and trim) BEFORE the rule. */
  if (typeof name === 'string') name = name.trim().toLowerCase();
  if (typeof name !== 'string' || !NAME_RULE.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 letters, digits or hyphens' };
  }
  // #1010/#1003: a surviving state dir already at this name IS this Mac. Do not
  // re-register -- it would mint a fresh identity key and spend a scarce
  // certificate for this Mac's own previous life. Recognise it, bring the tunnel
  // up, done. A DIFFERENT name is a real move and falls through to register.
  //
  // ACCOUNT-SWITCH EDGE (by design, the same one setupComplete documents, and
  // more reachable here since journey 2 is specifically "sign in an existing
  // account"): if the surviving state is account A at name X and someone signs
  // in as account B but registers at the SAME name X, this recognises the Mac
  // and KEEPS account A's enrolment -- account B's held session is never spent.
  // Switching the account on a Mac is what forget() (which wipes the state dir)
  // is for; once the state is gone, enrolled() is false and this guard does not
  // fire.
  // Without a session (a Try again after the page gave up) only when the switch is
  // already on: after a Sign out it is off on purpose, and this would undo it.
  if (enrolled() && ((signinSession && typeof signinSession.token === 'string') || read().on === true)) {
    const have = address();
    if (have && have.split('.')[0] === name) {
      /* #3827: signing in IS asking to be reachable; ensure() only starts the tunnel when switched on. */
      // kosmos#5786 (b): only when this call spent a real sign-in (the code steps). A Try again with Kosmos+ already on
      // (no session) does not mint a secret, so no local caller can re-open the browser by repeating it.
      const spentSignin = !!(signinSession && typeof signinSession.token === 'string');
      turnOnAfterSignin();
      ensure(localPort);
      signinSession = null;
      if (spentSignin) startVouch();
      // standing is '' on this path, not omitted: the engine cannot know it
      // without the coordinator round-trip this short-circuit skips, and a
      // uniform shape (always a standing key) is easier for the wizard than a
      // sometimes-absent field. 3b treats '' as "unknown, ask on next check".
      return { ok: true, because: null, data: { stage: 'registered', address: have, name, standing: '', alreadySetUp: true } };
    }
  }
  // After the shortcut: a register the page gave up on (a dropped connection, a
  // closed tab) finishes, clears the session and is set up;
  // a Try again at the same name is answered above, not sent to the code steps.
  if (!signinSession || typeof signinSession.token !== 'string') {
    // Already set up at exactly this name, switched off, no sign-in running (a
    // stale Try again, a board restart): the code steps would change nothing.
    const have = enrolled() ? address() : null;
    if (have && have.split('.')[0] === name) {
      return { ok: false, because: 'this computer is already signed in as ' + have + '; turn Kosmos+ on in Settings to be reachable' };
    }
    return { ok: false, because: 'finish the code steps first' };
  }
  secureStateDir();
  // Like every other step: a Sign out (or a Forget) that lands while register is
  // waiting on the connector must not be followed by this turning Kosmos+ on.
  const epoch = signinEpoch;
  const token = signinSession.token;
  const before = macIdHere();
  const addressBefore = address();
  const startedAt = Date.now();
  const running = (async () => {
    // An earlier register that stopped after the coordinator accepted it (key and
    // id, no certificate) is retired first, so this one does not strand it.
    const half = await clearHalfIdentity();
    if (half && half.kept) return KEPT_HALF(half.kept);
    // A Sign out or Forget during that retire (up to a minute): the register has
    // not been sent yet, so it is not sent at all.
    if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
    return explainStranded(await setupRun(['signin', 'register', '--coordinator', COORDINATOR(),
      '--name', name, '--state-dir', STATE_DIR()], token, registerTimeoutMs(), { register: true }), half, name);
  })();
  registerInFlight = running;
  const offAt = offEpoch;
  let r;
  try { r = parseSaid(await running); } finally { if (registerInFlight === running) registerInFlight = null; }
  // A cancel after the coordinator accepted the register cannot undo it: the Mac is
  // registered and the next paint shows the switch OFF, which is the truth. What a
  // cancel must never do is let this switch it on.
  if (epoch !== signinEpoch) return cancelledAfter(r, before, addressBefore, startedAt);
  if (!r.ok) {
    abandonChangedIdentity(before, addressBefore, startedAt);
    return withKeyChange(r);
  }
  lastOffered = null;   // kosmos#6596 step 8: a registration that went through ends any offer and acceptance
  acceptedKey = null;
  signinSession = null;   // the token is spent; it must not linger in this process
  /* #3827 (Josh's live test: registered, then the relay never heard from this Mac): ensure() starts the
     tunnel only when switched ON, and nothing set it, so the pane showed "Turn on" and the wizard's
     "connecting" was false. Signing in IS asking to be reachable; turning off stays one press away.
     Unless the person pressed that off while this register was out: that stands. */
  // A new identity: a tunnel still running the old one (or started on it) stops,
  // so ensure() below brings it up on the new key and certificate.
  if (macIdHere() !== before) { stopChild(); forgetPendingSnapshot(); }   // #4610
  /* #4610 (Josh's ruling): grant this Mac's own sign-in now. After this call returns, so the register's in-flight
     flag (busy) is cleared, and a fresh identity may be granted at once (the retry window starts over). */
  resetSelfGrant();
  setImmediate(allowSelfQuietly);
  startVouch();   // kosmos#5786 (b): after resetSelfGrant, so its epoch is this sign-in's
  const switchedOn = offEpoch === offAt;
  if (switchedOn) turnOnAfterSignin();
  registerTakesOver();   // kosmos#4277: the register's start is not a relaunch
  ensure(localPort);
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  fedSetStanding(d.standing);   // fed gate: SET (or clear) standing from this fresh register
  return { ok: true, because: null, data: {
    stage: 'registered',
    address: typeof d.address === 'string' ? d.address : address(),
    name: typeof d.name === 'string' ? d.name : name,
    standing: typeof d.standing === 'string' ? d.standing : '',
    // False when the person turned Kosmos+ off while this was out: the page must
    // not say "connecting" about a switch that is off.
    switchedOn,
  } };
}

module.exports = {
  cloudKeepsOn, clearStateDir, offeredKeyIn, acceptOfferedKey, OFFERED_KEY_LABEL /* kosmos#6596 step 8 */, connectorCapabilities, warmConnectorCapabilities, askConnectorCapabilities, forgetConnectorCapabilities, resetConnectorCapabilitiesForTests /* kosmos#6595 R01 */, endForeignTunnel, isOrphanedTunnel /* kosmos#6669 */, computerNameShown, computerNameChoice, canKeepComputerNameChoice, keepComputerNameChoice /* #5995 */, macIdHere, ADDR_META_MS, ADDR_READ_MS, SETUP_CLOSE_GRACE_MS, OFF_STANDING_TTL_MS, OFF_RETRY_MS, COORDINATOR, fedSeatArgs, fetchFederationLive, fetchMetaFlag, signinAddresses, thisComputerDeviceName, deviceNameFrom, lastJsonLine, secondReset, forget, macRequest, assistantChat, hostedAvailable, DEFAULT_RELAY, DEFAULT_COORDINATOR, configured, connectorFile,
  FILE,
  read,
  ownDeviceIds,
  kosmosPlus,
  fedSetStanding,
  refreshStandingIfStale,
  startReportTimer,
  REPORT_INTERVAL_MS,
  REPORT_TTL_MS,
  REPORT_FIRST_MS,
  federationLive,
  refreshFederationLiveIfStale,
  setOn,
  setRelay,
  enrolled,
  spawnFedSeat,
  address,
  certWatch, setCertWatch, ackCertWatchLost, serviceKeys,
  ensure,
  status,
  setupStart,
  setupComplete,
  managedOrg,
  companyStart,
  companyStatus,
  companyComplete,
  companySecond,
  companyOpen,
  signinStart,
  signinVerify,
  signinSecond,
  signinEnrol,
  signinConfirmEnrol,
  signinRegister,
  signinCancel,
  pendingDevices,
  devicesList,
  deviceAllow,
  joinStatus,
  joinConfirm,
  joinRetry,
  openTicket,
  tlsPin, TLS_PIN_TTL_MS, warmTlsPins, forgetTlsPins /* kosmos#6589 */,
  joinRecheck,
  deviceDeny,
  deviceRemove,
  /* #988: ONE derivation of each of these, for the same reason the #790 comment
     above gives. engine/updating.js speaks to the coordinator directly and must
     not re-derive either, or the two disagree the moment one of them learns
     something. */
  coordinator: COORDINATOR,
  stateDir: STATE_DIR,
  /* kosmos#4277: the supervisor's relaunch count, read by engine/remote-report.js. */
  restartCount: () => restarts,
  /* kosmos#4277: the current tunnel process's last failure sentence, for
     engine/remote-report.js to classify. Never sent as text. */
  lastTunnelFailure: () => lastTunnelFailure,
  /* kosmos#4640: the waiting-to-be-allowed refusal's sentence, or null (pure; tests pin both spellings). */
  allowWaitSentence,
  /* How long the current tunnel process has been dialling without being up, in ms, or null. */
  dialingForMs: () => (dialingSince === null ? null : performance.now() - dialingSince),
  holdsKey,
  stateDirIsCustom: STATE_DIR_IS_CUSTOM,
  /* kosmos#4277: whether the supervisor's tunnel process is up ('alive'), dead with a
     relaunch scheduled ('waiting'), or not running ('none'). This, not status(), says whether a
     relaunch held: status() reads `restarting` for the tunnel's own in-process reconnects too. */
  supervisorState: () => (restartTimer ? 'waiting' : (child ? 'alive' : 'none')),
  KEY_ONLY_ROUTE,
  ENROL_FILES,
  /* test seam: stops the supervised child between cases (the name is the
     one the reachability sweep excuses for exactly this job) AND clears any
     in-flight sign-in and the device-id memo, so neither a held token/challenge
     nor a memoised device id leaks across cases. */
  turnOnAfterSigninForTests: turnOnAfterSignin,   // kosmos#4743: tests only (it skips setOn's busy() check)
  cancelledAfterForTests: cancelledAfter,   // kosmos#4743: tests only
  standingQuietForTests: () => !standingRefreshInFlight && !flipPending,   // kosmos#4743: tests wait on it
  standingOutForTests: () => standingRefreshInFlight,   // kosmos#4743: a test waits out a refresh another left
  bumpSelfEpochForTests: () => { selfEpoch += 1; },
  resetForTests: () => { acceptedKey = null; lastOffered = null; tlsPinCache.clear(); tlsPinInFlight.clear(); tlsPinWarmQuiet.clear(); tlsPinSaidAt.clear(); vouchAllowingId = ''; notMeDuringVouch.clear(); lastVouched = null; flipPending = false; standingRefreshInFlight = false; lastTunnelFailure = null; dialingSince = null; notEnrolledReportAt = 0; notEnrolledReportInFlight = false; notEnrolledLastLogged = null; setupSpawn = spawn; companySetup = null; companyFinishing = null; companyOpenCommandForTests = null; companyOpenSourceForTests = null; companyOpenedAt = 0; companySecondInFlight = null; companyStartInFlight = null; companyStatusInFlight = null; managedReader = defaultManagedReader; managedCache = null; signinSession = null; mintedDeviceId = null; heldIdentity = null; registerInFlight = null; addressesInFlight = null; forgetInFlight = null; forgetting = false; signedInFlight.clear(); resetSelfGrant(); stopVouch(); vouchOpenedUrl = ''; flushWaiting(); waitingInFlight = null; stopChild(); },
  vouchTickForTests: () => vouchTick(),
  vouchSecretForTests: () => (vouchState ? vouchState.secret : null),
  vouchOpenedUrlForTests: () => vouchOpenedUrl,
  vouchAllowingIdForTests: () => vouchAllowingId,   // kosmos#6407
  vouchUntilForTests: () => (vouchState ? vouchState.until : 0),
  recentlyVouchedForTests: (settings) => recentlyVouched(settings),
  vouchPatchForTests: (patch) => { if (vouchState && patch) Object.assign(vouchState, patch); },   // kosmos#6599
  setSetupSpawnForTests: (fn) => { setupSpawn = fn; },
  boardV2, listedAsComputer, devicesWaiting, deviceAllowCode, deviceDropWaiting, devicesClearWaiting, deviceCtAck,   // kosmos#6590 branch c
  deviceAckSelfForTests: deviceAckSelf, allowSelfQuietlyForTests: allowSelfQuietly,   // kosmos#6590 c2
  startVouchForTests: () => { startVouch(); return vouchState ? vouchState.secret : null; },   // kosmos#6590 c3
  setManagedReaderForTests: (fn) => { managedReader = fn; managedCache = null; },
  setCompanyOpenCommandForTests: (argv) => { companyOpenCommandForTests = argv || null; },
  setCompanyOpenSourceForTests: (src) => { companyOpenSourceForTests = src || null; },
  /* kosmos#4597 test seam: where an app keeps its connector, asked for a given app dir and platform. */
  bundledConnector,
  /* test seam: the live child's pid, or null. spawn() sets the handle
     synchronously, so a test can assert "nothing spawned" deterministically
     right after ensure() instead of waiting a fixed interval and hoping. */
  currentChildPid: () => (child ? child.pid : null),
};
