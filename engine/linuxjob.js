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
  if (require('./live-execution').inTestProcess()) require('./live-execution').refuseOrWarn('engine/linuxjob.js', cmd, args);
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
    if (require('./live-execution').inTestProcess()) require('./live-execution').refuseOrWarn('engine/linuxjob.js', cmd, args);
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

function unitPath(name, worldId) {
  return path.join(systemdDir(), unitName(name, worldId));
}

/* Linger keeps user units running with nobody logged in; without it an agent stops at logout and does not start at
   boot. Returns whether linger is ON afterwards (read back, not assumed from the enable call). */
function enableLinger() {
  const u = process.env.USER || (typeof process.getuid === 'function' ? String(process.getuid()) : '');
  try { runner('loginctl', u ? ['enable-linger', u] : ['enable-linger']); } catch { /* read back below */ }
  let r = null;
  try { r = runner('loginctl', u ? ['show-user', u, '-p', 'Linger'] : ['show-user', '-p', 'Linger']); } catch { r = null; }
  return { lingering: Boolean(r && r.ok && /^Linger=yes\s*$/m.test(String(r.stdout || ''))) };
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
function escapeUnitValue(val) { return unitSafe(val); }
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
  const port = Number(process.env.PORT) || DEFAULT_BOARD_PORT;
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
WorkingDirectory=${unitSafe(workdir, 'the agent folder')}
${envLines.join('\n')}
StandardOutput=append:${unitSafe(log, 'the log path')}
StandardError=append:${unitSafe(log, 'the log path')}
# Stopping this agent stops its supervisor only. The tmux server is shared by every agent and may have been started
# from this unit's cgroup; the default KillMode (control-group) would take every agent's session down with it.
KillMode=process
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
  if (!systemdDirOverridden && !process.env.AGENT_WORKFORCE_SYSTEMD_DIR && require('./live-execution').inTestProcess()) {
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

/* Stops, disables and deletes the unit. { ok: true } only when the unit file is gone AND the stop did not fail for a
   reason other than the unit not being loaded (#4918 review 2: with the user bus unreachable, a deleted file leaves
   the loaded unit running and restarting from memory). */
// systemd's own wording for a unit it does not have. Not "no such file": that is also the bus failure
// ("Failed to connect to bus: No such file or directory"), which must stay a failure (#4918 review 3).
const NOT_LOADED = /Unit \S+ (not loaded|does not exist|not found)/i;
function remove(name, worldId) {
  const st = stop(name, worldId);
  const stopFailed = st && st.ok === false && !NOT_LOADED.test(String(st.stderr || st.because || ''));
  const dis = disable(name, worldId);
  const disableFailed = dis && dis.ok === false && !NOT_LOADED.test(String(dis.stderr || dis.because || ''));
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
  stop,
  status,
  loaded,
  presence,
  remove,
  enableLinger,
  unitSafe,
  escapeUnitNamePart,
  refuseRealUnitDirInTests,
  systemdDirIsOverridden: () => systemdDirOverridden,
  runner,
  setRunnerForTests,
};
