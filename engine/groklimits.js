'use strict';
/**
 * kosmos#6176 slice 3: a Grok subscription's usage, as Grok itself last logged it.
 *
 * On a grok.com sign-in, the Grok CLI fetches its billing state and logs it into its own log,
 * `<GROK_HOME>/logs/unified.jsonl`, one JSON object per line (`ts, lvl, src, pid, sid, ver, msg, ctx`):
 *   msg "billing: fetched credits config", ctx { config: { creditUsagePercent: 67.0,
 *     currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "<RFC 3339>", end: "<RFC 3339>" }, ... },
 *     subscriptionTier: "X Premium" }
 * (measured 2026-10-16 on this computer: 43 such lines from 09-26 to 09-29; the percent is of the plan's included
 * credits in the current period, and `end` is when it resets). Nothing here asks xAI anything: it reads the tail of a
 * file Grok wrote. An API key never gets this line (Grok's billing read needs a grok.com sign-in), so the caller asks
 * only for a subscription account.
 *
 * Grok does not log a fetch every session (none here after 09-29, though Grok ran on 10-05, 10-07 and 10-10), so a
 * reading can be days old: `at` is the line's own time, for the page to say how old it is, and a reading whose period
 * has ended is dropped (its figure belongs to a period that is over). A line whose shape is not the one above is
 * skipped: no figure is better than a wrong one. Read cheaply: the last 256 KB of the log, then 1 MB, then 4 MB, only
 * while no reading is found (a busy day logs past 256 KB, measured: the 09-29 readings sit 1.2 MB from the end of a
 * 1.5 MB log). Never throws.
 *
 * Returns { windows: [{ usedPct, windowMinutes, resetsAt }], plan, at } (times in epoch ms), the shape
 * codexlimits.read returns, so the page draws both the same way; or null.
 */
const fs = require('node:fs');
const path = require('node:path');

const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];   // read further back only when no reading is found
const BILLING_MSG = 'billing: fetched credits config';

/** The last `bytes` of a file as text, or '' when it cannot be read. A first line cut in half fails to parse. */
function tail(file, bytes) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

/** One log line's billing reading, validated, or null. */
function readingOfRow(row) {
  if (!row || typeof row !== 'object' || row.msg !== BILLING_MSG) return null;
  const at = Date.parse(row.ts);
  const ctx = row.ctx && typeof row.ctx === 'object' ? row.ctx : null;
  const c = ctx && ctx.config && typeof ctx.config === 'object' ? ctx.config : null;
  if (!c || !Number.isFinite(at)) return null;
  const pct = c.creditUsagePercent;
  const p = c.currentPeriod && typeof c.currentPeriod === 'object' ? c.currentPeriod : null;
  const start = p ? Date.parse(p.start) : NaN;
  const end = p ? Date.parse(p.end) : NaN;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    windows: [{ usedPct: pct, windowMinutes: Math.round((end - start) / 60000), resetsAt: end }],
    plan: typeof ctx.subscriptionTier === 'string' && ctx.subscriptionTier ? ctx.subscriptionTier : null,
    at,
  };
}

/**
 * The newest billing reading in `<home>/logs/unified.jsonl`, or null: no log, no reading, or its period is over.
 * @param {string} home  the account's Grok folder (~/.grok, or a named account's ~/.grok-<label>)
 * @param {number} [now] epoch ms
 */
function read(home, now = Date.now()) {
  try {
    if (typeof home !== 'string' || !home) return null;
    const file = path.join(home, 'logs', 'unified.jsonl');
    let size = 0; try { size = fs.statSync(file).size; } catch { return null; }
    for (const bytes of TAIL_STEPS) {
      const text = tail(file, bytes);
      if (!text) return null;
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || line.indexOf(BILLING_MSG) === -1) continue;
        let row; try { row = JSON.parse(line); } catch { continue; }
        const r = readingOfRow(row);
        if (!r) continue;
        // The newest reading decides, even when its period is over: then there is no current figure.
        const windows = r.windows.filter((w) => w.resetsAt > now);
        return windows.length ? { ...r, windows } : null;
      }
      if (bytes >= size) return null;   // the whole file was read
    }
    return null;
  } catch { return null; }
}

module.exports = { read, readingOfRow, BILLING_MSG, TAIL_STEPS };
