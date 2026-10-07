'use strict';
/**
 * #5432: an agent's startup job, written the way THIS platform keeps it, for tests that seed one.
 *
 * On macOS the job is a launchd plist (create.plistPath / create.plistFor); on Linux it is a systemd user unit
 * (linuxjob.unitPath / linuxjob.unitFor), and the job reader (create.readJob) reads only the platform's own. A test that
 * wrote a plist on a Linux runner seeded nothing, so its agent read as having no job. The two writers take their
 * arguments in the same order (name, runner binary, tmux binary, model, account folder, runner name), so a test calls
 * jobPath / jobFor / writeJob where it called plistPath / plistFor, and macOS (and Windows, which never reads either
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
    const p = require('../engine/linuxjob').unitPath(name, worldId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }
  return require('../engine/create').plistPath(name, worldId);
}

/** The job file's text, as this platform writes it (same arguments as create.plistFor). */
function jobFor(name, runnerBin, tmuxBin, model, configDir, runnerName) {
  if (linux()) return require('../engine/linuxjob').unitFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
  return require('../engine/create').plistFor(name, runnerBin, tmuxBin, model, configDir, runnerName);
}

/** Write the agent's job file (its folder made first) and return its path. */
function writeJob(name, runnerBin, tmuxBin, model, configDir, runnerName) {
  const p = jobPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, jobFor(name, runnerBin, tmuxBin, model, configDir, runnerName), 'utf8');
  return p;
}

module.exports = { jobPath, jobFor, writeJob };
