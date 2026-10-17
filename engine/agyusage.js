'use strict';
/**
 * kosmos#6176 slice 4: a Google subscription's Gemini usage, as Antigravity reports it.
 *
 * `agy -p "/usage" --output-format json` answers from agy's own record of the plan without starting an agent turn
 * (measured 2026-10-17 on this computer, agy 1.4.0: num_turns 0, total_tokens 0, about a second). The payload:
 *   { status, num_turns, usage: {...}, command: { name: "usage", data: { description, groups: [
 *     { name: "Gemini Models", description, buckets: [
 *       { id, name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 0.9947, reset_time: "<RFC 3339>" },
 *       { id, name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 1, reset_time: "<RFC 3339>" } ] },
 *     { name: "Claude and GPT models", ... }, { name: "Gemini 4 Argon", ... } ] } } }
 * Only the "Gemini Models" group is read: those are the models Kosmos runs Gemini agents on. It is matched by name, so
 * a renamed or split group shows nothing rather than another group's figure.
 *
 * It is a network call (agy asks Google), so it is never run per repaint: the accounts route shows the last reading
 * and asks for a new one at most every REFRESH_MS, one run at a time (agy's sign-in covers the whole computer, so one
 * reading covers the row). A failed run keeps the last good reading and stops the asking until agy's sign-in is next
 * confirmed; the page shows the reading's age, and a window whose reset has passed is not drawn. macOS only: on Windows a signed-out print run can open a browser, and /usage there is
 * unmeasured. Never runs agy in a test process unless the test supplies the runner.
 *
 * The reading has codexlimits.read's shape, { windows: [{ usedPct, windowMinutes, resetsAt }], plan, at }, so the
 * page draws it the same way.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const GROUP = 'Gemini Models';
const WINDOW_MINUTES = { weekly: 7 * 1440, '5h': 300 };
const REFRESH_MS = 5 * 60e3;   // the route asks for a new reading at most this often
const CAP_SECONDS = 30;        // agy's own print timeout, as agystatus passes (review 1)
const KILL_MS = 45000;

/** The Gemini group's reading from agy's /usage JSON (an object or its text), or null. `at` is epoch ms. */
function parse(payload, at) {
  let j = payload;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return null; } }
  if (!j || typeof j !== 'object') return null;
  // A run that started a turn is not this command's answer (the measured run starts none).
  if (j.num_turns !== undefined && j.num_turns !== 0) return null;
  const cmd = j.command && typeof j.command === 'object' ? j.command : null;
  if (!cmd || cmd.name !== 'usage' || !cmd.data || !Array.isArray(cmd.data.groups)) return null;
  const g = cmd.data.groups.find((x) => x && x.name === GROUP);
  if (!g || !Array.isArray(g.buckets)) return null;
  const windows = [];
  for (const b of g.buckets) {
    if (!b || typeof b !== 'object') continue;
    const mins = WINDOW_MINUTES[b.window];
    const f = b.remaining_fraction;
    const resetsAt = Date.parse(b.reset_time);
    if (!mins || typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1 || !Number.isFinite(resetsAt)) continue;
    /* Rounded DOWN to a whole percent, once (review 1): a page that rounds 99.5 to 100 would say "at its limit" while
       Gemini still has room. 100 only when nothing is left. */
    windows.push({ usedPct: Math.floor((1 - f) * 100 + 1e-9), windowMinutes: mins, resetsAt });
  }
  windows.sort((a, b) => a.windowMinutes - b.windowMinutes);   // five-hour first, as Codex reports them
  return windows.length ? { windows, plan: null, at } : null;
}

