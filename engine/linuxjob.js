'use strict';
/**
 * Systemd user units for Kosmos agents on Linux.
 *
 * The Linux equivalent of macOS LaunchAgents (~/Library/LaunchAgents/*.plist)
 * and Windows Scheduled Tasks (Kosmos\agent-*).
 *
 * Each agent runs bin/agent-supervisor.sh under a user unit:
 *   ~/.config/systemd/user/kosmos-agent-<session>.service
 * with Restart=always, RestartSec=10, and KillMode=process.
 *
 * Systemd user units run without sudo/root privileges via systemctl --user,
 * and survive disconnect/logout when linger is on (loginctl enable-linger, read back; the person is told when it is off).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launchidentity = require('./launchidentity');
const accountenv = require('./accountenv');


/* The real unit folder, ONE definition (#4918 review 11: it was pasted four times across two files). linuxboard.js
   uses it too. A sandboxed board (AGENT_WORKFORCE_LAUNCH, as create.agentsDir honours on the Mac) keeps its units in
   the sandbox, where systemd never reads them (review 5). */
function defaultSystemdDir() {
  if (process.env.AGENT_WORKFORCE_SYSTEMD_DIR) return process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  if (process.env.AGENT_WORKFORCE_LAUNCH) return path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
  /* ~/.config, never the board's own XDG_CONFIG_HOME (review 19): the user manager is started by PAM without the
     person's shell profile, so an XDG_CONFIG_HOME exported in .bashrc names a folder systemd never reads, and every
     enable would fail with "Unit file ... does not exist". */
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

let systemdDirFn = defaultSystemdDir;

function systemdDir() {
  return systemdDirFn();
}

let systemdDirOverridden = false;
function setSystemdDirForTests(fn) {
  systemdDirOverridden = typeof fn === 'function';
  systemdDirFn = typeof fn === 'function' ? fn : defaultSystemdDir;
}

/* #4918 review 12/13: systemctl --user finds the user manager through XDG_RUNTIME_DIR, which a board started from cron or
   after its login session ended does not have. The standard place is /run/user/<uid>: set it on this process when it
   is unset and exists, so EVERY Linux path's systemctl inherits it, including the ones that run through create's,
   remove's and delete-leftover's own run(). Linux only; a no-op elsewhere. */
function ensureRuntimeDir() {
  if (process.platform !== 'linux' || process.env.XDG_RUNTIME_DIR || typeof process.getuid !== 'function') return;
  const rd = '/run/user/' + process.getuid();
  try { if (fs.statSync(rd).isDirectory()) process.env.XDG_RUNTIME_DIR = rd; } catch { /* none: as before */ }
}

/* The real systemctl/loginctl runner, ONE definition, shared with linuxboard.js. A test that forgot its seam never
   reaches the host's systemd (live-execution #1598, test half; production unchanged; review 1). 30 s: a stop waits
   on the supervisor's sleep (up to 10 s; review 6). */
function realRunner(cmd, args) {
  if (require('./live-execution').inTestProcess()) require('./live-execution').refuseOrWarn('engine/linuxjob.js', cmd, args);
  /* #4918 review 12: systemctl --user finds the user manager through XDG_RUNTIME_DIR, which a board started from cron
     or after its login session ended does not have. The standard place is /run/user/<uid>; use it when it exists. */
  ensureRuntimeDir();
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (err) {
    return {
      ok: false,
      code: err && err.status != null ? err.status : 1,
      stderr: (err && err.stderr) ? String(err.stderr) : '',
      stdout: (err && err.stdout) ? String(err.stdout) : '',
      because: (err && err.message) || String(err),
    };
  }
}

let runnerFn = realRunner;

/* #4918 review 6: a caller with its own command seam (remove.js's run: setRunner, dry run, the live gate) runs
   these ops through it, so a dry-run or sandboxed board never reaches the real user manager by unit name. */
let runOverride = null;
/* review 21: a SANDBOXED board (AGENT_WORKFORCE_LAUNCH, no deliberate AGENT_WORKFORCE_SYSTEMD_DIR) keeps its units where
   systemd never reads them, and systemctl names units in the person's REAL user manager. It never acts on a unit by
   name from a sandbox: that could re-enable a real removed agent of the same name. */
function sandboxedWithoutSystemd() {
  return Boolean(process.env.AGENT_WORKFORCE_LAUNCH) && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !systemdDirOverridden;
}
function runner(cmd, args) {
  if (sandboxedWithoutSystemd()) return { ok: false, code: 1, stdout: '', stderr: '', because: 'a sandboxed board does not manage real systemd units' };
  return runOverride ? runOverride(cmd, args) : runnerFn(cmd, args);
}
function runWith(fn, body) {
  const prev = runOverride;
  runOverride = fn;
  try { return body(); } finally { runOverride = prev; }
}

function setRunnerForTests(fn) {
  runnerFn = typeof fn === 'function' ? fn : realRunner;
}

/* systemd accepts only letters, digits and ":_.-" in a unit name (and "\\" from its own escaping). A named world's launch key
   carries "+" (launchidentity.WORLD_SEPARATOR), so every other character is written the way systemd-escape writes it,
   "\\xHH". The tmux session name is the launch key itself; only the unit name is escaped. */
function escapeUnitNamePart(s) {
  return String(s).replace(/[^A-Za-z0-9:_.-]/g, (c) => Buffer.from(c, 'utf8').toString('hex').replace(/../g, (h) => `\\x${h}`));
}

function unitName(name, worldId) {
  const world = worldId === undefined ? launchidentity.currentWorldId() : worldId;
  const session = launchidentity.launchKey(name, world);
  return `kosmos-agent-${escapeUnitNamePart(session)}.service`;
}

/* #4918 review 8: the world a unit name belongs to, read back from the name itself (the inverse of unitName), so
   a record that kept only the label acts on THAT world's unit, not the current one. null when it is not ours. */
function keyFromUnitName(label) {
  const m = /^kosmos-agent-(.+)\.service$/.exec(String(label || ''));
  if (!m) return null;
  return m[1].replace(/((?:\\x[0-9a-f]{2})+)/gi, (seq) => Buffer.from(seq.replace(/\\x/gi, ''), 'hex').toString('utf8'));
}
function worldFromUnitName(label) {
  const key = keyFromUnitName(label);
  return key === null ? null : launchidentity.parseKey(key).worldId;
}

/* #5445 (display parity): every Kosmos agent unit in the unit folder, as { name, worldId, file }, read back from the
   unit name (the inverse of unitName). The Mac's listings read the LaunchAgents folder's .plist names the same way.
   A name that does not round-trip (unitName of what it decodes to is not the file) is not ours. Throws when the folder
   cannot be read for any reason but its absence, so a caller can tell "none" from "could not look". */
function listUnits() {
  let files;
  try { files = fs.readdirSync(systemdDir()); } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const f of files) {
    const key = keyFromUnitName(f);
    if (key === null) continue;
    const { name, worldId } = launchidentity.parseKey(key);
    let back;
    try { back = unitName(name, worldId); } catch { continue; }
    if (back !== f) continue;
    out.push({ name, worldId, file: path.join(systemdDir(), f) });
  }
  return out;
}

