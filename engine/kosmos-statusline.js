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
 * that window by a few ms; a lower figure landing last is replaced by the next forward reading.)
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

/** The seven-day reading from a statusline payload, or null. Validated, not
 *  presence-checked: a present field of the wrong shape is worse than none. */
function weeklyOf(payload) {
  const rl = payload && typeof payload === 'object' ? payload.rate_limits : null;
  const s = rl && typeof rl === 'object' && !Array.isArray(rl) ? rl.seven_day : null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const pct = s.used_percentage;
  const resets = s.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return null;
  return { usedPct: pct, resetsAt: resets };
}

/** Record a reading in `dir`. True when it wrote, false when unchanged or it could not. */
function record(dir, reading, now) {
  const file = path.join(dir, FILE);
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* absent or unreadable: start fresh */ }
  if (cur && typeof cur.usedPct === 'number' && typeof cur.resetsAt === 'number') {
    const sameWeek = Math.abs(reading.resetsAt - cur.resetsAt) < SAME_WEEK_TOLERANCE_SECONDS;
    if (sameWeek ? reading.usedPct <= cur.usedPct : reading.resetsAt < cur.resetsAt) return false;
  }
  const history = cur && Array.isArray(cur.history) ? cur.history.slice(-(HISTORY_MAX - 1)) : [];
  history.push([now, reading.usedPct, reading.resetsAt]);
  const next = { usedPct: reading.usedPct, resetsAt: reading.resetsAt, at: now, history };
  const data = JSON.stringify(next) + '\n';
  /* #5434 slice 5: flushed before the rename (a crash otherwise can leave the file zero-filled, #5431), through
     securewrite, required only when there is something to write (this runs on every repaint and must stay cheap and
     must never show an error). In the provider's folder, only this file's own dead temps are reaped (ownTempsOnly).
     An existing file keeps its mode (not on Windows, where a mode is only the read-only bit); a new one takes the umask
     default. Should securewrite be missing (a copy outside the app folder, a half-swapped engine folder), the
     unflushed write below still records the reading; a save through it that fails returns false, and the reading is
     recorded on its next forward move. */
  let securewrite = null;
  try { securewrite = require('./securewrite'); } catch { securewrite = null; }
  if (securewrite) {
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
  const reading = weeklyOf(payload);
  if (reading) record(dir, reading, now);
}

if (require.main === module) {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { /* no input: nothing to record */ }
  try { main(process.argv, input, Date.now()); } catch { /* never show an error in the pane */ }
  process.exitCode = 0;
}

module.exports = { FILE, HISTORY_MAX, SAME_WEEK_TOLERANCE_SECONDS, weeklyOf, record, main };
