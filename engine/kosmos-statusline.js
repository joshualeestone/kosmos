'use strict';

/**
 * Kosmos's Claude Code statusline (#3946 phase B). Its only job is to write
 * down the account's weekly usage, as Anthropic counts it, where the engine
 * can read it. It prints nothing. Measured 2026-09-26 on Claude Code 2.1.283:
 * a configured status line that prints nothing still takes one empty row under
 * the prompt, and the footer's "? for shortcuts" hint is not shown, compared
 * with no status line at all. That is the visible cost of this reading.
 *
 * Why a statusline: Claude Code hands the weekly figure to exactly one
 * place, the statusline's input. Measured 2026-09-26 on Claude Code 2.1.283:
 * the input carries
 *   "rate_limits":{"five_hour":{...},"seven_day":{"used_percentage":42,"resets_at":1790949600}}
 * on one compact line, and the hook events (UserPromptSubmit, Stop) carry no
 * rate_limits at all, so the report hook cannot capture it. The figure is
 * absent for API-key accounts and before an account's first request; then
 * nothing is written, and the engine treats the account as having no weekly
 * reading (the honest fallback, never a guess).
 *
 * Wired by engine/allowance.js as `"<node>" "<this file>" "<account dir>"`.
 * The account dir is baked into the command at wire time, so the reading
 * lands beside the settings file that asked for it and never depends on
 * which environment the agent happened to inherit.
 *
 * Written only when the reading MOVES FORWARD. Claude Code runs a statusline
 * on every repaint, so an unchanged reading is not rewritten. And each session
 * carries the figure from its own last API response, so several agents on one
 * account repaint with readings that lag each other: within one week a LOWER
 * figure is stale, not news, and a reading for an earlier week is ignored.
 * `history` keeps each forward step with the moment it was first seen, which
 * is what the calibration reads (tokens Kosmos measured per point of weekly
 * movement). Concurrent writers can still race: the rename keeps the file
 * whole, and whichever renames last stands until the next reading. (Since #5434 the flush before the rename widens
 * that window by a few ms. A lower usedPct landing last is replaced by the next forward reading; a history row
 * written by the losing session is lost for good, which can lower the calibration's point count a little.)
 *
 * Never throws and always exits 0: a statusline that errors shows its error
 * in the person's pane, and nothing here is worth that.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'kosmos-weekly.json';
/* Rows of history kept, one per forward step of the weekly figure: enough for
   the calibration to see more than one week, and a bound on the file's size. */
const HISTORY_MAX = 400;
/* Two readings are the same week when their reset times are within this many
   seconds. Weeks reset seven days apart, so a day separates "the same reset,
   stamped slightly differently by two sessions" from "the next week" with room
   on both sides. */
const SAME_WEEK_TOLERANCE_SECONDS = 86400;
/* kosmos#6570: for a latest-wins writer, two readings whose reset times are this close are the same account's same
   window (the provider's reset is one fixed time; this allows only for a rounding), so its history carries on. */
const LATEST_SAME_RESET_SECONDS = 60;
/* #6176: the five-hour reading, in its own file so the weekly file's history and its calibration are untouched. Its
   windows reset five hours apart, so readings within an hour of each other's reset time are the same window. */
const FIVE_HOUR_FILE = 'kosmos-fivehour.json';
const SAME_WINDOW_TOLERANCE_SECONDS = 3600;
/* #6176: no five-hour window resets further out than this; a reset beyond it is a bad reading or file. One value, used
   by record() here and by allowance.readFiveHour, so the writer and the reader cannot disagree. */
const FIVE_HOUR_MAX_AHEAD_SECONDS = 6 * 3600;

/** The seven-day reading from a statusline payload, or null. Validated, not
 *  presence-checked: a present field of the wrong shape is worse than none. */
function weeklyOf(payload) { return windowOf(payload, 'seven_day'); }
/** The five-hour reading (#6176), validated the same way, or null. */
function fiveHourOf(payload) { return windowOf(payload, 'five_hour'); }
function windowOf(payload, key) {
  const rl = payload && typeof payload === 'object' ? payload.rate_limits : null;
  const s = rl && typeof rl === 'object' && !Array.isArray(rl) ? rl[key] : null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const pct = s.used_percentage;
  const resets = s.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return null;
  return { usedPct: pct, resetsAt: resets };
}

/** Record a reading in `dir`. True when it wrote, false when unchanged or it could not. The weekly file by default;
 *  `opt` names another window's file, its same-window tolerance, and whether it keeps history (#6176). */
