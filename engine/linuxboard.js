'use strict';
/**
 * Systemd user units for the Kosmos board on Linux.
 *
 * Keeps the board running after machine restart / crash, mirroring macOS
 * com.kosmos.board.plist and Windows Scheduled Tasks.
 *
 * Callers: engine/boardrestart.js (self-restart on a world switch or a user restart); install/setup.sh on
 * Linux calls installBoard, loadedBoardJob, removeBoard and boardUnitPath (#4920) through the installed node.
 * install/kosmos never loads this file: it names the
 * same unit itself (_kosmos_board_systemd_unit, kept equal by tools/test-board-supervised-linux-4918.sh).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');


/* The unit folder and the real runner are linuxjob.js's own (one definition each; #4918 review 11). This module keeps
   its own test seams, so a board test can point them elsewhere without touching the agent ones. */
let systemdDirFn = () => require('./linuxjob').defaultSystemdDir();

function systemdDir() {
  return systemdDirFn();
}

let systemdDirOverridden = false;
function setSystemdDirForTests(fn) {
  systemdDirOverridden = typeof fn === 'function';
  systemdDirFn = typeof fn === 'function' ? fn : () => require('./linuxjob').defaultSystemdDir();
}

let runnerFn = (cmd, args) => require('./linuxjob').realRunner(cmd, args);

/* review 22: the same sandbox refusal as linuxjob.runner. A sandboxed board's unit sits where systemd never reads it,
   and systemctl would name the person's REAL kosmos-board unit. */
function runner(cmd, args) {
  if (process.env.AGENT_WORKFORCE_LAUNCH && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !systemdDirOverridden) {
    return { ok: false, code: 1, stdout: '', stderr: '', because: 'a sandboxed board does not manage real systemd units' };
  }
  return runnerFn(cmd, args);
}

function setRunnerForTests(fn) {
  runnerFn = typeof fn === 'function' ? fn : (cmd, args) => require('./linuxjob').realRunner(cmd, args);
}

function defaultKosmosHome() {
  return path.join(os.homedir(), '.local', 'share', 'kosmos');
}

function boardUnitName(kosmosHome) {
  const home = kosmosHome || process.env.KOSMOS_HOME || defaultKosmosHome();
  const normalizedHome = path.resolve(home);
  const normalizedDefault = path.resolve(defaultKosmosHome());
  if (normalizedHome === normalizedDefault) {
    return 'kosmos-board.service';
  }
  const hash = crypto.createHash('sha256').update(normalizedHome).digest('hex').slice(0, 8);
  return `kosmos-board.${hash}.service`;
}

function boardUnitPath(kosmosHome) {
  return path.join(systemdDir(), boardUnitName(kosmosHome));
}

