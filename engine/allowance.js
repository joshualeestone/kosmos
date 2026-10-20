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
 * empty. Windows (#6213): a statusline is a shell string run by Git Bash or,
 * without it, PowerShell, and it has no exec form (the report hook's #570 way
 * round this), so winCommandFor builds the one string both shells run alike.
 *
 * MERGE-ONLY, NEVER CLOBBER, through the same read/write/#1582 helpers as
 * engine/reporthook.js, so there is one copy of each. It requires
 * reporthook, kosmos-statusline and (to save) securewrite. securewrite needs
 * only node built-ins, and the other two need no engine module but
 * securewrite, so accounts.js can require this without a cycle.
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

/* kosmos#6213: on Windows a status line command runs in Git Bash when it is installed and in PowerShell when it is not
   (Claude Code docs, statusline "Windows configuration"), and a status line has no exec form. PowerShell needs `&` before a
   quoted path and bash rejects that `&`, so the one form that runs the same in both is UNQUOTED paths
   with forward slashes (bash eats backslashes). A folder with a space is replaced by its Windows short (8.3) name,
   which has none; a `~` inside a word is literal to bash. The file name is kept as it is, so the command still names
   kosmos-statusline.js (MARKER). Anything left outside this set is refused. */
const WIN_SAFE = /^[A-Za-z0-9._\-\/:~]+$/;

/* Ask cmd.exe for a folder's Windows short (8.3) name. { answered: true, short } when cmd.exe ran and exited 0 (short is
   null when the folder has none: short names switched off); { answered: false } when it could not be asked (a timeout,
   a failed spawn, a character cmd.exe would read inside its quotes). */
function askShortPath(p) {
  if (typeof p !== 'string' || /["%\r\n]/.test(p)) return { answered: false };   // cmd.exe would read these inside its quotes
  try {
    const r = require('node:child_process').spawnSync('cmd.exe', ['/d', '/s', '/c', 'for %I in ("' + p + '") do @echo %~sI'],
      { encoding: 'utf8', windowsVerbatimArguments: true, timeout: 2000 });   // runs on the board's thread: kept short
    if (!r || r.error || r.status !== 0 || typeof r.stdout !== 'string') return { answered: false };
    const out = r.stdout.trim().split(/\r?\n/).pop();
    return { answered: true, short: out && !/\s/.test(out) ? out : null };
  } catch { return { answered: false }; }
}

/* The short name; null when Windows answered that there is none; undefined when it could not be asked (a timeout, a
   failed spawn), which is never kept, so the next set-up asks again. An answer is kept only for a folder that exists
   (cmd.exe hands back a missing folder's long spelling): one made later is asked again. A kept "none" stops 8.3 being
   switched off from starting up to three cmd.exe per set-up. */
const SHORT_SEEN = new Map();   // folder -> its short name, or null for "it has none": one cmd.exe per folder per process
function winShortPathCached(p, ask = askShortPath, exists = fs.existsSync) {
  if (SHORT_SEEN.has(p)) return SHORT_SEEN.get(p);
  const r = ask(p);
  if (!r.answered) return undefined;
  if (exists(p)) SHORT_SEEN.set(p, r.short);
  return r.short;
}

/* One path for a Windows command: forward slashes, and when that is not safe (a space, a non-ASCII letter) the short name
   instead, if that one is safe. A short name can keep some characters (an apostrophe, & ( ) !), so such a folder is
   refused. ensureStatusLine refuses ", %, $, ` and line breaks before this runs. With keepName the file name is kept long and only its folder is shortened (the script: MARKER);
   otherwise the whole path may be. null when no safe form exists; undefined when the short name could not be asked
   for. `shortPath` is injectable for tests. */
function winPath(p, shortPath, keepName) {
  if (typeof p !== 'string' || !p) return null;
  const s = p.replace(/\\/g, '/');
  if (WIN_SAFE.test(s)) return s;
  const cut = s.lastIndexOf('/');
  if (keepName && cut <= 0) return null;
  const head = keepName ? s.slice(0, cut) : s;
  const tail = keepName ? '/' + s.slice(cut + 1) : '';
  const short = shortPath(head.replace(/\//g, '\\'));
  if (short === undefined) return undefined;
  const out = short ? short.replace(/\\/g, '/') + tail : null;
  return out && WIN_SAFE.test(out) ? out : null;
}

/** The Windows statusline command (see WIN_SAFE), or with nothing written: null when a path cannot be made safe,
    undefined when a short name could not be asked for (worth another try). */
function winCommandFor(node, script, accountDir, shortPath = winShortPathCached) {
  const parts = [winPath(node, shortPath, false), winPath(script, shortPath, true), winPath(accountDir, shortPath, false)];
  if (parts.every(Boolean)) return parts.join(' ');
  return parts.includes(undefined) ? undefined : null;
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
 * scriptPath()), accountDir (default: the settings file's directory), shortPath
 * (win32: a folder's 8.3 name, for tests; default winShortPathCached).
 */
function ensureStatusLine(settingsPath, opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  const script = o.script === undefined ? scriptPath() : o.script;
  if (!script) return { wired: false, because: 'the statusline script is not on this machine' };
  if (typeof settingsPath !== 'string') return { wired: false, because: 'there is no settings file to wire' };
  /* kosmos#6713: the command names THIS engine's script, so anything that is not the installed Kosmos (a source
     checkout, a worktree, on a Mac or Linux a bundle under another KOSMOS_HOME) leaves a settings file in the real home alone
     (installroot.js has the rule). `leaveAlone` is injectable for tests: a reason string, or null to go ahead. */
  let leave = o.leaveAlone;
  if (leave !== undefined && leave !== null && typeof leave !== 'string') leave = 'this board was given a rule it cannot read, so it leaves this account\'s Claude settings alone';
  if (leave === undefined) {
    try { leave = require('./installroot').leaveAlone(settingsPath, { platform: o.platform }); }
    catch { leave = 'this board could not tell whether it is an installed Kosmos, so it leaves this account\'s Claude settings alone'; }
  }
  if (leave) return { wired: false, because: leave };
  const node = o.node || stableNode();
  const accountDir = o.accountDir || path.dirname(settingsPath);
  /* The command is a shell string, so every path in it is vetted the way the
     report hook vets its script: on posix quote, backslash, dollar, backtick
     and CR/LF are refused; on Windows quote, %, dollar, backtick and CR/LF
     (backslashes become forward slashes in winCommandFor). */
  if ([node, script, accountDir].some((p) => reporthook.unsafeForCommand(p, plat))) {
    return { wired: false, because: 'the statusline command path contains characters we will not embed in a command' };
  }
  if (reporthook.ephemeralMismatch(settingsPath, [node, script, accountDir])) {
    return { wired: false, because: 'a statusline command path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
  }
  const read = reporthook.readSettings(settingsPath);
  if (read.because) return { wired: false, because: read.because };
  const { target, data, prevMode } = read;
  const want = plat === 'win32' ? winCommandFor(node, script, accountDir, o.shortPath) : commandFor(node, script, accountDir);
  if (want === undefined) return { wired: false, because: 'Kosmos could not ask Windows for a folder\'s short name just now; set it up again to retry' };
  if (!want) return { wired: false, because: 'a folder Kosmos would run it from has a name Windows commands cannot take as it is, and Windows has no short name for it' };
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

/**
 * #6176: the account's five-hour reading, or null when there is none to trust (never recorded, unreadable, the wrong
 * shape, or from a window that has already reset). Returns { usedPct, resetsAt (epoch SECONDS), at (epoch ms) }.
 */
function readFiveHour(accountDir, now = Date.now()) {
  if (typeof accountDir !== 'string') return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(accountDir, statusline.FIVE_HOUR_FILE), 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const reading = statusline.fiveHourOf({ rate_limits: { five_hour: { used_percentage: j.usedPct, resets_at: j.resetsAt } } });
  if (!reading || !(typeof j.at === 'number' && Number.isFinite(j.at))) return null;
  if (reading.resetsAt * 1000 <= now) return null;
  if (reading.resetsAt > now / 1000 + statusline.FIVE_HOUR_MAX_AHEAD_SECONDS) return null;   // a five-hour window cannot reset further out: a bad file, not a reading
  return { usedPct: reading.usedPct, resetsAt: reading.resetsAt, at: j.at };
}

/* ---- The calibration (#3946 item 10): tokens per point of the weekly figure ----

   Kosmos cannot see the weekly allowance as a number of tokens; the provider does
   not publish it. What it can see is the figure MOVE while Kosmos's own agents on
   that account spend tokens it counts. Tokens counted today, divided by the points
   the figure moved today, is how many tokens one point of this account's week is
   worth. A swarm's "3% a day" is then 3 times that.

   The figure is a whole number, so the points it moved can be under-read by up to
   one; tokens are divided by points + 1 (calibrate's test pins it). The baseline is
   taken only from a reading made BEFORE today, never from today's first one, which
   would leave the day's first tokens counted with no points behind them. */

/* Points the figure must have moved today before a day's numbers are trusted: one
   point is a whole-number step of the provider's rounding, too coarse to divide by. */
const MIN_CALIBRATION_POINTS = 2;
/* A stored calibration older than this is not used: it describes a week that is over. */
const CALIBRATION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/* Past this age any qualifying day replaces it, so one heavy day cannot hold until it expires. */
const CALIBRATION_REPLACE_AGE_MS = 3 * 24 * 3600 * 1000;
const CALIBRATION_FILE = 'kosmos-weekly-calibration.json';

/**
 * Points the weekly figure moved since `dayStart` (epoch ms), or null when there is
 * no baseline: the figure must have a reading from BEFORE dayStart in the same week.
 */
function pointsSince(weekly, dayStart) {
  if (!weekly || !Array.isArray(weekly.history)) return null;
  const sameWeek = (r) => Math.abs(r[2] - weekly.resetsAt) < statusline.SAME_WEEK_TOLERANCE_SECONDS;
  const before = weekly.history.filter((r) => r[0] < dayStart && sameWeek(r));
  if (!before.length) return null;
  const base = before[before.length - 1][1];
  return Math.max(0, weekly.usedPct - base);
}

/** The stored calibration for an account, or null when there is none young enough. */
function readCalibration(accountDir, now = Date.now()) {
  if (typeof accountDir !== 'string') return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(accountDir, CALIBRATION_FILE), 'utf8')); } catch { return null; }
  if (!j || typeof j.tokensPerPoint !== 'number' || !Number.isFinite(j.tokensPerPoint) || j.tokensPerPoint <= 0) return null;
  if (typeof j.at !== 'number' || !(now - j.at < CALIBRATION_MAX_AGE_MS) || j.at > now) return null;
  return { tokensPerPoint: j.tokensPerPoint, points: Number.isFinite(j.points) ? j.points : 0,
    tokens: Number.isFinite(j.tokens) ? j.tokens : null, day: Number.isFinite(j.day) ? j.day : null, at: j.at };
}

/**
 * Update an account's calibration from today's numbers and return the one to use:
 * today's, when the figure moved at least MIN_CALIBRATION_POINTS since a baseline
 * from before today and at least as many points as the stored one rests on (or the
 * stored one is older than CALIBRATION_REPLACE_AGE_MS); otherwise
 * the last stored one (readCalibration); otherwise null.
 * `tokensToday` is every Kosmos agent's tokens on this account since `dayStart`,
 * counted the way the swarm limit counts them (swarm.meter), or NaN when a count was not
 * read in full this time (nothing is updated then). Never throws.
 */
function calibrate(accountDir, tokensToday, { now = Date.now(), dayStart } = {}) {
  try {
    const weekly = readWeekly(accountDir, now);
    const points = Number.isFinite(dayStart) ? pointsSince(weekly, dayStart) : null;
    const stored = readCalibration(accountDir, now);
    /* A day's estimate replaces the stored one once it rests on at least as many points, or
       once the stored one is older than CALIBRATION_REPLACE_AGE_MS. */
    const enough = points !== null && points >= MIN_CALIBRATION_POINTS
      && (!stored || points >= stored.points || now - stored.at > CALIBRATION_REPLACE_AGE_MS);
    /* Tokens counted today only grow: an agent stopped or removed mid-day drops out of the roster, and a
       meter that restarted reads less than it had, but neither un-spends what the figure already moved for.
       So the day's count is the most it has been (kept with the calibration, for today only). */
    const sameDay = stored && stored.day === dayStart && Number.isFinite(stored.tokens);
    const counted = Number.isFinite(tokensToday) ? Math.max(tokensToday, sameDay ? stored.tokens : 0) : NaN;
    if (enough && counted > 0) {
      const next = { tokensPerPoint: counted / (points + 1), points, tokens: counted, day: dayStart, at: now };
      if (sameDay && stored.points === points && stored.tokens === counted) return stored;   // nothing moved: no write
      const file = path.join(accountDir, CALIBRATION_FILE);
      /* #5434 slice 5: flushed before the rename, as the account's settings are (reporthook.writeSettings): an
         existing file keeps its mode, a new one takes the umask default; a failed save leaves the old file; in the
         provider's folder only this file's own dead temps are reaped. A failed save is not an error here (the
         estimate is returned either way, as before). No mode is carried on Windows, where a mode is only the
         read-only bit (as store.js does); reporthook.readSettings carries it everywhere, a difference left for the
         slice that aligns the two settings writers. */
      // (the same mode rule as kosmos-statusline's record, which keeps its own copy: it must work copied alone)
      let mode = null;
      if (process.platform !== 'win32') { try { mode = fs.statSync(file).mode & 0o777; } catch { mode = null; } }
      try { require('./securewrite').writeSecret(file, JSON.stringify(next) + '\n', mode, { atomicOnly: true, ownTempsOnly: true, umaskDefault: true }); }
      catch { /* not saved this time; the next calibration tries again */ }
      return next;
    }
  } catch { /* fall through to what is stored */ }
  return readCalibration(accountDir, now);
}

/* kosmos#6213: the Windows uninstall takes Kosmos's status line out of a settings file when it points inside the install
   being removed (as install/setup.sh does on the Mac), or the person's Claude Code runs a deleted node.exe on every
   refresh. `roots` are the install folder's spellings; each is also matched by its short name, since the command may
   carry that. Under the caller's lock. Returns { ours, changed, because }. */
function unwireStatusLine(settingsPath, roots, opts) {
  const o = opts || {};
  const shortPath = o.shortPath || winShortPathCached;
  const read = reporthook.readSettings(settingsPath);
  if (read.because) return { ours: false, changed: false, because: read.because };
  const { target, data, prevMode } = read;
  const sl = data.statusLine;
  if (!isOurs(sl)) return { ours: false, changed: false };
  const norm = (x) => String(x).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const spellings = [];
  for (const r of roots || []) {
    if (typeof r !== 'string' || !r) continue;
    spellings.push(norm(r));
    const sh = shortPath(r);
    if (sh) spellings.push(norm(sh));
  }
  const cmd = norm(sl.command);
  // Space-separated tokens are exact here: Kosmos only ever writes WIN_SAFE paths, which have none.
  const inside = spellings.some((r) => r && (cmd.startsWith(r + '/') || cmd.includes(' ' + r + '/')));
  /* Also ours when the script it names is already gone (an account wired from an earlier Kosmos folder), as the report
     hooks' unwire does: left in, it runs a missing file on every refresh. */
  /* The token must BE the script at a drive-qualified path, as Kosmos writes it: not a name ending in it
     (C:/me/my-kosmos-statusline.js), and not ~/... or a bare name, which goneOnDisk would resolve wrongly and call gone. */
  const script = String(sl.command).split(' ').map((t) => t.replace(/\\/g, '/')).find((t) => /^[A-Za-z]:\//.test(t) && t.endsWith('/' + MARKER));
  const isGone = o.gone || reporthook.goneOnDisk;   // only ENOENT/ENOTDIR: an unreadable folder is not gone (#5999 round 3)
  const gone = !!script && isGone(script);
  if (!inside && !gone) return { ours: false, changed: false };
  if (o.dryRun) return { ours: true, changed: false };
  delete data.statusLine;
  if (!reporthook.writeSettings(target, data, prevMode)) return { ours: true, changed: false, because: 'the settings file could not be saved' };
  return { ours: true, changed: true };
}

module.exports = { MARKER, scriptPath, stableNode, commandFor, winCommandFor, winShortPathCached, unwireStatusLine, isOurs, ensureStatusLine, readWeekly, readFiveHour,
  MIN_CALIBRATION_POINTS, CALIBRATION_MAX_AGE_MS, CALIBRATION_REPLACE_AGE_MS, CALIBRATION_FILE, pointsSince, readCalibration, calibrate };