/* #5445: a unit the person masked (systemctl --user mask) is a link to /dev/null in the unit folder. fs.existsSync
   follows the link and finds /dev/null, so it read as present; reading it gave an empty file, which read as a broken
   unit. Masked is the person's choice: the name stays held, and the sentence says how to undo it. */
function masked(name, worldId) {
  let st;
  try { st = fs.lstatSync(unitPath(name, worldId)); } catch { return false; }
  if (!st.isSymbolicLink()) return false;
  try { return fs.readlinkSync(unitPath(name, worldId)) === '/dev/null'; } catch { return false; }
}
function maskedSentence(name, worldId) {
  return `you masked it in systemd, so it does not start; run systemctl --user unmask ${unitName(name, worldId)} to let Kosmos start it again`;
}

function unitPath(name, worldId) {
  return path.join(systemdDir(), unitName(name, worldId));
}

/* Linger keeps user units running with nobody logged in; without it an agent stops at logout and does not start at
   boot. Returns whether linger is ON afterwards (read back, not assumed from the enable call). */
function enableLinger() {
  // The numeric uid, never $USER: under su without -l or cron, USER can name another account (review 22).
  const u = typeof process.getuid === 'function' ? String(process.getuid()) : '';
  try { runner('loginctl', u ? ['enable-linger', u] : ['enable-linger']); } catch { /* read back below */ }
  let r = null;
  try { r = runner('loginctl', u ? ['show-user', u, '-p', 'Linger'] : ['show-user', '-p', 'Linger']); } catch { r = null; }
  if (r && r.ok && /^Linger=yes\s*$/m.test(String(r.stdout || ''))) return { lingering: true };
  /* review 24: show-user can lag the enable a moment. logind's own record of linger is a file named for the user;
     consulted only outside a test process (create runs through its own runner, so "is the runner real" is the wrong
     question), so a test's faked "Linger=no" is never overruled by a CI runner that has linger on. */
  if (!require('./live-execution').inTestProcess()) {
    if (lingerFileOn() === true) return { lingering: true };   // #5445: the one read of logind's record
  }
  return { lingering: false };
}