function boardUnitFor(kosmosHome, port) {
  const home = path.resolve(kosmosHome || process.env.KOSMOS_HOME || defaultKosmosHome());
  const kosmosBin = path.join(home, 'bin', 'kosmos');
  const p = Number(port) || require('./create').boardPort();   // review 29: create's one derivation of the port
  // An integer only: a string with a newline would add a directive to the unit (review 19).
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('the board port is not a port number');
  const userHome = os.homedir();
  const stopMarker = path.join(home, 'board.stopped');
  const tmuxBinDir = path.join(home, 'tmux', 'bin');
  /* #4918 review 2: a Linux install may use the system tmux (no bundled one). The installer's board-run accepts it
     through AGENT_WORKFORCE_TMUX_BIN, so the unit carries that, or a board started by systemd would refuse as
     "incomplete" and restart every 5 seconds. */
  const sysTmux = typeof process.env.AGENT_WORKFORCE_TMUX_BIN === 'string' && path.isAbsolute(process.env.AGENT_WORKFORCE_TMUX_BIN)
    ? process.env.AGENT_WORKFORCE_TMUX_BIN : '';
  const pathVal = `${tmuxBinDir}:${sysTmux ? path.dirname(sysTmux) + ':' : ''}/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const { unitSafe } = require('./linuxjob');
  for (const [v, what] of [[home, 'the Kosmos folder'], [userHome, 'the home folder'], [sysTmux, 'the tmux path']]) unitSafe(v, what);

  return `[Unit]
Description=Kosmos Board
ConditionPathExists=!${stopMarker}

[Service]
ExecStart=/bin/bash "${kosmosBin}" board-run
WorkingDirectory=${home}
Environment="HOME=${userHome}"
Environment="KOSMOS_HOME=${home}"
Environment="PATH=${pathVal}"
Environment="LANG=C.UTF-8"
Environment="KOSMOS_PORT=${p}"
Environment="PORT=${p}"
${sysTmux ? `Environment="AGENT_WORKFORCE_TMUX_BIN=${sysTmux}"\n` : ''}# The board writes where install/kosmos says it does (BOARD_LOG = $KOSMOS_HOME/logs/board.log), as on the Mac,
# never only to the journal: kosmos start sends the person to that file when the board does not come up (review 16).
StandardOutput=append:${path.join(home, 'logs', 'board.log')}
StandardError=append:${path.join(home, 'logs', 'board.log')}
# Stopping the board stops the board only, never a tmux server it may have started (see linuxjob.js).
KillMode=process
# on-failure, not always (#4918, measured on GitHub's ubuntu runner): systemd's automatic restart does not re-check
# ConditionPathExists, and board-run exits 0 when board.stopped is there, so Restart=always restarted a stopped
# board every 5 seconds. A crash or a kill is a failure and is restarted; a clean exit (stopped, or deferring to a
# board already on the port) is not.
Restart=on-failure
# review 28: a SIGTERM exit (kosmos stop) is clean even if node ever reports it as 143, as the agent unit's is.
SuccessExitStatus=143
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/* Writes and enables the board's unit. { ok: false, because } when systemd refused either step. */
function installBoard(kosmosHome, port) {
  const content = boardUnitFor(kosmosHome, port);
  // systemd's append: needs the folder to exist (review 16).
  try { fs.mkdirSync(path.join(path.resolve(kosmosHome || process.env.KOSMOS_HOME || defaultKosmosHome()), 'logs'), { recursive: true }); } catch { /* the start will say */ }
  const target = boardUnitPath(kosmosHome);
  // #4918 review 3: a test process never writes into the real unit folder (as linuxjob.writeUnitFile).
  if (!systemdDirOverridden && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !process.env.AGENT_WORKFORCE_LAUNCH && require('./live-execution').inTestProcess()) {
    throw new Error('a test tried to write the board unit into the real folder (' + target + '); call setSystemdDirForTests first');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  const reload = runner('systemctl', ['--user', 'daemon-reload']);
  if (!reload || !reload.ok) return { ok: false, because: 'systemd did not reload its user units: ' + ((reload && (reload.stderr || reload.because)) || '').trim() };
  const unit = boardUnitName(kosmosHome);
  const en = runner('systemctl', ['--user', 'enable', unit]);
  if (!en || !en.ok) return { ok: false, because: 'systemd did not enable the board: ' + ((en && (en.stderr || en.because)) || '').trim() };
  /* #4918 review 12: without linger the board stops at logout and does not start at boot, the property this unit
     exists for. Read back, as for agents; the caller (piece D's installer) says so when it is off. */
  let lingering = false;
  const lj = require('./linuxjob');
  try { lingering = lj.runWith((c, a) => runner(c, a), () => lj.enableLinger()).lingering; } catch { lingering = false; }
  return { ok: true, lingering };
}

/* Stops, disables and deletes the board's unit. { ok } is true only when every step held (#4918 review 3), so the
   caller piece D adds can say what did not. A unit systemd does not have counts as stopped. */
function removeBoard(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  // The one "not loaded" rule, linuxjob's (review 16: it was written twice).
  const failed = (r) => Boolean(r) && !require('./linuxjob').stoppedOrNotLoaded(r);
  const hadFile = fs.existsSync(boardUnitPath(kosmosHome));   // review 29: as linuxjob.remove (review 28)
  const st = runner('systemctl', ['--user', 'stop', unit]);
  if (failed(st)) return { ok: false, because: 'systemd could not stop the board: ' + String(st.stderr || st.because || '').trim() };
  const dis = runner('systemctl', ['--user', 'disable', unit]);
  const target = boardUnitPath(kosmosHome);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (err) {
    return { ok: false, because: 'the board unit could not be deleted: ' + ((err && err.message) || String(err)) };
  }
  runner('systemctl', ['--user', 'daemon-reload']);
  // A refused disable of a unit that had no file is not read from systemd's (localized) wording: nothing to disable.
  if (hadFile && failed(dis)) return { ok: false, because: 'the board unit is gone, but systemd could not disable it: ' + String(dis.stderr || dis.because || '').trim() };
  return { ok: true };
}

/* #4918 review 2: read the unit's MainPID and state with `systemctl show`, the machine-readable form, never the
   human `status` text (locale and format dependent). */
function loadedBoardJob(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  const r = runner('systemctl', ['--user', 'show', '-p', 'MainPID', '-p', 'ActiveState', unit]);
  if (!r || !r.ok || !r.stdout) return { ok: false };
  const pid = Number((String(r.stdout).match(/^MainPID=(\d+)$/m) || [])[1]);
  const state = (String(r.stdout).match(/^ActiveState=(\S+)$/m) || [])[1] || '';
  return { ok: true, pid: pid > 0 ? pid : null, active: state === 'active' };
}

function canRestart(kosmosHome) {
  const target = boardUnitPath(kosmosHome);
  if (!fs.existsSync(target)) {
    return { canRestart: false, because: 'this board has no systemd user service; restart it by hand' };
  }
  const job = loadedBoardJob(kosmosHome);
  if (!job.ok) {
    return { canRestart: false, because: 'could not read systemd board service status; restart it by hand' };
  }
  if (job.pid !== process.pid) {
    return { canRestart: false, because: 'this process is not the running systemd board service; restart it by hand' };
  }
  return {
    canRestart: true,
    because: 'the board is the kosmos-board systemd user service, so systemctl restart brings it back',
    via: 'systemd',
  };
}

function restart(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  const r = runner('systemctl', ['--user', 'restart', '--no-block', unit]);
  if (r && r.ok) return { ok: true };
  // review 27: a sentence a person can read, as the Mac and Windows arms return, not Node's "Command failed".
  return { ok: false, because: 'systemd did not restart the board service; restart it by hand with: systemctl --user restart ' + unit };
}

module.exports = {
  systemdDir,
  setSystemdDirForTests,
  boardUnitName,
  boardUnitPath,
  boardUnitFor,
  installBoard,
  removeBoard,
  loadedBoardJob,
  canRestart,
  restart,
  runner,
  setRunnerForTests,
};
