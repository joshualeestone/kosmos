'use strict';
/**
 * The win32 roster provider: the Windows source for `status.setPaneSource` (#570).
 *
 * On a Mac the roster comes from `tmux list-panes` formatted as PANE_COLUMNS.
 * Windows has no tmux. `claude agents --json` is the server-invokable
 * replacement (windows-orchestrator proved it on the box, and it needs no
 * running agent): it lists the machine's Claude sessions with
 * { pid, cwd, kind, startedAt, sessionId, name, status }. This module turns that
 * JSON into the exact PANE_COLUMNS tab-separated text `status.parsePanes`
 * already reads, so the entire engine ownership + classification path is reused
 * UNCHANGED behind the source seam ("replaces where the TEXT comes from, never
 * what is done with it").
 *
 * 🛑 TWO FAIL-CLOSED PROPERTIES, because `claude agents --json` lists EVERY
 * Claude session including the operator's own, and the board must manage only
 * Kosmos's:
 *   1. EMIT ONLY RECORDED SESSIONS. A row is produced only for a live session
 *      whose sessionId is in `win32sessions` (the Kosmos-created record). An
 *      unrecorded session -- the operator's own -- is never emitted, so no code
 *      path on the board ever touches it.
 *   2. command = "claude.exe", NOT a version string. `status.isClaudeCommand`
 *      accepts "claude.exe" so an emitted row classifies as a real agent
 *      (typeable / restartable), but `status.isNativeClaude` matches ONLY a
 *      three-segment version (e.g. 2.1.212), so the ownership PROCESS arm
 *      (`isNativeClaude(command)`) does NOT fire on a synthesized row.
 *
 * 🛑 PROPERTY 1 IS THE LOAD-BEARING ONE; PROPERTY 2 IS NOT AN INDEPENDENT
 * BACKSTOP. It is tempting to say "even if an unrecorded row were emitted, the
 * process arm could not claim it, so property 2 alone is a safety net." That is
 * FALSE, and stating it would invite someone to lean on property 2. `isNamedOurs`
 * has a legacy arm that matches a session NAME ending in `-discord`, entirely
 * independent of the claim column and of the command -- so an unrecorded row
 * named `*-discord` with an empty claim WOULD read as ours despite property 2.
 * Property 2 defeats only the isNativeClaude PROCESS arm; it does not neutralize
 * the `-discord$` NAME arm. What actually closes the hole is property 1: an
 * unrecorded session is never emitted at all, so no such row exists to be claimed
 * by any arm. Operator `claude agents --json` sessions are named like `agent1-d2`,
 * not `*-discord`, so this is not reachable today -- but the guarantee is
 * property 1, and property 2 is a defense-in-depth that narrows, not closes.
 *
 * ⚠️ A read failure returns NULL, never "". `listPanes` treats null as "we could
 * not see what is running" and refuses honestly, exactly as a failed
 * `tmux list-panes` does. Returning "" would report an empty machine off a look
 * that never happened -- the false-zero this whole module family exists to stop.
 */
const { execFileSync } = require('node:child_process');
const win32sessions = require('./win32sessions');
const win32codexlive = require('./win32codexlive');

/* The synthesized command. See the header: classifies as a Claude agent via
   isClaudeCommand, but is NOT a version string, so the ownership process arm
   (isNativeClaude) stays off and the claim is the sole ownership evidence. */
const WIN32_COMMAND = 'claude.exe';

/**
 * Is this a pane this roster emitted? The ONE test for the mark above, owned by
 * the module that stamps it, so `status.classify`'s win32 arm and the card's
 * `reachedByChannel` (#570 7c-4) cannot come to disagree about which agents are
 * Windows agents.
 */
function isWin32Pane(pane) {
  return Boolean(pane) && pane.command === WIN32_COMMAND;
}

/* A tab or newline in a field would break the PANE_COLUMNS framing (tab-separated,
   one row per line). Agent names from `claude agents --json` do not contain them,
   but a field is caller-external text, so flatten defensively rather than smuggle
   a row break. */
function flat(v) {
  return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
}

/**
 * Default exec: run `claude agents --json` and parse it. Returns the array, or
 * null on ANY failure (claude missing, non-zero exit, unparseable) so the caller
 * refuses honestly. Never throws.
 */
