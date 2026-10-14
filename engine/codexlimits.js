'use strict';
/**
 * kosmos#6176 slice 2: an OpenAI (Codex) account's plan limits, as Codex itself last reported them.
 *
 * Codex writes its limits into its own session files: each `token_count` event in
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` carries
 *   "rate_limits": { "primary": { "used_percent": 0.0, "window_minutes": 10080, "resets_at": 1791985721 },
 *                    "secondary": null, "plan_type": "prolite", ... }
 * (measured 2026-10-14 on this computer, a ChatGPT sign-in on the prolite plan). Kosmos runs Codex, so the newest
 * session file in an account's home holds that account's latest report. Nothing here asks OpenAI anything.
 *
 * Read cheaply: only the end of the newest few files (a session file can run to megabytes, and the last report is at
 * its end), newest first by name, which carries the timestamp. A window whose reset time has passed is dropped: that
 * figure is from a window that is over. Never throws.
 */
const fs = require('node:fs');
const codexsession = require('./codexsession');

const FILES_TRIED = 3;
const TAIL_BYTES = 256 * 1024;

/** One window `{ used_percent, window_minutes, resets_at }`, validated, or null. resetsAt in epoch ms. */
function windowOf(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const pct = w.used_percent, mins = w.window_minutes, resets = w.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return null;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return null;
  return { usedPct: pct, windowMinutes: mins, resetsAt: resets * 1000 };
}

/** The `rate_limits` of one parsed rollout row, as `{ windows, plan }`, or null when the row carries none. */
function limitsOfRow(row) {
  const p = row && row.type === 'event_msg' && row.payload && typeof row.payload === 'object' ? row.payload : null;
  const rl = p && p.type === 'token_count' ? p.rate_limits : null;
  if (!rl || typeof rl !== 'object' || Array.isArray(rl)) return null;
  const windows = [rl.primary, rl.secondary].map(windowOf).filter(Boolean);
  if (!windows.length) return null;
  return { windows, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null };
}

/** The last 256 KB of a file as text, or '' when it cannot be read. A first line cut in half fails to parse and is skipped. */
function tail(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return ''; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to do */ } } }
}

/**
 * The account's latest report: `{ windows: [{ usedPct, windowMinutes, resetsAt (ms) }], plan, at (ms) }`, or null when
 * no session file in `home` carries one, or every window it reports has already reset.
 */
function read(home, now = Date.now()) {
  if (typeof home !== 'string' || !home) return null;
  let files;
  try { files = codexsession.rollouts(home).slice(0, FILES_TRIED); } catch { return null; }
  for (const file of files) {
    const lines = tail(file).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line.indexOf('rate_limits') === -1) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const lim = limitsOfRow(row);
      if (!lim) continue;
      const at = Date.parse(row.timestamp);
      if (!Number.isFinite(at)) continue;
      const windows = lim.windows.filter((w) => w.resetsAt > now);
      return windows.length ? { windows, plan: lim.plan, at } : null;   // the newest report decides, even when it is over
    }
  }
  return null;
}

module.exports = { read, windowOf, limitsOfRow, FILES_TRIED, TAIL_BYTES };