function record(dir, reading, now, opt = {}) {
  const file = path.join(dir, opt.file || FILE);
  const tolerance = opt.tolerance ?? SAME_WEEK_TOLERANCE_SECONDS;
  const keepHistory = opt.history !== false;
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* absent or unreadable: start fresh */ }
  /* #6176: a stored reset further out than this window can be (a bad file) is not a window to compare against, or every
     real reading after it would be refused as older until that impossible time passed. */
  if (cur && opt.maxAheadSeconds && typeof cur.resetsAt === 'number' && cur.resetsAt > now / 1000 + opt.maxAheadSeconds) cur = null;
  // And an incoming one like that is not recorded: it would replace a good reading with one nothing will show.
  if (opt.maxAheadSeconds && reading.resetsAt > now / 1000 + opt.maxAheadSeconds) return false;
  if (cur && typeof cur.usedPct === 'number' && typeof cur.resetsAt === 'number') {
    const sameWindow = Math.abs(reading.resetsAt - cur.resetsAt) < tolerance;
    /* kosmos#6570: `latestWins` is for a writer whose every reading is the provider's answer at that moment (a Windows
       agent's rate_limit_event, sent as the response arrives), not a figure a session carried from its last response.
       Then a lower figure in the same window is news, not lag (measured on the Windows box 10-22: the stored 96% and a
       live 3% in the same week, after the folder's sign-in changed), so only an unchanged one is skipped. */
    /* (Review 4: a same figure under a moved reset is still news: the reset is part of the reading.) */
    const stale = opt.latestWins
      ? reading.usedPct === cur.usedPct && Math.abs(reading.resetsAt - cur.resetsAt) < LATEST_SAME_RESET_SECONDS
      : reading.usedPct <= cur.usedPct;
    /* And a different window is news too while its reset is still ahead: a folder signed in to another account carries
       that account's own reset, which can fall before the stored one (review 1). One already past is not current. */
    const older = opt.latestWins ? reading.resetsAt * 1000 <= now : reading.resetsAt < cur.resetsAt;
    if (sameWindow ? stale : older) return false;
  }
  const next = { usedPct: reading.usedPct, resetsAt: reading.resetsAt, at: now };
  if (keepHistory) {
    /* kosmos#6570 review 2: a latest-wins figure LOWER than the stored one in the same window is not usage going back:
       the folder now answers for another account (or the provider reset it). Its earlier rows would be read as this
       account's baseline by the calibration (allowance.pointsSince), so the history starts again from here. Two agents
       on one account racing (each writer reads, then renames) can also land an older figure last; the next event puts
       the current one back, at the cost of a restarted history, which only delays a calibration. */
    /* Review 3: and on ANY change of reset time, which a higher figure can hide: one account's reset is one fixed time
       (measured on the Windows box: 1792965600 in events a day apart), so another one is another account or another
       week, and either way the older rows are no baseline for this one. */
    const restart = !!(opt.latestWins && cur && typeof cur.usedPct === 'number' && typeof cur.resetsAt === 'number'
      && (Math.abs(reading.resetsAt - cur.resetsAt) >= LATEST_SAME_RESET_SECONDS || reading.usedPct < cur.usedPct));
    const history = !restart && cur && Array.isArray(cur.history) ? cur.history.slice(-(HISTORY_MAX - 1)) : [];
    history.push([now, reading.usedPct, reading.resetsAt]);
    next.history = history;
  }
  const data = JSON.stringify(next) + '\n';
  /* #5434 slice 5: flushed before the rename (a crash otherwise can leave the file zero-filled, #5431), through
     securewrite, required only when there is something to write (this runs on every repaint and must stay cheap and
     must never show an error). In the provider's folder, only this file's own dead temps are reaped (ownTempsOnly).
     An existing file keeps its mode (not on Windows, where a mode is only the read-only bit); a new one takes the umask
     default. Should securewrite be MISSING (a copy outside the app folder; an older securewrite that loads is not covered), the
     unflushed write below still records the reading; a save through it that fails returns false, and the reading is
     recorded on its next forward move. */
  let securewrite = null;
  try { securewrite = require('./securewrite'); } catch { securewrite = null; }
  if (securewrite) {
    // (the same mode rule as allowance.calibrate's save; kept inline here because this file must work copied alone;
    // statSync follows a link, so a symlinked file is replaced by a regular file at its target's mode)
    let mode = null;
    if (process.platform !== 'win32') { try { mode = fs.statSync(file).mode & 0o777; } catch { mode = null; } }
    try { securewrite.writeSecret(file, data, mode, { atomicOnly: true, ownTempsOnly: true, umaskDefault: true }); return true; }
    catch { return false; }
  }
  const tmp = file + '.' + process.pid + '.new';
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    return false;
  }
}

function main(argv, input, now) {
  const dir = argv[2];
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return;
  try { if (!fs.statSync(dir).isDirectory()) return; } catch { return; }
  let payload = null;
  try { payload = JSON.parse(input); } catch { return; }
  let weekly = null; let fiveHour = null;
  try { weekly = weeklyOf(payload); } catch { weekly = null; }
  try { fiveHour = fiveHourOf(payload); } catch { fiveHour = null; }
  recordReadings(dir, { weekly, fiveHour }, now);
}

/** Record a weekly and a five-hour reading (either may be null) in `dir`, each on its own: a failure recording one must
 *  never cost the other. The one place the two files' options live, shared by main() here and by a Windows agent's
 *  event stream (kosmos#6570, engine/win32streamstate.js), so the two writers cannot disagree. Never throws. */
function recordReadings(dir, readings, now, opt = {}) {
  const r = readings && typeof readings === 'object' ? readings : {};
  const latestWins = !!(opt && opt.latestWins);   // see record(): only for readings that are the provider's answer now
  try { if (r.weekly) record(dir, r.weekly, now, { latestWins }); } catch { /* the five-hour one still goes */ }
  try { if (r.fiveHour) record(dir, r.fiveHour, now, { file: FIVE_HOUR_FILE, tolerance: SAME_WINDOW_TOLERANCE_SECONDS, history: false, maxAheadSeconds: FIVE_HOUR_MAX_AHEAD_SECONDS, latestWins }); } catch { /* nothing to show */ }
}

if (require.main === module) {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { /* no input: nothing to record */ }
  try { main(process.argv, input, Date.now()); } catch { /* never show an error in the pane */ }
  process.exitCode = 0;
}

module.exports = { FILE, HISTORY_MAX, SAME_WEEK_TOLERANCE_SECONDS, FIVE_HOUR_FILE, SAME_WINDOW_TOLERANCE_SECONDS, FIVE_HOUR_MAX_AHEAD_SECONDS, weeklyOf, fiveHourOf, record, recordReadings, main };
