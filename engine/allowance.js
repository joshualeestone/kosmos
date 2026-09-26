'use strict';

/**
 * The weekly allowance reading (#3946 phase B, item 10): wiring Kosmos's
 * statusline into a Claude account, and reading back what it recorded.
 *
 * Josh asked for a swarm's daily limit as "% of weekly allowance". The only
 * honest source for "weekly allowance" is the provider's own weekly figure,
 * and Claude Code hands it to exactly one place: the statusline's input
 * (engine/kosmos-statusline.js has the measurement). So an account gets a
 * weekly reading only if its settings.json runs our statusline.
 *
 * ⚠️ A STATUSLINE IS ONE SLOT, unlike the report hooks (a list we append to).
 * An account that already has its own statusline is LEFT ALONE: replacing it
 * would take away something the person set up, which is clobbering. That
 * account simply has no weekly reading, and the swarm limit stays in tokens
 * for it. API-key accounts have no weekly figure, but they are wired anyway:
 * a key can later be swapped for a sign-in, and the slot costs nothing while
 * empty. Windows is not wired for now: a statusline is a shell string there,
 * the report hook's exec form (#570) does not apply to it, and wiring it
 * needs the Windows box to verify (the Mac does not ship a Windows change
 * unverified).
 *
 * MERGE-ONLY, NEVER CLOBBER, through the same read/write/#1582 helpers as
 * engine/reporthook.js, so there is one copy of each. It requires only
 * reporthook and kosmos-statusline, neither of which requires any other
 * engine module, so accounts.js can require this without a cycle.
 */

const fs = require('node:fs');
const path = require('node:path');
const reporthook = require('./reporthook');
const statusline = require('./kosmos-statusline');

/* The dedup key: a statusline command containing this is ours. The script's
   whole filename, so a person's own `kosmos-statusline.sh` is not mistaken for
   ours and repointed. */
const MARKER = 'kosmos-statusline.js';

/** Where the statusline script is: beside this module, installed or source. */
function scriptPath() {
  const p = path.resolve(__dirname, 'kosmos-statusline.js');
  return fs.existsSync(p) ? p : null;
}

/**
 * The node to bake into the command. The command outlives the process that
 * writes it, so a versioned path is a trap: a board run from source under
 * Homebrew has execPath /opt/homebrew/Cellar/node/<version>/bin/node, which
 * the next upgrade deletes. So prefer, in order: the installed bundle's own
 * runtime (only when this file sits in an installed app/engine), then
 * Homebrew's unversioned link when it resolves to the same binary, then
 * execPath as it is. Other version managers (nvm, fnm, volta, asdf) have no
 * unversioned link, so a source run under one of them bakes a versioned path;
 * the next setup or prepare repoints it. Installed Kosmos always takes the
 * first branch.
 */
function stableNode(execPath = process.execPath) {
  const installed = path.basename(__dirname) === 'engine' && path.basename(path.dirname(__dirname)) === 'app';
  const bundled = path.resolve(__dirname, '..', '..', 'runtime', 'bin', 'node');
  if (installed && fs.existsSync(bundled)) return bundled;
  let real = null;
  try { real = fs.realpathSync(execPath); } catch { return execPath; }
  for (const link of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { if (fs.realpathSync(link) === real) return link; } catch { /* not there */ }
  }
  return execPath;
}

/** The statusline command for an account: node, the script, the account dir. */
function commandFor(node, script, accountDir) {
  return '"' + node + '" "' + script + '" "' + accountDir + '"';
}

function isOurs(sl) {
  return !!(sl && typeof sl === 'object' && typeof sl.command === 'string' && sl.command.includes(MARKER));
}

/**
 * Wire our statusline into one settings.json. Returns { wired:true, changed }
 * or { wired:false, because } in a sentence, never throws for an expected
 * shape (both callers fail soft, as with the report hooks).
 *
 * opts: platform, node (default: the node running this), script (default:
 * scriptPath()), accountDir (default: the settings file's directory).
 */
function ensureStatusLine(settingsPath, opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  if (plat === 'win32') return { wired: false, because: 'the weekly reading is not wired on Windows yet' };
  const script = o.script === undefined ? scriptPath() : o.script;
  if (!script) return { wired: false, because: 'the statusline script is not on this machine' };
  if (typeof settingsPath !== 'string') return { wired: false, because: 'there is no settings file to wire' };
  const node = o.node || stableNode();
  const accountDir = o.accountDir || path.dirname(settingsPath);
  /* The command is a shell string, so every path in it is vetted the way the
     posix report hook vets its script (quote, backslash, dollar, backtick,
     CR/LF refused). */
  if ([node, script, accountDir].some((p) => reporthook.unsafeForCommand(p, plat))) {
    return { wired: false, because: 'the statusline command path contains characters we will not embed in a command' };
  }
  if (reporthook.ephemeralMismatch(settingsPath, [node, script, accountDir])) {
    return { wired: false, because: 'a statusline command path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
  }
  const read = reporthook.readSettings(settingsPath);
  if (read.because) return { wired: false, because: read.because };
  const { target, data, prevMode } = read;
  const want = commandFor(node, script, accountDir);
  const cur = data.statusLine;
  if (cur !== undefined && cur !== null) {
    if (!isOurs(cur)) {
      return { wired: false, because: cur && typeof cur === 'object'
        ? 'this account already has its own status line, so it was left alone'
        : 'the status line setting in that file is not the shape we expect, so it was left alone' };
    }
    if (cur.type === 'command' && cur.command === want) return { wired: true, changed: false };
    /* Ours, but aimed at another copy (an older install, a moved node): the
       #1467 lesson from reporthook.js, repoint rather than call it wired.
       Any other field the person added (padding) is kept. */
    data.statusLine = { ...cur, type: 'command', command: want };
  } else {
    data.statusLine = { type: 'command', command: want };
  }
  if (!reporthook.writeSettings(target, data, prevMode)) return { wired: false, because: 'we could not save the settings file' };
  return { wired: true, changed: true };
}

/**
 * The account's weekly reading, or null when there is none to trust: never
 * recorded, unreadable, the wrong shape, or from a week that has already
 * reset (a figure from last week is not this week's usage).
 *
 * Returns { usedPct, resetsAt, at, history } where resetsAt is epoch SECONDS
 * (the provider's unit) and at is epoch milliseconds.
 */
function readWeekly(accountDir, now = Date.now()) {
  if (typeof accountDir !== 'string') return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(accountDir, statusline.FILE), 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const reading = statusline.weeklyOf({ rate_limits: { seven_day: { used_percentage: j.usedPct, resets_at: j.resetsAt } } });
  if (!reading || !(typeof j.at === 'number' && Number.isFinite(j.at))) return null;
  if (reading.resetsAt * 1000 <= now) return null;
  const history = Array.isArray(j.history)
    ? j.history.filter((r) => Array.isArray(r) && r.length === 3 && r.every((v) => typeof v === 'number' && Number.isFinite(v)))
    : [];
  return { usedPct: reading.usedPct, resetsAt: reading.resetsAt, at: j.at, history };
}

module.exports = { MARKER, scriptPath, stableNode, commandFor, isOurs, ensureStatusLine, readWeekly };
