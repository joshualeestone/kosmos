'use strict';
/**
 * Systemd user units for Kosmos agents on Linux.
 *
 * The Linux equivalent of macOS LaunchAgents (~/Library/LaunchAgents/*.plist)
 * and Windows Scheduled Tasks (Kosmos\agent-*).
 *
 * Each agent runs bin/agent-supervisor.sh under a user unit:
 *   ~/.config/systemd/user/kosmos-agent-<session>.service
 * with Restart=always and RestartSec=5.
 *
 * Systemd user units run without sudo/root privileges via systemctl --user,
 * and survive disconnect/logout via loginctl enable-linger.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launchidentity = require('./launchidentity');
const accountenv = require('./accountenv');

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

function unitName(name, worldId) {
  const world = worldId === undefined ? launchidentity.currentWorldId() : worldId;
  const session = launchidentity.launchKey(name, world);
  return `kosmos-agent-${session}.service`;
}

function unitPath(name, worldId) {
  return path.join(systemdDir(), unitName(name, worldId));
}

function enableLinger() {
  try {
    const u = process.env.USER || (typeof process.getuid === 'function' ? String(process.getuid()) : '');
    const args = u ? ['enable-linger', u] : ['enable-linger'];
    runner('loginctl', args);
  } catch {
    // Best-effort; lingering may already be enabled or restricted
  }
}

function escapeUnitValue(val) {
  return String(val == null ? '' : val).replace(/"/g, '\\"');
}

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
  const port = Number(process.env.PORT) || DEFAULT_BOARD_PORT;
  const nonClaude = create.isNonClaudeRunner(runnerName);

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

  const execLine = execArgs.map((arg) => (!arg || /[ \t"]/.test(arg) ? `"${escapeUnitValue(arg)}"` : arg)).join(' ');

  const home = os.homedir();
  const binDir = path.dirname(runnerBin);
  const tmuxDir = path.dirname(tmuxBin);
  const pathVal = `${binDir}:${tmuxDir}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

  const envLines = [
    `Environment="HOME=${escapeUnitValue(home)}"`,
    `Environment="PATH=${escapeUnitValue(pathVal)}"`,
    'Environment="LANG=C.UTF-8"',
  ];

  if (configDir) {
    const key = accountenv.accountEnvVar(runnerName);
    envLines.push(`Environment="${key}=${escapeUnitValue(configDir)}"`);
  }

  if (port !== DEFAULT_BOARD_PORT) {
    envLines.push(`Environment="KOSMOS_PORT=${port}"`);
  }

  const tmuxSock = typeof process.env.TMUX_TMPDIR === 'string' ? process.env.TMUX_TMPDIR : '';
  if (tmuxSock) {
    envLines.push(`Environment="TMUX_TMPDIR=${escapeUnitValue(tmuxSock)}"`);
  }

  if (!launchidentity.isDefaultWorld(world)) {
    envLines.push(`Environment="KOSMOS_WORLD=${escapeUnitValue(world)}"`);
  }

  return `[Unit]
Description=Kosmos agent ${session}
After=network.target

[Service]
ExecStart=${execLine}
WorkingDirectory=${workdir}
${envLines.join('\n')}
StandardOutput=append:${log}
StandardError=append:${log}
Restart=always
RestartSec=5

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

function writeUnitFile(targetPath, content) {
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
  daemonReload();
  enable(name, worldId);
  const u = unitName(name, worldId);
  return runner('systemctl', ['--user', 'start', u]);
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
    active: Boolean(act && act.ok && act.stdout.trim() === 'active'),
    enabled: Boolean(en && en.ok && en.stdout.trim() === 'enabled'),
  };
}

function loaded(name, worldId) {
  const u = unitName(name, worldId);
  const r = runner('systemctl', ['--user', 'is-active', u]);
  return Boolean(r && ((r.ok && r.stdout.trim() === 'active') || r.stdout.trim() === 'activating'));
}

function presence(name, worldId) {
  return fs.existsSync(unitPath(name, worldId));
}

function remove(name, worldId) {
  stop(name, worldId);
  disable(name, worldId);
  const file = unitPath(name, worldId);
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      daemonReload();
    }
  } catch {}
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
  stop,
  status,
  loaded,
  presence,
  remove,
  enableLinger,
  runner,
  setRunnerForTests,
};
