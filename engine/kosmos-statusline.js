'use strict';

/**
 * Kosmos's Claude Code statusline (#3946 phase B). Its only job is to write
 * down the account's weekly usage, as Anthropic counts it, where the engine
 * can read it. It prints NOTHING, so a pane looks exactly as it did before.
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
 * movement). Concurrent writers can still race; the rename keeps the file
 * whole, and a lost row is a gap in history, never a step backwards.
 *
 * Never throws and always exits 0: a statusline that errors shows its error
 * in the person's pane, and nothing here is worth that.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'kosmos-weekly.json';
const HISTORY_MAX = 400;

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
    /* Same week when the reset times are within a day of each other: weeks are seven
       days apart, and this keeps two sessions' slightly different reset stamps from
       reading as a new week and stepping the figure backwards. */
    const sameWeek = Math.abs(reading.resetsAt - cur.resetsAt) < 86400;
    if (sameWeek ? reading.usedPct <= cur.usedPct : reading.resetsAt < cur.resetsAt) return false;
  }
  const history = cur && Array.isArray(cur.history) ? cur.history.slice(-(HISTORY_MAX - 1)) : [];
  history.push([now, reading.usedPct, reading.resetsAt]);
  const next = { usedPct: reading.usedPct, resetsAt: reading.resetsAt, at: now, history };
  const tmp = file + '.' + process.pid + '.new';
  try {
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
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

module.exports = { FILE, HISTORY_MAX, weeklyOf, record, main };
