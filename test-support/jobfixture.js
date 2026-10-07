'use strict';
/**
 * #5432: an agent's startup job, written the way THIS platform keeps it, for tests that seed one.
 *
 * On macOS the job is a launchd plist (create.plistPath / create.plistFor); on Linux it is a systemd user unit
 * (linuxjob.unitPath / linuxjob.unitFor), and the job reader (create.readJob) reads only the platform's own. A test that
 * wrote a plist on a Linux runner seeded nothing, so its agent read as having no job. The two writers take their
 * arguments in the same order (name, runner binary, tmux binary, model, account folder, runner name), so a test calls
 * jobPath / jobFor where it called plistPath / plistFor, and macOS (and Windows, which never reads either
 * here) is unchanged.
 *
 * The Linux unit folder is the sandbox's own (AGENT_WORKFORCE_SYSTEMD_DIR, which the test sets beside
 * AGENT_WORKFORCE_LAUNCH); without it the unit would be written under AGENT_WORKFORCE_LAUNCH/systemd/user.
 */
const fs = require('node:fs');
const path = require('node:path');

const linux = () => process.platform === 'linux';

/** Where this platform keeps the agent's job file. On Linux its folder is made too: the tests made the LaunchAgents
    folder for the plist and write to this path themselves, and the unit folder does not exist until something makes it. */
function jobPath(name, worldId) {
  if (linux()) {
    /* Never the person's real unit folder: with no sandbox set, unitPath is ~/.config/systemd/user, and this helper
       makes the folder and the tests write into it. A test that keeps its sandbox only in a child's env uses jobPathIn. */
    if (!process.env.AGENT_WORKFORCE_SYSTEMD_DIR && !process.env.AGENT_WORKFORCE_LAUNCH) {
      throw new Error('jobfixture.jobPath: no sandbox (set AGENT_WORKFORCE_LAUNCH or AGENT_WORKFORCE_SYSTEMD_DIR, or use jobPathIn)');
    }
    const p = require('../engine/linuxjob').unitPath(name, worldId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }
  return require('../engine/create').plistPath(name, worldId);
}

/** Where a board whose sandbox is `launchDir` (its AGENT_WORKFORCE_LAUNCH, with no AGENT_WORKFORCE_SYSTEMD_DIR) keeps the
    agent's job: the plist in launchDir on macOS, the unit in launchDir/systemd/user on Linux (linuxjob.defaultSystemdDir).
    For tests that hand the sandbox only to a child board. The folder is made. The name comes from THIS process's
    world (KOSMOS_WORLD, unless worldId is given), so the child board must inherit that variable to look for the same file. */
function jobPathIn(launchDir, name, worldId) {
  if (linux()) {
    const dir = path.join(launchDir, 'systemd', 'user');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, require('../engine/linuxjob').unitName(name, worldId));
  }
  return path.join(launchDir, require('../engine/create').serviceLabel(name, worldId) + '.plist');
}

/** The job file's text, as this platform writes it (same arguments as create.plistFor). */
function jobFor(name, runnerBin, tmuxBin, model, configDir, runnerName) {
  if (linux()) return require('../engine/linuxjob').unitFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
  return require('../engine/create').plistFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
}

/** #5500: a stand-in for `systemctl --user` and `loginctl`, for a test's runner stub that answered launchctl only.
    It keeps the units it has started and enabled, so it answers as systemd does: is-active "active" for a started unit
    and "inactive" (exit 3) otherwise; is-enabled "enabled" or "disabled" (exit 1); list-units and list-unit-files from
    the same two sets; linger on. Any other systemctl verb (daemon-reload, restart, ...) succeeds with no output. Any
    other PROGRAM answers null, so the test's own fake answers it (on a Mac every call does). `.active` and `.enabled` are the two sets, for a test that seeds a unit as running or switched on. */
function systemdStub() {
  const active = new Set();
  const enabled = new Set();
  const answer = (file, args) => {
    const cmd = String(file).split('/').pop();
    if ((cmd !== 'systemctl' && cmd !== 'loginctl') || !Array.isArray(args)) return null;
    if (cmd === 'loginctl') return { ok: true, stdout: args[0] === 'show-user' ? 'Linger=yes\n' : '' };
    const [, verb, unit] = args;   // args[0] is --user
    if (verb === 'start') active.add(unit);
    else if (verb === 'stop') active.delete(unit);
    else if (verb === 'enable') enabled.add(unit);
    else if (verb === 'disable') enabled.delete(unit);
    else if (verb === 'is-active') return active.has(unit) ? { ok: true, stdout: 'active\n' } : { ok: false, code: 3, stdout: 'inactive\n' };
    else if (verb === 'is-enabled') return enabled.has(unit) ? { ok: true, stdout: 'enabled\n' } : { ok: false, code: 1, stdout: 'disabled\n' };
    else if (verb === 'list-units') return { ok: true, stdout: [...active].map((u) => `${u} loaded active running x\n`).join('') };
    else if (verb === 'list-unit-files') {
      const units = new Set([...enabled, ...active]);
      return { ok: true, stdout: [...units].map((u) => `${u} ${enabled.has(u) ? 'enabled' : 'disabled'} enabled\n`).join('') };
    }
    return { ok: true, stdout: '' };
  };
  answer.active = active;
  answer.enabled = enabled;
  return answer;
}

module.exports = { jobPath, jobPathIn, jobFor, systemdStub };
