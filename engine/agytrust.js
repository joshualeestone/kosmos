'use strict';

/**
 * #3568: pre-answer Antigravity's folder-trust question for an agent's folder.
 *
 * Measured 2026-09-25 on Agent1s (agy 1.2.11, signed in): on every NEW folder agy stops at
 * "Do you trust the contents of this project?", even with --dangerously-skip-permissions, and it
 * has no launch flag to skip it (gemini has --skip-trust, grok --trust). It records the answer per
 * exact folder in ~/.gemini/antigravity-cli/settings.json as `trustedWorkspaces`; a subfolder of a
 * trusted folder is still asked. Without this, every new Antigravity agent sits on that question.
 *
 * The supervisor runs this before each launch (bin/agent-supervisor.sh, antigravity arm).
 *
 * This writes into another program's settings, so it only ever ADDS the folder:
 *   - every other setting is kept as read (the file is re-written as 2-space JSON); a file it cannot
 *     read, or that is not a JSON object, is left alone (the prompt then shows, which is visible);
 *   - the file keeps its permissions, and a symlinked settings file is written through to its target;
 *   - several agents starting at once take turns on a lock file beside it, and each one re-reads the
 *     file after writing to check its folder is there;
 *   - a temporary file is removed if the write does not complete.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
const WRITE_TRIES = 3;

function settingsPath(home) {
  return path.join(home || os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/* An exclusive-create lock beside the settings file. A lock older than LOCK_STALE_MS belongs to a
   run that died, so it is taken over: it is renamed aside first (only one waiter's rename can
   succeed), so two waiters cannot both take it. Every path counts against the deadline, so an
   odd lock (a folder, a dangling link, a folder that cannot be written) ends the wait instead of
   spinning. Returns { release } or { because }. */
function lock(file) {
  const lockFile = file + '.kosmos-lock';
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockFile, 'wx'));
      return { release: () => { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } } };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return { because: `agy settings could not be locked (${err && err.code})` };
    }
    let stale = false;
    try { stale = Date.now() - fs.lstatSync(lockFile).mtimeMs > LOCK_STALE_MS; } catch { /* gone meanwhile: try again */ }
    if (stale) {
      const aside = `${lockFile}.stale-${process.pid}-${Date.now()}`;
      try { fs.renameSync(lockFile, aside); fs.rmSync(aside, { force: true }); } catch { /* another waiter took it */ }
    }
    if (Date.now() > deadline) return { because: 'agy settings are locked by another start that did not finish' };
    sleepMs(25);
  }
}

/* Read the settings. { settings } on success (an absent file is an empty object), { because } when
   it must be left alone. */
function readSettings(file) {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return { because: 'agy settings could not be read, so they were left alone' };
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { because: 'agy settings are not an object, so they were left alone' };
  }
  if (settings.trustedWorkspaces !== undefined && !Array.isArray(settings.trustedWorkspaces)) {
    return { because: 'agy trustedWorkspaces is not a list, so it was left alone' };
  }
  return { settings };
}

/* Replace `target` with `body`, keeping its mode, through a temp file that is removed on failure. */
function writeKeepingMode(target, body) {
  let mode = 0o600;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file: owner only, like agy's own */ }
  const tmp = `${target}.kosmos-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, body, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never created */ }
    throw err;
  }
}

/* Run this in its own process only (the supervisor does: node agytrust.js <folder>). Waiting on the
   lock blocks for up to LOCK_WAIT_MS, which would freeze the board if it were called in-process. */
function trustAgyFolder(dir, opts) {
  const home = opts && opts.home;
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, because: 'not an absolute folder' };
  // agy records the folder it runs in, resolved (a /tmp folder is /private/tmp). A folder that does
  // not exist yet cannot be resolved, and recording it as given might never match, so refuse.
  let real;
  try { real = fs.realpathSync(dir); } catch { return { ok: false, because: 'the agent folder does not exist yet' }; }
  const file = settingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A symlinked settings file is written through to its target, so the link stays a link. A link
  // whose target is gone is left alone rather than replaced by a plain file.
  let target = file;
  let isLink = false;
  try { isLink = fs.lstatSync(file).isSymbolicLink(); } catch { /* absent */ }
  if (isLink) {
    try { target = fs.realpathSync(file); } catch { return { ok: false, because: 'agy settings are a link to a file that is gone, so they were left alone' }; }
  }
  const held = lock(target);
  if (!held.release) return { ok: false, because: held.because };
  try {
    for (let i = 0; i < WRITE_TRIES; i++) {
      const r = readSettings(target);
      if (!r.settings) return { ok: false, because: r.because };
      const list = r.settings.trustedWorkspaces || [];
      if (list.includes(real)) return { ok: true, changed: i > 0 };
      const next = Object.assign({}, r.settings, { trustedWorkspaces: list.concat([real]) });
      writeKeepingMode(target, JSON.stringify(next, null, 2) + '\n');
      // Re-read: another writer outside the lock (agy itself) may have replaced the file meanwhile.
      const check = readSettings(target);
      if (check.settings && (check.settings.trustedWorkspaces || []).includes(real)) return { ok: true, changed: true };
    }
    return { ok: false, because: 'agy settings kept changing underneath, so the folder could not be added' };
  } finally {
    held.release();
  }
}

module.exports = { trustAgyFolder, settingsPath };

// The supervisor calls this as a script: node agytrust.js <folder>. It always exits 0 (the launch
// goes ahead either way), and says on stderr why it could not add the folder, for the agent's log.
if (require.main === module) {
  try {
    const r = trustAgyFolder(process.argv[2]);
    if (!r.ok) process.stderr.write(`agytrust: ${r.because}; agy may ask to trust this folder\n`);
  } catch (err) {
    process.stderr.write(`agytrust: ${err && err.message}; agy may ask to trust this folder\n`);
  }
  process.exit(0);
}