/* #5445: whether linger is on, read from logind's own record without running anything (the create path asks loginctl
   through enableLinger, which turns it on; a sentence about an agent that is not running must not change anything).
   undefined when it cannot be read. */
function lingerFileOn() {
  if (typeof process.getuid !== 'function') return undefined;
  try { return fs.existsSync(path.join('/var/lib/systemd/linger', os.userInfo().username)); } catch { return undefined; }
}

/* A value written into a unit file. systemd expands "%" specifiers in most directives and "$" in ExecStart, unescapes
   "\\" inside quotes, and a newline starts a new directive. Rather than escape each rule per directive, a value carrying
   any of them is refused: Kosmos's own paths never do, and a refusal is a sentence, where an escaping slip is a
   command in the person's user unit. */
const UNIT_UNSAFE = /[\x00-\x1f\x7f"\\$%]/;
function unitSafe(val, what) {
  const s = String(val == null ? '' : val);
  if (UNIT_UNSAFE.test(s)) throw new Error(`${what || 'a value'} cannot go into a systemd unit (it contains a quote, backslash, $, % or a control character)`);
  return s;
}
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/**
 * Generates systemd user unit content for an agent.
 */
function unitFor(name, runnerBin, tmuxBin, modelArg, configDir, runnerName) {
  const create = require('./create');
  const world = launchidentity.currentWorldId();
  const session = launchidentity.launchKey(name, world);
  const supervisor = create.supervisorPath();
  const workdir = create.workerDir(name);
  const log = path.join(workdir, 'start.log');
  const port = create.boardPort();   // review 29: one derivation of the port, the one plistFor uses
  const nonClaude = create.isNonClaudeRunner(runnerName);

  if (modelArg && !MODEL_ID.test(String(modelArg))) throw new Error('the model name is not one Kosmos can write into a systemd unit');
  const modelVal = (modelArg || nonClaude) ? (modelArg || '') : '';
  const runnerVal = nonClaude ? runnerName : '';

  const execArgs = [
    '/bin/bash',
    supervisor,
    session,
    workdir,
    runnerBin,
    tmuxBin,
    log,
  ];
  if (modelVal || runnerVal) {
    execArgs.push(modelVal);
  }
  if (runnerVal) {
    execArgs.push(runnerVal);
  }

  const execLine = execArgs.map((arg) => `"${unitSafe(arg, 'a path in the agent command')}"`).join(' ');

  const home = create.homeDir();   // honours AGENT_WORKFORCE_HOME, as plistFor does (#4918 review 5)
  const binDir = path.dirname(runnerBin);
  const tmuxDir = path.dirname(tmuxBin);
  const pathVal = `${binDir}:${tmuxDir}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

  const envLines = [
    `Environment="HOME=${unitSafe(home, 'the home folder')}"`,
    `Environment="PATH=${unitSafe(pathVal, 'the PATH')}"`,
    'Environment="LANG=C.UTF-8"',
  ];

  if (configDir) {
    const key = accountenv.accountEnvVar(runnerName);
    envLines.push(`Environment="${key}=${unitSafe(configDir, 'the account folder')}"`);
  }

  if (port !== create.DEFAULT_BOARD_PORT) {
    envLines.push(`Environment="KOSMOS_PORT=${port}"`);
  }

  const tmuxSock = typeof process.env.TMUX_TMPDIR === 'string' ? process.env.TMUX_TMPDIR : '';
  if (tmuxSock) {
    envLines.push(`Environment="TMUX_TMPDIR=${unitSafe(tmuxSock, 'the tmux folder')}"`);
  }

  if (!launchidentity.isDefaultWorld(world)) {
    envLines.push(`Environment="KOSMOS_WORLD=${unitSafe(world, 'the Kosmos name')}"`);
  }

  return `[Unit]
Description=Kosmos agent ${unitSafe(session, 'the agent name')}

[Service]
ExecStart=${execLine}
WorkingDirectory=${unitSafe(workdir, 'the agent folder')}
${envLines.join('\n')}
StandardOutput=append:${unitSafe(log, 'the log path')}
StandardError=append:${unitSafe(log, 'the log path')}
# Stopping this agent stops its supervisor only. The tmux server is shared by every agent and may have been started
# from this unit's cgroup; the default KillMode (control-group) would take every agent's session down with it.
KillMode=process
Restart=always
# A constant 10 s (#4918 review 13). The Mac's ThrottleInterval 30 is a minimum gap between spawns, so a long-running
# agent whose session ends comes straight back there, and no systemd setting matches that exactly. A growing delay
# (RestartSteps) keys on a restart counter that only an explicit start clears, so it could leave a long-lived agent at
# its maximum for good. 10 s revives quickly and keeps a lasting fault (a missing runner) off a 5 s loop.
RestartSec=10
# The supervisor traps TERM and exits 143 (bin/agent-supervisor.sh): reported as a clean stop, not 'failed'. This
# changes reporting only: under Restart=always it is systemctl stop itself that keeps a deliberate stop stopped.
SuccessExitStatus=129 130 143

[Install]
WantedBy=default.target
`;
}

/**
 * Parses ExecStart and Environment from unit content back into job properties.
 */
function readUnitJob(content) {
  if (typeof content !== 'string') return null;
  const execMatch = content.match(/^ExecStart=(.*)$/m);
  if (!execMatch) return null;

  // Tokenize arguments handling quotes
  const rawArgs = execMatch[1].trim();
  const tokens = [];
  const re = /(?:[^\s"]+|"[^"]*")+/g;
  let m;
  while ((m = re.exec(rawArgs)) !== null) {
    let tok = m[0];
    if (tok.startsWith('"') && tok.endsWith('"')) {
      tok = tok.slice(1, -1).replace(/\\"/g, '"');
    }
    tokens.push(tok);
  }

  // Tokens:
  // 0: /bin/bash
  // 1: supervisorPath
  // 2: session
  // 3: workdir
  // 4: runnerBin (claude)
  // 5: tmuxBin
  // 6: logFile
  // 7: model (optional)
  // 8: runner (optional)
  // A truncated ExecStart is no job (the same guard readPlistJob applies), never a job with null binaries.
  if (tokens.length < 7 || !tokens[4] || !tokens[5]) return null;
  const claude = tokens.length > 4 ? tokens[4] : null;
  const tmux = tokens.length > 5 ? tokens[5] : null;
  const model = tokens.length > 7 && tokens[7] ? tokens[7] : null;
  const runner = tokens.length > 8 && tokens[8] ? tokens[8] : 'claude';

  // Environment variables
  let configDir = null;
  const envRe = /^Environment="?([^"=\n]+)=([^"\n]*)"?$/gm;
  let envMatch;
  while ((envMatch = envRe.exec(content)) !== null) {
    const key = envMatch[1];
    const val = envMatch[2];
    if (key === 'CLAUDE_CONFIG_DIR' || key === 'CODEX_HOME' || key === 'GEMINI_CLI_HOME' || key === 'GROK_HOME') {
      configDir = val;
    }
  }

  return {
    claude,
    tmux,
    model,
    configDir,
    runner,
  };
}

/* #4918 review 3: the runner gate keeps a test process off real systemd commands; this keeps it off the real unit
   folder too. A test must point the folder elsewhere (setSystemdDirForTests or AGENT_WORKFORCE_SYSTEMD_DIR). */
function refuseRealUnitDirInTests(targetPath) {
  if (!systemdDirOverridden && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !process.env.AGENT_WORKFORCE_LAUNCH && require('./live-execution').inTestProcess()) {
    throw new Error('a test tried to write a systemd unit into the real folder (' + targetPath + '); call setSystemdDirForTests first');
  }
}

function writeUnitFile(targetPath, content) {
  refuseRealUnitDirInTests(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function daemonReload() {
  return runner('systemctl', ['--user', 'daemon-reload']);
}

function enable(name, worldId) {
  const u = unitName(name, worldId);
  return runner('systemctl', ['--user', 'enable', u]);
}

function disable(name, worldId) {
  const u = unitName(name, worldId);
  return runner('systemctl', ['--user', 'disable', u]);
}

function start(name, worldId) {
  try {
    const create = require('./create');
    const workdir = create.workerDir(name);
    fs.mkdirSync(workdir, { recursive: true });
  } catch {}
  const reload = daemonReload();
  if (!reload || !reload.ok) return { ok: false, because: 'systemd did not reload its user units: ' + ((reload && (reload.stderr || reload.because)) || '').trim() };
  const en = enable(name, worldId);
  if (!en || !en.ok) return { ok: false, because: 'systemd did not enable the agent: ' + ((en && (en.stderr || en.because)) || '').trim() };
  const u = unitName(name, worldId);
  return runner('systemctl', ['--user', 'start', u]);
}

/* #4918 review 9: start WITHOUT enabling, for a restart or relaunch. The Mac's restart only bootstraps and never
   re-enables, so a switched-off agent cannot quietly come back at every boot; enabling stays the enable op's job
   (restore and resume call it first). start() above, which enables, is for creating an agent. */
function startOnly(name, worldId) {
  // The unit appends to <workdir>/start.log; systemd cannot create the folder (review 18).
  try { fs.mkdirSync(require('./create').workerDir(name), { recursive: true }); } catch { /* the start will say */ }
  const reload = daemonReload();
  if (!reload || !reload.ok) return { ok: false, because: 'systemd did not reload its user units: ' + ((reload && (reload.stderr || reload.because)) || '').trim() };
  return runner('systemctl', ['--user', 'start', unitName(name, worldId)]);
}

function stop(name, worldId) {
  const u = unitName(name, worldId);
  return runner('systemctl', ['--user', 'stop', u]);
}

function status(name, worldId) {
  const u = unitName(name, worldId);
  const act = runner('systemctl', ['--user', 'is-active', u]);
  const en = runner('systemctl', ['--user', 'is-enabled', u]);
  return {
    active: Boolean(act && act.ok && String(act.stdout || '').trim() === 'active'),   // review 28: a result may carry no stdout
    enabled: Boolean(en && en.ok && String(en.stdout || '').trim() === 'enabled'),
  };
}

/* #4918 review 5: whether the agent is switched on, for a world switch's pause. { known:false } when systemd could
   not answer (a pause then leaves the agent as it was, as on the other platforms). */
function enabledState(name, worldId) {
  const r = runner('systemctl', ['--user', 'is-enabled', unitName(name, worldId)]);
  const out = String((r && r.stdout) || '').trim();
  if (/^(enabled|enabled-runtime|linked|alias|static)$/.test(out)) return { known: true, enabled: true };
  if (/^(disabled|masked|masked-runtime)$/.test(out)) return { known: true, enabled: false };
  return { known: false };
}

/* #5445 (display parity): every Kosmos agent unit file and its state, in one call, for the board's "switched off"
   set (create.disabledJobsResult). No name pattern: systemctl exits non-zero on a pattern that matches nothing on some
   versions, which would read as "could not look". { ok:false } when systemd could not answer. */
function listUnitFiles() {
  const r = runner('systemctl', ['--user', 'list-unit-files', '--type=service', '--no-legend', '--no-pager']);
  if (!r || r.ok === false) return { ok: false };
  const rows = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const [unit, state] = line.trim().split(/\s+/);
    if (unit && state && unit.startsWith('kosmos-agent-')) rows.push({ unit, state });
  }
  return { ok: true, rows };
}

/* #5445: the Kosmos agent units systemd has active (running), for create.runningJobs. */
function activeUnits() {
  const r = runner('systemctl', ['--user', 'list-units', '--type=service', '--state=active', '--no-legend', '--no-pager', '--plain']);
  if (!r || r.ok === false) return { ok: false };
  const units = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const unit = line.trim().split(/\s+/)[0];
    if (unit && unit.startsWith('kosmos-agent-')) units.push(unit);
  }
  return { ok: true, units };
}

function loaded(name, worldId) {
  const u = unitName(name, worldId);
  const r = runner('systemctl', ['--user', 'is-active', u]);
  const out = String((r && r.stdout) || '').trim();   // a runner may return no stdout on failure
  return Boolean(r && ((r.ok && out === 'active') || out === 'activating'));
}

function presence(name, worldId) {
  return fs.existsSync(unitPath(name, worldId));
}

/* Stops, disables and deletes the unit. { ok: true } only when the unit file is gone AND the stop did not fail for a
   reason other than the unit not being loaded (#4918 review 2: with the user bus unreachable, a deleted file leaves
   the loaded unit running and restarting from memory). */
// systemd's own wording for a unit it does not have. Not "no such file": that is also the bus failure
// ("Failed to connect to bus: No such file or directory"), which must stay a failure (#4918 review 3).
const NOT_LOADED = /Unit (file )?\S+ (not loaded|does not exist|not found)/i;   // incl. disable's "Unit file X.service does not exist"
/* A stop result that leaves the unit not running: ok, or systemd saying it never had it (review 14). */
/* "systemd does not have this unit": systemctl's exit 5 (any locale), or its English wording (review 20). */
function notLoaded(r) {
  return Boolean(r) && (r.code === 5 || NOT_LOADED.test(String(r.stderr || r.because || '')));
}
function stoppedOrNotLoaded(r) {
  return Boolean(r && (r.ok || notLoaded(r)));
}

function remove(name, worldId) {
  // review 28: whether there was a unit file at all. disable of a missing unit exits 1 (not 5) with localized text,
  // so for an already-gone file a refused disable is not read from systemd's wording: there is nothing to disable.
  const hadFile = fs.existsSync(unitPath(name, worldId));
  const st = stop(name, worldId);
  const stopFailed = st && st.ok === false && !notLoaded(st);
  const dis = disable(name, worldId);
  const disableFailed = hadFile && dis && dis.ok === false && !notLoaded(dis);
  if (stopFailed) {
    return { ok: false, because: 'systemd could not stop it, so it may still be running: ' + String(st.stderr || st.because || '').trim() };
  }
  const file = unitPath(name, worldId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    return { ok: false, because: 'the unit file could not be deleted: ' + ((err && err.message) || String(err)) };
  }
  daemonReload();
  if (fs.existsSync(file)) return { ok: false, because: 'the unit file is still there' };
  // A failed disable can leave its default.target.wants link behind; say so rather than report a clean removal.
  return disableFailed ? { ok: false, because: 'the unit file is gone, but systemd could not disable it: ' + String(dis.stderr || dis.because || '').trim() } : { ok: true };
}

module.exports = {
  systemdDir,
  setSystemdDirForTests,
  unitName,
  unitPath,
  unitFor,
  readUnitJob,
  writeUnitFile,
  daemonReload,
  enable,
  disable,
  start,
  startOnly,
  stop,
  status,
  loaded,
  presence,
  remove,
  enableLinger,
  lingerFileOn,
  enabledState,
  worldFromUnitName,
  listUnits,
  listUnitFiles,
  activeUnits,
  keyFromUnitName,
  masked,
  maskedSentence,
  stoppedOrNotLoaded,
  unitSafe,
  escapeUnitNamePart,
  refuseRealUnitDirInTests,
  systemdDirIsOverridden: () => systemdDirOverridden,
  runner,
  runWith,
  setRunnerForTests,
  defaultSystemdDir,
  realRunner,
  ensureRuntimeDir,
};
