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

function setSystemdDirForTests(fn) {
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
  const pathVal = `${tmuxBinDir}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const { unitSafe } = require('./linuxjob');
  for (const [v, what] of [[home, 'the Kosmos folder'], [userHome, 'the home folder']]) unitSafe(v, what);

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
# Stopping the board stops the board only, never a tmux server it may have started (see linuxjob.js).
KillMode=process
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/* Writes and enables the board's unit. { ok: false, because } when systemd refused either step. */
function installBoard(kosmosHome, port) {
  const content = boardUnitFor(kosmosHome, port);
  const target = boardUnitPath(kosmosHome);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  const reload = runner('systemctl', ['--user', 'daemon-reload']);
  if (!reload || !reload.ok) return { ok: false, because: 'systemd did not reload its user units: ' + ((reload && (reload.stderr || reload.because)) || '').trim() };
  const unit = boardUnitName(kosmosHome);
  const en = runner('systemctl', ['--user', 'enable', unit]);
  if (!en || !en.ok) return { ok: false, because: 'systemd did not enable the board: ' + ((en && (en.stderr || en.because)) || '').trim() };
  return { ok: true };
}

function removeBoard(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  runner('systemctl', ['--user', 'stop', unit]);
  runner('systemctl', ['--user', 'disable', unit]);
  const target = boardUnitPath(kosmosHome);
  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      runner('systemctl', ['--user', 'daemon-reload']);
    }
  } catch {}
}

function loadedBoardJob(kosmosHome) {
  const unit = boardUnitName(kosmosHome);
  const r = runner('systemctl', ['--user', 'status', unit]);
  if (!r.ok || !r.stdout) return { ok: false };
  const pidMatch = r.stdout.match(/Main PID:\s*(\d+)/);
  const activeMatch = /\bActive:\s*active\s*\(running\)/.test(r.stdout);
  return {
    ok: true,
    pid: pidMatch ? Number(pidMatch[1]) : null,
    active: activeMatch,
  };
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
