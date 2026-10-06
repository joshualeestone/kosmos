'use strict';
/**
 * Systemd user units for the Kosmos board on Linux.
 *
 * Keeps the board running after machine restart / crash, mirroring macOS
 * com.kosmos.board.plist and Windows Scheduled Tasks.
 *
 * Driven by:
 *   - install/kosmos: cmd_board_run, cmd_start, cmd_stop
 *   - engine/boardrestart.js: self-restart on world switch / user restart
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_BOARD_PORT = 16180;

let systemdDirFn = () => {
  if (process.env.AGENT_WORKFORCE_SYSTEMD_DIR) return process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'systemd', 'user');
};

function systemdDir() {
  return systemdDirFn();
}

let systemdDirOverridden = false;
function setSystemdDirForTests(fn) {
  systemdDirOverridden = typeof fn === 'function';
  systemdDirFn = typeof fn === 'function' ? fn : () => {
    if (process.env.AGENT_WORKFORCE_SYSTEMD_DIR) return process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'systemd', 'user');
  };
}

let runnerFn = (cmd, args) => {
  /* #4918 review 1: a test that forgot setRunnerForTests must not reach the host's real systemd (live-execution #1598,
     test half only; production is unchanged). */
  if (require('./live-execution').inTestProcess()) require('./live-execution').refuseOrWarn('engine/linuxboard.js', cmd, args);
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
};

function runner(cmd, args) {
  return runnerFn(cmd, args);
}

function setRunnerForTests(fn) {
  runnerFn = typeof fn === 'function' ? fn : (cmd, args) => {
    /* #4918 review 1: a test that forgot setRunnerForTests must not reach the host's real systemd (live-execution #1598,
       test half only; production is unchanged). */
    if (require('./live-execution').inTestProcess()) require('./live-execution').refuseOrWarn('engine/linuxboard.js', cmd, args);
    try {
      const stdout = execFileSync(cmd, args, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
  };
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
  const p = port || Number(process.env.PORT) || DEFAULT_BOARD_PORT;
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
After=network.target
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
${sysTmux ? `Environment="AGENT_WORKFORCE_TMUX_BIN=${sysTmux}"\n` : ''}# Stopping the board stops the board only, never a tmux server it may have started (see linuxjob.js).
KillMode=process
# on-failure, not always (#4918, measured on GitHub's ubuntu runner): systemd's automatic restart does not re-check
# ConditionPathExists, and board-run exits 0 when board.stopped is there, so Restart=always restarted a stopped
# board every 5 seconds. A crash or a kill is a failure and is restarted; a clean exit (stopped, or deferring to a
# board already on the port) is not.
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/* Writes and enables the board's unit. { ok: false, because } when systemd refused either step. */
function installBoard(kosmosHome, port) {
  const content = boardUnitFor(kosmosHome, port);
  const target = boardUnitPath(kosmosHome);
  // #4918 review 3: a test process never writes into the real unit folder (as linuxjob.writeUnitFile).
  if (!systemdDirOverridden && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && require('./live-execution').inTestProcess()) {
    throw new Error('a test tried to write the board unit into the real folder (' + target + '); call setSystemdDirForTests first');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  const reload = runner('systemctl', ['--user', 'daemon-reload']);
  if (!reload || !reload.ok) return { ok: false, because: 'systemd did not reload its user units: ' + ((reload && (reload.stderr || reload.because)) || '').trim() };
  const unit = boardUnitName(kosmosHome);
  const en = runner('systemctl', ['--user', 'enable', unit]);
  if (!en || !en.ok) return { ok: false, because: 'systemd did not enable the board: ' + ((en && (en.stderr || en.because)) || '').trim() };
  return { ok: true };
}

/* Stops, disables and deletes the board's unit. { ok } is true only when every step held (#4918 review 3), so the
   caller piece D adds can say what did not. A unit systemd does not have counts as stopped. */
function removeBoard(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  const notLoaded = /Unit (file )?\S+ (not loaded|does not exist|not found)/i;
  const failed = (r) => r && r.ok === false && !notLoaded.test(String(r.stderr || r.because || ''));
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
  if (failed(dis)) return { ok: false, because: 'the board unit is gone, but systemd could not disable it: ' + String(dis.stderr || dis.because || '').trim() };
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
    because: 'the board is the kosmos-board systemd user service and will relaunch when stopped',
    via: 'systemd',
  };
}

function restart(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  return runner('systemctl', ['--user', 'restart', '--no-block', unit]);
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