function defaultRun() {
  let out;
  try {
    // Resolve `claude` through the codebase's ONE runner-resolution seam
    // (engine/runners.resolveBin) so the AGENT_WORKFORCE_CLAUDE_BIN sandbox
    // override is honoured, exactly like every other claude invocation
    // (connect/create/machine/subscription) rather than a second bare `claude`.
    const bin = require('./runners').resolveBin('claude').bin;
    // ⚠️ maxBuffer RAISED to 16 MiB for the SAME reason machine.js:43-50 did:
    // a busy machine with many concurrent sessions makes `claude agents --json`
    // large (long cwd/name fields), and Node's 1 MiB default would make
    // execFileSync throw -> null -> the whole roster blanks on a healthy box.
    out = execFileSync(bin, ['agents', '--json'], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(out); } catch { return null; }
  return Array.isArray(parsed) ? parsed : null;
}

/* The same read as `defaultRun`, without blocking: the child runs while the board
   goes on answering. Calls back with the array, or null on any failure, exactly
   the shapes `defaultRun` returns. Never throws. */
function defaultRunAsync(cb) {
  let bin;
  try { bin = require('./runners').resolveBin('claude').bin; } catch { cb(null); return; }
  try {
    require('node:child_process').execFile(bin, ['agents', '--json'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, out) => {
        if (err) { cb(null); return; }
        let parsed;
        try { parsed = JSON.parse(out); } catch { cb(null); return; }
        cb(Array.isArray(parsed) ? parsed : null);
      });
  } catch { cb(null); }
}

/* How long an answer is served as it stands, and how long past that it is still
   served while a fresh one is fetched in the background. */
const FRESH_MS = 2000;
const STALE_MS = 30000;

/**
 * `claude agents --json`, read ONCE for everybody and kept for a moment.
 *
 * 🛑 THIS READ WAS THE BOARD'S WHOLE WAIT ON WINDOWS. Measured on the fleet box:
 * the call costs ~230ms, and a DM send made THREE of them back to back (the name
 * gate's `paneRoster`, the snapshot's `listPanes`, and the capture's live read),
 * a thread GET three more, and every status poll two, all synchronous on the one
 * thread that answers the page. On a weaker laptop each call is seconds, the
 * polls queue behind each other, and a person's message sat unanswered for over a
 * minute while the machine looked idle (one core busy).
 *
 * So: an answer younger than `freshMs` is served as it is. One younger than
 * `staleMs` is served too, and a fresh read starts in the BACKGROUND (one at a
 * time), so the next request gets it. Only a cold cache (the first read, or a
 * board nobody has asked for `staleMs`) reads synchronously, as before.
 *
 * ⚠️ WHAT IT COSTS: a card can trail the machine by up to one poll plus one read
 * (an agent that has just stopped still shows for a few seconds). Nothing is
 * decided off it that the next step does not check again: a send to an agent that
 * has gone is refused by its own channel, and the loops that must see a process
 * leave or arrive (`win32stop`, `win32create`) read through `win32live` with the
 * uncached `defaultRun`, not this.
 *
 * ⚠️ A FAILED READ IS KEPT AS null, never as the last good list, so "we could not
 * look" still reaches every caller as itself.
 */
function makeCachedRun(opts) {
  const o = opts || {};
  const run = typeof o.run === 'function' ? o.run : defaultRun;
  const runAsync = typeof o.runAsync === 'function' ? o.runAsync : defaultRunAsync;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const freshMs = Number.isFinite(o.freshMs) ? o.freshMs : FRESH_MS;
  const staleMs = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
  let cache = null;       // { at, value }
  let inFlight = false;
  function cachedRun() {
    const t = now();
    const age = cache ? t - cache.at : Infinity;
    if (cache && age < freshMs) return cache.value;
    if (cache && age < staleMs) {
      if (!inFlight) {
        inFlight = true;
        const started = t;
        try {
          runAsync((value) => {
            inFlight = false;
            // A synchronous read that landed while this one ran is newer; keep it.
            if (!cache || cache.at <= started) cache = { at: now(), value: Array.isArray(value) ? value : null };
          });
        } catch { inFlight = false; }
      }
      return cache.value;
    }
    const value = run();
    cache = { at: now(), value: Array.isArray(value) ? value : null };
    return cache.value;
  }
  cachedRun.forget = () => { cache = null; };
  return cachedRun;
}

/* The one shared reader the board's roster and live-state sources use, so a
   request that asks both pays for one read, not two. */
const cachedRun = makeCachedRun();

/**
 * Build the paneSource function to hand to `status.setPaneSource` on win32.
 *
 * @param {object} [opts]
 * @param {() => (Array|null)} [opts.run] the `claude agents --json` reader,
 *   injectable for tests; returns the parsed array or null on failure. The
 *   default is the shared `cachedRun`, not a fresh read per call.
 * @param {{ read: () => object }} [opts.record] the ownership record (default
 *   the real win32sessions), injectable for tests.
 * @returns {() => (string|null)} a paneSource: PANE_COLUMNS text, or null on a
 *   failed look.
 */
function make(opts) {
  const run = opts && typeof opts.run === 'function' ? opts.run : cachedRun;
  const record = opts && opts.record ? opts.record : win32sessions;
  /* #3380: the codex live source, injectable for tests. */
  const codexLive = opts && typeof opts.codexLive === 'function' ? opts.codexLive : win32codexlive.liveSessions;
  return function win32PaneSource() {
    const agents = run();
    /* #3380: the codex live source is INDEPENDENT of `claude agents --json` -- it
       reads the ownership record and the codex supervisors' presence, never claude
       -- so it is asked whether or not the claude read succeeded. */
    let codexRows = [];
    try { codexRows = codexLive() || []; } catch { codexRows = []; }
    const claudeOk = Array.isArray(agents);
    /* 🛑 #3380 THE null IS NOW CLAUDE-ONLY, and this closes the gap the prior comment
       NAMED but left open. `null` is the load-bearing "we could not look" that makes
       the roster refuse rather than read an empty machine off a failed look -- but a
       failed CLAUDE read says nothing about CODEX, whose liveness is local and
       deterministic (win32codexlive: the record + each supervisor's presence file +
       a live pid). Refusing the WHOLE roster on a claude read failure made a running
       codex agent vanish -- no card ("Can't tell"), and undeliverable, because
       chat.deliver gates on a roster card. So we refuse ONLY when the claude read
       failed AND there is no codex agent to show; a codex agent still draws its card
       through a claude blip. The claude answer is byte-identical whenever the claude
       read SUCCEEDS (the happy path): `agents` is used exactly as before and codex is
       unioned exactly as before. */
    if (!claudeOk && codexRows.length === 0) return null;
    const claudeAgents = claudeOk ? agents : [];
    const owned = record.read();
    const lines = [];
    const COLUMNS = require('./status').PANE_COLUMNS;   // #5333: lazily, once per call (status requires this module)
    for (const a of claudeAgents.concat(codexRows)) {
      if (!a || typeof a !== 'object') continue;
      const id = a.sessionId;
      // Re-validate the live id against the SAME gate record() writes under, so the
      // record store is the sole trust root EXPLICITLY, not merely by construction.
      // Without this the loop would trust that owned's keys are all well-formed; that
      // holds today (record() enforces validId), but a hand-corrupted store plus a
      // matching live id is the one path it does not close -- e.g. JSON.parse of
      // `{"__proto__":...}` yields an OWN "__proto__" key, which validId rejects here.
      if (!win32sessions.validId(id)) continue;
      // FAIL CLOSED: emit ONLY sessions Kosmos created. An unrecorded session
      // (the operator's own) is never put on the board.
      if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
      const rec = owned[id] || {};
      // The claim must MATCH the pane's name (status.isNamedOurs), so the emitted
      // name and claim are the SAME value. Prefer the recorded name (what Kosmos
      // filed it under) and fall back to the live name.
      const name = flat(rec.name || a.name || '');
      // Re-check the name against the SAME visible-char gate record() writes under,
      // for the SAME reason validId is re-checked above: a hand-corrupted store could
      // hold a whitespace/zero-width name that a bare truthiness test (and status.js's
      // own .trim(), which does not strip U+200B) would pass, emitting a degenerate
      // invisible row that reads as ours. One definition (win32sessions.validName),
      // two call sites -- symmetric with the id gate, not a duplicated regex.
      if (!win32sessions.validName(name)) continue;
      const runner = flat(rec.runner || '');
      // pane "0.0" (one synthetic pane per session); inMode "0" (never copy-mode
      // -> typeable); command WIN32_COMMAND (agent, not process-arm-ours); claim
      // = name (ownership); title = name (state comes from the capture seam, not
      // the roster); tokenInstance empty (#5333: a Windows run's token is not stamped on a session).
      // #5333: built BY KEY from PANE_COLUMNS, not hand-typed in order: a column added before `title` (tokenInstance)
      // shifted every Windows row, putting the name in the new column and dropping the title. A column this does not
      // know is left empty (win32roster.test.js asserts every column is known here).
      const value = { session: name, pane: '0.0', command: WIN32_COMMAND, inMode: '0', claim: name, runner, tokenInstance: '', title: name };
      lines.push(COLUMNS.map((c) => (Object.prototype.hasOwnProperty.call(value, c.key) ? value[c.key] : '')).join('\t'));
    }
    // Trailing newline so the last row parses like every other (matches tmux's
    // own output shape); an empty roster is a valid, readable answer (no agents),
    // which is what unblocks create's "couldn't check which agents are running".
    return lines.length ? lines.join('\n') + '\n' : '';
  };
}

/* #5333: the keys a Windows row fills, so a test can assert it knows every PANE_COLUMNS column. */
const WIN32_ROW_KEYS = ['session', 'pane', 'command', 'inMode', 'claim', 'runner', 'tokenInstance', 'title'];

module.exports = { WIN32_ROW_KEYS, make, defaultRun, defaultRunAsync, makeCachedRun, cachedRun, FRESH_MS, STALE_MS, WIN32_COMMAND, isWin32Pane, flat };