/* The seam a test replaces: run agy's /usage once and hand back (err, stdout). */
const defaultRunAgy = (bin, done) => {
  let dir = null;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agy-usage-')); } catch { dir = os.tmpdir(); }
  execFile(bin, ['-p', '/usage', '--output-format', 'json', '--print-timeout', CAP_SECONDS + 's'], { cwd: dir, timeout: KILL_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 },
    (err, stdout) => {
      if (dir && dir !== os.tmpdir()) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
      done(err, String(stdout || ''));
    });
};
let runAgy = defaultRunAgy;
let runnerSetByTest = false;
/** null puts agy's own run back (and with it the test-process refusal). */
function setRunnerForTests(fn) { runAgy = fn || defaultRunAgy; runnerSetByTest = !!fn; }

let last = null;        // the last good reading
let askedAt = 0;        // when a run was last started
let running = null;     // the run in flight, shared
let stopped = false;    // a run failed or hung: ask no more until agy's sign-in is next confirmed (review 3)
let generation = 0;     // bumped by clear(): a run started before it is another sign-in's, and its answer is dropped

/** The last good reading, or null. Never runs anything. */
function lastReading() { return last; }

/**
 * Start a new reading when the last one is older than REFRESH_MS and none is running. Returns the run's promise
 * (resolving to the reading or null), or null when nothing was started. Never throws.
 */
function refresh(now = Date.now()) {
  try {
    if (running) return null;
    if (now - askedAt < REFRESH_MS) return null;
    if (stopped) return null;
    if (!supported()) return null;
    if (!tokenPresent()) return null;
    if (!runnerSetByTest && require('./live-execution').inTestRun()) return null;
    const inst = require('./runners').resolveBin('antigravity');
    if (!inst || !inst.present || !inst.bin) return null;
    askedAt = now;
    const gen = generation;
    running = new Promise((resolve) => {
      let done = false;
      const cap = setTimeout(() => { if (!done) { done = true; if (gen === generation) stopped = true; resolve(null); } }, KILL_MS + 5000);
      if (cap.unref) cap.unref();   // a hung run never holds the board (or a test) open
      try {
        runAgy(inst.bin, (err, out) => {
          if (done) return;
          done = true; clearTimeout(cap);
          if (gen !== generation) { resolve(null); return; }   // the sign-in changed while it ran (review 2): not this row's
          /* A run that failed (offline, or agy signed out since Kosmos last checked) stops the asking until agy's sign-in is
             next confirmed (review 3): a signed-out print run may open a browser, so it must not repeat unprompted. An
             answer that came back but cannot be read (a renamed group) waits the full interval like any other. */
          if (err) { stopped = true; resolve(null); return; }
          const r = parse(out, Date.now());
          if (r) last = r;
          resolve(r);
        });
      } catch { done = true; clearTimeout(cap); resolve(null); }
    }).finally(() => { running = null; });
    return running;
  } catch { return null; }
}
function isRunning() { return !!running; }
/* Where a reading can be asked for at all (review 1): a Mac, as agystatus judges the platform. On Windows a signed-out
   print run can open a browser and /usage there is unmeasured, so the row carries no limits field and draws nothing. */
function supported() { try { return require('./agystatus').platform() === 'darwin'; } catch { return false; } }
/** Drop the reading and the throttle: the sign-in was checked again or removed, so the next read asks afresh
    (review 1: a reading must not outlive a change of Google account). */
function clear() { last = null; askedAt = 0; stopped = false; generation++; }
/* agy keeps its Google sign-in in this file (measured: present while signed in). A run is never started without it.
   Whether signing out removes it is unmeasured, so this only narrows the runs; `stopped` is the guard that holds. */
let tokenFileForTests = null;
function tokenPresent() {
  try {
    const f = tokenFileForTests || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    return fs.existsSync(f);
  } catch { return false; }
}
function setTokenFileForTests(f) { tokenFileForTests = f || null; }
function resetForTests() { last = null; askedAt = 0; running = null; stopped = false; generation++; runAgy = defaultRunAgy; runnerSetByTest = false; tokenFileForTests = null; }

module.exports = { parse, refresh, lastReading, isRunning, supported, clear, setRunnerForTests, setTokenFileForTests, resetForTests, GROUP, REFRESH_MS };
