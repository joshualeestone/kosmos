'use strict';

/**
 * Talking to ONE agent, about ONE project.
 *
 * The gap this closes: a card could say an agent is asking you something, and
 * there was nowhere to see the question or answer it. The board could observe
 * an agent and could not reach one.
 *
 * ⚠️ This paragraph used to be framed as a QUOTATION of the person who reported
 * the gap, around a card sentence the copy sweep then rewrote. An edited
 * quotation is not a quotation, so the frame went rather than the words.
 *
 * ⚠️ WHAT THIS MODULE MAY CLAIM, and the fourth row is the one that is never
 * ours. `engine/projects.js` has the same table for membership; this is the
 * same discipline pointed at a keystroke:
 *
 * | Claim | | |
 * |---|---|---|
 * | we put this text into that pane | ✅ | tmux took it and said so |
 * | this is what that pane shows right now | ✅ | we captured it a moment ago |
 * | we could not deliver, and why | ✅ | the failure is ours to report |
 * | we typed it and cannot tell whether it landed | ✅ | our own blind spot, stated |
 * | what the pane was doing when we typed | ✅ | the board's own verdict, at that moment |
 * | the agent **read** it, received it, or will act on it | ❌ | never |
 *
 * The fourth is false in three separate ways, which is why it gets a paragraph
 * rather than a footnote. `send-keys` reaches a terminal, not a program's
 * understanding: the composer may be mid-render, the agent may be busy for
 * minutes, and a Claude that is thinking does not consume its input box the
 * moment text lands in it. So every sentence this module produces is about the
 * KEYSTROKE, and the UI that renders it says "placed into casey's session just
 * now", never "casey received it".
 *
 * ⚠️ AND THE PANE IS SHOWN, NEVER PARSED. There is no bubble-maker here. A
 * parser that guesses which lines of a TUI are "the agent talking" puts words
 * in the agent's mouth the first time it guesses wrong, and it will guess wrong
 * — Claude Code redraws, wraps, animates, and prints tool output that looks
 * exactly like prose. So the agent's side of this screen is a VIEWPORT: the
 * literal tail of what the terminal is displaying, labelled as that.
 *
 * ⚠️ WHAT WAS MEASURED BEFORE THIS WAS WRITTEN (2026-08-13, tmux 3.6a, this
 * machine — the same discipline connect.js's fixtures are held to):
 *
 *   - `send-keys -t '=<session>:<window>.<pane>' -l -- <text>` places the text
 *     literally, INCLUDING a leading `-` (probed with `-echo dashy-probe-text`,
 *     which landed verbatim in the composer). `-l` sends literal characters
 *     rather than key names, and `--` ends option parsing.
 *     📌 SUPERSEDED FOR THE BODY (#3419): the body is no longer streamed with
 *     `send-keys -l` — a BUSY pane silently drops all but a tail of a keystroke
 *     stream. It is PASTED now: `pasteWire` does `set-buffer -b <buf> -- <chunk>`
 *     then `paste-buffer -d -t <target>`, in UTF-8-safe chunks, atomically. The
 *     `--`/leading-`-` fact above carries over to set-buffer; `-l` is history.
 *   - A second, separate `send-keys -t <same> Enter` submits it — still true, and
 *     now after the paste plus a size-adaptive delay. The two are never one call:
 *     `-l` would type the word "Enter", and an Enter sent before the pasted bytes
 *     have flushed races the paste and submits a partial line.
 *   - `capture-pane -p -J -t '=<session>:<window>.<pane>'` reads that pane back.
 *   - The `=` exact-match prefix DOES defeat prefix matching on a pane target:
 *     with the session killed and a `kchatprobe2` still alive, the same command
 *     answered `can't find session: kchatprobe` rather than landing on the
 *     lookalike. That refusal is the whole reason every target here is built
 *     with `=`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const store = require('./store');
const status = require('./status');
const { withFileLock } = require('./filelock');

/**
 * Where a send got to. THREE values, and the third is the one that matters.
 *
 * ⚠️ AN EARLIER VERSION OF THIS BLOCK HAD TWO, and said so proudly: "unlike a
 * status read there is no 'we did not look' — a send either happened or it did
 * not". That is wrong about the only part of this module that touches another
 * program. We drive tmux, and tmux can take a keystroke and then fail to tell
 * us so: a timed-out call may have delivered, and an Enter we could not send
 * leaves the person's words sitting in a live composer.
 *
 * With two states those cases render as failure — and the person does the
 * obvious thing, which is send it again. Now the agent has the message twice,
 * and on the screen this feature exists for (a permission prompt) the second
 * copy answers a question the first one already answered. **The verdict has to
 * make re-sending feel unnecessary exactly when it is**, which is a thing only
 * a third state can say.
 *
 * The line between them is not "how bad it was". It is one checkable fact:
 *
 *   COULD_NOT    — NOTHING of the person's text reached the pane. Re-sending is
 *                  safe, and is what they should do.
 *   UNCONFIRMED  — something may have. Re-sending may duplicate it. Look at the
 *                  screen, which is on this very page, before deciding.
 *   PLACED       — tmux took the text and the Enter, and said so.
 *
 * Every refusal that happens BEFORE the first keystroke (a bad message, a pane
 * we will not type into, a roster we could not read) is `COULD_NOT` by that
 * rule, and the tests assert the invariant rather than the enumeration.
 */
const DELIVERY = {
  PLACED: 'placed',
  UNCONFIRMED: 'unconfirmed',
  COULD_NOT: 'could_not',
};

/**
 * One message, one line.
 *
 * ⚠️ NOT a style preference. When the body went in via `send-keys -l`, a newline
 * reached the composer as a submit, so a two-line message was delivered as two
 * messages with the second half arriving as its own instruction while the agent
 * was already acting on the first. `cleanMessage` flattens every run of
 * whitespace to a single space so this cannot happen, and #3419 does NOT change
 * that: the body is pasted now, but the paste is issued without `-p` (no
 * bracketed-paste markers — see the paste-transport note), so whether a raw
 * pasted newline would submit is NOT something this code has verified, and
 * nothing here relies on it either way. The flattening stays, "one message is
 * one turn" stays, and letting a paste carry real newlines is a separate change
 * that would have to establish that behaviour first — it is not something this
 * transport quietly enabled. Runs of whitespace are collapsed rather than
 * refused, so the person's paragraph arrives as a paragraph-shaped sentence
 * rather than an error.
 */
// #3403: 10000, not 2000. Josh hit the old 2000 cap writing a message to an agent and was cut
// off mid-message with no warning; 2000 chars is short for actually instructing an agent. This is
// a PRODUCT choice, not a transport limit: the #3419 paste transport (pasteWire) delivers the body
// in 256B (PASTE_CHUNK_BYTES) sub-threshold chunks with a size-adaptive wait, so a longer body is
// delivered without the busy-pane head-truncation a single send-keys burst had -- the chunking
// already scales to any size. The two MULTI-LINE agent-message composers (#d-say, #pj-post) carry
// maxlength=10000 to match this cap -- render-msg-counter-3403 asserts that cap, and the soft
// near-limit counter (which reads each composer's own maxlength) warns before it so the cut is
// never silent. A UI maxlength BELOW this cap is the #3403 cutoff itself (input just stops, no
// warning); one ABOVE it would let the caller type past what the engine keeps. The two single-line
// quick inputs (#pj-say, #d-term-say) stay at 2000 for now, a documented plan follow-on: they are
// quick-say inputs, not the long-message composers Josh hit.
const MAX_TEXT = 10000;

/**
 * Ceiling on how many messages one thread FILE keeps.
 *
 * ⚠️ NEVER rotates by dropping the oldest entries: that would delete something
 * the person wrote, and "nothing of the user's is ever deleted" is this
 * codebase's rule on every write path. kosmos#5841: at the cap the thread
 * ROLLS OVER instead. The full file is set aside whole (`.full`, ROLL_KIND),
 * and a new file carries its last ROLL_CARRY rows and names it (`continues`),
 * so the conversation keeps recording and its earlier messages stay readable
 * (asideChain, the older route). Before #5841 a full thread stopped recording
 * for good. It still refuses, saying why, only when the full file cannot be
 * set aside; delivery is unaffected either way (see `appendMessage`).
 */
const MAX_MESSAGES = 1000;

/** How much of the pane the viewport shows. */
const VIEWPORT_LINES = 60;

/**
 * Where every project's stored dialogue lives (kosmos#969).
 *
 * 🔑 EXPORTED AS A FUNCTION, NOT A VALUE. `store.ROOT` is read from the
 * environment, and the tests re-point it between cases; a constant captured at
 * require time would hand a caller the FIRST sandbox forever, which is exactly
 * the shape that puts one test's files in another test's directory.
 */
const DIR = () => path.join(store.ROOT, 'chats');

/* ── the tmux seam ───────────────────────────────────────────────────────── */

/**
 * ⚠️ THE SAME BIDIRECTIONAL INTERLOCK AS `engine/create.js` AND
 * `engine/connect.js`, and it matters more here than in either: this is the
 * only module in the product that types into a RUNNING AGENT's session. A test
 * that reached the real tmux would put its fixture text into somebody's live
 * conversation. `setRunner(null)` re-arms dry-run, so no ordering of teardowns
 * leaves a suite able to send.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

function setRunner(fn) {
  runner = typeof fn === 'function' ? fn : null;
  if (!runner) DRY_RUN = true;
}

function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would type into real agents');
  }
  DRY_RUN = Boolean(on);
}

/**
 * The MINIMUM gap between putting a message in and pressing Enter on a CODEX
 * pane. MEASURED (#571, codex 0.149.1): an Enter that arrives immediately after
 * the burst is taken as part of the paste and becomes a newline in the composer,
 * at any message length; an Enter 0.5s later submits.
 *
 * 📌 SINCE #3419 THIS IS A FLOOR, NOT A CODEX-ONLY PAUSE. The body is pasted now
 * and EVERY pane waits the size-adaptive `pasteToEnterMs` before its Enter (the
 * pasted bytes must flush first — see the paste-transport note); on a codex pane
 * that wait is `Math.max`'d with this floor so it is never below the measured
 * 0.5s. Pre-#3419 only codex paid a pause and this was it; the wording "for codex
 * only" no longer holds. HTTP delivery waits asynchronously so this pause does
 * not hold the board. Synchronous internal callers retain the old wait.
 * `pauser` is the test seam, the way `runner` is for tmux; null means the real
 * wait.
 */
const CODEX_ENTER_GAP_MS = 500;
let pauser = null;
const deliveryQueues = new Map();
/* #6249: per pane, the last line the board typed and saw left unsent in the box (its wire), so the next delivery can
   press Enter on THAT line, which is ours, rather than leave the agent blocked until a person clears it.
   kosmos#6436: `seen` is what the box showed when the line was left (whitespace squashed). On an 80x24 agent pane a
   long line scrolls, so the box shows only its end, which on screen looks like a line whose start a person deleted;
   the box showing exactly `seen` again is what tells the two apart. Kept on disk (UNSENT_FILE), so a board restart
   does not leave the agent refused behind its own line. */
const unsentWires = new Map();   // target -> { wire, at, seq, seen }
const UNSENT_FILE = () => path.join(store.ROOT, 'unsent-lines.json');
let unsentLoaded = false;
/* Each remembered line gets its own id (a retry scheduled for one line never acts on another, whatever the clock says). */
let unsentIdNext = 0;
/* A line not seen in the box for longer than this (each delivery or retry that finds it there starts the day again) is
   neither pressed nor loaded after a restart. Hours, not the old 10 minutes (an
   agent sat idle 30 to 60 minutes behind one), and not forever: a memory that outlived its line could meet the same
   words put back in the box later (the person's own up-arrow history) and press them. */
const UNSENT_KEEP_MS = 24 * 60 * 60 * 1000;
const UNSENT_LIGHT_MS = 60 * 1000;   // the light record: just past its one retry (30 s)
function loadUnsent() {
  if (unsentLoaded) return;
  unsentLoaded = true;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(UNSENT_FILE(), 'utf8')); } catch { return; }
  if (!raw || typeof raw !== 'object') return;
  for (const [target, e] of Object.entries(raw)) {
    /* A seq names a message row of the process that wrote it, so a loaded line carries none. */
    if (e && typeof e.wire === 'string' && e.wire && Date.now() - (Number(e.at) || 0) <= UNSENT_KEEP_MS) {
      unsentIdNext += 1;
      unsentWires.set(target, { id: unsentIdNext, wire: e.wire, at: Number(e.at) || 0, seq: null, seen: typeof e.seen === 'string' ? e.seen : '',
        target, ...(typeof e.chip === 'string' && e.chip ? { chip: e.chip, chipPid: typeof e.chipPid === 'string' ? e.chipPid : '' } : {}) });
    }
  }
}
/* At most this many lines are kept (the oldest go first), so a pane that never comes back cannot grow the file. One
   writer is assumed: the board, one per account folder. Another process writing the same file would drop its lines. */
const UNSENT_KEEP = 100;
function saveUnsent() {
  if (unsentWires.size > UNSENT_KEEP) {
    const oldest = [...unsentWires.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, unsentWires.size - UNSENT_KEEP);
    for (const [target] of oldest) unsentWires.delete(target);
  }
  const out = {};
  for (const [target, e] of unsentWires) if (!e.light) out[target] = { wire: e.wire, at: e.at, seen: e.seen || '', ...(e.chip ? { chip: e.chip, chipPid: e.chipPid || '' } : {}) };
  try {
    const file = UNSENT_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (err) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw err; }
  } catch (err) {
    // Best effort: the line is still remembered for this run, but a restart would lose it, so it is said.
    process.stderr.write('chat: could not keep the unsent-lines record (' + (err && err.message) + '); a restart forgets it\n');
  }
}
function recallUnsent(target) {
  loadUnsent();
  const e = unsentWires.get(target) || null;
  /* A light record (an unread watch: the line usually went, so it may sit in the agent's own history) lives only past its
     one retry: a person recalling those words later must never have them pressed. */
  const life = e && e.light ? UNSENT_LIGHT_MS : UNSENT_KEEP_MS;
  if (e && Date.now() - e.at > life) { forgetUnsent(target); return null; }
  return e;
}
function rememberUnsent(target, entry) {
  loadUnsent();
  if (entry && entry.target !== target) entry = { ...entry, target };   // kosmos#6717: a kept chip is checked against this pane
  if (!entry.id) { unsentIdNext += 1; entry = { ...entry, id: unsentIdNext }; }
  unsentWires.set(target, entry);
  saveUnsent();
}
function forgetUnsent(target) { loadUnsent(); if (unsentWires.delete(target)) saveUnsent(); }
/* kosmos#6436 test seam: what a board restart does to the memory (gone from the process, still on disk). */
function restartUnsentForTests() { unsentWires.clear(); unsentLoaded = false; }
/* #6256 item 2: each remembered line has a number, given back on its verdict (`unsentSeq`), so whoever recorded that
   line can be told when a later delivery sends it (the hook below): chat itself does not know message ids. */
let unsentSeq = 0;
let earlierSubmittedHook = null;
function setEarlierSubmittedHook(fn) { earlierSubmittedHook = typeof fn === 'function' ? fn : null; }
function tellEarlierSubmitted(seq) {
  if (!earlierSubmittedHook) return;
  try { earlierSubmittedHook(seq, new Date().toISOString()); } catch { /* a record that fails is not the delivery's failure */ }
}
/* kosmos#6436: a line the board left unsent is pressed again on its own after these delays, so the agent is not left
   idle until someone next writes to it (agents sat idle 30 to 60 minutes behind one). A line is pressed late only within
   its day (UNSENT_KEEP_MS): while it is in the box nothing newer can be typed in, so sending it then keeps the order. A
   retry that finds a delivery typing there is spent (that delivery presses the line itself); the next one still runs.
   Round 12: a hold can outlast all three (a permission prompt answered ten minutes later, a usage limit), so a line still
   stuck after the last is tried again every UNSENT_TAIL_MS, for at most a day from when its retries were set (the bound
   holds even when a press that does not take starts the line's day again). One chain per line: a newer set ends the older. */
const UNSENT_RETRY_MS = [30 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
const UNSENT_TAIL_MS = 10 * 60 * 1000;
const UNSENT_DONE = new Set(['sent', 'empty', 'gone']);   // pressRememberedNow's answers after which nothing is left to try
let unsentChainNext = 0;
/* The test seam for those retries: (ms, fn) => void. Unset with an injected tmux runner, nothing is scheduled (a test
   that wants them sets it); unset in production, a real unref'd timer. */
let unsentRetryScheduler = null;
function setUnsentRetryScheduler(fn) { unsentRetryScheduler = typeof fn === 'function' ? fn : null; }
/* kosmos#6436: the board's roster now (server.js sets it). A retry runs minutes after its delivery, so it passes every
   gate (typingGate) on the roster as it is then, not the card it was scheduled with. Unset: no retry presses anything. */
let rosterSource = null;
function setRosterSource(fn) { rosterSource = typeof fn === 'function' ? fn : null; }

function setPauser(fn) {
  pauser = typeof fn === 'function' ? fn : null;
}

/**
 * The Windows channel seam (#570 7c-4), `runner`'s twin for agents reached
 * through their supervisor's pipe rather than a pane. Clearing it re-arms
 * dry-run, as clearing `runner` does.
 *
 * ⚠️ AND A FAKE TMUX IS NOT PERMISSION TO USE THE REAL CHANNEL. `setDryRun(false)`
 * checks only that a tmux `runner` was injected, so a suite that faked tmux and
 * left dry-run would otherwise send Windows cards down a real pipe. The real
 * `say` is therefore used only when NO runner is injected, which is production.
 */
let channel = null;

function setChannel(fn) {
  channel = typeof fn === 'function' ? fn : null;
  if (!channel) DRY_RUN = true;
}

function resetForTests() {
  QMENU_BUSY.clear();
  runner = null;
  pauser = null;
  channel = null;
  DRY_RUN = true;
  deliveryQueues.clear();
  unsentWires.clear();
  unsentLoaded = true;
  try { fs.rmSync(UNSENT_FILE(), { force: true }); } catch { /* the sandbox's own file */ }
  unsentRetryScheduler = null;
  rosterSource = null;
  MOVED_TELL = null;   // #5400
}

/**
 * ⚠️ Bare `tmux`, resolved on PATH, because that is what the running product
 * already depends on: `engine/status.js` reads every pane on the board with a
 * bare `tmux`, so a machine where this module could not find tmux is a machine
 * with no board at all. The env override exists for the same reason connect's
 * does — a sandboxed run must be able to point somewhere harmless.
 */
function tmuxBin() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux';
}

/**
 * One tmux call. Returns the `{ran, status, out, err}` shape `status.shDetail`
 * produces, plus one field of its own — see `spawnFailed`.
 *
 * ⚠️ `spawnFailed` IS THE THIRD OUTCOME, and it exists because two very
 * different things both arrive as `ran: false`:
 *
 *   - tmux could not be EXECUTED (it is not on PATH, it is not executable). The
 *     process never started, so nothing was typed anywhere. That is a definite
 *     answer.
 *   - tmux was executed and did not come back inside the timeout. It may have
 *     delivered the keystroke and been slow to exit. That is NOT a definite
 *     answer, and reporting it as a failure is what makes somebody re-send a
 *     message that already landed.
 *
 * Collapsing the two is exactly the "cannot tell a failure from a thing I could
 * not see" shape this codebase is built against, and here it costs the person a
 * duplicate message in a live agent's composer.
 */
function tmux(args) {
  if (runner) return runner(args);
  if (DRY_RUN) {
    return {
      ran: false,
      spawnFailed: true, // nothing was executed, so nothing was typed
      status: null,
      out: '',
      // Neutral wording on purpose (round 27): viewport() funnels this
      // through refusalReason too, and "without permission to TYPE" as the
      // explanation of a failed READ was a wrong sentence. Fixture-facing
      // only, but fixtures are where sentences get read most carefully.
      err: 'this copy of Kosmos is running without permission to touch agents',
    };
  }
  try {
    return { ran: true, spawnFailed: false, status: 0, out: execFileSync(tmuxBin(), args, { encoding: 'utf8', timeout: 5000 }), err: '' };
  } catch (e) {
    const code = e && typeof e.status === 'number' ? e.status : null;
    return {
      ran: code !== null,
      spawnFailed: code === null && spawnFailure(e),
      status: code,
      out: (e && e.stdout && e.stdout.toString()) || '',
      err: (e && e.stderr && e.stderr.toString()) || '',
    };
  }
}

/**
 * Did this `execFileSync` failure mean the process NEVER STARTED?
 *
 * ⚠️ PURE AND EXPORTED, so it can be tested against errors a real
 * `execFileSync` really threw rather than against a fixture of what I remember
 * it throwing. The whole three-state distinction rests on this one boolean: get
 * it wrong towards `true` and a slow tmux is reported as "your message did not
 * arrive", which is the duplicate-send this feature is guarding against.
 *
 * ⚠️ MEASURED, on this machine, Node v25.6.1 — because the exit status alone
 * cannot answer it. Both of the first two rows carry `status: null`:
 *
 *   ENOENT   (no such binary)   code ENOENT     status null  signal null
 *   ETIMEDOUT (killed at the timeout)           status null  signal SIGTERM
 *   a non-zero exit             code undefined  status 3     signal null
 *   EACCES   (not executable)   code EACCES     status null  signal null
 *
 * So the discriminator is the SIGNAL: a child killed by one was running. Note
 * `killed` was `undefined` in every row above, so a check written on that
 * property alone would have called a timeout a spawn failure — which is the
 * defect this function exists to prevent, and it is why the signal is read
 * first.
 */
function spawnFailure(err) {
  if (!err) return true;
  return !(err.signal || err.killed);
}

/* ── what may be sent ────────────────────────────────────────────────────── */

/**
 * The text we will actually type, from whatever was typed at us.
 *
 * ⚠️ ONE cleaner, EXPORTED, and validated in the same place it is applied.
 * `create.js` has the identical note above `cleanName` because the two-function
 * version there agreed with itself only by coincidence, and the caller that
 * validated a raw value then used it unchanged carried a leading space into a
 * directory name. Here the equivalent slip types something other than what was
 * checked into somebody's agent.
 */
function cleanMessage(raw) {
  // Any run of whitespace — newlines, tabs, the lot — becomes one space. See
  // MAX_TEXT for why a newline cannot survive to the pane.
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

/*
 * #4934 / #5967: a room post that is ONLY acknowledgement (agreed, thanks, confirmed)
 * and carries no new facts. The room valve (engine/messages.js) HOLDS the room on the
 * VOLUME of arrivals; this is a separate signal that a RUN of these reached a bound, so
 * engine/messages.js stops passing on the ack-only posts (NOT a hold: the next post with
 * content goes through) sooner than the volume valve would hold the room. The
 * classification is pure text, so it is unit-tested on its own.
 *
 * Whole-post judgment with STRUCTURAL escapes, never a prefix check. The failure to
 * avoid is a word list that would hold a real "agreed, and here is the number: 42":
 * that post escapes two ways here, by words outside the lexicon AND by a digit, so it
 * is content. A post is acknowledgement-only only if ALL of these hold:
 *   A. after a single LEADING @mention is stripped it is at most ACK_MAX_WORDS words
 *      (brevity: necessary, since a real update is almost never this short, not
 *      sufficient); a further or non-leading @mention is a new-information signal
 *      (pulling a colleague into the thread), so it is content;
 *   B. every remaining word is in the closed ACK_WORDS lexicon (the WHOLE post, not a
 *      prefix), matched case-insensitively and with edge punctuation trimmed, so
 *      "AGREED." and "Thanks!!" still count (a case-sensitive match is this fleet's
 *      most repeated false zero). A token is skippable only if it is PURE PUNCTUATION
 *      ("!!", "..."); a symbol or an off-lexicon emoji (❌, ✗, ⚠️, 🚀) is content,
 *      because it can carry meaning, often negation, and treating "ok ❌" as an
 *      acknowledgement would stop a disagreement from being passed on. A word in ANY
 *      script (not only Latin) that is not in the lexicon is
 *      also content, so a non-English post is never mistaken for an acknowledgement;
 *   C. it carries no new-information signal: a digit, a url or scheme, a file path or
 *      a filename.ext, inline code/backticks, a question mark, a currency or percent
 *      sign, or a double-quoted span.
 * Failing ANY of A/B/C makes it content, which RESETS the run, so ordinary back-and-
 * forth with real content is never judged by this at all. Every edge case here errs
 * toward content (not held), which is the safe direction: the dangerous direction is
 * calling a real post an acknowledgement, and that needs every word in the lexicon.
 */
const ACK_MAX_WORDS = 5;
// A hard character ceiling, checked BEFORE any regex below. A real acknowledgement is at
// most ACK_MAX_WORDS short lexicon words (plus a leading @mention); nothing longer can be
// one, so a longer post is content. This matters for more than brevity: the filename/path
// test is `\S+\.[A-Za-z]{1,8}` and backtracks QUADRATICALLY on a long unbroken token, so a
// single MAX_BODY-sized post (tens of KB) would block the event loop for seconds. Bounding
// the input here first keeps every regex below linear on a tiny string (challenge-loop
// round 8). 200 is comfortably above any genuine five-word ack with a long @mention and an
// emoji, and far below the length at which the regex is slow.
const ACK_MAX_CHARS = 200;
// A closed lexicon of acknowledgement words. Several tokens are deliberately excluded to keep
// a request or a status report from reading as agreement: "it" (a pronoun, never agreement on
// its own -- it only glued "do it", an instruction); the full request verbs "confirm" and
// "acknowledge", which read as asking the READER to do something ("confirm this" / "acknowledge
// this") rather than the reader agreeing. Their completed forms "confirmed"/"confirms"/
// "acknowledged", and the established short acknowledgement token "ack"/"acked" (which stands for
// "acknowledged", not "acknowledge this"), ARE the acknowledgement and stay. "done" is excluded
// too: it reports that something finished, it does not agree, so a "done" answering "is it ready?"
// is a status the room may need, not a content-free ack. "do"/"will do" stay (willingness to act
// is agreement; without "it", "do it" cannot form). "yes" stays: it is an acknowledgement in the
// loop context, and the run gate in messages.js (4 consecutive AND the incoming post's own sender
// already in the run -- a true back-and-forth, not a poll of distinct answerers) bounds the
// false-positive.
const ACK_WORDS = new Set([
  'agreed', 'agree', 'agrees', 'thanks', 'thank', 'thx', 'ty', 'confirmed',
  'confirms', 'ack', 'acked', 'acknowledged', 'ok', 'okay', 'okey', 'k',
  'kk', 'yes', 'yep', 'yeah', 'yup', 'sure', 'sounds', 'good', 'great', 'perfect',
  'will', 'do', 'noted', 'got', 'understood', 'roger', 'cool', 'nice',
  'fine', 'right', 'correct', 'indeed', 'affirmative', 'ditto', 'same', 'to', 'me',
]);
// A few common acknowledgement emoji, judged whole (never trimmed as punctuation).
const ACK_EMOJI = new Set(['👍', '🙏', '✅', '👌', '💯', '🔥']);
function acknowledgementOnly(raw) {
  const text = cleanMessage(raw);
  if (!text) return false;                       // nothing said is not an acknowledgement
  if (text.length > ACK_MAX_CHARS) return false; // too long to be an ack; also bounds the regexes below (no ReDoS)
  // C: a new-information signal. Any one present means the post carries new facts.
  if (/[0-9]/.test(text)) return false;          // a digit
  if (/:\/\//.test(text) || /\bhttps?:/i.test(text)) return false; // a url or scheme
  if (text.includes('`')) return false;          // inline code / backticks
  if (/[?？؟¿]/.test(text)) return false; // a question (ASCII ?, full-width CJK ？, Arabic ؟, inverted ¿)
  if (/[$%£€]/.test(text)) return false;         // a currency or percent sign
  if (text.includes('"')) return false;          // a double-quoted span
  if (/\S+\.[A-Za-z]{1,8}(?![A-Za-z])/.test(text) || /\/\S/.test(text)) return false; // filename.ext or a path
  // A: allow a SINGLE leading @mention (a reply addressing one colleague is still an
  // acknowledgement); a further or non-leading @mention pulls a new colleague in and is
  // content. Then the brevity gate.
  const stripped = text.replace(/^@\S+\s*/, '').replace(/\s+/g, ' ').trim();
  if (!stripped) return false;                   // only a leading @mention: nothing acknowledged
  if (/(^|\s)@\S+/.test(stripped)) return false; // a @mention beyond the leading one -> content
  const tokens = stripped.split(' ');
  if (tokens.length > ACK_MAX_WORDS) return false;
  // B: every content token is an acknowledgement word (or an acknowledgement emoji). The
  // \p{L}\p{N} trim keeps letters and numbers of ANY script, so a token is skippable only
  // when it is pure punctuation/symbol/emoji; a word in any script that is not in the
  // lexicon is content. Trimming with a Latin-only class would strip a CJK/Cyrillic/etc.
  // token to empty and mistake real non-English content for an acknowledgement -- the
  // dangerous direction.
  for (const tok of tokens) {
    if (ACK_EMOJI.has(tok)) continue;            // a listed acknowledgement emoji, judged whole
    // A symbol ANYWHERE in the token makes the post content, whether it stands alone
    // ("ok ❌") or is glued to a word ("ok❌"): a negation (❌, ✗, ⚠️) or an off-lexicon
    // emoji carries meaning, and the dangerous direction is treating "ok❌" as an
    // acknowledgement. Checked BEFORE the edge trim, which would otherwise strip an
    // attached symbol away and let the bare word pass. Only a token that is wholly a
    // listed ack emoji (handled above) is exempt.
    if (/\p{S}/u.test(tok)) return false;        // a non-ack symbol or off-lexicon emoji -> content
    const w = tok.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (w === '') continue;                      // pure punctuation ("!!", "...") -> skippable
    if (!ACK_WORDS.has(w)) return false;         // a word outside the lexicon (any script) -> content
  }
  return true;
}

/**
 * The person's text as it is KEPT, preserving paragraph breaks.
 *
 * ⚠️ THE STORE IS NOT THE PANE. `cleanMessage` above flattens because a newline
 * typed into a pane is Enter -- it submits half a message and fires the agent
 * early (see MAX_TEXT). That constraint belongs to the pane, and applying it at
 * the store was the #1927 defect: every destination lost paragraphs, including
 * the operator's HTML view (which never had a pane's limit and which Josh reads
 * daily). So the store keeps `\n`; only `deliver()` still flattens on the way
 * to a pane. It also normalises CR, since a bare `\r` is a control character
 * `messageProblem` would otherwise refuse:
 *   - CRLF, lone CR and the Unicode line/paragraph separators → LF
 *   - a tab → four spaces (a tab is a control character `CONTROL` refuses)
 *   - #3679: indentation is kept, and inside a ``` fence each line is kept as
 *     written except its trailing spaces, so code and nested lists arrive as
 *     written. The tab and leading-space rules apply inside a fence too, and a
 *     fence body loses at most the message's shared indent (see the dedent below).
 *   - In a fence left open, blank lines at the very end of the message go with
 *     the final trim. Outside a fence, a run of spaces INSIDE a line becomes one space
 *     and trailing spaces go.
 *   - outside a fence, three or more newlines → a single blank line
 *   - the indentation every line shares comes off, then the ends are trimmed.
 * Every other control char (ESC, `\v`, `\f` and the rest) is preserved, except where the
 * final trim takes one off an end, so `messageProblem` still sees and refuses it; `\n` is
 * the one `CONTROL` exempts.
 */
// Every tab is four spaces, not the next tab stop, the same width pjListDepth reads.
const STORE_TAB = '    ';
// A fence line, CommonMark-like (its run-length and info-string rules; any indent, backticks only): three or more backticks, and
// no backtick after them (so an inline ```span``` is not one). A fence closes only on a bare
// run at least as long as the one that opened it, so ```` can hold a ``` example.
// \x60 is a backtick: a literal one here reads as a template string to the #1732 scanner.
const STORE_FENCE = /^ *(\x60{3,})([^\x60]*)$/;
// The stored form may exceed a one-line limit (kept indentation, a tab as four spaces), but
// not by more than this factor, so a thread read on every poll stays bounded. Four is a chosen
// bound (a tab's width), not a measured ratio: deep indentation can grow further and is refused.
const STORE_GROWTH = 4;
const STORE_TOO_SPACED = 'that has more indentation and spacing than we keep in a message; put it in a file and send the path';
// Trailing spaces off, in linear time: `/ +$/` backtracks on a long run that ends in text.
function trimSpacesEnd(line) {
  let e = line.length;
  while (e > 0 && line.charCodeAt(e - 1) === 32) e -= 1;
  return line.slice(0, e);
}
function storeText(raw) {
  // A leading byte-order mark goes, and a line's leading non-breaking spaces (how rich-text
  // pastes indent) and full-width spaces (CJK text; two columns each) become spaces, so the
  // dedent below and the final trim agree on what indentation is.
  const lines = String(raw == null ? '' : raw).replace(/^\ufeff+/, '').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, STORE_TAB)
    .split('\n').map((l) => l.replace(/^[ \u00a0\u3000]+/, (run) => run.replace(/\u3000/g, '  ').replace(/\u00a0/g, ' ')));
  const out = [];
  const inBody = [];   // parallel to out: true for a line inside a fence body
  let fenceLen = 0;   // the opening run's length while inside a fence, else 0
  let blanks = 0;
  for (const line of lines) {
    const f = STORE_FENCE.exec(line);
    if (fenceLen) {
      if (!(f && f[1].length >= fenceLen && /^ *$/.test(f[2]))) { out.push(trimSpacesEnd(line)); inBody.push(true); continue; }
      fenceLen = 0;
    } else if (f) {
      fenceLen = f[1].length;
    }
    const lead = /^ */.exec(line)[0];
    const rest = trimSpacesEnd(line.slice(lead.length).replace(/ +/g, ' '));
    // Blank means no visible character, whatever the whitespace (a full-width space line too).
    // (A form feed or vertical tab is not blank: it stays, so CONTROL refuses it.)
    if (!/\S/.test(rest) && !/[\v\f]/.test(rest)) { blanks += 1; if (blanks > 1) continue; out.push(''); inBody.push(false); continue; }
    blanks = 0;
    out.push(lead + rest);
    inBody.push(false);
  }
  // The indentation every non-blank line OUTSIDE a fence body shares comes off, so a block
  // indented as a whole keeps its relative depths instead of losing only its first line's. A
  // fence body loses at most that much from each line (CommonMark removes the opener's
  // indentation from its content), so a column-0 line of code cannot cancel the dedent.
  let common = Infinity;
  out.forEach((l, k) => { if (l && !inBody[k]) common = Math.min(common, /^ */.exec(l)[0].length); });
  const dedented = common > 0 && common !== Infinity
    ? out.map((l, k) => (inBody[k] ? l.slice(Math.min(common, /^ */.exec(l)[0].length)) : l.slice(common)))
    : out;
  // Then trim the ends, which also takes any indentation left on the first line alone.
  return dedented.join('\n').trim();
}

/**
 * Why this message cannot be sent, or null.
 *
 * ⚠️ CONTROL CHARACTERS ARE REFUSED, NOT STRIPPED, and ESC is the reason. `-l`
 * sends characters literally, so an ESC inside the text is the Escape KEY
 * arriving in a TUI: in Claude Code that cancels what is on screen. A message
 * that quietly cancels the agent's current prompt and then types the rest of
 * itself is not the message anybody wrote. `storeText` has already dealt with
 * the ordinary ones (tab → four spaces, CR → LF), so anything left in this range got
 * there on purpose or by paste accident, and refusing names it.
 *
 * 🛑 ONE EXEMPTION, AND ONLY ONE: `\n` (U+000A). The store keeps paragraph
 * breaks (#1927), so `messageProblem` now validates the STORED shape, in which
 * a legitimate newline survives. The range is split around 0x0A so newline
 * passes and EVERY OTHER control character -- ESC (U+001B) included -- is still
 * refused. Do NOT widen this: the pane path (`deliver`) flattens the newline
 * back out before it is typed, so exempting it here costs the pane nothing,
 * while exempting anything else would let a real control character through to
 * a terminal.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

function messageProblem(raw) {
  // ⚠️ A non-string is refused, not coerced. storeText's String() would
  // turn {"text": {}} into the literal "[object Object]" and this module's
  // whole contract is that what was CHECKED is what gets TYPED into a
  // person's agent -- a coerced artifact was never checked by anyone.
  if (raw != null && typeof raw !== 'string') return 'that message is not text';
  // ⚠️ VALIDATE THE STORED SHAPE, not the pane-flattened one (#1927). The store
  // keeps `\n`; `deliver` flattens it for the pane afterwards. Checking the
  // stored shape is what lets a legitimate newline reach `CONTROL` (which now
  // exempts it) while ESC and every other control char are still seen and
  // refused -- `storeText` leaves those untouched.
  // #3679: measured on the one-line form, as the room does, so kept indentation
  // (and a tab's four spaces) cannot push a message over the limit. Checked first, so
  // the stored form is not built for a message that is refused anyway.
  if (cleanMessage(raw).length > MAX_TEXT) return `keep it to ${MAX_TEXT} characters or fewer`;
  // #3679: the raw text is bounded before storeText walks it line by line, so a few words and
  // millions of blank lines (a tiny one-line form) cannot cost every caller that walk. Same
  // bound as storedWithin's raw check.
  if (raw != null && raw.length > STORE_GROWTH * STORE_GROWTH * MAX_TEXT) return 'that message is too long to send';
  const text = storeText(raw);
  if (!text) return 'write something to send';
  if (CONTROL.test(text)) return 'that message has characters we will not type into a terminal';
  return null;
}

/**
 * #3679: the stored form, or null when it is too large to keep: the raw text past
 * STORE_GROWTH squared times `limit` (checked first, so a few words and a million blank
 * lines are refused before the store walks them), or the stored form past STORE_GROWTH
 * times `limit`. Only for paths that PERSIST `storeText`; a pane-only path keeps nothing,
 * so the stored ceiling does not apply to it (`messageProblem` is the pane's rule). The raw
 * bound does: `messageProblem` runs storeText too, so it carries the same raw check.
 */
function storedWithin(raw, limit) {
  if (raw != null && String(raw).length > STORE_GROWTH * STORE_GROWTH * limit) return null;
  const text = storeText(raw);
  return text.length > STORE_GROWTH * limit ? null : text;
}
/** The refusal for a direct message whose stored form is too large to keep, or null. */
function storedProblem(raw) {
  return storedWithin(raw, MAX_TEXT) === null ? STORE_TOO_SPACED : null;
}

/* ── the paste transport (#3419) ─────────────────────────────────────────────
 *
 * 🛑 WHY THIS REPLACED `send-keys -l -- <text>`. A raw `send-keys -l` streams the
 * message into the pane as KEYSTROKES, and a pane that is BUSY (an agent
 * mid-turn) drops all but a tail fragment of that stream — silently, with no
 * error on either side. The person typed a full message; the agent received
 * "…og area." and nobody was told. That is silent corruption of the product's
 * core action, and it is the launch blocker this fixes (kosmos#3419). The
 * surviving-fragment / lost-INTERIOR-space signature is a keystroke race, not a
 * clean byte cut — which is exactly what a paste avoids.
 *
 * THE FIX is the transport `~/.claude/scripts/claude-msg` proved on the fleet:
 * load the body into a tmux buffer and `paste-buffer` it into the composer, so
 * the input arrives atomically rather than as a per-keystroke stream a busy pane
 * can shred. claude-msg lives in ~/.claude/scripts (fleet infra, NOT shipped
 * with Kosmos), so we cannot call it; this is a faithful port of its core into
 * the product, orchestrating `tmux` (already this module's only external
 * dependency) through the same `tmux()` seam every other send uses — so there is
 * no vendored executable to package, unpack or chmod, and the whole path stays
 * inside the one test seam this file is built on.
 *
 * TWO MEASURED FACTS from claude-msg this port keeps, because dropping either
 * reintroduces truncation:
 *
 *   1. CHUNK THE PASTE. A single paste-buffer above ~800B drops its LEADING
 *      bytes at the PTY/input layer, before any Enter (measured on the fleet TUI
 *      2026-09-01: every clean send ≤782B, head-truncation by ~931B — and a
 *      single-LINE 1198B paste lost ~600B off its head, so it is paste VOLUME,
 *      not line count). The body is pasted in sub-threshold chunks with NO Enter
 *      between them; the composer accumulates them and the single Enter below
 *      submits the whole thing as one turn. 256B stays well under the ceiling.
 *
 *   2. WAIT BEFORE THE ENTER. paste-buffer streams the buffer's bytes into the
 *      pane; an Enter that arrives before that stream has flushed through the
 *      tmux/PTY pipeline races the still-arriving paste and submits a partial
 *      line — the rest lands after, in the composer, unsent. The delay scales
 *      with body size because the flush cost grows with the paste. (Accuracy
 *      note: `paste-buffer` is issued WITHOUT `-p`, matching the proven
 *      claude-msg, so tmux itself adds NO bracketed-paste ESC[200~/ESC[201~
 *      markers — those need `-p`. The receiving Claude TUI has bracketed-paste
 *      mode on, but the dependency this delay covers is the byte-stream flush,
 *      not a tmux-inserted close marker.) This is why the codex-only 500ms gap
 *      that used to be the ONLY pause is now folded into a size-adaptive delay
 *      paid before EVERY submit (see `deliver`).
 *
 * NOT ported, deliberately, each with why it is safe to omit HERE:
 *   - claude-msg's per-target mkdir LOCK guards concurrent sender PROCESSES
 *     clobbering the shared tmux buffer. This server is synchronous (execFileSync
 *     and the Atomics.wait pause both BLOCK), so one deliver() runs to completion
 *     before the next begins — there is no interleaving to guard. Unique buffer
 *     names below are kept anyway as cheap hygiene against a future async caller.
 *   - claude-msg's self-address envelope guard is fleet-messaging-specific (it
 *     reads a `from:` line); there is no envelope on this path.
 *   - the shell / copy-mode / menu SAFETY that stops a paste being executed as a
 *     command in a pane that fell back to a shell is NOT dropped — it is
 *     `verifyAtSend`, made against a FRESH capture immediately before this runs
 *     (see its call site), which is the guard this product already relied on for
 *     the raw send. This transport trusts that gate and does not re-derive it.
 */

// Max BYTES per paste-buffer chunk. See point 1 above; matches claude-msg's
// default and stays under its measured 782B clean ceiling.
const PASTE_CHUNK_BYTES = 256;

// Size-adaptive paste→Enter delay (point 2 above), ported from claude-msg:
//   delay = min(BASE + PER_KB * kB, MAX)
// A one-line message clears well under BASE; a multi-KB body needs proportionally
// longer for its bytes to flush before the Enter, so the Enter submits the whole
// message rather than racing the still-arriving paste.
const PASTE_ENTER_BASE_MS = 250;
const PASTE_ENTER_PER_KB_MS = 100;
const PASTE_ENTER_MAX_MS = 2000;

function pasteToEnterMs(byteLen) {
  const d = PASTE_ENTER_BASE_MS + PASTE_ENTER_PER_KB_MS * (byteLen / 1024);
  return Math.min(Math.round(d), PASTE_ENTER_MAX_MS);
}

/**
 * Split a string into UTF-8-safe chunks of at most `maxBytes` bytes each, never
 * cutting a multibyte character. Ported from claude-msg's perl splitter. We cut
 * at the byte budget but back off while the NEXT chunk would start on a UTF-8
 * continuation byte (10xxxxxx, i.e. 0x80–0xBF). This is defensive: the chunks
 * are pasted back-to-back with nothing between them, so a split codepoint would
 * in fact reassemble — but keeping cuts on character boundaries matches
 * claude-msg, keeps each chunk independently valid UTF-8 (so a stray decode in
 * any consumer cannot corrupt it), and stays correct if bracketed-paste `-p`
 * (which WOULD insert markers between chunks) is ever enabled.
 *
 * ⚠️ EXPORTED so the suite exercises THIS boundary logic rather than a copy of
 * it — the same reason claude-msg exposes its `--split-chunks` seam.
 */
function chunkUtf8(str, maxBytes) {
  // Defensive floor: a non-positive budget would make `end` collapse to `i`, the
  // pathological-case fallback recompute the same `i`, and the loop spin forever
  // pushing empty chunks. Unreachable via the one caller (PASTE_CHUNK_BYTES=256),
  // but this is an exported pure helper, so clamp rather than trust the caller.
  const max = maxBytes >= 1 ? maxBytes : 1;
  const buf = Buffer.from(String(str == null ? '' : str), 'utf8');
  const chunks = [];
  let i = 0;
  while (i < buf.length) {
    let end = Math.min(i + max, buf.length);
    // Back off only when there IS a next byte to inspect: a cut at the very end
    // of the buffer is always on a boundary. buf[end] is the first byte of what
    // would be the next chunk; a continuation byte there means we are mid-char.
    while (end < buf.length && end > i && (buf[end] & 0xc0) === 0x80) end--;
    // Pathological: a single character wider than the whole budget (unreachable
    // at the 256B default — the widest UTF-8 codepoint is 4 bytes). Make
    // progress rather than loop forever.
    if (end === i) end = Math.min(i + max, buf.length);
    chunks.push(buf.slice(i, end).toString('utf8'));
    i = end;
  }
  return chunks;
}

/**
 * Paste `wire` into `target`'s composer in UTF-8-safe chunks, with NO Enter
 * between them. Returns the same `{ran, spawnFailed, status, out, err}` shape
 * `tmux()` returns, so `deliver` maps it to a verdict exactly as it mapped the
 * single send-keys call this replaced: a tmux refusal or spawn-failure →
 * COULD_NOT (nothing submitted, safe to re-send); all chunks pasted → success
 * (the Enter that submits is `deliver`'s, after the size-adaptive delay).
 *
 * ⚠️ NO ENTER IS SENT HERE. A partial failure (chunk N fails after 0..N-1
 * pasted) leaves an un-submitted fragment in the composer — inert until someone
 * submits it, reported through `deliver` as COULD_NOT so the caller knows the
 * send did not complete. This matches claude-msg's exit-4 contract, and a target
 * whose paste just failed is in any case likely unreachable.
 *
 * ⚠️ THE CHUNK IS PASSED AS ARGV AFTER `--`, never through a shell (execFileSync
 * takes no shell) and never as send-keys keystrokes. So message content of any
 * bytes — a leading `-`, a `;`, `$(…)`, unicode — is data, never a command and
 * never a tmux flag. A paste also delivers a trailing `;` literally, so the
 * raw `wire` is pasted with no escaping (the old send-keys path's trailing-`;`
 * escape, and its measured tmux table, were removed in #5582: git history).
 */
function pasteWire(target, wire) {
  const chunks = chunkUtf8(wire, PASTE_CHUNK_BYTES);
  // ⚠️ DEFENSIVE: an empty wire pastes nothing, and if this returned "success"
  // deliver would press a BARE Enter — a submit into whatever is on screen, which
  // on a permission prompt takes the highlighted default. `messageProblem` +
  // `cleanMessage` upstream already guarantee a non-empty `text` (so `wire` is
  // non-empty), making this unreachable today; but pasteWire must never report a
  // send that put nothing in the pane as landed. Report it as a refusal so
  // deliver maps it to COULD_NOT and does not Enter.
  if (chunks.length === 0) {
    return { ran: true, spawnFailed: false, status: 1, out: '', err: 'refusing to submit an empty message', pastedAny: false };
  }
  // A unique buffer prefix per send. The default tmux buffer is shared across
  // processes; a private name means a future async caller cannot read another
  // send's bytes even if the (currently unneeded) lock is absent.
  const tag = `kosmos-msg-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  // ⚠️ `pastedAny` DISTINGUISHES TWO FAILURES THE CALLER MUST TELL APART. A
  // failure on the FIRST chunk left nothing in the composer, so a re-send is
  // safe (COULD_NOT). A failure on a LATER chunk left the earlier chunks sitting
  // un-submitted in the composer, so a blind re-send would paste the whole body
  // AGAIN behind that fragment and the Enter would submit the two together —
  // that case is UNCONFIRMED, not COULD_NOT. See deliver's use of it.
  let pastedAny = false;
  for (let idx = 0; idx < chunks.length; idx += 1) {
    const buf = `${tag}-${idx}`;
    // `--` is load-bearing: without it a chunk that begins with `-` is parsed as
    // set-buffer flags (measured on tmux 3.6a: `set-buffer -b b '-n x'` errors
    // "unknown buffer"). After `--`, the chunk is literal data of any bytes.
    const set = tmux(['set-buffer', '-b', buf, '--', chunks[idx]]);
    if (!set.ran || set.status !== 0) {
      tmux(['delete-buffer', '-b', buf]); // best-effort; the buffer may not exist
      return { ...set, pastedAny };
    }
    // `-d` deletes the buffer after a successful paste, so no buffer leaks per
    // chunk. On a paste FAILURE the buffer set above still exists (‑d did not
    // run), so clean it up explicitly.
    const pasted = tmux(['paste-buffer', '-b', buf, '-d', '-t', target]);
    if (!pasted.ran || pasted.status !== 0) {
      tmux(['delete-buffer', '-b', buf]);
      return { ...pasted, pastedAny };
    }
    pastedAny = true;
  }
  return { ran: true, spawnFailed: false, status: 0, out: '', err: '', pastedAny };
}

/* ── #6249: is it still in the input box? ─────────────────────────────────── */

/**
 * #6249: a line typed into an IDLE Claude Code agent was twice left in its input box, unsent, while the log said
 * placed: `placed` meant only that tmux took the Enter. So for a Claude Code pane the board now reads the input box
 * before it pastes (never behind text that is not ours), right before the Enter (never with text that is not
 * ours), and after it (still there and only ours: one more Enter on the async path; else said as unsubmitted, and a
 * line left there that is only ours is pressed again by its retries and before the next delivery, kosmos#6436).
 *
 * The input box is read from an ANSI capture (`capture-pane -e`), measured on Claude Code 2.1.296 to 2.1.300:
 *   - the LIVE box is the last line that starts with ❯ and a NO-BREAK SPACE (U+00A0). Prompts already sent, a line
 *     queued behind a busy turn, and a menu option all draw ❯ with a plain space, and a slash menu's ❯ is indented;
 *   - it runs down to the next rule line (─), wrapped rows indented;
 *   - DIM text (SGR 2, until SGR 0 or 22) is not typed text: the placeholder ("Try ..."), the queued hint ("Press up
 *     to edit queued messages") and suggestions are drawn dim (bulletin ghost-text-needs-ansi-capture);
 *   - a long box scrolls: only its last rows show, so ours is matched by its tail.
 * Answers { ok: true, text } (text '' when empty), or { ok: false } when no live box is on screen (a menu, a dialog,
 * another program): then the caller does what it did before this card.
 */
const composerText = (ansi) => status.composerText(ansi);   // the reader lives in status.js (the card reads it too)
/* Whitespace is not compared: wrapping puts a row break where the message had a space, or in the middle of a long word. */
const squash = (s) => String(s == null ? '' : s).replace(/[\s ]+/g, '');
/* kosmos#6717: Claude Code folds a long paste into a chip: "[Pasted text #N]" for one line, "[Pasted text #N +K lines]"
   for several (measured on 2.1.305; N rises through the session and is not reused after the box is cleared). The words
   are then not on screen, so a box showing only a chip cannot be compared with what was pasted. A message from Kosmos
   is always one line (cleanMessage), so only the one-line form, alone in the box (squashed: "[Pastedtext#N]"), can be
   ours. A chip counts as ours only when something ties it to our own paste (`chip` below); otherwise it is someone
   else's text, never pressed, never read as "ours went". */
const ONE_LINE_CHIP = /^\[Pastedtext#\d+\]$/;
/* Measured on 2.1.305: a paste of 800 characters stays as text, one of 1,000 folds. A line shorter than this can never
   come back as a chip, so a chip after it is never ours. */
const CHIP_MIN_CHARS = 800;
/* Chip numbers start again at #1 when Claude Code restarts in the pane (measured), so a chip kept with a line is tied
   to the pane's process as well: the pid tmux reports for the pane, read when the line was left and again before it is
   pressed. '' when it cannot be read, which never matches. */
function panePidOf(target) {
  const got = tmux(['display-message', '-p', '-t', target, '#{pane_pid}']);
  const pid = got && got.ran && got.status === 0 ? String(got.out || '').trim() : '';
  return /^\d+$/.test(pid) ? pid : '';
}
const isChipBox = (text) => /^\[Pastedtext#\d+(?:\+\d+lines)?\]$/.test(squash(text));
/* 'empty', 'ours' (what is there is a piece of what we pasted, and nothing else), or 'other'. `chip` ties a chip to our
   paste: true for a box read right after we pasted into it while it was empty (the delivery holds the pane, so no
   other delivery pastes meanwhile, and the before-paste read found nothing), where any one-line chip is ours; or the
   exact squashed chip recorded when our line was left there (a retry), where only that chip, same number, is ours.
   Anything else that is a chip is 'other'. */
function composerHolds(text, wire, chip = null) {
  const t = squash(text);
  if (!t) return 'empty';
  if (ONE_LINE_CHIP.test(t) && (chip === true || (typeof chip === 'string' && chip && t === chip))) return 'ours';
  if (isChipBox(text)) return 'other';
  const w = squash(wire);
  if (w.startsWith(t)) return 'ours';   // round 4: Claude still drawing our start, however little of it shows yet
  /* A short piece ("ok", ".") could be anyone's: ours only when enough of it shows, or all of a short message. */
  if (t.length < Math.min(20, w.length)) return 'other';
  /* Any unbroken run of ours (round 3): a box that scrolled shows our end, a box Claude is still drawing shows our
     start. The box was empty before the paste, so text from anyone else is not a run of ours. */
  return w.includes(t) ? 'ours' : 'other';
}
/* Round 6, tightened in round 8: the box holds exactly that line: a person who cut it down anywhere, or added to it,
   is not this. A box that scrolled is decided by rememberedShows below (kosmos#6436). */
function composerIsAll(text, wire) {
  const t = squash(text);
  return !!t && t === squash(wire);
}
/* kosmos#6436: the box shows the board's remembered line and nothing else. All of it; or, for a long line on a small
   pane (it scrolls, and only its end shows, ❯ drawn on the first VISIBLE row): exactly what the box showed when the
   line was left there, or any end of the line at least SCROLLED_MIN long (a pane resized since, by a person attaching,
   wraps the same end to a different length, and requiring the old length left the agent blocked for good).
   What this cannot see, stated: the rows above the visible end. A person who typed there (cursor moved to the start
   and back) would be sent with it, and a person who cut a long line of ours down on purpose would have the rest sent.
   Text added after ours, or other text on screen, is never pressed. */
const SCROLLED_MIN = 200;
/* The rows a box draws once it has scrolled (measured: 7 at 80x24; fewer on a shorter pane). A box drawing fewer
   shows all it holds, so the wider end rule does not apply to it. */
const SCROLLED_ROWS = 4;
/* `exact`: only all of the line, or exactly what the box showed when it was left (the unattended retries use this;
   the wider SCROLLED_MIN end, on a box that has scrolled, is left to a delivery). `seen` counts only at the length
   composerHolds asks of a piece of ours. */
function rememberedShows(text, kept, exact = false, rows = 0) {
  if (!kept) return false;
  if (composerIsAll(text, kept.wire)) return true;
  /* kosmos#6717: our line left there as a chip: exactly the chip recorded then (its number), and nothing else. */
  if (typeof kept.chip === 'string' && kept.chip && squash(text) === kept.chip
    && kept.chipPid && kept.target && panePidOf(kept.target) === kept.chipPid) return true;
  const t = squash(text);
  if (!t || !squash(kept.wire).endsWith(t)) return false;
  if (kept.seen && t === kept.seen && t.length >= 20) return true;
  return !exact && t.length >= SCROLLED_MIN && rows >= SCROLLED_ROWS;
}
/* Round 9: does the box still hold the end of what we pasted (its last 20 characters, or all of a shorter message)? */
function stillHoldsOurEnd(text, wire) {
  const w = squash(wire);
  return squash(text).includes(w.slice(-Math.min(20, w.length)));
}
/* The live box of a Claude Code pane, read with its colours; { ok: false } when it cannot be read. */
function readComposer(target) {
  const got = tmux(['capture-pane', '-e', '-p', '-t', target, '-S', '-200']);
  if (!got.ran || got.status !== 0) return { ok: false };
  return status.composerText(got.out, { rows: true });
}
/* Only Claude Code's box is read this way; other runners draw their own and keep today's verdict. */
const composerReadable = (card) => !!card && String(card.runner || 'claude') === 'claude';
/* #6256 item 1: true only when a Claude Code card's input box is read and holds nothing (roomhold's retry of posts
   held by text in the box); false for anything unread, so an unreadable box keeps its posts waiting. */
function inputBoxEmpty(card) {
  if (!composerReadable(card) || !card.target) return false;
  const box = readComposer(paneTarget(card));   // review 5: the exact pane the delivery types into
  return box.ok === true && box.text === '';
}
/* After the Enter, how long the box may take to empty before it is called not sent (measured: 25 to 93 ms on 2.1.300,
   up to about a second for the first line after start on 2.1.296), and how often it is looked at. */
const SUBMIT_SETTLE_MS = 1500;
const EARLIER_SETTLE_MS = 300;   // round 8: the watch after the Enter on the board's own earlier line
const SUBMIT_LOOK_MS = 60;   // round 4, measured on 2.1.300: the box reads empty 25 to 93 ms after the Enter
/* #6256 item 3: says what happens next, so nobody types it again by hand (the retries are UNSENT_RETRY_MS). */
const UNSENT_BECAUSE = 'it went into its input box and was not sent; it is still sitting there, and Kosmos presses Enter on it again on its own over the next few minutes, then every ten minutes while it sits there, and before the next thing it types to this agent, while the box shows only that line';
const UNSENT_OTHER_BECAUSE = 'it went into its input box, which then held other text too, so Enter was not pressed again; it is sitting there unsent';
const NOT_OURS_BECAUSE = 'its input box already holds text that was not sent, so this was not typed behind it';
const UNSENT_NOT_PRESSED_BECAUSE = 'it went into its input box, which by then held other text too, so Enter was not pressed; it is sitting there unsent';
/**
 * #6249: after the Enter, watch the box. `mayRetry` (the async path only, round 2): the synchronous path holds the
 * board while it waits, so it only watches; a line it leaves unsent is remembered and sent by the next delivery.
 * Yields { wait: ms } for the driver (synchronous or not, as the gap is); returns { outcome, retried } (and `text`, the
 * box as read, on 'unsent': settle records it as `seen`): 'sent' (it
 * emptied), 'unread' (no live box to read: a menu or the turn's own screen, so today's verdict stands), 'unsent'
 * (only ours still there after the settle, and after the one retry where there is one), 'other' (something besides ours:
 * the person's typing or another sender's text, so Enter is NEVER pressed on it).
 * The one retry (async only) is pressed only on a box that holds nothing but ours, on a pane still an agent's.
 */
function* submitConfirmSteps(card, target, wire, mayRetry, settleMs = SUBMIT_SETTLE_MS, chip = null) {   // chip: composerHolds'
  let waited = 0;
  let retried = false;
  let pin = chip;   // kosmos#6717: `true` becomes the exact chip at the first look that shows one, for the rest of the watch
  for (;;) {
    /* Read first, wait only while ours is still there: a pane with no box to read pays nothing over today. */
    const box = readComposer(target);
    if (!box.ok) return { outcome: 'unread', retried };
    if (pin === true && ONE_LINE_CHIP.test(squash(box.text))) pin = squash(box.text);
    const holds = composerHolds(box.text, wire, pin);
    if (holds === 'empty') return { outcome: 'sent', retried };
    /* Round 9: other text, but none of our ending in it: ours went and someone has started typing since. kosmos#6717:
       not for a chip, whose words are hidden: one that is not tied to our paste is someone else's, said as 'other'. */
    if (holds === 'other') {
      if (isChipBox(box.text)) return { outcome: 'other', retried };   // kosmos#6717: its words are hidden; never "ours went"
      return { outcome: stillHoldsOurEnd(box.text, wire) ? 'other' : 'sent', retried };
    }
    if (waited < settleMs) {
      yield { wait: SUBMIT_LOOK_MS };
      waited += SUBMIT_LOOK_MS;
      continue;
    }
    if (retried || !mayRetry) return { outcome: 'unsent', retried, text: box.text };
    if (!verifyAtSend(card).ok) return { outcome: 'unsent', retried, text: box.text };   // never an Enter into what it became
    const now = readComposer(target);   // round 4: read again right before it, so nothing typed meanwhile goes with ours
    if (!now.ok) return { outcome: 'unread', retried };   // round 6: a box that cannot be read is not someone's text
    if (composerHolds(now.text, wire, pin) !== 'ours') return { outcome: now.text ? 'other' : 'sent', retried };
    const again = tmux(['send-keys', '-t', target, 'Enter']);
    if (!again.ran || again.status !== 0) return { outcome: 'unsent', retried, text: now.text };
    retried = true;
    waited = 0;
  }
}
/* The verdict a confirm turns a placed one into. */
function confirmedVerdict(placed, result) {
  if (!result || result.outcome === 'sent' || result.outcome === 'unread') {
    return result && result.retried ? { ...placed, enterRetried: true } : placed;
  }
  return {
    ...placed, state: DELIVERY.UNCONFIRMED, queued: false, unsubmitted: true,
    because: result.outcome === 'other' ? UNSENT_OTHER_BECAUSE : UNSENT_BECAUSE,
  };
}

/* kosmos#6436: press Enter on the board's own remembered line in `target`, with no new line behind it, under the same
   gates as a delivery and the holds an automatic sender passes. Cheap looks first (the box, the exact match), so a
   retry that can press nothing never pays for a roster. Answers 'sent' (the box emptied; the line is forgotten and its
   message row told), or why nothing was sent: 'gone' (nothing remembered), 'busy' (a delivery is typing there),
   'unread', 'empty' (two reads agree the box is empty; forgotten), 'changed' (it shows something else, never
   pressed; remembered), 'gate' (no roster, a hold, or a delivery gate refused), 'pane', or 'unsent' (tmux refused the
   Enter, or the watch did not see it go; remembered, and its day starts again only when the box still shows it).
   The waits do not hold the board; its tmux reads are synchronous, as a delivery's are. */
async function pressRememberedNow(target, card) {
  const kept = recallUnsent(target);
  if (!kept) return 'gone';
  if (deliveryQueues.has(target)) return 'busy';
  const box = readComposer(target);
  if (!box.ok) return 'unread';
  /* The box is empty: our line went (sent, or cleared by hand), so it is forgotten. Only on two reads that agree a look
     (SUBMIT_LOOK_MS, 60 ms) apart: one read caught mid-redraw must not drop a line that is still there, which would leave the agent refused
     behind it again. A box holding other text keeps the memory (a person who adds to our line and then deletes the
     addition leaves our line there), and is never pressed; the day bound ends it. */
  if (!box.text) {
    if (pauser) await pauser(SUBMIT_LOOK_MS);
    else if (!runner) await new Promise((resolve) => setTimeout(resolve, SUBMIT_LOOK_MS));
    const again = readComposer(target);
    if (!again.ok) return 'unread';
    if (again.text) return 'changed';
    const still = recallUnsent(target);
    if (still && still.id === kept.id) forgetUnsent(target);
    return 'empty';
  }
  if (!rememberedShows(box.text, kept, true)) return 'changed';   // other text, or a resized pane: left to a delivery
  /* Every hold an automatic sender passes (a menu up, a usage limit or sign-out, a quota) and every gate a delivery
     passes before a keystroke (a question being answered, the trust dialog, a paused swarm, quiet hours, the usage
     cap, Claude Code's menus and prompts read fresh: an Enter on a permission prompt would approve it), on the roster
     as it is now. The wire (envelope included) is judged as the line. The pane must still be this one. */
  let roster = null;
  try { roster = rosterSource ? rosterSource() : null; } catch { roster = null; }
  if (!Array.isArray(roster) || !card || !card.sessionName) return 'gate';
  const name = card.sessionName;
  try {
    if (menuHeldVerdict(name, roster) || accountHeldVerdict(name, roster) || quotaHeldVerdict(name, roster)) return 'gate';
  } catch { return 'gate'; }
  const gate = typingGate(name, kept.wire, roster, '', '', new Date().toISOString());
  if (!gate.ok) return 'gate';
  if (paneTarget(gate.allowed.card) !== target) return 'pane';
  if (!composerReadable(gate.allowed.card)) return 'pane';   // only a Claude Code box is read this way
  card = gate.allowed.card;
  /* Read again right before the Enter: the gates took time, and the box must still be only our line. */
  const now = readComposer(target);
  if (!now.ok) return 'unread';
  if (!now.text || !rememberedShows(now.text, kept, true)) return 'changed';
  if (!verifyAtSend(card).ok) return 'pane';
  /* The pane is busy while this runs (deliver refuses a pane in deliveryQueues, deliverAsync waits behind it), so no
     line is pasted while this one is being watched. */
  let release = () => {};
  const mark = new Promise((resolve) => { release = resolve; });
  deliveryQueues.set(target, mark);
  try {
    const pressed = tmux(['send-keys', '-t', target, 'Enter']);
    if (!pressed.ran || pressed.status !== 0) return 'unsent';
    /* The full watch (the box can take about a second to empty); the waits between looks do not hold the board (#4468).
       While it runs (about 1.5 s) a person's line to this pane is refused as busy, nothing typed. */
    const steps = submitConfirmSteps(card, target, kept.wire, false, SUBMIT_SETTLE_MS, kept.chip || null);
    let step = steps.next();
    while (!step.done) {
      if (pauser) await pauser(step.value.wait);
      else if (!runner) await new Promise((resolve) => setTimeout(resolve, step.value.wait));
      step = steps.next();
    }
    const outcome = step.value && step.value.outcome;
    const still = recallUnsent(target);
    const mine = still && still.id === kept.id;
    if (outcome === 'sent') {
      if (mine) forgetUnsent(target);   // only the line this retry pressed
      if (kept.seq != null) tellEarlierSubmitted(kept.seq);
      return 'sent';
    }
    /* Only a box read still holding only ours starts the day again; 'unread' (the screen changed) and 'other' do not. */
    if (outcome === 'unsent' && mine) rememberUnsent(target, { ...still, at: Date.now() });
    return 'unsent';
  } finally {
    if (deliveryQueues.get(target) === mark) deliveryQueues.delete(target);
    release();
  }
}
/* kosmos#6436: the retries after an unsent verdict. Each one that finds the line gone (sent, emptied, or replaced by a
   newer one) does nothing; one that finds a newer line remembered leaves it to that line's own retries. */
function scheduleUnsentRetries(target, card, delays = UNSENT_RETRY_MS) {
  const kept = recallUnsent(target);
  if (!kept) return;
  /* One set at a time per line: a delivery that remembers the line again only adds a set once the last is done.
     retriesUntil lives in memory only (saveUnsent keeps wire, at and seen): a restart schedules none anyway. */
  const lastMs = delays[delays.length - 1];
  if (kept.retriesUntil && Date.now() < kept.retriesUntil) return;
  kept.retriesUntil = Date.now() + lastMs;
  unsentChainNext += 1;
  kept.retryChain = unsentChainNext;
  const id = kept.id, chain = kept.retryChain, since = Date.now();
  const schedule = unsentRetryScheduler || (runner ? null : (ms, fn) => {
    const t = setTimeout(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
  if (!schedule) return;
  delays.forEach((ms, i) => {
    schedule(ms, () => {
      const now = recallUnsent(target);
      if (!now || now.id !== id) return;   // gone, or a newer line with retries of its own
      Promise.resolve().then(() => pressRememberedNow(target, card)).then((answer) => {
        if (i === delays.length - 1 && !UNSENT_DONE.has(answer)) scheduleUnsentTail(target, card, id, chain, since, schedule);
      }).catch(() => { /* a retry that fails is not the delivery's failure */ });
    });
  });
}
/* Round 12: one more try every UNSENT_TAIL_MS while the line is still this chain's and still stuck. A light record has
   no tail (it lives 60 s); a newer set of retries (a delivery that met the line again) ends this chain. */
function scheduleUnsentTail(target, card, id, chain, since, schedule) {
  const kept = recallUnsent(target);
  if (!kept || kept.id !== id || kept.light || kept.retryChain !== chain) return;
  if (Date.now() + UNSENT_TAIL_MS - since > UNSENT_KEEP_MS) return;
  kept.retriesUntil = Date.now() + UNSENT_TAIL_MS;   // a delivery meanwhile adds no second chain
  schedule(UNSENT_TAIL_MS, () => {
    const now = recallUnsent(target);
    if (!now || now.id !== id || now.retryChain !== chain) return;
    Promise.resolve().then(() => pressRememberedNow(target, card)).then((answer) => {
      if (!UNSENT_DONE.has(answer)) scheduleUnsentTail(target, card, id, chain, since, schedule);
    }).catch(() => { /* a retry that fails is not the delivery's failure */ });
  });
}

/* kosmos#6717: text that has sat unsent in an idle Claude Code agent's input box for STUCK_INPUT_MS (the board's minute
   sweep in server.js decides that from the card's unsentInput) is cleared by Kosmos, so the agent hears again:
     - the board's own remembered line, and nothing else in the box (rememberedShows, exact): pressed, as a #6436 retry
       presses it. This also covers a line remembered across a board restart, which gets no retries;
     - anything else (the person's typing, another tool's paste, our line with anything added): saved as a draft for
       the person FIRST (the draft saver, engine/unsentdrafts.js), and only once that is written, cleared. Never sent.
   Ghost text never counts: the box is read with colours and dim runs are dropped (status.composerText). */
const STUCK_INPUT_MS = 10 * 60 * 1000;
/* Claude Code folds a long paste (or fast typing) into "[Pasted text #1]" and an image into "[Image #1]": the words
   behind it are not on screen, so they cannot be saved, and clearing would lose them. Such a box is left as it is. */
const STUCK_FOLDED = /\[(?:Pasted text|Image) #\d+[^\]]*\]/;
/* A box whose start may be out of sight is left as it is: only part of it could be saved. Measured on Claude Code
   2.1.304 (private tmux socket): a line pasted as Kosmos pastes it scrolls inside the box, which then draws its last 7
   rows at every pane height tried (15, 24, 40, 60) with nothing on screen to say the start is hidden (as #6436 measured
   on 2.1.302). So a box drawing 7 rows or more may be hiding its start. Text typed slowly grew the box instead (39 rows
   at 80x24), but the screen cannot tell the two apart. */
const STUCK_ROWS_MAX = 6;
/* Measured on Claude Code 2.1.303: one round of Ctrl-E, Ctrl-U, Ctrl-K empties a row (Ctrl-U a row before the cursor,
   Ctrl-K the line break after an emptied line, Ctrl-E first so a cursor left mid-line loses nothing to its right) and
   does nothing on an empty box. Ctrl-Y gives the cleared text back. Not Ctrl-C: one press empties the box but arms
   "Press Ctrl-C again to exit", so a person's Ctrl-C right after would end the agent. Not Escape twice: on an empty
   box it opens the rewind menu. */
const STUCK_CLEAR_KEYS = ['C-e', 'C-u', 'C-k'];
let draftSaver = null;   // (sessionName, text, { since }) => { ok, id }; set by server.js, the test seam too
function setDraftSaver(fn) { draftSaver = typeof fn === 'function' ? fn : null; }
/* After a round of the clearing keys, is `now` what was there (`prev`, both squashed) with a run taken out of it? A round
   empties the cursor's row, which can be the last, the first or one in the middle, so what is left keeps the start of
   `prev` up to that row and its end after it: shorter, and covered by their common start plus their common end. Anything
   else (a letter typed, a paste) is someone else's, and the clearing stops. */
function stuckShrunk(prev, now) {
  if (now.length >= prev.length) return false;
  let p = 0;
  while (p < now.length && prev[p] === now[p]) p += 1;
  let q = 0;
  while (q < now.length && prev[prev.length - 1 - q] === now[now.length - 1 - q]) q += 1;
  return p + q >= now.length;
}
/* The board's remembered line went out with the box (its words, with the person's added, are in the draft): forgotten,
   so no retry or delivery waits on a line that is no longer there. Only the line read at the decision (`kept`). */
function forgetDraftedLine(target, kept) {
  if (!kept) return;
  const still = recallUnsent(target);
  if (still && still.id === kept.id) forgetUnsent(target);
}
async function stuckPause(ms) {
  if (pauser) await pauser(ms);
  else if (!runner) await new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Answers { outcome, because? }: 'pressed' (the board's own line was sent), 'drafted' (saved, and the box read empty
 * after clearing), 'drafted-not-cleared' (saved, but the box did not read empty, or changed under the clearing, which
 * then stopped), 'left' (not ours and cannot be saved whole: kept in the box, `because` says why), or 'waiting' (not
 * now: a gate, a delivery typing there, the box unread or changed; `because` names it). Never throws.
 */
async function recoverStuckInput(card, since) {
  try {
    if (!composerReadable(card) || !card.target || !card.sessionName) return { outcome: 'waiting', because: 'not a Claude Code box' };
    const target = paneTarget(card);
    if (deliveryQueues.has(target)) return { outcome: 'waiting', because: 'busy' };
    const box = readComposer(target);
    if (!box.ok) return { outcome: 'waiting', because: 'unread' };
    if (!box.text) return { outcome: 'waiting', because: 'empty' };
    const kept = recallUnsent(target);
    if (kept && rememberedShows(box.text, kept, true)) {
      /* Idle on the roster as it is now, not only as the sweep read it: an Enter on a busy agent would queue the line.
         pressRememberedNow then passes every gate a #6436 retry passes (menu, account and quota holds, typingGate,
         verifyAtSend). Not the open-terminal check of the draft path: this is Kosmos's own message, which a #6436 retry
         would press with the window open too, and pressing it loses nothing. */
      let fresh = null;
      try { const r = rosterSource ? rosterSource() : null; fresh = Array.isArray(r) ? resolveCard(r, card.sessionName) : null; } catch { fresh = null; }
      if (!fresh || fresh.state !== status.STATE.IDLE) return { outcome: 'waiting', because: 'not idle' };
      const answer = await pressRememberedNow(target, card);
      if (answer === 'sent') return { outcome: 'pressed' };
      /* Enter went and the box still holds the line (Enter rebound, say): said once in the log and not pressed again by
         this sweep for the same text (`giveUp`), so #6436's own retries, and their one-day bound, are all that press it. */
      if (answer === 'unsent') return { outcome: 'left', giveUp: true, because: 'Enter on the line Kosmos had left there did not send it' };
      return { outcome: 'waiting', because: answer };
    }
    if (STUCK_FOLDED.test(box.text)) return { outcome: 'left', because: 'it holds a pasted block or image whose words are not on screen' };
    if ((box.rows || 0) > STUCK_ROWS_MAX) return { outcome: 'left', because: 'it is too long to read whole' };
    /* Someone has this agent's terminal window open (an attached tmux client): the text in the box is in front of them,
       and clearing it there would make words vanish under their hands with nothing on that screen to say where. */
    const seen = tmux(['display-message', '-p', '-t', target, '#{session_attached}']);
    if (!seen.ran || seen.status !== 0 || !/^\d+\s*$/.test(String(seen.out))) return { outcome: 'waiting', because: 'unread' };
    if (Number(String(seen.out).trim()) > 0) return { outcome: 'left', because: 'its terminal window is open, so the person there can see it' };
    if (!draftSaver) return { outcome: 'waiting', because: 'nowhere to save it' };
    /* The holds a retry passes, on the roster as it is now, and the pane must still be this agent's, idle. */
    let roster = null;
    try { roster = rosterSource ? rosterSource() : null; } catch { roster = null; }
    if (!Array.isArray(roster)) return { outcome: 'waiting', because: 'gate' };
    const name = card.sessionName;
    try {
      if (menuHeldVerdict(name, roster) || accountHeldVerdict(name, roster) || quotaHeldVerdict(name, roster)) return { outcome: 'waiting', because: 'gate' };
    } catch { return { outcome: 'waiting', because: 'gate' }; }
    const allowed = addressable(name, roster);
    if (!allowed.ok) return { outcome: 'waiting', because: 'gate' };
    const nowCard = allowed.card;
    if (paneTarget(nowCard) !== target || !composerReadable(nowCard)) return { outcome: 'waiting', because: 'pane' };
    if (QMENU_BUSY.has(target)) return { outcome: 'waiting', because: 'gate' };
    if (nowCard.state !== status.STATE.IDLE) return { outcome: 'waiting', because: 'not idle' };
    let release = () => {};
    const mark = new Promise((resolve) => { release = resolve; });
    deliveryQueues.set(target, mark);   // no delivery pastes while this runs (deliver refuses, deliverAsync waits)
    try {
      const again = readComposer(target);
      if (!again.ok) return { outcome: 'waiting', because: 'unread' };
      if (squash(again.text) !== squash(box.text)) return { outcome: 'waiting', because: 'changed' };
      if (!verifyAtSend(nowCard).ok) return { outcome: 'waiting', because: 'pane' };
      let saved = null;
      try { saved = draftSaver(name, again.text, { since: since || null }); } catch { saved = null; }
      if (saved && saved.full === true) return { outcome: 'left', because: String(saved.because || 'too many drafts are kept') + ', so the box was left as it is' };
      /* Said in the log (once per text, by the sweep) and tried again next minute: a store that cannot be written or read
         would otherwise leave the agent deaf with nothing said anywhere. */
      if (!saved || saved.ok !== true) return { outcome: 'left', because: 'the draft could not be saved (' + String((saved && saved.because) || 'no answer') + '), so the box was left as it is' };
      /* Saved: from here the words are safe. Clear a round at a time; stop as soon as the box shows anything that is
         not what is left of the saved text (someone typing now), so their new words are not cleared too. */
      const done = (outcome, because) => ({ outcome, id: saved.id, ...(saved.already ? { already: true } : {}), ...(because ? { because } : {}) });
      /* Nothing was cleared and nothing is wrong with the box (tmux refused, a read failed): tried again next minute,
         which saves nothing twice (the drafts keep one copy of a text). */
      const notYet = (because) => ({ ...done('drafted-not-cleared', because), retry: true });
      /* `expect` is the box as last read. Right before each round it must still read exactly that (so words typed since
         are never cleared with it), and after the round what is left must be it with rows taken out (stuckShrunk). The
         same read stops the clearing if anything replaces the box: a dialog or permission prompt leaves no box to read,
         and a menu's own ❯ row reads as different text. */
      let expect = squash(again.text);
      let rowsWere = again.rows || 0;
      let stale = 0;
      const rounds = 2 * (again.rows || 1) + 6;
      for (let i = 0; i < rounds; i += 1) {
        const before = readComposer(target);
        if (!before.ok) return notYet('the box could not be read');
        if (squash(before.text) !== expect) return done('drafted-not-cleared', 'the box changed while it was being cleared');
        const sent = tmux(['send-keys', '-t', target, ...STUCK_CLEAR_KEYS]);
        if (!sent.ran || sent.status !== 0) return notYet('tmux refused the keys');
        await stuckPause(SUBMIT_LOOK_MS);
        let left = readComposer(target);
        if (!left.ok) return notYet('the box could not be read');
        if (!left.text) {
          /* Empty only when two reads a look apart agree, as pressRememberedNow asks: one read can catch a redraw. */
          await stuckPause(SUBMIT_LOOK_MS);
          left = readComposer(target);
          if (!left.ok) return notYet('the box could not be read');
          if (!left.text) { forgetDraftedLine(target, kept); return done('drafted'); }
        }
        const now = squash(left.text);
        /* A round that empties a blank row reads the same once squashed but draws one row fewer: that is progress. */
        if (now === expect && (left.rows || 0) < rowsWere) { rowsWere = left.rows || 0; stale = 0; continue; }
        rowsWere = left.rows || 0;
        if (now === expect) {
          stale += 1;   // the keys did nothing (vim mode, keys rebound): two such rounds and it is given up
          if (stale >= 2) return done('drafted-not-cleared', 'the box did not empty');
          continue;
        }
        if (!stuckShrunk(expect, now)) return done('drafted-not-cleared', 'the box changed while it was being cleared');
        stale = 0;
        expect = now;
      }
      return done('drafted-not-cleared', 'the box did not empty');
    } finally {
      if (deliveryQueues.get(target) === mark) deliveryQueues.delete(target);
      release();
    }
  } catch (err) {
    return { outcome: 'waiting', because: 'failed: ' + String((err && err.message) || err) };
  }
}
/* kosmos#6717: each kept draft as one Kosmos line in the agent's conversation, placed at the time it was moved. Derived
   on every read like withAccountRow, never stored as a message row: every reader of a thread takes a row as the
   person's or the agent's, and this is neither. `draft: true` and `draftId` let the page offer Dismiss. */
const DRAFT_ROW_ID_PREFIX = 'kosmos-draft:';
function withDraftRows(messages, drafts) {
  const list = Array.isArray(messages) ? messages : [];
  const kept = Array.isArray(drafts) ? drafts.filter((d) => d && typeof d.id === 'string' && typeof d.text === 'string' && d.text
    && typeof d.at === 'string' && Number.isFinite(Date.parse(d.at))) : [];
  if (!kept.length) return list;
  let out = list.slice();
  for (const d of kept) {
    const atMs = Date.parse(d.at);
    let place = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = out[i] ? Date.parse(out[i].at) : NaN;
      if (Number.isFinite(t) && t <= atMs) place = i + 1;
    }
    const row = { id: DRAFT_ROW_ID_PREFIX + d.id, at: d.at, text: d.text, from: null, delivery: null, kind: 'kosmos', draft: true, draftId: d.id,
      ...(typeof d.since === 'string' ? { since: d.since } : {}) };
    out = out.slice(0, place).concat([row], out.slice(place));
  }
  return out;
}

/* ── who may be sent to ──────────────────────────────────────────────────── */

/**
 * The agent card this name is allowed to address, or a refusal.
 *
 * ⚠️ EXACT MATCH TO PERMIT, LOOSE TO NOTICE — the rule this repo has now fixed
 * three separate times (the profile route, then `projects.tellAgent`, then
 * `remove`). `store.safeKey` STRIPS rather than rejects, so any spelling that
 * sanitises to a live agent would otherwise address it: `An.gel` reaching
 * `angel`'s session is the same hole, one keystroke more dangerous, because
 * here it types into a conversation rather than editing a file.
 *
 * ⚠️ AND `isNamedOurs`, not merely a name on the roster. `list-panes -a`
 * returns every pane on the machine, so a stranger's `tmux new -s casey` is on
 * the roster under that name. `remove` gates its destructive action on exactly
 * this flag and `tellAgent` gates the instruction write on it; typing into a
 * pane is at least as strong an act as either.
 *
 * ⚠️ AND `isAgentPane`, which is a DIFFERENT question and the one that stops
 * the worst outcome here. It is false when no Claude is running in the pane —
 * i.e. when the pane is a SHELL — and text sent to a shell is EXECUTED rather
 * than read. It is also false while the pane is scrolled back in copy-mode,
 * where keystrokes go to copy-mode bindings and the message silently never
 * arrives while we report that it did.
 *
 * A roster of `null` means the caller could not look, which is not permission.
 */
/**
 * Find the roster card for a name on the SEND path, tolerating CASE.
 *
 * 🛑 #989: THE SEND AND THE ROUTE GATE DISAGREED ON CASE. server.js's
 * `claimantFor` (which `knownAgent` gates every route on) resolves a name
 * exact-first and then by `store.safeKey`, so `Casey` reaches the agent whose
 * session is `casey`. `addressable`/`viewport` here did a BARE case-sensitive
 * `sessionName === key`, so the SAME name the route just admitted was then
 * refused "by exactly this name" -- Josh changed an agent's model, the restart's
 * recovery route resolved a name whose case differed from the tmux session, and
 * the send was refused while the agent looked alive (kosmos#989). This resolver
 * closes THAT disagreement (case) and only that.
 *
 * ⚠️ CASE-FOLD, NOT `store.safeKey` -- AND THE DIFFERENCE IS DELIBERATE. safeKey
 * also STRIPS to [a-z0-9_-], and the SEND path is intentionally STRICTER than the
 * read gate: a name that merely SANITISES to a live agent (`Ca.sey` -> `casey`)
 * must be REFUSED here, or a send types into a conversation it was never aimed at.
 * engine/chat.test.js:181 pins exactly that contract ("a spelling that merely
 * sanitises to a live agent is refused"), and the repo has restored the same hole
 * three times (profile route, projects.tellAgent, remove). So the gate stays
 * safeKey-tolerant (keeps an agent REPORTABLE under its sanitised name, #18) and
 * the send tolerates case only -- they now AGREE on case and still DIFFER on
 * strip, on purpose.
 *
 * Exact match wins outright (no behaviour change for an exact name; `casey` still
 * resolves to `casey` even beside an external `tmux new -s Casey`). Otherwise a
 * case-insensitive match, preferring the `isNamedOurs` card so a stranger's
 * like-cased pane never wins over ours. The caller's `isNamedOurs`/`isAgentPane`
 * checks still run on the returned card, so tolerating case loosens no gate.
 */
function resolveCard(roster, key) {
  if (!Array.isArray(roster)) return null;
  const exact = roster.filter((a) => a && a.sessionName === key);
  if (exact.length) return exact.find((a) => a.isNamedOurs === true) || exact[0];
  // #989: tolerate CASE ONLY, not store.safeKey. safeKey ALSO strips to
  // [a-z0-9_-], and the send path must stay STRICTER than the route gate: a name
  // that merely SANITISES to a live agent (`Ca.sey` -> `casey`) must be REFUSED
  // here, or a send types into a conversation it was never aimed at -- a hole this
  // repo has closed three times (engine/chat.test.js:181, the profile route,
  // projects.tellAgent, remove). Case is the only difference #989 reported, and
  // lowercasing closes exactly that and nothing more. isNamedOurs preference
  // matches claimantFor so a stranger's like-cased pane never wins over ours.
  // Guard the key too, not just the roster: this is now a public export the test
  // suite calls directly, and a non-string/null key would throw on .toLowerCase().
  const want = String(key == null ? '' : key).toLowerCase();
  const same = roster.filter((a) => a && typeof a.sessionName === 'string'
    && a.sessionName.toLowerCase() === want);
  if (!same.length) return null;
  return same.find((a) => a.isNamedOurs === true) || same[0];
}

function addressable(sessionName, roster) {
  const key = String(sessionName == null ? '' : sessionName);
  if (!key) return { ok: false, because: 'we do not have an agent to send this to' };
  if (!Array.isArray(roster)) {
    return { ok: false, because: 'we could not check which agents are running, so we did not type anything anywhere' };
  }
  const card = resolveCard(roster, key);
  if (!card) {
    return { ok: false, because: 'we cannot see an agent by exactly this name on this computer right now' };
  }
  if (card.isNamedOurs !== true) {
    return { ok: false, because: 'something is running under this name, but we cannot tell that it is this agent, so we did not type into it' };
  }
  if (!card.target) {
    return { ok: false, because: 'we cannot tell where this agent is running' };
  }
  if (card.isAgentPane !== true) {
    // Two reasons, worth telling apart on screen: a pane scrolled back in
    // copy-mode swallows what we type, and a pane with no agent process in it
    // would EXECUTE it as a command.
    // #2100: the "no <runner> running" line NAMES THE RUNNER. This branch is
    // reached when the pane holds a shell rather than the agent's own process
    // -- for a Claude agent that is a stopped/crashed pane, and for a codex
    // agent (a `codex`/`codex.exe`/shell front, NOT the `node` front that reads
    // as Claude and stays messageable) likewise. Telling a codex agent's owner
    // "there is no Claude running" is wrong and confusing on an agent they
    // created as OpenAI (Josh's #2100 screenshot). The reason is identical in
    // both cases -- the pane would RUN typed text -- so only the process name
    // differs. 🔑 THIS CHANGES ONLY THE REASON SHOWN, NEVER THE GATE: isAgentPane
    // is already false above; nothing here enables the composer or the send path.
    if (card.isAgentSession === true) {
      return { ok: false, because: 'its window is scrolled back right now, so anything we typed would go to the scrollback instead of to the agent' };
    }
    const runnerName = card.runner === 'codex' ? 'Codex' : card.runner === 'gemini' ? 'Gemini' : card.runner === 'grok' ? 'Grok' : card.runner === 'antigravity' ? 'Antigravity' : card.runner === 'muse' ? 'Muse Code' : 'Claude';   // #3939
    return { ok: false, because: 'there is no ' + runnerName + ' running in its window right now, so anything we typed would be run as a command instead of read' };
  }
  return { ok: true, card };
}

/**
 * The exact tmux pane, pinned.
 *
 * ⚠️ `=` on every target, no exceptions — the rule `engine/connect.js`,
 * `engine/remove.js` and the README already treat as mandatory. Without it tmux
 * resolves a target by PREFIX when no exact session exists, so a send aimed at
 * a `casey` that has just died lands in a `casey2` that has not. Measured on
 * 3.6a: with the session gone and a lookalike alive, the pinned form answers
 * "can't find session" instead of typing into the neighbour.
 */
function paneTarget(card) {
  return '=' + card.target;
}

/* ── the send ────────────────────────────────────────────────────────────── */

/**
 * The three fields that can go stale between authorising a send and making it,
 * asked for by NAME from the engine's own column list.
 *
 * ⚠️ Built from `status.PANE_COLUMNS` rather than hand-typed, for the reason
 * `test-support/fleet` builds pane lines the same way: a format string typed
 * out here is a second place that has to be right about what tmux calls these
 * things, and it would go on looking right while asking for the wrong field.
 *
 * ⚠️ `claim` sits in the MIDDLE on purpose. It is empty for every session that
 * does not carry one, and a trailing empty field is indistinguishable from a
 * field that was not emitted at all once the answer is split. `inMode` is
 * always `0` or `1`, so putting it last keeps the shape readable.
 */
const VERIFY_KEYS = ['command', 'claim', 'inMode'];
/* A FUNCTION, not a require-time constant (round 38): `verifyAtSend`'s
   column guard re-reads `status.PANE_COLUMNS` at call time, and a constant
   computed at load can outlive the shape it describes -- the exported copy
   and the guard could disagree about the same columns. Derived on demand,
   the two cannot fork; the export below is a getter for the same reason
   `DRY_RUN`'s is. */
const verifyFormat = () => VERIFY_KEYS
  .map((key) => (status.PANE_COLUMNS.find((c) => c.key === key) || {}).fmt)
  .join('\t');

/**
 * Is this pane STILL one we may type into, right now?
 *
 * Never throws. Answers `{ok}` or `{ok: false, because}`, and every refusal
 * here happens before a single keystroke — so the caller's verdict is
 * `could_not`, which is the one that tells the person re-sending is safe.
 */
function verifyAtSend(card) {
  if (VERIFY_KEYS.some((key) => {
    const col = status.PANE_COLUMNS.find((c) => c.key === key);
    // The fmt too, not only the key (round 28): a column that kept its key
    // and lost its fmt puts the literal string "undefined" into the format,
    // survives the arity check, and refuses every send on the machine with
    // a sentence about the pane changing -- the same silent machine-wide
    // refusal this guard exists to prevent, one field over.
    return !col || typeof col.fmt !== 'string' || !col.fmt;
  })) {
    // A column was renamed in the engine and this would silently ask tmux for
    // an empty string, which reads as "no Claude running" and refuses every
    // send on the machine. Better to say so than to fail closed in silence.
    return { ok: false, because: 'we cannot work out how to check its window before typing, so we did not type anything' };
  }
  const got = tmux(['display-message', '-p', '-t', paneTarget(card), verifyFormat()]);
  if (!got.ran || got.status !== 0) {
    return {
      ok: false,
      because: refusalReason(got, 'we could not check its window just before sending, so we did not type anything'),
    };
  }
  const parts = String(got.out || '').replace(/\n+$/, '').split('\t');
  /**
   * ⚠️ TOO MANY FIELDS IS AS WRONG AS TOO FEW, and only the second half was
   * checked. A short answer was refused while a LONG one was silently accepted
   * and its extras dropped — so if a value ever contained a tab, or a future
   * tmux emitted another field, the fields would shift by one and this would
   * read a claim as a command and a command as a session name, then hand the
   * result to `isAgentPane` with complete confidence. Length is the only signal
   * available that the shape is the shape we asked for, so it is checked
   * exactly, in both directions.
   */
  if (parts.length !== VERIFY_KEYS.length) {
    return {
      ok: false,
      because: 'its window answered in a shape we do not recognise, so we did not type anything',
    };
  }
  const fresh = {};
  VERIFY_KEYS.forEach((key, i) => { fresh[key] = parts[i]; });
  /**
   * ⚠️ The IDENTITY fields come from the card and the LIVE fields from tmux,
   * and that split is deliberate. A session's name cannot change under us
   * without the exact-pinned target failing outright, so re-reading it would
   * add nothing; what changes in the window that matters is what is RUNNING in
   * the pane and whether it is scrolled back.
   */
  const pane = {
    name: card.sessionName,
    session: card.session,
    claim: fresh.claim,
    command: fresh.command,
    inMode: fresh.inMode,
  };
  /**
   * ⚠️ OWNERSHIP IS ASSERTED SEPARATELY, and a test caught me leaving it out.
   *
   * `isAgentPane` is NOT an ownership check: its fleet arm accepts any pane
   * with a live Claude in it, whatever the session is called, because a
   * legitimately non-Discord agent has to be manageable. So a probe answering
   * with somebody ELSE's claim still passed it — while the `claim` field this
   * function goes to the trouble of fetching went unread, which is its own
   * smell.
   *
   * `addressable` gates the send on `isNamedOurs` up front; this is that same
   * gate re-asked against the live values, so the window closes on all three
   * facts rather than two. It is the lesson `status.js` states about itself:
   * publishing a flag and leaving another branch to honour it is not enough.
   */
  if (!status.isNamedOurs(pane)) {
    return {
      ok: false,
      because: 'we could not still tie its window to this agent when we went to type, so we did not type anything',
    };
  }
  if (status.isAgentPane(pane)) return { ok: true };
  // Told apart, because they are different things to be told: one is somebody
  // scrolling, the other is an agent that has stopped since we looked.
  return {
    ok: false,
    because: status.isAgentSession(pane)
      ? 'its window was scrolled back by the time we went to type, so we did not type anything'
      : 'it stopped being an agent’s window between us checking and us typing, so we did not type anything: '
        + 'anything we sent would have been run as a command instead of read',
  };
}

/**
 * What the agent was doing when we typed into it.
 *
 * ⚠️ THIS EXISTS BECAUSE THE NO-QUEUE DESIGN IS HONEST ABOUT THE SEND AND
 * MISLEADING ABOUT THE READ. "Placed into casey's session just now" is exactly
 * true and invites precisely the wrong inference: that casey is now reading it.
 * A Claude that is mid-task does not consume its composer until it finishes, so
 * a message sent to a working agent sits there — possibly for minutes. Without
 * this clause the person waits, sees nothing happen, and concludes the feature
 * is broken.
 *
 * ⚠️ THE STATE IS THE BOARD'S, not a second reading. It comes off the roster
 * card the send was authorised against — the same `classify` verdict the agent's
 * own card shows — so the thread and the card cannot disagree about what an
 * agent was doing. And it is a claim about WHEN THIS WAS SENT, not about now:
 * the roster is one observation, taken at the start of the request, and the
 * wording says so rather than implying a live reading.
 *
 * ⚠️ `unknown` GETS A SENTENCE TOO. It is the state that must never read as
 * fine, and silence here would render identically to an idle agent.
 */
/**
 * @param {string} [outcome] the delivery state this note will be shown beside.
 *   ⚠️ `unconfirmed` DROPS THE SETTLED-FACT CLAUSE. "It was mid-task, so this
 *   sits in its composer until it finishes" is a statement about where the
 *   message IS — and the one verdict that cannot make that statement is the one
 *   that exists precisely because we do not know whether it arrived. The two
 *   were being printed side by side: "we cannot tell you whether it arrived"
 *   and "this sits in its composer", in one sentence. What the agent was DOING
 *   is still true and still useful, so that half stays.
 */
/* ⚠️ FOUR PARAMETERS, AND THE ORDER IS NOT ARBITRARY. #2107 added `runner`
   at position 3 and landed on main; #1889 added `backgroundWait` and had not.
   The landed one keeps its slot so no merged caller or test moves, and the
   unlanded one takes position 4. Both were written as "the third parameter"
   independently, which is exactly how a positional API collides silently:
   the types are compatible, so a caller passing the wrong one still runs. */
function waitingNote(state, outcome, runner, backgroundWait, sessionName) {
  const unsure = outcome === DELIVERY.UNCONFIRMED;
  // #2093/#2107: name the PROVIDER the sign-in belongs to, not a hardcoded "Claude".
  // Before #2093 a codex pane never reached AUTH_FAILED here, so the literal was
  // always correct; #2093's produce path makes a dead codex agent reach it, and
  // "its Claude sign-in was not working" beside a codex agent is the exact
  // cross-provider mislabel #2107 tracks.
  //
  // #2107's chat.js half named the RUNNER here ('Codex'), copying the "no <runner>
  // running" idiom at chat.js:520. That idiom is right THERE -- a stopped/crashed
  // pane is a RUNNER-PROCESS fact, so the process name is the truth. A SIGN-IN is a
  // different fact: it is the credential/account, and the remedy the board shows is
  // "Reconnect the account" -- an OpenAI account, connected by an OpenAI key or the
  // ChatGPT sign-in, never a "Codex account". So a sign-in line names the PROVIDER,
  // not the runner. Decisively, this note and the board must teach ONE fact:
  // status.js's produce copy says "Its OpenAI sign-in is not working" (#2093), so
  // this line must say OpenAI too or the phone and the board drift.
  // #3296: gemini names Gemini, not Claude -- an auth-failed gemini agent must point at
  // the Gemini sign-in/key, not send the person to reconnect Claude (the #2107 cross-
  // provider copy class). Product name 'Gemini', matching create.js's create/model copy.
  // #3391: grok names Grok for the same reason -- an auth-failed grok agent points at its
  // own XAI_API_KEY/sign-in, not Claude's. Product name 'Grok', matching create.js.
  // #5977 review 3: accountproblem's map (the same words), which also reads a codex agent's job, so Qwen says Qwen.
  const provider = require('./accountproblem').providerOf({ runner, sessionName });   // #3568: its sign-in is Google's; #3939: Muse's is Meta's
  /* 🛑 #1889. ONE `working` MEANS THE OPPOSITE OF THE OTHER, FOR THIS SENTENCE.
     A pane whose screen says it is waiting on a BACKGROUND agent classifies
     `working`, but its own turn has ENDED and its REPL is at its prompt, so the
     composer takes the text immediately. The unqualified line below told the
     person the exact opposite of what happens, and they wait on a message that
     was already read. Same false-sentence class this branch fixed in
     `reconcileReport` rule 5 and in the #1921 account badge; this is the only
     one a PERSON reads.
     📌 Polarity is `=== true` on purpose: a card built before this field existed,
     or by any path that does not set it, keeps the existing sentence. Absence
     must never select the new branch. */
  const bgWait = backgroundWait === true;
  // The engine's own constants, not literals: a state renamed in status.js
  // must move these cases with it rather than leaving a switch that
  // silently stops matching (the same rule server.js records for its
  // STATE import).
  switch (state) {
    case status.STATE.WORKING:
      if (bgWait) {
        return unsure
          ? 'it was waiting on a background agent'
          : 'it was waiting on a background agent, so its own turn had already ended and it can pick this up now';
      }
      return unsure
        ? 'it was mid-task'
        : 'it was mid-task, so it will not read this until it finishes';
    case status.STATE.NEEDS_YOU:
      // Deliberately weaker than "this answered its question". We observed a
      // question on its screen; what its interface did with the keystroke is
      // not something we watched. (#3419 note: this looks redundant once the
      // question renders as a thread bubble, but `waitingNote` is shared by
      // EVERY chat.deliver caller -- the Compact/Clear route reaches it too, and
      // its `memoryCommand` reader substitutes "between tasks" on a null note,
      // which is false for a waiting agent. Stripping it is a step-3 job scoped
      // to the message route only, after auditing all deliver callers.)
      return 'it was waiting on an answer when this was sent';
    case status.STATE.RATE_LIMITED:
      return unsure
        ? 'it was paused on a usage limit'
        : 'it was paused on a usage limit, so it may not act on this until that clears';
    // #874: was falling to the default below ("we could not tell what it
    // was doing") for exactly the case where the most was known -- its
    // Claude sign-in had already failed.
    case status.STATE.AUTH_FAILED:
      /* #5977 review 4: a Qwen account has no sign-in; what fails is reaching its endpoint (accountproblem's words). */
      if (provider === 'Qwen') {
        return unsure
          ? 'it could not get answers from its Qwen endpoint'
          : 'it could not get answers from its Qwen endpoint, so it will not act on this until that is fixed';
      }
      return unsure
        ? 'its ' + provider + ' sign-in was not working'
        : 'its ' + provider + ' sign-in was not working, so it will not act on this until that is fixed';
    // #3410: the same "most was known, yet it fell to the default" gap the
    // AUTH_FAILED case above closes -- a wedged agent's connection loss is fully
    // known to the board, so a person messaging it should be told, not given
    // "we could not tell". Sibling of the taskLine/stateReason surfacing; here the
    // note is past-tense (what it was doing WHEN the message was sent).
    case status.STATE.CONNECTION_LOST:
      return unsure
        ? 'it had lost its connection to the internet'
        : 'it had lost its connection to the internet, so it may not act on this until it reconnects';
    case status.STATE.IDLE:
      return 'it was sitting at its prompt';
    default:
      return 'we could not tell what it was doing when this was sent';
  }
}

/* #5223: what viewport() says for a Windows agent, which has no window. Exported so tests share one copy. */
const NO_WINDOW_BECAUSE = 'on Windows an agent runs without a window, so there is no screen to show here; its replies are in your messages with it';

/* #5223: one sentence for every keysAllowed caller (Stop now, stop helpers, the Gemini quota Stop). It says
   the outcome, true for all three: it was not stopped (for the Gemini quota, its Stop was not chosen). A
   Windows agent has no window to go to, and Restart (stop and start, under AI Settings) works on Windows
   (#3431), so that is where it points, with its cost in the page's own words (the Restart dialog's): heavier
   than the key the person asked for, so said. */
const WIN32_NO_KEYS_SENTENCE = 'Kosmos cannot send keys to an agent on Windows yet, so it was not stopped; Restart under its AI Settings ends what it is doing, and it comes back with nothing in its memory';

/**
 * #3564: the gate for Stop now's keystrokes. deliver's own checks for a key that is not a
 * message: exact name, ours, an agent pane (`addressable`); NOT on Claude Code's trust
 * dialog, where one Escape ends the session (measured, Claude Code 2.1.282, 2026-09-25);
 * and not a Windows agent, whose input is a supervisor channel with no keys to send.
 */
function keysAllowed(sessionName, roster) {
  const allowed = addressable(sessionName, roster);
  if (!allowed.ok) return { ok: false, because: allowed.because };
  if (allowed.card.state === status.STATE.NEEDS_YOU && status.isTrustDialogEvidence(allowed.card.stateEvidence)) {
    return { ok: false, because: status.TRUST_DIALOG_SENTENCE };
  }
  if (allowed.card.reachedByChannel === true) {
    return { ok: false, because: WIN32_NO_KEYS_SENTENCE };
  }
  /* #4589 round 2: Stop now's keys obey the same Codex rule as a message (Escape and C-x C-k are keys too, and
     C-x C-k on Codex's hook dialog is unmeasured). */
  const codex = codexScreenRefusal(allowed.card, sessionName, roster);
  if (codex) return { ok: false, because: codex };
  return { ok: true, card: allowed.card };
}

/* #3564: Claude Code's "stop all agents" chord, pressed twice (the second press confirms).
   Measured on 2.1.282 (2026-09-25): from the plain prompt it stops every background helper,
   and with none running it leaves the prompt untouched. */
const STOP_ALL_HELPERS_KEYS = ['C-x', 'C-k', 'C-x', 'C-k'];

/**
 * #3564 Stop now, the half Escape cannot do: stop ALL of a swarm lead's background helpers
 * (one Escape does not reach them, measured). Sends STOP_ALL_HELPERS_KEYS through
 * keysAllowed. It drives Claude Code's own keys, so a change there can break it; the card's
 * activeHelpers, read from the helpers' own files, is how anyone sees whether it held.
 * Never throws.  { ok: true } | { ok: false, because }
 */
function stopHelpers(sessionName, roster) {
  const allowed = keysAllowed(sessionName, roster);
  if (!allowed.ok) return { ok: false, because: allowed.because };
  const t = paneTarget(allowed.card);
  for (const k of STOP_ALL_HELPERS_KEYS) {
    const got = tmux(['send-keys', '-t', t, k]);
    if (got.spawnFailed || !got.ran || got.status !== 0) return { ok: false, because: 'we could not finish stopping its helpers; look at its window' };
  }
  return { ok: true };
}

/**
 * #3564 Stop now: interrupt the agent's current turn (Escape, as a person would press
 * it). Through keysAllowed. Never throws.
 *   { ok: true } | { ok: false, because }
 */
function interrupt(sessionName, roster) {
  const allowed = keysAllowed(sessionName, roster);
  if (!allowed.ok) return { ok: false, because: allowed.because };
  const got = tmux(['send-keys', '-t', paneTarget(allowed.card), 'Escape']);
  if (got.spawnFailed) return { ok: false, because: got.err || 'we could not reach its window, so nothing was stopped' };
  if (!got.ran || got.status !== 0) return { ok: false, because: 'we could not tell whether it stopped; look at its window' };
  return { ok: true };
}

/**
 * #4004: answer Gemini's usage-limit question with Stop, so an agent that reached a Google usage limit is
 * back at its prompt instead of frozen on "Keep trying / Stop" with nobody there to choose. Through keysAllowed.
 * The pane is read again here, immediately before the key, and the key is the number Gemini printed beside "Stop"
 * (never a fixed one): nothing is pressed unless that question is on screen now. Retrying cannot clear a daily
 * limit, which is why Stop. Never throws.
 *   { ok: true, key } | { ok: false, because }
 */
function answerGeminiQuotaStop(sessionName, roster) {
  const allowed = keysAllowed(sessionName, roster);
  if (!allowed.ok) return { ok: false, because: allowed.because };
  if (allowed.card.runner !== 'gemini') return { ok: false, because: 'that is not a Gemini agent' };
  const t = paneTarget(allowed.card);
  let text;
  try { text = status.capturePane(t); } catch { text = null; }
  const q = text ? status.geminiQuotaReading(text) : null;
  if (!q || !q.dialog) return { ok: false, because: 'the quota question is not on its screen now' };
  const key = status.geminiStopKey(text);
  if (!key) return { ok: false, because: 'the question on its screen has no Stop to choose' };
  const got = tmux(['send-keys', '-t', t, key]);
  if (got.spawnFailed || !got.ran || got.status !== 0) return { ok: false, because: 'we could not answer the question; look at its window' };
  return { ok: true, key };
}

/* #5406 part 2: answering Claude Code's question menu (status.claudeQuestionMenu) by key, the only way it takes an
   answer. Measured on Claude Code 2.1.29x: a bare digit selects at once; the message path's paste is ignored by the
   menu and its Enter then takes the HIGHLIGHTED option (a wrong answer, silently); Escape closes the menu and a message
   sent after it reaches the agent. Both read the screen right before the key, so a key never lands on a menu the person
   did not see, and again after, so the answer is reported from what the screen shows. */
const QMENU_SETTLE_MS = 1200;
const qmenuWait = (ms) => new Promise((done) => setTimeout(done, ms));
/* Review 3: a Claude card only, and never while a delivery is being typed into the same pane (a key in its paste-to-Enter
   gap would land on whatever the screen is then). */
function questionMenuKeysAllowed(sessionName, roster) {
  const allowed = keysAllowed(sessionName, roster);
  if (!allowed.ok) return allowed;
  if (String(allowed.card.runner || 'claude') !== 'claude') return { ok: false, because: 'that is not a Claude agent' };
  if (deliveryQueues.has(paneTarget(allowed.card))) return { ok: false, because: 'a message is being typed to it right now; try again in a moment' };
  /* #5406 slice C review 18: one key answer per pane at a time. The page's own lock covers one tab; two surfaces on the
     same agent could each read the menu before it redraws and both send a digit, the second landing on whatever is
     on screen then. Held from before the first read to after the settle read. */
  if (QMENU_BUSY.has(paneTarget(allowed.card))) return { ok: false, because: QMENU_BUSY_SENTENCE };
  return allowed;
}
const QMENU_BUSY = new Set();   // pane targets with a key answer or a close in progress
const QMENU_BUSY_SENTENCE = 'its question is being handled right now, so nothing was sent; look at this page again in a moment';
/* Run `fn` holding the pane's key-answer slot (the check above refused if it was taken). */
async function withQmenuSlot(allowed, fn) {
  const t = paneTarget(allowed.card);
  QMENU_BUSY.add(t);
  try { return await fn(); } finally { QMENU_BUSY.delete(t); }
}
/* Send the bare digit for option `n`, only if the live menu still asks `question` and option `n` is still `label`.
   Resolves { ok: true, key, label, answered, screen } (screen: what the pane shows after) or { ok: false, because }. */
async function answerQuestionMenu(sessionName, n, roster, expect) {
  const allowed = questionMenuKeysAllowed(sessionName, roster);
  if (!allowed.ok) return { ok: false, because: allowed.because };
  /* kosmos#6239 (challenge round 1): answering a question sets an agent back to work as surely as a message, so in the
     policy's quiet hours it is refused too (deliverWithGap's rule, read the same way). Nothing is pressed. */
  {
    let q = { ok: true };
    try { q = require('./orgpolicy').quietAllows(); } catch { q = { ok: true }; }
    if (q.ok !== true) return { ok: false, because: `nothing was answered: ${q.because}`, quiet: true };
    /* kosmos#6309: at the policy's monthly usage cap, likewise (deliverWithGap's rule). A fault reads as open. */
    let c = { ok: true };
    try { c = require('./usagecap').capAllows(); } catch { c = { ok: true }; }
    if (c.ok !== true) return { ok: false, because: `nothing was answered: ${c.because}`, capped: true };
  }
  return withQmenuSlot(allowed, () => answerQuestionMenuHeld(sessionName, n, roster, expect, allowed));
}
async function answerQuestionMenuHeld(sessionName, n, roster, expect, allowed) {
  const t = paneTarget(allowed.card);
  const look = () => { try { const v = viewport(sessionName, roster); return v && typeof v.text === 'string' ? v.text : null; } catch { return null; } };
  const before = look();
  // Review 32: a screen that could not be read is not "the question went": say which (nothing was sent either way).
  if (!before) return { ok: false, because: 'we could not see its screen to answer its question, so nothing was sent; try again' };
  const menu = status.claudeAnswerableMenu(before);   // #6054: a permission prompt is answered the same way
  if (!menu) return { ok: false, because: 'its question is no longer on its screen, so nothing was sent' };
  const opt = menu.options.find((o) => o.n === Number(n));
  const e = expect || {};
  /* #6054 review 1: a permission prompt's question line and labels repeat from one command to the next ("Do you want to
     proceed?", "1. Yes"), so it is matched on what is above them (questionAbove: the command or the file), read on THIS
     last look, and refused without one. A redraw to another command between the route's read and this one is then a
     refusal, never a Yes to a command the person did not see. */
  /* Review 3: the WHOLE identity, uncut (a tall command's distinguishing head can sit past any prefix), and only for a box
     whose top is on screen (permissionAnswerable). */
  const idOf = (text) => { const q = questionIn(text, 'claude'); const a = q ? questionAbove(q.text) : null; return a ? cleanMessage(a) : null; };
  const idBefore = menu.permission && permissionAnswerable(before) ? idOf(before) : null;
  if (menu.permission && (!e.identity || !idBefore)) {
    return { ok: false, because: 'we could not tell which request its screen is asking about, so nothing was sent; look at this page again in a moment' };
  }
  if (menu.permission && idBefore !== cleanMessage(e.identity)) {
    return { ok: false, because: 'its question changed on its screen, so nothing was sent. What is on this page now is current' };
  }
  /* kosmos#7020: and the request, on this same last look. The identity above is compared after cleanMessage, which folds
     runs of spaces, so `rm -rf "/tmp/old  build"` and `rm -rf "/tmp/old build"` share it; only the card's reading
     (permissionRequestId) tells them apart. A press that named its request is sent only at that request. */
  const reqOf = (text) => { const c = permissionCard(text); return c ? permissionRequestId(c) : null; };
  // Review 2: a press that named a permission request is typed only at a permission prompt, never at another menu.
  if (e.request && !menu.permission) {
    return { ok: false, because: 'its question changed on its screen, so nothing was sent. What is on this page now is current' };
  }
  const reqBefore = menu.permission && e.request ? reqOf(before) : null;
  if (menu.permission && e.request && reqBefore !== e.request) {
    return { ok: false, because: 'its question changed on its screen, so nothing was sent. What is on this page now is current' };
  }
  if (!opt || (e.question && e.question !== menu.question) || (e.label && cleanMessage(e.label) !== cleanMessage(opt.label))) {
    return { ok: false, because: 'its question changed on its screen, so nothing was sent. What is on this page now is current' };
  }
  const got = tmux(['send-keys', '-t', t, String(opt.n)]);
  if (got.spawnFailed || !got.ran || got.status !== 0) return { ok: false, because: 'we could not answer its question; look at its window' };
  await qmenuWait(QMENU_SETTLE_MS);
  const after = look();
  const still = after ? status.claudeAnswerableMenu(after) : null;
  // Review 3: a screen that could not be read after the key is not "answered": the record says unconfirmed.
  /* #6054 review 1: the same prompt still showing, by identity for a permission prompt: the NEXT command's prompt has the
     same question line, and reading that as "not answered" would invite a second press that approves it. A redraw
     that changes the box's text reads as answered too: the safe direction, since "unconfirmed" invites a second press,
     though the record then says placed for a prompt that may still be pending. */
  // kosmos#7020: another request under the same identity is the next prompt, so it reads answered (the direction above).
  const same = still && (menu.permission ? (still.permission && idOf(after) === idBefore && (!reqBefore || reqOf(after) === reqBefore))
    : still.question === menu.question);
  return { ok: true, key: String(opt.n), label: opt.label, answered: !!after && !same, screen: after };
}
/* Close the live question menu with Escape before a message goes (the person answered in their own words). Resolves
   { ok: true, closed } (closed: there was a menu and it went) or { ok: false, because }. No menu: { ok: true, closed: false }. */
async function closeQuestionMenu(sessionName, roster, expect) {
  const allowed = questionMenuKeysAllowed(sessionName, roster);
  if (!allowed.ok) {   // a typed message met a key answer settling: say it in a typed message's words (review 24)
    return { ok: false, because: allowed.because === QMENU_BUSY_SENTENCE
      ? 'its question is being handled right now, so this was not typed; send it again in a moment' : allowed.because };
  }
  return withQmenuSlot(allowed, () => closeQuestionMenuHeld(sessionName, roster, expect, allowed));
}
async function closeQuestionMenuHeld(sessionName, roster, expect, allowed) {
  const t = paneTarget(allowed.card);
  const look = () => { try { const v = viewport(sessionName, roster); return v && typeof v.text === 'string' ? v.text : null; } catch { return null; } };
  const before = look();
  // Review 3: the route saw the menu; a screen it cannot read now is not "no menu" (a paste there takes its default).
  if (!before) return { ok: false, because: 'we could not see its screen to close its question, so this was not sent; try again' };
  const shown = status.claudeQuestionMenu(before);
  if (!shown) return { ok: true, closed: false };
  // Review round 1: only the question the person saw; a menu that redrew into another one is not closed for them.
  if (expect && expect.question && expect.question !== shown.question) {
    return { ok: false, because: 'its question changed on its screen, so this was not sent. What is on this page now is current' };
  }
  const got = tmux(['send-keys', '-t', t, 'Escape']);
  if (got.spawnFailed || !got.ran || got.status !== 0) return { ok: false, because: 'we could not close its question to send this; look at its window' };
  await qmenuWait(QMENU_SETTLE_MS);
  const after = look();
  // Review 3: an unreadable screen is not a closed menu; a paste into a menu that stayed takes its highlighted option.
  if (!after) return { ok: false, because: 'we could not see its screen after closing its question, so this was not sent; try again' };
  if (status.claudeQuestionMenu(after)) return { ok: false, because: 'its question is still on its screen, so this was not sent; answer it there or press a choice' };
  return { ok: true, closed: true };
}

/* #4607: how long a Codex screen settles before a key: a key sent the instant a screen draws is dropped (measured
   twice on 0.149.1, a "2" before the menu drew and a "t" as the table drew). */
const CODEX_HOOK_SETTLE_MS = 1500;
/* #4607 (review round 1): one answer per agent at a time. Two surfaces (the app and a browser tab) answering at once
   would each read the menu before Codex redrew, and the second key would land in its composer. */
const CODEX_HOOK_BUSY = new Set();
/* #4607 (review round 4): what the person was shown, as the thread route sent it (status.codexHookSummary). The
   answer must be about THAT dialog: a different one on screen now (another hook set, or another screen) is refused. */
function sameCodexHooks(a, b) {
  /* Never throws on what a request sends (review round 9): anything odd is simply not a match. */
  const norm = (h) => {
    try {
      return (h && typeof h === 'object')
        ? JSON.stringify({ screen: h.screen || null, count: typeof h.count === 'number' ? h.count : null,
          events: Array.isArray(h.events) ? h.events.map((e) => `${e && e.event}:${e && e.count}`) : [], source: h.source || null, command: h.command || null })
        : null;
    } catch { return null; }
  };
  return norm(a) !== null && norm(a) === norm(b);
}
/**
 * #4607: the PERSON answers Codex's "Hooks need review" from the board: choice 'trust' (every hook it lists),
 * 'skip' (continue without trusting; the hooks do not run) 'close' (the trusted list left open) or 'list' (from one hook's page, back to the full list). The only caller is the owner-only route; no message path
 * reaches it, and #4589's floor (codexScreenRefusal, in deliverWithGap and keysAllowed) is unchanged for every other
 * key. So this checks what keysAllowed checks EXCEPT that floor: this is the one place the dialog may be answered.
 *
 * Keys, measured 2026-09-30 on a live pane (Codex 0.149.1, isolated CODEX_HOME, one `true` Stop and one `true`
 * SubagentStop hook):
 *   menu:  trust "2", skip "3" (each acts at once, no Enter) -> the prompt
 *   table: trust "t" -> the same table with "Press enter to view hooks; esc to close", then Escape -> the prompt;
 *          skip Escape -> the prompt, nothing trusted
 *   hook:  Escape -> the table, then as the table
 * Before EVERY key the screen is read again and must be the screen that key was measured on; after it, the screen
 * settles and is read again. Anything else stops with what it saw: nothing is pressed into a screen we did not expect.
 * `seen` is the summary the page showed (status.codexHookSummary); the first key must match it.
 * Resolves { ok: true, choice, keys, screen } | { ok: false, because, keys, reread? }. Never rejects.
 */
async function answerCodexHooks(sessionName, choice, roster, seen) {
  const keys = [];
  const no = (because) => ({ ok: false, because, keys });
  if (!['trust', 'skip', 'close', 'list'].includes(choice)) return no('choose to trust the hooks, to continue without them, or to close the list');
  const allowed = addressable(sessionName, roster);
  if (!allowed.ok) return no(allowed.because);
  /* Locked on the PANE the name resolved to, not the name as typed (review round 2: a case-folded spelling reaches the
     same pane under another key). */
  const lockKey = paneTarget(allowed.card) || String(allowed.card.sessionName || sessionName);
  if (CODEX_HOOK_BUSY.has(lockKey)) return no('an answer to its hook question is already being sent; wait a moment');
  CODEX_HOOK_BUSY.add(lockKey);
  try { return await answerCodexHooksOnce(sessionName, choice, roster, keys, no, allowed.card, seen); } finally { CODEX_HOOK_BUSY.delete(lockKey); }
}
/* #4607 (review round 5): the ONLY screen steps this answer takes, each one measured on 0.149.1. `[screen, key, next]`:
   `key` is pressed on `screen` and the next read must be `next` ('gone' = no hook screen and not blank). Any other
   step stops, so no key is ever pressed on a screen reached by a step nobody measured (a Trust that landed on a new
   menu pressed "2" there before). 'digit' is the number beside the chosen option on that menu, read then.
   From ONE hook's page the only step is 'list' (back to the full table, then stop): that page names one hook and
   "t" trusts them all, so the person reads the whole list first; Trust there is refused before any key. */
/* ⚠️ Only the FIRST key is checked against what the person was shown (sameCodexHooks); after it, Trust takes at
   most "t" then Escape. A new Trust step added here must re-check what was shown before its key. */
const CODEX_HOOK_STEPS = {
  trust: { menu: ['digit', 'gone'], table: ['t', 'trusted'], trusted: ['Escape', 'gone'] },
  /* From one hook's page: back to the full list, then stop so the person reads it (review round 15: its own choice,
     so it is never logged or worded as a Trust). */
  list: { hook: ['Escape', 'table'] },
  skip: { menu: ['digit', 'gone'], table: ['Escape', 'gone'], hook: ['Escape', 'table'] },
  close: { trusted: ['Escape', 'gone'] },
};
async function answerCodexHooksOnce(sessionName, choice, roster, keys, no, card, seen) {
  if (card.runner !== 'codex') return no('that is not a Codex agent');
  if (card.reachedByChannel === true) return no('Kosmos cannot answer this on Windows yet, and a Windows agent has no window to answer it in');
  const t = paneTarget(card);
  const wait = (ms) => (pauser ? Promise.resolve(pauser(ms)) : (runner ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))));
  const look = () => {
    /* The pane is asked again on every read (review rounds 5 and 7: a fresh tmux probe, the one the message path uses
       just before typing): a pane that stopped being this agent's, or went into copy mode, takes no more keys. */
    if (!verifyAtSend(card).ok) return { unseen: true };
    const view = viewport(sessionName, roster);
    const text = view && typeof view.text === 'string' ? view.text : null;
    if (text === null) return { unseen: true };
    const q = status.codexHookReview(text);
    if (q) return { screen: q.screen, text };
    if (status.codexHookTrustedTable(text)) return { screen: 'trusted', text };
    return { screen: String(text).trim() ? 'gone' : 'blank', text };
  };
  const press = (key) => {
    const got = tmux(['send-keys', '-t', t, key]);
    keys.push(key);
    return !(got.spawnFailed || !got.ran || got.status !== 0);
  };
  /* After a key that trusts, any later failure says so (review round 14): "nothing more was pressed" alone would read
     as though Trust did nothing, and trusting is the one choice that is hard to take back. */
  let trustPressed = false;
  let readFirst = null;
  const noAfter = (m) => Object.assign(no(trustPressed ? `${m}. Trust may already have taken effect` : m), { screen: readFirst });
  const steps = CODEX_HOOK_STEPS[choice];
  let now = look();
  readFirst = now.screen || null;
  if (now.unseen) return no('we could not see its screen just now, so nothing was pressed');
  if (now.screen === 'gone' || now.screen === 'blank') return no('the hook question is not on its screen now, so nothing was pressed');
  if (now.screen === 'trusted' && choice !== 'close') return no('its hooks are already trusted and their list is still open; close the list');
  if (now.screen !== 'trusted' && choice === 'close') return no('there is no open hook list to close on its screen now, so nothing was pressed');
  if (now.screen === 'hook' && choice === 'trust') return no('this page names one hook; show the full list first, then choose');
  if (choice === 'list' && now.screen !== 'hook') return no('showing the full list is only for one hook\u2019s page, so nothing was pressed');
  let first = true;
  for (let n = 0; n < 4; n += 1) {
    const step = steps[now.screen];
    if (!step) return no('its screen went somewhere we have not measured, so nothing more was pressed; look at This agent\u2019s Terminal under AI Settings on this page');
    /* Read again immediately before the key: it must still be this screen, and on the FIRST key it must be the dialog
       the person was shown (review round 4, checked on this same read, round 5). */
    const before = look();
    if (before.unseen || before.screen !== now.screen) return no('its screen changed before we could answer, so nothing more was pressed; look at This agent\u2019s Terminal under AI Settings on this page');
    if (first && !sameCodexHooks(seen, status.codexHookSummary(before.text))) return no('its hook question changed since you read it, so nothing was pressed; read it again and choose');
    /* The table and one hook's page must have their exact measured shape before any key (review round 10: a bare
       table footer printed by an agent read as the table, and Trust pressed "t" there). */
    if ((now.screen === 'table' || now.screen === 'hook') && !status.codexHookScreenExact(before.text, now.screen)) {
      return no('the hook question on its screen is not the one we know, so nothing was pressed; look at This agent\u2019s Terminal under AI Settings on this page');
    }
    let key = step[0];
    if (key === 'digit') {
      const mk = status.codexHookMenuKeys(before.text);
      key = choice === 'trust' ? mk.trust : mk.skip;
      if (!key) return no('the hook question on its screen does not show that choice the way we know it, so nothing was pressed; look at This agent\u2019s Terminal under AI Settings on this page');
    }
    if (!press(key)) return noAfter('we could not press the key; look at This agent\u2019s Terminal under AI Settings on this page');
    if (choice === 'trust' && (key === 't' || now.screen === 'menu')) trustPressed = true;
    first = false;
    await wait(CODEX_HOOK_SETTLE_MS);
    const after = look();
    if (after.unseen) return noAfter('we answered, and then could not see its screen to check it; look at This agent\u2019s Terminal under AI Settings on this page');
    if (after.screen === 'blank') return noAfter('we answered, and its screen was blank when we checked; look at This agent\u2019s Terminal under AI Settings on this page');
    if (after.screen !== step[1]) {
      if (after.screen === now.screen) {
        /* A slow redraw is not proof the key failed (review round 11): after a Trust key it may still have landed. */
        if (trustPressed && now.screen === 'trusted') return noAfter('its hooks are trusted and their list is still open; close the list');
        if (trustPressed) return Object.assign(no('we pressed Trust and its screen has not changed yet, so it may still take effect; check again in a moment'), { screen: readFirst });
        return noAfter('its screen did not change after we answered; look at This agent\u2019s Terminal under AI Settings on this page');
      }
      return noAfter('its screen went somewhere we have not measured, so nothing more was pressed; look at This agent\u2019s Terminal under AI Settings on this page');
    }
    if (after.screen === 'gone') return { ok: true, choice, keys, screen: readFirst };
    /* Trust from one hook's page: the full list is up now; the person chooses again with every hook in view. */
    if (choice === 'list') return { ok: false, keys, because: 'the full list of hooks is showing now; read it and choose again', reread: true, screen: readFirst };
    now = after;
  }
  return noAfter('its screen is still asking after four keys, so we stopped; look at This agent\u2019s Terminal under AI Settings on this page');
}

/* #3564: what a paused swarm still accepts. */
const PAUSED_SWARM_COMMANDS = /^\/(compact|clear|cost|context|status)([ \t][^\r\n]*)?$/i;
/* kosmos#6244: in a policy's quiet hours only the bare commands go. /compact takes words as a summarising instruction,
   so with words it is a message by another name. */
const QUIET_LOOK_AFTER = /^\/(compact|clear|cost|context|status)$/i;

/**
 * #4589: may anything be typed into this Codex agent's pane right now? Returns the sentence saying why not, or null.
 * Shared by deliverWithGap (every message) and keysAllowed (Stop now's keys), so a message and a key obey one rule.
 * Codex stops at startup on its "Hooks need review" dialog, where a typed "2" or "t" trusts every hook (outside the
 * sandbox). So, for a Codex agent with a tmux pane, a FRESH read decides:
 *   - either dialog screen on it -> refused (the person answers it on the agent page, #4607);
 *   - a read that succeeds with a BLANK screen -> refused as still starting (round 1: the dialog is about to draw,
 *     and text pasted then lands on it as raw keys);
 *   - a read that FAILS -> refused as unseen (round 2: the snapshot is from before startup, so it cannot vouch that
 *     no dialog is up).
 * A channel-reached (Windows) agent has no tmux pane and is not read. Residuals, stated: the dialog can still draw
 * in the gap between this read and the paste (one read, then a paste of a few chunks); a Codex launched through
 * `node` reads as Claude until its runner tag lands (status.js takes the command only for a native `codex`).
 */
function codexScreenRefusal(card, sessionName, roster) {
  /* When nothing will really be typed (dry-run with no injected runner, exactly tmux()'s own rule), the dry-run answer
     is the true one (round 3: demo boards read "we could not see its screen" for every Codex agent). An injected
     runner outranks dry-run in tmux(), so the rule still applies there (round 4). */
  if ((DRY_RUN && !runner) || !card || card.runner !== 'codex' || card.reachedByChannel === true) return null;
  const view = viewport(sessionName, roster);
  if (!view || typeof view.text !== 'string') return status.CODEX_UNSEEN_SENTENCE;
  if (!view.text.trim()) return status.CODEX_STARTING_SENTENCE;
  /* #4607: the trusted-but-open list too (a typed key there is unmeasured; Close answers it from the board). */
  if (status.codexHookReview(view.text) !== null) return status.CODEX_HOOK_DIALOG_SENTENCE;
  return status.codexHookTrustedTable(view.text) ? status.CODEX_HOOK_LIST_SENTENCE : null;
}

/* #5743: a Claude agent showing its question menu (any form, status.claudeQuestionMenuUp) is not typed at: the menu
   ignores a paste and the Enter after it takes the HIGHLIGHTED answer (measured on 2.1.29x, #5406), so the agent gets a
   default nobody chose and nothing says so. Read fresh, when the snapshot says needs_you or working (see
   claudeMenuRefusal); an idle card pays no capture. Decided: a read that fails is not a refusal, except for a card
   whose own report says it is asking permission (see claudeMenuRefusal).
   needs_you also covers permission prompts and every other question, and the direct-message route reaches here right
   after closing the menu, so failing closed would refuse ordinary replies whenever one capture fails; the trust-dialog
   floor above still covers the dialog that ends a session. */
const CLAUDE_MENU_SENTENCE = 'it is showing a question on its screen, and a message typed now would pick an answer nobody chose, '
  + 'so we did not type anything; answer the question in its window first';
/* Said only when the screen is the form the direct-message route answers by number (status.claudeQuestionMenu). */
const CLAUDE_MENU_DM_CLAUSE = ', or by its number in its direct messages';
/* #5743 review 10: the safeguards model-switch menu (#5051). Kosmos never presses it, and a typed line's Enter would. */
const CLAUDE_SAFEGUARDS_SENTENCE = 'it is asking on its screen whether to switch models, and a message typed now would '
  + 'pick the highlighted option, so we did not type anything; answer it in its window first';
/* A highlighted numbered option over an "Esc to cancel" footer, in no wording we know: a permission request worded
   otherwise, or a picker someone opened. Its Enter would take the highlighted option either way. */
const CLAUDE_WAITING_SENTENCE = 'it is waiting for an answer on its screen, and a message typed now would pick the '
  + 'highlighted option, so we did not type anything; answer it in its window first';
/* #5754: Claude's permission prompt. Measured on 2.1.296: the paste is ignored and the Enter approves the highlighted
   option (usually Yes), so a typed line would approve a command or an edit nobody chose. */
const CLAUDE_PERMISSION_SENTENCE = 'it is asking for permission on its screen, and a message typed now would answer that '
  + '(usually Yes), so we did not type anything; answer it in its window first';
/* #6054: the ending for a screen the agent page answers with buttons (status.claudeAnswerableMenu reads it), in place of
   "in its window", which a person using Kosmos cannot reach. Only when the buttons are really drawn: another form of the
   menu, or a permission prompt whose options do not read cleanly, keeps the window ending. */
const ON_ITS_PAGE = 'answer it with the buttons under its question on its page in Kosmos';
const onItsPage = (sentence) => sentence.replace(/answer (?:the question|it) in its window first$/, ON_ITS_PAGE);
/* #6054 review 2: the page reads the screen and draws buttons only for a needs_you card, and never in the setup guide's
   thread (everything there is masked). A working card or the guide keeps the window ending. */
/* #6054 review 4: and every label is one a press can carry (the GET's `pressable` refuses a menu with one that is not). */
const labelsPressable = (menu) => Boolean(menu) && menu.options.every((o) => typeof o.label === 'string' && !messageProblem(o.label));
function pageDrawsButtons(card, sessionName) {
  if (!card || card.state !== status.STATE.NEEDS_YOU) return false;
  if (card.disruption && card.disruption.failed === true) return false;   // review 3: the page's `asking` excludes it
  try { return !require('./setup-assistant').isGuideFolder(sessionName); } catch { return false; }
}
function claudeMenuRefusal(card, sessionName, roster) {
  if ((DRY_RUN && !runner) || !card || String(card.runner || 'claude') !== 'claude' || card.reachedByChannel === true) return null;
  /* needs_you, and working too (review 11): an agent usually reaches a permission prompt mid-turn, while its card still
     reads working. An idle agent cannot be showing one, so it pays no read. */
  if (card.state !== status.STATE.NEEDS_YOU && card.state !== status.STATE.WORKING) return null;
  const view = viewport(sessionName, roster);
  if (!(view && typeof view.text === 'string')) {
    /* A read that fails is not a refusal (decided), EXCEPT when the card itself says it is asking permission (its
       PermissionRequest self-report): typing there is the measured #5754 harm, and the report is the evidence. */
    const said = String(card.because || '') + ' ' + String(card.stateEvidence || '');
    return card.state === status.STATE.NEEDS_YOU && /\basking permission to use\b/i.test(said) ? CLAUDE_PERMISSION_SENTENCE : null;
  }
  if (status.claudeSafeguardsMenuUp(view.text)) return CLAUDE_SAFEGUARDS_SENTENCE;   // its own reading (#5051), never pressed
  if (status.claudeQuestionMenuUp(view.text)) {   // first: its free-answer row is the stricter signal
    /* The direct-message route answers by number only when the card reads needs_you (it reads the screen only then). */
    // #6054: the page draws buttons for the single-select form (status.claudeQuestionMenu) only.
    const qm = status.claudeQuestionMenu(view.text);
    const single = Boolean(qm);
    return (single && labelsPressable(qm) && pageDrawsButtons(card, sessionName) ? onItsPage(CLAUDE_MENU_SENTENCE) : CLAUDE_MENU_SENTENCE)
      + (card.state === status.STATE.NEEDS_YOU && single ? CLAUDE_MENU_DM_CLAUSE : '');
  }
  const kind = status.claudePermissionPromptKind(view.text);   // #5754
  if (kind === 'wording') return permissionAnswerable(view.text) && labelsPressable(status.claudePermissionPrompt(view.text)) && pageDrawsButtons(card, sessionName) ? onItsPage(CLAUDE_PERMISSION_SENTENCE) : CLAUDE_PERMISSION_SENTENCE;   // #6054
  return kind === 'shape' ? CLAUDE_WAITING_SENTENCE : null;   // other wording, or one of Claude Code's own pickers
}

/* kosmos#6436: the gates a line passes before anything is typed into an agent's pane, in their order: who it is, a
   question being answered, the trust dialog, a paused swarm, quiet hours and the usage cap, the Codex hooks dialog, and
   Claude Code's own menus and prompts (a fresh read). Answers a verdict (nothing typed) or { ok: true, allowed }; a
   verdict never carries `ok`. deliverWithGap and pressRememberedNow both pass here, so they cannot drift apart. */
function typingGate(sessionName, raw, roster, envelope, trailer, at) {
  const allowed = addressable(sessionName, roster);
  if (!allowed.ok) {
    return { state: DELIVERY.COULD_NOT, because: allowed.because, at, paneState: null, paneNote: null };
  }
  /* #5406 slice C review 19: a key answer to its question is settling (QMENU_BUSY); a line pasted now would land on
     whatever the screen shows mid-redraw. Nothing typed; busy, like a pane another message is being placed in. */
  if (allowed.card && QMENU_BUSY.has(paneTarget(allowed.card))) {
    return { state: DELIVERY.COULD_NOT, because: 'its question is being handled right now, so this was not typed; send it again in a moment',
      at, paneState: null, paneNote: null, busy: true };
  }
  /**
   * #1629 point 3: NEVER TYPE AT AN AGENT STOPPED ON CLAUDE CODE'S TRUST
   * DIALOG. Every caller comes through here (both thread routes, the task
   * line, the slash-command route, the auto-handoff sweep), and every one
   * ends with an Enter -- which on that dialog picks the default, "No, exit",
   * and ends the session. The card is the roster snapshot this request
   * already holds, so this costs no capture. `stateEvidence` is set by
   * several states (a rate limit's line, a dead token's line, a working
   * line); what makes this read unambiguous is the pair: the state is
   * `needs_you` AND the evidence opens with the trust dialog's own question,
   * which only that detector writes. A route that wants a fresher read makes
   * its own capture (server.js `trustDialogHold`); this is the floor under
   * all of them. `paneState: null`, like every other pre-send refusal here:
   * nothing was verified at the pane, the snapshot was read.
   */
  if (allowed.card && allowed.card.state === status.STATE.NEEDS_YOU
      && status.isTrustDialogEvidence(allowed.card.stateEvidence)) {
    return {
      state: DELIVERY.COULD_NOT,
      because: status.TRUST_DIALOG_SENTENCE,
      at, paneState: null, paneNote: null,
    };
  }
  /* #3564: a PAUSED swarm is not typed at. Every caller comes through here (DMs, rooms,
     tasks, the sweeps), so this is the one place that makes "paused" true. Only the
     commands that look after an agent without setting it to work go in
     (PAUSED_SWARM_COMMANDS); a skill such as /pplan is work. The card's `swarm` field is
     the snapshot this request already holds. */
  if (allowed.card && allowed.card.swarm && allowed.card.swarm.active === false
      && !PAUSED_SWARM_COMMANDS.test(String(raw).trim())) {
    return {
      state: DELIVERY.COULD_NOT,
      // Lazy: swarm requires projects, which requires this module at its top.
      because: require('./swarm').pausedSentence(allowed.card.name || sessionName, allowed.card.swarm.pausedBecause),
      at, paneState: null, paneNote: null,
    };
  }
  /* kosmos#6239: in the policy's quiet hours (orgpolicy.quietAllows) nothing new is typed at any agent: not a person's
     message, another agent's, a room's or the board's own nudges, since every one comes through here. The commands that
     look after an agent without setting it to work still go, bare and with nothing riding on them: no envelope and no
     trailer, since those are typed around the command and carry words of their own (QUIET_LOOK_AFTER, kosmos#6244; the
     Compact and Clear buttons send exactly that). `quiet: true` lets a caller that
     knows a person asked report it (server.js's thread route). A policy read that throws is not quiet: an agent that
     cannot be reached because of a fault is worse than one reached at night. */
  const bareLookAfter = QUIET_LOOK_AFTER.test(String(raw).trim())
    && !(typeof envelope === 'string' && envelope.trim()) && !(typeof trailer === 'string' && trailer.trim());
  if (!bareLookAfter) {
    let q = { ok: true };
    try { q = require('./orgpolicy').quietAllows(); } catch { q = { ok: true }; }
    if (q.ok !== true) {
      return { state: DELIVERY.COULD_NOT, because: `nothing new is sent to agents now: ${q.because}`, at, paneState: null, paneNote: null, quiet: true };
    }
    /* kosmos#6309: at the policy's monthly usage cap (usagecap.capAllows, this month's tokens on every agent), the same:
       nothing new is typed, the bare look-after commands still go, and a fault reads as open. `capped: true`, not
       `quiet`: it is not reported as a quiet-hours refusal, and the coordinator has no rule word for it yet. */
    let c = { ok: true };
    try { c = require('./usagecap').capAllows(); } catch { c = { ok: true }; }
    if (c.ok !== true) {
      return { state: DELIVERY.COULD_NOT, because: `nothing new is sent to agents now: ${c.because}`, at, paneState: null, paneNote: null, capped: true };
    }
  }
  /* #4589 (after the paused-swarm check, round 3: that check is free and its sentence is the true one): NEVER TYPE INTO CODEX'S "HOOKS NEED REVIEW" DIALOG. Codex stops at startup on it when a hook
     it has not been told to trust is enabled, and a message typed there vanishes: Enter opens the review
     table and the text is gone (reproduced 2026-09-29, Codex 0.149.1). Every sender comes through here.
     A FRESH read for a Codex agent, because the dialog draws at startup, exactly when the first message
     arrives, and the roster snapshot predates it. A read that fails, or shows a blank screen, refuses too
     (codexScreenRefusal). Nothing is typed while the dialog is up, not even an option number: this function cannot tell the person from
     another agent, a task line or a room post, and trusting hooks lets them run outside the sandbox, so
     the choice is made in the agent's terminal. A channel-reached (Windows) agent has no tmux pane. */
  {
    const codex = codexScreenRefusal(allowed.card, sessionName, roster);
    if (codex) return { state: DELIVERY.COULD_NOT, because: codex, at, paneState: null, paneNote: null };
  }
  /* #5743/#5754: the floor under every sender (question menu, permission prompt, safeguards menu), read fresh here, right before typing. The direct-message route closes or
     answers the single-select form first (#5406); the forms it does not handle (multi-select, multi-question) reach
     here with the menu up and are refused. Automatic senders are held before this (menuHeldVerdict); this second read
     is deliberate, a last look right before the keystrokes. */
  {
    let menu = null;
    try { menu = claudeMenuRefusal(allowed.card, sessionName, roster); } catch { menu = null; }   // deliver never throws
    if (menu) return { state: DELIVERY.COULD_NOT, because: menu, at, paneState: null, paneNote: null };
  }
  return { ok: true, allowed };
}

/**
 * Put one message into one agent's session.
 *
 * ⚠️ NEVER THROWS, and never claims more than a keystroke. The return is a
 * verdict a screen can render as-is. See `DELIVERY` for the three states and
 * for the one fact that separates them: whether anything of the person's text
 * could have reached the pane. None of them says the agent knows anything.
 */
function deliverWithGap(sessionName, raw, roster, envelope, trailer, asynchronousGap) {
  const at = new Date().toISOString();
  const problem = messageProblem(raw);
  if (problem) return { state: DELIVERY.COULD_NOT, because: problem, at, paneState: null, paneNote: null };

  /* kosmos#6436: every gate before the first keystroke, shared with the retry that presses a line left unsent. */
  const gate = typingGate(sessionName, raw, roster, envelope, trailer, at);
  if (!gate.ok) return gate;
  const allowed = gate.allowed;

  /**
   * ⚠️ THE ENVELOPE IS PREPENDED AFTER THE LENGTH CHECK, NEVER BEFORE IT, and
   * that ordering is the whole reason it is a parameter rather than something
   * the caller concatenates.
   *
   * `messageProblem` above measured `raw`. A caller that glued its own prefix
   * on first would have spent the person's `MAX_TEXT` budget on Kosmos's own
   * words: a message at exactly the limit would be refused with *"keep it to
   * 10000 characters or fewer"* -- naming a limit the text they typed does not
   * exceed, which is unfalsifiable from where they are standing. The wire may
   * exceed MAX_TEXT; the person's message may not.
   *
   * 📌 The room path reaches the same place from the other side: it validates
   * its body against MAX_BODY and spills a post whose whole line would pass
   * this limit (messages.spillsAt, #6065), so what it concatenates is
   * bounded. Both are "check the part the person
   * wrote"; only this one had no bound of its own.
   */
  const text = cleanMessage(raw);
  /* `trailer` (#358) is the attached file's path and its facts (#5448: type,
     an image's pixel size, size; attachments.wireNote holds the uploader's
     type to plain media-type characters so it cannot trip the refusal below),
     appended AFTER the checks:
     the cap is measured against the person's words alone (the envelope
     comment above), and `cleanMessage` must not collapse the spaces in a
     file name into a path that does not exist. A trailer with a newline or a
     control character is refused here rather than typed. */
  let tail = '';
  if (typeof trailer === 'string' && trailer) {
    if (/[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(trailer)) {
      return { state: DELIVERY.COULD_NOT, because: 'the attached file\'s name has characters we will not type into a terminal', at, paneState: null, paneNote: null };
    }
    tail = trailer;
  }
  // ⚠️ FLATTEN THE ENVELOPE'S WHITESPACE, not just trim it (#3419). The paste
  // transport's safety rests on `wire` carrying no newline: `paste-buffer` (issued
  // without `-r`) turns an LF into a CR, which a pane that fell back to a shell
  // would take as a submit AT PASTE TIME — before the pre-Enter `verifyAtSend`
  // can refuse. `text` is already newline-free (`cleanMessage` collapses all
  // whitespace) and `tail` refuses control chars above, but the caller-supplied
  // `envelope` was only trimmed, so an interior newline in it would survive into
  // `wire`. Every caller passes a system-generated single-line envelope today, so
  // this is defense-in-depth, not a live bug — but the invariant the transport
  // now depends on should be enforced here, not assumed of every caller.
  const envelopeLine = (typeof envelope === 'string' && envelope.trim())
    ? envelope.replace(/\s+/g, ' ').trim()
    : '';
  const wire = (envelopeLine ? envelopeLine + ' ' + text : text) + tail;
  const target = paneTarget(allowed.card);
  // Read BEFORE the send, from the card the send was authorised against, so the
  // note describes the pane we typed into rather than whatever it became while
  // we were typing.
  /* #5949: a state the card shows from a REMEMBERED look (held through a failed check) is not what the agent was doing
     when this was sent, so the note says we could not tell, as a failed look always did. */
  const paneState = ('stateRead' in allowed.card && allowed.card.stateRead === 'remembered') ? null : (allowed.card.state || null);
  // ⚠️ The note depends on the VERDICT as well as the state (see waitingNote),
  // and the verdict is not known until the sends have answered — so it is built
  // at each return rather than once up front.
  const paneBackgroundWait = allowed.card.stateBackgroundWait === true;
  const noteFor = (outcome) => waitingNote(paneState, outcome, allowed.card.runner, paneBackgroundWait, allowed.card.sessionName);

  /**
   * 🔑 A WINDOWS AGENT IS REACHED THROUGH ITS SUPERVISOR, NOT A PANE (#570 7c-4).
   *
   * Every gate above is shared and has already run: the message, ownership,
   * the trust-dialog floor, the trailer. What differs is only how the words get
   * there, and the CARD says which way, not the platform: `status.js` sets
   * `reachedByChannel` from the mark win32roster stamps on every Windows row
   * (`WIN32_COMMAND`, a value tmux never reports on a Mac). One derivation of
   * "this is a Windows agent", made where the card is built.
   *
   * ⚠️ `verifyAtSend` IS SKIPPED ON PURPOSE, and the property it protects is
   * kept. It exists because a tmux pane can fall back to a SHELL, turning the
   * message into a command, or be scrolled into copy-mode, where keystrokes
   * vanish. A Windows agent's input is a JSON line into `claude -p`'s stdin,
   * which can be neither. The re-check that remains, "is the agent still
   * there", is made by the supervisor at the moment of the write, inside the
   * process that holds the stdin, which is closer than any probe from here.
   */
  if (allowed.card.reachedByChannel === true) {
    return deliverThroughChannel(allowed.card, wire, { at, paneState, noteFor });
  }

  /**
   * ⚠️ THE PANE IS ASKED AGAIN, HERE, IMMEDIATELY BEFORE THE KEYSTROKE.
   *
   * `addressable` above checked a roster SNAPSHOT, and that snapshot is already
   * hundreds of milliseconds old by the time we get here: it was taken at the
   * top of the request, and a `snapshot()` fans out one `capture-pane` per agent
   * on the machine before the route even reaches this function. Everything it
   * authorised can stop being true inside that window, and the two ways it can
   * are the two worst outcomes this module has:
   *
   *   - Claude EXITS. The pane falls back to a shell, and the person's message
   *     is then a COMMAND, executed. "have a look at the lease" is harmless;
   *     the message somebody sends about deleting an old build is not.
   *   - The person scrolls the pane into copy-mode. The keystrokes go to
   *     copy-mode bindings, tmux answers success, and we report `placed` for a
   *     message that reached nothing.
   *
   * A check whose window a real user action can walk through is not a check, so
   * this closes it to one tmux round-trip. It is not zero — nothing outside the
   * pane can make it zero — but it is the difference between a gate that can be
   * beaten by scrolling and one that cannot realistically be.
   *
   * ⚠️ AND THE VERDICT IS THE ENGINE'S OWN. The fresh values are put back into a
   * pane shaped the way `status` builds them and handed to `isAgentPane`, so
   * this cannot drift from the rule that authorised the send in the first place.
   * A second copy of "is this pane typeable" is exactly the two-derivations
   * habit this codebase keeps paying for.
   */
  const still = verifyAtSend(allowed.card);
  if (!still.ok) {
    return { state: DELIVERY.COULD_NOT, because: still.because, at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT) };
  }
  /* #6249: never paste behind text already in a Claude Code agent's input box: an earlier line left unsent, or the
     person's own typing. Pasted behind it, one Enter would send both as one message (case 1 on the card: a reminder
     left there at 09:14 and a ruling pasted after it at 09:49). Nothing is typed, so this is COULD_NOT; `inputHeld`
     says why. A box that cannot be read (a menu, a dialog) is left to the gates above, as before. */
  let earlierSubmitted = false;
  let emptyBefore = false;   // kosmos#6717: the box was read, and empty, just before our paste
  if (composerReadable(allowed.card)) {
    let box = readComposer(target);
    if (box.ok && box.text) {
      /* Round 1, reworked in round 7: the text is the line the board itself left there unsent (remembered, and still
         all of it ours): press Enter on it once, watch the box empty (as after any Enter), and then type this line as
         usual, so the two go in order and never as one. If it does not empty, the text is still there and this line is
         refused with the sentence that says so. Anything else in the box is never submitted. */
      const kept = recallUnsent(target);
      const earlier = kept ? kept.wire : null;
      /* kosmos#6436: the earlier line passes the gates as a line of its own: a bare command let through in quiet hours or
         on a paused swarm must not carry a work line in ahead of it. */
      const shows = !!earlier && rememberedShows(box.text, kept, false, box.rows);   // the cheap look first
      let earlierGated = false;
      if (shows) { try { earlierGated = typingGate(sessionName, earlier, roster, '', '', at).ok === true; } catch { earlierGated = false; } }
      if (shows && earlierGated && verifyAtSend(allowed.card).ok) {
        forgetUnsent(target);
        const pressed = tmux(['send-keys', '-t', target, 'Enter']);
        if (pressed.ran && pressed.status === 0) {
          /* Round 8: a short watch (measured: the box empties 25 to 93 ms after an Enter), so even the async path is
             held at most EARLIER_SETTLE_MS here; a box slower than that is refused below, truthfully. */
          const steps = submitConfirmSteps(allowed.card, target, earlier, false, EARLIER_SETTLE_MS, kept.chip || null);
          let step = steps.next();
          while (!step.done) { submitGap(step.value.wait); step = steps.next(); }
          if (step.value && step.value.outcome === 'sent') { earlierSubmitted = true; if (kept.seq != null) tellEarlierSubmitted(kept.seq); }
          box = readComposer(target);   // round 10: always read it again: a person may have started typing meanwhile
        }
        /* #6256 item 4: a box slower than the short watch (or an Enter tmux refused) still holds exactly our earlier
           line: remember it again, with its own time and number, so the next delivery can still press it. This one is
           refused below, as before. It keeps its id and number, so its own retries (kosmos#6436) still know it.
           Known gap (review 3): if the Enter did take and the box only emptied later, no follow-up row is written; an
           empty box later cannot say whether it was sent or cleared by hand. */
        if (!earlierSubmitted && box.ok && rememberedShows(box.text, kept, false, box.rows)) {
          /* Still there: a full record's day runs from now; a light record keeps its time and its one retry. */
          rememberUnsent(target, kept.light ? kept : { ...kept, at: Date.now() });
          scheduleUnsentRetries(target, allowed.card, kept.light ? UNSENT_RETRY_MS.slice(0, 1) : UNSENT_RETRY_MS);
        }
      }
      /* busy (round 2): a sweep that counts its tries waits for the box rather than spend them on it. */
      if (box.ok && box.text) {
        return { state: DELIVERY.COULD_NOT, because: NOT_OURS_BECAUSE, inputHeld: true, busy: true, at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT) };
      }
    }
    emptyBefore = box.ok && !box.text;
  }
  /* kosmos#6717: what may count as our own paste chip: only when the box was read empty just before our paste and our
     line is long enough to fold, and only a chip seen BEFORE our Enter (our fold happens while we paste; the Enter then
     submits what is there). That chip is pinned (ourChip) for the watch after the Enter and its retry. A chip seen for
     the first time after our Enter is never ours: nothing ties it to our paste. */
  const chipTie = emptyBefore && String(wire).length >= CHIP_MIN_CHARS ? true : null;
  let ourChip = null;

  // ⚠️ TWO STEPS, in this order, never one: put the text in, THEN a SEPARATE
  // Enter submits it. Folding them would submit each chunk, and an Enter sent
  // before the pasted bytes have flushed races the paste (see the paste-transport
  // note and the size-adaptive delay below).
  // ⚠️ THE TEXT IS PASTED, not typed with `send-keys -l`. A raw keystroke stream
  // is silently shredded into a busy pane (kosmos#3419); `pasteWire` delivers it
  // atomically in UTF-8-safe chunks. The raw `wire` is pasted unescaped: a paste
  // delivers a trailing `;` literally, so no escaping is needed.
  const typed = pasteWire(target, wire);
  // ⚠️ A MULTI-CHUNK PASTE THAT FAILED PART-WAY is UNCONFIRMED, not COULD_NOT,
  // and this branch must come first because the failure below it would otherwise
  // call it "safe to re-send". `pasteWire` sets `pastedAny` when at least one
  // chunk already landed in the composer before the failure; a re-send then
  // pastes the whole body again behind that fragment and the Enter submits both.
  // The honest verdict is the third state: some of it may be sitting there
  // half-typed. (A first-chunk failure leaves pastedAny false and falls through
  // to the could_not/unconfirmed branches below, which are correct — nothing
  // landed.) The engine states the fact; the page says where to look.
  if ((!typed.ran || typed.status !== 0) && typed.pastedAny) {
    return {
      state: DELIVERY.UNCONFIRMED,
      because: 'part of it reached its window before the send failed, so it may be sitting there half-typed',
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  if (typed.ran && typed.status !== 0) {
    // tmux ran and refused: it did not type anything. Re-sending is safe.
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(typed, 'we could not type it into its window'),
      at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
    };
  }
  if (!typed.ran && typed.spawnFailed) {
    // tmux never started, so no keystroke exists. Also safe to re-send.
    return {
      state: DELIVERY.COULD_NOT,
      because: refusalReason(typed, 'we could not get to its window, so we did not type anything'),
      at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
    };
  }
  if (!typed.ran) {
    /**
     * ⚠️ THE AMBIGUOUS ONE, AND THE REASON THIS STATE EXISTS. tmux was started
     * and did not answer inside the timeout — which it can do having already
     * delivered the keystroke. Rendering that as a failure is what makes
     * somebody re-send, and this send may have landed.
     */
    return {
      state: DELIVERY.UNCONFIRMED,
      // ⚠️ THE FACT ONLY. What to DO about it belongs to the screen, which
      // knows where its own viewport is; a module that also gave instructions
      // produced a three-clause wall on screen, each clause telling the person
      // to look somewhere different.
      because: 'we typed it in and its window did not answer us in time, so we cannot tell whether it arrived',
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  /* Pause before the submit Enter so the pasted bytes have flushed through the
     tmux/PTY pipeline; otherwise the Enter races the still-arriving paste and
     submits a partial line, the rest landing unsent (paste-transport note,
     point 2). Size-adaptive,
     and never below the codex floor on a codex pane — codex also swallows an
     Enter that rides the paste burst (#571), and its measured 500ms gap is the
     minimum. Every pane now pays at least the base delay; HTTP delivery waits
     without holding the event loop, and the gap is what makes the paste submit. */
  const gapMs = Math.max(
    pasteToEnterMs(Buffer.byteLength(wire, 'utf8')),
    /* #3296/#3391: gemini and grok get the same enter-gap floor as codex. Each is a
       non-claude terminal TUI (not the claude composer), so it can swallow an Enter that
       rides a large paste burst (#571); the floor is cheap insurance (invisible at
       agent-comms cadence) for the core task-delivery mechanism, taken as a precaution
       rather than measured per-runner. Grok drives a full-screen TUI with its own
       composer, so the paste-swallow risk is the same class; the floor is the safe
       default and a 0 here would be the unmeasured gamble. #3568: antigravity takes the same
       floor for the same reason, unmeasured like grok's. */
    (allowed.card.runner === 'codex' || allowed.card.runner === 'gemini' || allowed.card.runner === 'grok' || allowed.card.runner === 'antigravity') ? CODEX_ENTER_GAP_MS : 0,
  );
  const finishSubmit = () => {
  /**
   * ⚠️ RE-VERIFY THE PANE IS STILL AN AGENT'S WINDOW IMMEDIATELY BEFORE THE
   * SUBMIT ENTER. The old send-keys path put the whole message in one call, so
   * verifyAtSend above sat one round-trip from the keystroke. The paste path is
   * wider: N chunks × (set-buffer + paste-buffer) plus the size-adaptive gap now
   * paid on EVERY send (up to 2s), and during that window the pane can stop being
   * an agent's — Claude exits and the pane falls back to a SHELL. The body is
   * already pasted into that pane by now; an unconditional Enter would submit it,
   * and in a shell that EXECUTES it as a command. This is the exact hazard
   * verifyAtSend exists to prevent, and the widened window is where it now lives,
   * so the check is re-run here, closing the gap back to one round-trip before
   * the Enter.
   *
   * ⚠️ THE VERDICT IS UNCONFIRMED, NOT COULD_NOT. The paste HAS landed, so the
   * text may be sitting in the composer (or a shell prompt) unsent — reporting
   * could_not would invite a re-send that pastes the whole body again. We refuse
   * to press Enter (never executing a command in a fallen shell) and report the
   * honest third state.
   */
  const stillAnAgent = verifyAtSend(allowed.card);
  if (!stillAnAgent.ok) {
    return {
      state: DELIVERY.UNCONFIRMED,
      because: 'its window changed before we could submit, so what we typed may be sitting there unsent',
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  /* #6249 round 2: the box was empty before the paste, but the gap is up to 2 s: if anything besides ours is in it
     now (the person started typing), the Enter would send it with ours. Never pressed then. */
  if (composerReadable(allowed.card)) {
    const before = readComposer(target);
    /* kosmos#6717: a one-line chip here is our own paste, folded: the box was read empty before it, under this pane's
       delivery lock, within the gap (chip: true). A person's paste in that same second is the one case it cannot
       tell from ours; a multi-line chip never is ours (our line is one line). */
    if (before.ok && chipTie && ONE_LINE_CHIP.test(squash(before.text))) ourChip = squash(before.text);
    if (before.ok && composerHolds(before.text, wire, ourChip || chipTie) === 'other') {
      return { state: DELIVERY.UNCONFIRMED, unsubmitted: true, because: UNSENT_NOT_PRESSED_BECAUSE, at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED) };
    }
  }
  const entered = tmux(['send-keys', '-t', target, 'Enter']);
  if (!entered.ran || entered.status !== 0) {
    /**
     * ⚠️ EVERYTHING PAST THE FIRST KEYSTROKE IS UNCONFIRMED, whatever the
     * second call said, and the previous version of this branch got it wrong in
     * a way worth keeping written down. It answered `could_not` with the
     * sentence "it is sitting there unsent" — two over-claims in one line. The
     * text HAD gone in, so "could not deliver" invited a re-send that would
     * duplicate it; and "sitting there unsent" is a settled claim about where
     * somebody's words are, made in the one case where we could not read the
     * pane to find out. The pane may have taken the Enter and died, or never
     * seen it.
     *
     * What we know is exactly this: we typed it, and we cannot say whether it
     * was submitted. The screen is on the same page, so the honest instruction
     * is to look rather than to guess for them.
     */
    return {
      state: DELIVERY.UNCONFIRMED,
      because: refusalReason(entered, 'it went into its window and we could not press Enter, so it may be sitting in its composer unsent'),
      at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED),
    };
  }
  const isQueued = paneState === status.STATE.WORKING && !paneBackgroundWait && (allowed.card.runner === 'antigravity');
  return { state: DELIVERY.PLACED, queued: isQueued, because: null, at, paneState, paneNote: noteFor(DELIVERY.PLACED), ...(earlierSubmitted ? { earlierSubmitted: true } : {}) };
};
  /* #6249: `placed` is no longer only "tmux took the Enter": on a Claude Code pane the box is watched until it empties
     (submitConfirmSteps), and a line left in it is said as UNCONFIRMED with `unsubmitted: true`. Not a fourth state:
     every sender already treats UNCONFIRMED as "may be there, do not type it again", which is exactly the case. */
  const needsConfirm = (v) => !!v && v.state === DELIVERY.PLACED && composerReadable(allowed.card);
  const settle = (v, result) => {
    let seq = null;
    /* `seen` only when it is an end of ours (a box still drawing our start shows a beginning, which no later read can
       match as the end). */
    const endSeen = (t) => { const q = squash(t); return q && squash(wire).endsWith(q) ? q : ''; };
    if (result && result.outcome === 'unsent') {   // only ours is there: the next line, or a retry, may send it
      unsentSeq += 1;
      seq = unsentSeq;
      /* kosmos#6717: left there as a chip: its exact text (the number) is what a later look must find to press it. */
      const chipSeen = ONE_LINE_CHIP.test(squash(result.text)) ? squash(result.text) : '';
      rememberUnsent(target, { wire, at: Date.now(), seq, seen: chipSeen ? '' : endSeen(result.text),
        ...(chipSeen ? { chip: chipSeen, chipPid: panePidOf(target) } : {}) });
      scheduleUnsentRetries(target, allowed.card);
    } else if (result && result.outcome === 'unread') {
      /* kosmos#6436: no box to read after the Enter (the turn's screen, or a dialog drawn over it). Usually the line
         went; if it did not, nothing would know it is ours. Remembered lightly (in this process only, never written to
         disk, no `seen`, no message row) with one retry: it forgets it on two empty reads and presses it only when
         the box shows all of it; a later delivery that finds it there presses it first, as for any remembered line. */
      rememberUnsent(target, { wire, at: Date.now(), seq: null, seen: '', light: true });
      scheduleUnsentRetries(target, allowed.card, UNSENT_RETRY_MS.slice(0, 1));
    } else forgetUnsent(target);
    const out = confirmedVerdict(v, result);
    const told = seq == null ? out : { ...out, unsentSeq: seq };
    return told.state === v.state ? told : { ...told, paneNote: noteFor(told.state) };
  };
  const confirmSync = (v) => {
    if (!needsConfirm(v)) return v;
    const steps = submitConfirmSteps(allowed.card, target, wire, false, SUBMIT_SETTLE_MS, ourChip);   // kosmos#6717: only a chip pinned before our Enter
    let step = steps.next();
    while (!step.done) { submitGap(step.value.wait); step = steps.next(); }
    return settle(v, step.value);
  };
  const confirmAsync = async (v) => {
    if (!needsConfirm(v)) return v;
    const steps = submitConfirmSteps(allowed.card, target, wire, true, SUBMIT_SETTLE_MS, ourChip);   // kosmos#6717: only a chip pinned before our Enter
    let step = steps.next();
    while (!step.done) {
      const ms = step.value.wait;
      if (pauser) await pauser(ms);
      else if (!runner) await new Promise((resolve) => setTimeout(resolve, ms));
      step = steps.next();
    }
    return settle(v, step.value);
  };
  if (asynchronousGap) {
    if (pauser) return Promise.resolve(pauser(gapMs)).then(finishSubmit).then(confirmAsync);
    if (!runner) return new Promise((resolve) => setTimeout(resolve, gapMs)).then(finishSubmit).then(confirmAsync);
  }
  submitGap(gapMs);
  return confirmSync(finishSubmit());
}

/* #5400: the failover's "your part was moved" notice rides on WHATEVER Kosmos next types into an owed agent. A person
   usually resumes a Claude agent themselves (a message at the reset), so the agent would carry on with a moved part
   before the idle sweep (engine/failovertell.js) ever reads it idle. The hook (server.js) answers which parts this
   session is owed (owed), the words (note) and marks them told (told), only once the line may have reached the pane
   (the sweep's reading: not COULD_NOT, not held). A part the line already names (the sweep's own line, agyquota's
   carry-on line) is not added again. In FRONT of the message, so an attached file's path stays with its words. If the
   note would push the message over the limit, the message goes as it was and the note waits for the next line.
   Enter pressed on Claude Code's own limit menu reaches no Kosmos line: that stays the idle sweep's.
   Weakest premise: that the agent reads a bracketed note above a person's message as Kosmos's, not the person's. */
let MOVED_TELL = null;
/* Review 1 asked whether a synchronous line in an async line's paste-to-Enter gap could carry the note a second time.
   It cannot: deliver() refuses an agent whose window still has a line being placed (deliveryQueues, "busy"), so the
   two never overlap (engine/chat.movedtell-5400.test.js pins the refusal). */
function setMovedTell(h) {
  MOVED_TELL = h && typeof h.owed === 'function' && typeof h.note === 'function' && typeof h.told === 'function' ? h : null;
}
function movedNoteFor(sessionName, raw, opts, card) {
  if (!MOVED_TELL || typeof raw !== 'string' || !raw.trim()) return null;
  /* Review 3: a caller whose line is the agent's LAST in this session (the restart-for-handoff request: write the
     handoff, stop, the session is restarted) passes { movedNote: false }; the note then rides the fresh session's
     pickup line, where the agent that acts next reads it. */
  if (opts && opts.movedNote === false) return null;
  /* Review 5: never while the card reads capped or needs-you. Claude Code's limit menu ("What do you want to do?")
     keeps the card capped (status.retireResetLimits), and a line typed there lands in the menu, reads PLACED, and
     would mark a note told that nobody read. Owed agents are exactly the ones just at their limit. Expected gap: a
     card reads capped for a minute past its reset (status RESET_GRACE_MS), so a line in that minute goes without the
     note, and the next line or the idle sweep carries it (review 9). */
  if (card && (card.state === 'rate_limited' || card.state === 'needs_you')) return null;
  /* Review 1 BLOCKER: a slash command must start the line (/clear, /compact, a person's /status; a paused swarm's
     allowed commands match ^/), and a /clear would erase the note anyway. */
  /* Review 4: and "!", Claude Code's shell mode, which a note in front would turn into a prompt too. Trimmed, because
     cleanMessage trims what is typed, so " /clear" is a command as typed. */
  if (/^[/!]/.test(raw.trim())) return null;
  /* Review 2 BLOCKER: never on a menu answer. The pane takes a bare digit there (Claude Code's limit menu, the moment
     this agent is owed a note), the rule dmNoteMayRide keeps for the reaction note; widened here to any single short
     token (a digit, y, n, esc), which is a keystroke answer, not a turn. The note rides the next real line. */
  if (!/\s/.test(raw.trim()) && raw.trim().length <= 12) return null;
  let items = [];
  /* Review 7: asked by the card's own session name, as the records hold it; the caller may have passed another casing
     (a URL), which resolveCard accepts and owedFor, an exact match, would not. */
  const key = (card && typeof card.sessionName === 'string' && card.sessionName) || sessionName;
  try { items = MOVED_TELL.owed(key) || []; } catch { items = []; }
  items = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.phrase === 'string' && i.phrase && !raw.includes(i.phrase));
  if (!items.length) return null;
  let note = '';
  try { note = String(MOVED_TELL.note(items) || ''); } catch { return null; }
  if (!note) return null;
  const text = note + '\n\n' + raw;
  if (messageProblem(text)) return null;
  return { text, items, key };
}
function movedToldAfter(sessionName, m, v) {
  if (!m) return v;
  /* Review 1: told only when the line was PLACED. An UNCONFIRMED verdict includes certain non-submits (the window
     changed before the Enter; part of it reached the window before the send failed), and a note said twice is
     harmless where a note lost is not. */
  const mark = (x) => {
    if (x && x.state === DELIVERY.PLACED) {
      try { MOVED_TELL && MOVED_TELL.told(m.key || sessionName, m.items); } catch { /* the next line or the sweep tells again */ }
    }
    return x;
  };
  return v && typeof v.then === 'function' ? v.then(mark) : mark(v);
}

function deliver(sessionName, raw, roster, envelope, trailer, opts) {
  const card = resolveCard(roster, sessionName);
  const target = card && card.isNamedOurs === true ? paneTarget(card) : null;
  if (target && deliveryQueues.has(target)) {
    return {
      state: DELIVERY.COULD_NOT,
      because: 'another message is still being placed in its window, so this one was not typed',
      at: new Date().toISOString(), paneState: null, paneNote: null,
      busy: true,   // #4951 review 7: the pane was busy, not unreachable; a caller counting tries need not count this one
    };
  }
  const m = movedNoteFor(sessionName, raw, opts, card);   // #5400 (a card that is not ours is refused before any typing)
  return movedToldAfter(sessionName, m, deliverWithGap(sessionName, m ? m.text : raw, roster, envelope, trailer, false));
}

/**
 * #4588 PR B: deliver for a TIMER, never for a person. While the shared Google quota of this machine's Antigravity
 * agents is out, a line typed into any of them spends a turn against the empty pool, so it is not typed. The verdict is
 * COULD_NOT (nothing reached the pane) with `held: true` and `heldUntil` (ISO), so a sender that budgets its tries can
 * keep the try for after the reset. A person's own message goes through deliver() and is never held.
 */
function quotaHeldVerdict(sessionName, roster, opts = {}) {
  // Review round 6: only a pane we could type into is HELD. A stopped or untypeable member (no agent process, no
  // target, not ours) is refused by deliver/deliverAsync with its real reason, exactly as without the quota gate, so
  // the room never logs a post as held for a pane nothing can reach, and the sender is not told PLACED.
  if (addressable(sessionName, roster).ok !== true) return null;
  const now = Date.now();
  let until = null;
  try { until = require('./agyquota').heldForQuota(sessionName, roster, now); } catch { until = null; }
  let because = null;
  let heldBy = 'quota';   // #4588 ask 3 review 1: which hold, so no surface says "the quota is out" for the cap
  if (until !== null) because = "held: this machine's Google account's shared Antigravity quota is out until " + new Date(until).toISOString();
  else {
    heldBy = 'cap';
    // #4588 ask 3: the person's cap on how many Antigravity agents work at once (Settings > Automation). Not for a
    // send that follows the person's own click (opts.cap false: the restart wake and the handoff pickup).
    if (opts.cap === false) return null;
    try { until = require('./agyquota').heldForCap(sessionName, roster, now); } catch { until = null; }
    if (until === null) return null;
    because = 'held: the Gemini subscription agents on this computer are at the limit you set for working at once; looking again at ' + new Date(until).toISOString();
  }
  return {
    state: DELIVERY.COULD_NOT, held: true, heldBy, heldUntil: new Date(until).toISOString(), because,
    at: new Date().toISOString(), paneState: null, paneNote: null,
  };
}
/* #5743/#5754: a timer's line for a Claude agent waiting on its screen (its question menu, a permission prompt, or the
   safeguards menu; heldBy 'menu' covers all three) is HELD, never typed and never closing the menu (that
   would dismiss a question the person may not have seen). The #4588 hold shape, so every automatic sender already
   keeps it: a room keeps the post for the member's next idle flush once the question is answered and the turn ends,
   or else for its next typed arrival. */
function menuHeldVerdict(sessionName, roster) {
  const card = Array.isArray(roster) ? resolveCard(roster, sessionName) : null;
  if (!card || card.isNamedOurs !== true || addressable(sessionName, roster).ok !== true) return null;
  const menu = claudeMenuRefusal(card, sessionName, roster);
  if (!menu) return null;
  return {
    state: DELIVERY.COULD_NOT, held: true, heldBy: 'menu', because: 'held: ' + menu,
    at: new Date().toISOString(), paneState: null, paneNote: null,
  };
}
/* #5805: the cards the usage-limit hold applies to, one test for the hold and the server's release predicate. */
function limitable(card) {
  return !!card && card.isNamedOurs === true && String(card.runner || 'claude') === 'claude';
}
/* #5805: how often a held line looks again after the printed reset, and for how long (see limitHeldVerdict). */
const LIMIT_RELOOK_MS = 60 * 1000;
const LIMIT_RELOOK_MAX_MS = 60 * 60 * 1000;
/* #5805: a timer's line for a Claude agent paused on a usage limit whose screen names a DATED reset (the weekly form
   status.limitResetAt reads) is HELD, the #4588 hold shape with heldBy 'limit': typed, it would reach a session that
   cannot answer and the sender would count it as delivered. Held while the reset is ahead (heldUntil the reset), and
   after it for as long as status still reads the card capped (heldUntil a minute on, to look again): status keeps a
   passed dated line only while Claude Code's limit menu is on screen, where a typed line would land in the menu, or
   in its one-minute grace. Not past LIMIT_RELOOK_MAX_MS after the reset: a capped card whose line status never retires
   (another limit wording) would otherwise be held for good; after that, lines are typed as before, unless the limit
   menu is still on screen (it holds the session until a key is pressed, and a typed line would land in it). A limit
   line with no date (the 5-hour form, a weekly limit's last day) stays on screen after its reset until something is
   typed, so slice 1 did not hold on it (nothing would ever wake the agent). Slice 3b holds it on the card's limitUntil
   (its reset as read from when the board first saw the line) and status retires the line at that reset, so the card
   reads released then; a dateless line the board saw too late to read is not held, as before. */
function limitHeldVerdict(sessionName, roster, now = Date.now()) {
  const card = Array.isArray(roster) ? resolveCard(roster, sessionName) : null;
  if (!limitable(card) || card.state !== status.STATE.RATE_LIMITED) return null;
  if (addressable(sessionName, roster).ok !== true) return null;
  /* #5805 review 1: a Windows card's reset is the one its account's stream gave (status read it into limitUntil), so it
     comes first, and the card and the hold cannot disagree; a Mac card's comes from its screen line, as before. */
  let reset = null;
  if (card.reachedByChannel === true && typeof card.limitUntil === 'string' && Number.isFinite(Date.parse(card.limitUntil))) reset = Date.parse(card.limitUntil);
  if (reset === null) reset = status.limitResetAt(card.stateEvidence, now);
  /* #5805 slice 3b: a dateless line ("resets 4pm (zone)") holds too, on the card's limitUntil: its reset as resolved
     from when the board first saw the line on screen (status.claudeLimitUntil). No limitUntil (seen late): not held. */
  if (reset === null && typeof card.limitUntil === 'string') {
    const until = Date.parse(card.limitUntil);
    if (Number.isFinite(until)) reset = until;
  }
  if (reset === null) return null;
  if (now - reset > LIMIT_RELOOK_MAX_MS) {
    const view = viewport(sessionName, roster);
    if (!(view && typeof view.text === 'string' && status.claudeLimitMenuUp(view.text))) return null;
  }
  const iso = new Date(reset > now ? reset : now + LIMIT_RELOOK_MS).toISOString();
  return {
    // limitReset: the printed reset itself, which a held ask's day counts from (heldUntil is the next look after it).
    state: DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: iso, limitReset: new Date(reset).toISOString(),
    because: reset > now ? 'held: this agent is paused on a usage limit until ' + iso
      : 'held: this agent still shows its usage limit on screen; looking again at ' + iso,
    at: new Date().toISOString(), paneState: null, paneNote: null,
  };
}
/* #5948: a line for an agent whose sign-in stopped working (a REPORTED auth_failed, see below) is HELD in the #5805 queue
   rather than typed: typed, it reaches a session that answers every turn "Not signed in", and the sender counts it as
   delivered (on Windows the supervisor even drops it). heldBy stays 'limit' so every #5805 path (the queue, its minute
   sweep, Send now anyway, the room's limit record) carries it unchanged; heldFor says why, for the words. limitReset is
   now: the queue's drop clock counts a day from the send, since a sign-in has no printed reset. heldUntil is the next
   look. Released when the card no longer reads auth_failed (signed in again, or restarted). */
function signinHeldVerdict(sessionName, roster, now = Date.now()) {
  const card = Array.isArray(roster) ? resolveCard(roster, sessionName) : null;
  // The REPORTED state only (the seam line): a screen-read auth_failed has no clearing writer on most runners.
  if (!card || card.isNamedOurs !== true || card.state !== status.STATE.AUTH_FAILED || card.stateReported !== true) return null;
  if (String(card.runner || 'claude') === 'claude') return null;   // the seam's own scope (status.reconcileReport)
  if (addressable(sessionName, roster).ok !== true) return null;
  const provider = require('./accountproblem').providerOf(card);
  return {
    state: DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldFor: 'signin',
    heldUntil: new Date(now + LIMIT_RELOOK_MS).toISOString(), limitReset: new Date(now).toISOString(),
    because: provider === 'Qwen'   // #5977 review 5: a Qwen account has no sign-in
      ? 'held: it cannot get answers from its Qwen endpoint; Kosmos sends it once the endpoint answers again'
      : 'held: it is signed out of ' + provider + '; Kosmos sends it once it is signed in again',
    at: new Date(now).toISOString(), paneState: null, paneNote: null,
  };
}
/* #5948: the one hold every #5805 sender asks: out of usage, or signed out. */
function accountHeldVerdict(sessionName, roster, now = Date.now()) {
  // Through the exports, so a test that replaces either (limitmsg-5805 review 9) still reaches every sender.
  return module.exports.limitHeldVerdict(sessionName, roster, now) || module.exports.signinHeldVerdict(sessionName, roster, now);
}
/* #5805: the server's release test for a limit-held member: its card reads idle, or still reads the blocked report
   Claude Code's StopFailure hook made on the limit while its screen reads idle (that report stands until the agent's
   next turn, which the held posts are what gives it). */
function limitReleased(card) {
  if (!limitable(card)) return false;
  if (status.stateIsRemembered(card)) return false;   // #5949: a remembered screen (either arm below) waits for a fresh look
  if (card.state === status.STATE.IDLE) return true;
  return card.state === status.STATE.BLOCKED && card.screenState === status.STATE.IDLE;
}
/* #5805 slice 2a: the minute sweep types messages kept for a limit once this is true: released as limitReleased reads
   it, or no longer held on the limit (the limit test a fresh send meets). The sweep then types through
   deliverAutomaticAsync, so a question or permission menu on screen, or a quota hold, also keeps them waiting, which a
   fresh `kosmos msg` (typed straight in) does not: decided, since a line typed into a menu answers it. A limit line
   with no date never holds (slice 1's stated gap), so it releases the backlog too, as it lets a fresh send through. */
function limitQueueReleased(card, roster) {
  /* #5948: a signed-out agent keeps its queue until it is signed in again, whatever else its card reads. */
  try { if (card && module.exports.signinHeldVerdict(card.sessionName, roster) !== null) return false; } catch { /* as the send gates do: a fault never holds */ }
  if (limitReleased(card)) return true;
  try { return !!card && limitHeldVerdict(card.sessionName, roster) === null; } catch { return false; }
}
/* #5743/#5754: true while this agent's screen waits for an answer (question menu, permission prompt, safeguards menu), for a sweep that decides BEFORE it types
   anything (the recommender holds a whole convening on it, as it does on the quota). */
function menuHeld(sessionName, roster) {
  try { return menuHeldVerdict(sessionName, roster) !== null; } catch { return false; }
}
function deliverAutomatic(sessionName, raw, roster, envelope, trailer, opts = {}) {
  let menuHold = null;
  try { menuHold = menuHeldVerdict(sessionName, roster); } catch { menuHold = null; }   // never throws (the floor still reads)
  if (menuHold) return menuHold;
  let limitHold = null;
  try { limitHold = accountHeldVerdict(sessionName, roster); } catch { limitHold = null; }   // never throws (#5948: or signed out)
  if (limitHold) return limitHold;
  const held = quotaHeldVerdict(sessionName, roster, opts);
  if (held) return held;
  // #4588 ask 3 review 1: reserve the cap slot before the keystroke; a line that reached nothing gives it back.
  const slot = require('./agyquota').noteCapStart(sessionName, roster, Date.now());
  let v;
  try { v = deliver(sessionName, raw, roster, envelope, trailer); }
  catch (err) { require('./agyquota').releaseCapStart(slot); throw err; }   // review 4: a throw reached nothing either
  if (v && v.state === DELIVERY.COULD_NOT) require('./agyquota').releaseCapStart(slot);
  return inputHold(v);
}
/* #6249 round 4: for an automatic sender, text in the box (inputHeld) is a HOLD, the
   #5743 shape: a room keeps the post for the member's next arrival and the sweeps wait, rather than drop it as a line
   that reached nothing. A person's own send (deliver, deliverAsync) keeps the plain refusal and its sentence. */
function inputHold(v) {
  if (!v || v.state !== DELIVERY.COULD_NOT || v.inputHeld !== true) return v;
  return { ...v, held: true, heldBy: 'input' };
}
/* The same gate in front of deliverAsync, for the automatic senders on the async path (a colleague's room post
   delivered by sendPostAsync, the #4624 idle flush). */
async function deliverAutomaticAsync(sessionName, raw, roster, envelope, trailer, opts = {}) {
  let menuHold = null;
  try { menuHold = menuHeldVerdict(sessionName, roster); } catch { menuHold = null; }   // never throws (the floor still reads)
  if (menuHold) return menuHold;
  let limitHold = null;
  try { limitHold = accountHeldVerdict(sessionName, roster); } catch { limitHold = null; }   // never throws (#5948: or signed out)
  if (limitHold) return limitHold;
  const held = quotaHeldVerdict(sessionName, roster, opts);
  if (held) return held;
  // Reserved synchronously, before the first await, so a parallel fan-out's next call already counts it.
  const slot = require('./agyquota').noteCapStart(sessionName, roster, Date.now());
  let v;
  try { v = await deliverAsync(sessionName, raw, roster, envelope, trailer); }
  catch (err) { require('./agyquota').releaseCapStart(slot); throw err; }
  if (v && v.state === DELIVERY.COULD_NOT) require('./agyquota').releaseCapStart(slot);
  return inputHold(v);
}

async function deliverAsync(sessionName, raw, roster, envelope, trailer, opts) {
  const card = resolveCard(roster, sessionName);
  if (!card || card.isNamedOurs !== true) {
    return deliverWithGap(sessionName, raw, roster, envelope, trailer, true);
  }
  const target = paneTarget(card);
  const before = deliveryQueues.get(target) || Promise.resolve();
  // #5400: the note is worked out when this line's turn to be typed comes, so two queued lines cannot both carry it.
  const delivery = before.catch(() => {}).then(() => {
    const m = movedNoteFor(sessionName, raw, opts, card);
    return movedToldAfter(sessionName, m, deliverWithGap(sessionName, m ? m.text : raw, roster, envelope, trailer, true));
  });
  deliveryQueues.set(target, delivery);
  try {
    return await delivery;
  } finally {
    if (deliveryQueues.get(target) === delivery) deliveryQueues.delete(target);
  }
}

/**
 * Hand one already-checked message to a Windows agent's supervisor, and report
 * the same three verdicts the tmux path reports.
 *
 *   ok            -> PLACED       the supervisor wrote it to the agent's stdin
 *   unsure        -> UNCONFIRMED  it may have arrived; only the answer was lost
 *   anything else -> COULD_NOT    nothing was typed, so re-sending is safe
 *
 * ⚠️ `unsure` IS THE CHANNEL'S OWN CLAIM, not inferred here. `win32channel`
 * sets it for any doubt once the request was handed over -- a lost or unreadable
 * answer, a helper that ran and died, a supervisor write that failed part-way.
 * Folding those into COULD_NOT would tell somebody "not delivered" about a
 * message that may be in the agent's conversation, which is how it gets sent
 * twice.
 *
 * ⚠️ A THROW IS UNCONFIRMED, NOT COULD_NOT. `say()` promises never to throw, so
 * one that does has broken that promise at a point we cannot see, and "nothing
 * was typed" is not ours to claim from there.
 */
function deliverThroughChannel(card, wire, ctx) {
  const { at, paneState, noteFor } = ctx;
  const say = channel || ((DRY_RUN || runner) ? null : require('./win32channel').say);
  if (!say) {
    return {
      state: DELIVERY.COULD_NOT,
      because: 'we could not get to it, so we did not type anything (this copy of Kosmos is running without permission to touch agents)',
      at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
    };
  }
  let got;
  try { got = say(card.session, wire); }
  catch (e) { got = { ok: false, unsure: true, because: 'something went wrong while we were handing it over (' + ((e && e.code) || 'unknown') + '), so we cannot tell whether it arrived' }; }

  if (got && got.ok === true) {
    return { state: DELIVERY.PLACED, queued: false, because: null, at, paneState, paneNote: noteFor(DELIVERY.PLACED) };
  }
  if (got && got.unsure === true) {
    return { state: DELIVERY.UNCONFIRMED, because: got.because || 'we cannot tell whether it arrived', at, paneState, paneNote: noteFor(DELIVERY.UNCONFIRMED) };
  }
  return {
    state: DELIVERY.COULD_NOT,
    because: (got && got.because) || 'we could not reach it, so we did not type anything',
    at, paneState, paneNote: noteFor(DELIVERY.COULD_NOT),
  };
}

/**
 * What to say about a tmux call that did not work.
 *
 * "We could not run tmux" and "tmux ran and refused" are different facts, and
 * the second one usually names the pane, which is the half a person can act on.
 */
function refusalReason(got, fallback) {
  if (!got || !got.ran) {
    /**
     * ⚠️ TOLD APART, because they send a person to different places. tmux
     * NEVER STARTED (it is not installed, not executable, not on PATH) is a
     * machine to fix; tmux started and did not answer in time is a machine
     * under load, where the same action a moment later usually works. One
     * sentence for both told the second person to go looking for a missing
     * program they have.
     */
    if (got && got.spawnFailed === false) {
      // ⚠️ The fallback clause SURVIVES the timeout branch. "…, so we did not
      // type anything" is the sentence that makes this verdict a could_not
      // rather than an unconfirmed, i.e. the reason re-sending is safe -- and
      // the timeout was the one branch that dropped it exactly where it
      // carries that weight.
      return fallback
        ? `${fallback} (its window did not answer in time)`
        : 'its window did not answer in time';
    }
    // ⚠️ Same weight-bearing rule as the timeout arm above (round 20): the
    // caller's fallback clause is what tells the reader nothing was typed,
    // so the spawn-failed sentence keeps it too instead of replacing it.
    const why = (got && got.err) ? String(got.err).trim().split('\n')[0] : 'we could not reach the agents on this computer';
    return fallback ? `${fallback} (${why})` : why;
  }
  const said = String((got && got.err) || '').trim().split('\n')[0];
  return said ? `${fallback} (${said})` : fallback;
}

/* ── the agent's side ────────────────────────────────────────────────────── */

/**
 * What this agent's screen is showing, right now.
 *
 * ⚠️ THE LABEL IS PART OF THE CONTRACT. This is the terminal's pixels as text.
 * It is not a transcript, it is not "what the agent said", and it does not
 * belong to the person's thread — it is live-only and never stored (see
 * `appendMessage`, which keeps only what is ours to keep).
 *
 * ⚠️ Gated on `isNamedOurs` like every other name-keyed read in this codebase.
 * A pane merely sharing the name is somebody else's screen, and putting it
 * under this agent's heading would be the borrowed-name defect wearing a chat
 * window.
 *
 * ⚠️ THIS IS NOT THE BOARD'S CAPTURE, and the differences are load-bearing
 * rather than incidental. `status.capturePane` asks for 40 lines of scrollback
 * WITHOUT `-J` and `classify` reads only the last 25 of what came back; this
 * asks for 60 WITH `-J`, and `questionIn` scans all of it. (Measured: `-S -N`
 * returns N plus the pane height, so the request is not the size of the
 * answer — see the note above `questionIn`.) So the two can legitimately disagree about
 * whether a question is on screen — see the note above `questionIn`, and
 * `questionBecause` on the route, which exists for exactly that case.
 */
function viewport(sessionName, roster) {
  // No `at` stamp (round 31): it was published on every return and read
  // by nothing -- the unread-surface rule rounds 19 and 22 applied to the
  // thread payload's agents copy and readIdentity's source, applied to
  // the third instance. The capture is made in the same request cycle as
  // the sentence that describes it, which is what "right now" claims.
  const key = String(sessionName == null ? '' : sessionName);
  if (!Array.isArray(roster)) {
    return { text: null, because: 'we could not check which agents are running, so we cannot show you its screen' };
  }
  const card = resolveCard(roster, key); // #989: exact-first, then case-fold (send stays stricter than the gate)
  if (!card) {
    return { text: null, because: 'we cannot see an agent by exactly this name on this computer right now' };
  }
  if (card.isNamedOurs !== true) {
    return { text: null, because: 'something is running under this name, but we cannot tell that it is this agent, so we are not showing you its screen' };
  }
  /* #5223: a Windows agent has NO window. It runs headless (`claude -p`, stream-json) under its
     supervisor, the same fact `send` branches on above, read off the same card mark. The tmux
     capture below could only fail, and its sentence ("could not reach the agents on this computer")
     told every Windows user, on every agent page, that a working agent was unreachable. Said as
     the fact it is, before tmux is asked, so nothing is spawned for an answer that is known.
     `noWindow` lets a caller that words its own sentence off a null `text` (the routes' question
     clause) tell "there is no window" from "we could not read it" without matching this wording. */
  if (card.reachedByChannel === true) {
    return { text: null, noWindow: true, because: NO_WINDOW_BECAUSE };
  }
  if (!card.target) {
    return { text: null, because: 'we cannot tell where this agent is running' };
  }
  // One depth for every caller: a `lines` parameter used to ride here with
  // a bound no caller ever exercised (round 16), which was API surface
  // whose safety nothing held.
  const got = tmux(['capture-pane', '-p', '-J', '-t', paneTarget(card), '-S', `-${VIEWPORT_LINES}`]);
  if (!got.ran || got.status !== 0) {
    return { text: null, because: refusalReason(got, 'we could not read its window just now') };
  }
  // ⚠️ Trailing blank lines are trimmed and NOTHING ELSE IS. tmux pads a
  // capture to the pane height, so an untrimmed viewport is mostly empty space
  // and the newest line sits off the top of a scrolled box. Trimming the ENDS
  // is presentation; touching the middle would be parsing, which this module
  // does not do.
  return { text: String(got.out || '').replace(/\s+$/, ''), because: null };
}

/**
 * The part of the screen that made the board say "Needs you".
 *
 * ⚠️ ONE derivation, shared. The markers come from `engine/status.js`, which is
 * where the NEEDS_YOU verdict is made — a private copy here would be a second
 * answer to one question, this codebase's worst habit, and it would drift the
 * first time a marker is added there. So this function SHARES the markers with
 * the card that sent the person here.
 *
 * ⚠️ That is not the same as the two agreeing, and an earlier version of this
 * paragraph claimed it was. The two reads differ in THREE ways, not one, and
 * only the first is about timing:
 *
 *   MOMENT — the card comes from the roster snapshot at the top of the request;
 *            this runs on a capture taken after it, and a TUI redraws.
 *   FLAGS  — `status.capturePane` does NOT pass `-J`; `viewport` does. `-J`
 *            joins a wrapped line back together, so a marker split across the
 *            pane's right edge is one line here and two there. The board can
 *            see a question this misses, and the reverse.
 *   DEPTH  — the board asks for 40 lines of scrollback and `classify` then
 *            reads only the LAST 25 of what came back; this asks for 60 and
 *            scans all of it. A question that has scrolled past those last 25
 *            lines is invisible to the card while still being findable here.
 *            (⚠️ MEASURED: `-S -N` returns N lines of scrollback PLUS the
 *            pane height — on a 20-row pane, `-S -40` came back with 60 lines
 *            and `-S -60` with 80. So neither number is the size of what is
 *            returned, and an earlier version of this note read as though it
 *            were. The 25-line window is the part that actually bounds what
 *            the card can see.)
 *
 * All three gaps are real and reachable, which is exactly why the route carries
 * `questionBecause` — a sentence for the case where the two reads disagree,
 * instead of a silence that would render as no question at all under a card
 * saying there is one.
 *
 * ⚠️ AND IT IS STILL NOT A PARSER. It returns a SLICE of the same pane text,
 * from a few lines above the matching line to the end. It does not extract "the
 * question", name the options, or reword anything: the person reads the
 * terminal, we only scroll it to the right place.
 *
 * `runner` (#4034): the card's runner. For 'gemini' the slice starts at Gemini's question box when one is up
 * (status.geminiQuestionReading); for any other runner, or none, only the markers are read.
 */
/* #6054 review 3: a permission prompt and where its box starts: the line under the nearest full-width rule above its
   question (top -1 when it is not on screen: a box taller than the pane). Review 4: the box never holds Claude Code's
   transcript marks ('⏺' a reply, '⎿' a result, '✻' its status line), and anything reaching back into an earlier turn
   does, so meeting one before the rule means this box's own rule has scrolled away and an older one is above it: top -1. */
function permissionBox(text) {
  const pp = status.claudePermissionPrompt(text);
  if (!pp) return null;
  const lines = String(text == null ? '' : text).split('\n');
  for (let i = pp.at - 1; i >= 0; i -= 1) {
    if (/^\s*─{8,}\s*$/.test(lines[i])) return { pp, top: i + 1 };
    if (/^\s*[⏺⎿✻]/.test(lines[i])) return { pp, top: -1 };
  }
  return { pp, top: -1 };
}
/* #6054 review 3: may this screen's permission prompt be answered by key? Only when its whole box is on screen, so its
   identity is the whole request. A box whose top has scrolled away could share its visible tail with another command's,
   so it gets no buttons, no key, and no promise of buttons. */
function permissionAnswerable(text) {
  const box = permissionBox(text);
  return Boolean(box && box.top >= 0);
}
/* kosmos#6727 (Josh, 10-20): the permission prompt as a short card instead of its screen. Read from the box, only where
   permissionAnswerable (the whole box on screen, the same gate as the buttons), else null and the old text stays.
   Measured on 2.1.296 (test-support/claude-screens): under the full-width rule, a title line ("Bash command", "Create
   file"), an optional "Tip:" line, then Claude's own description of a command or the file's name; the body between two
   dashed rules (the command, or the file's text); then, above the question, any reason Claude Code gives ("This command
   requires approval", or a warning such as a dangerous rm). Returns { kind, title, says, target, detail, reason, allow,
   deny }: kind is 'delete' | 'command' | 'create' | 'edit' | 'fetch' | 'other'; allow and deny are the numbers of the
   prompt's own "Yes" and "No" options (claudePermissionPrompt guarantees both). Every text field is plain text: no
   rule, option, key hint or control character. */
const PERMISSION_DASHED = /^\s*╌{8,}\s*$/;
function permissionCard(text) {
  const box = permissionBox(text);
  if (!box || box.top < 0) return null;
  const lines = String(text == null ? '' : text).split('\n').slice(box.top, box.pp.at);
  const segs = [[]];
  for (const l of lines) {
    if (PERMISSION_DASHED.test(l)) { segs.push([]); continue; }
    segs[segs.length - 1].push(l);
  }
  // eslint-disable-next-line no-control-regex
  const clean = (l) => l.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const headAll = segs[0].map(clean).filter(Boolean);
  const tipSeen = headAll.some((l) => /^Tip:/i.test(l));
  const head = headAll.filter((l) => !/^Tip:/i.test(l));
  const title = head[0] || '';
  const rest = head.slice(1);
  /* Review 4: a tip wraps on a narrow pane and its next line is not marked; with a tip on screen the description is
     known only when exactly one line is left, so anything else is ambiguous and stays under Show details. */
  const sub = rest.join(' ');
  const subSure = !tipSeen || rest.length === 1;
  const body = segs.length >= 3 ? segs.slice(1, -1).flat() : [];
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), 80);
  const detail = body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
  const tail = segs.length >= 2 ? segs[segs.length - 1].map(clean).filter(Boolean) : [];
  const reason = tail.join(' ');
  let kind = 'other';
  if (/^Bash command\b/i.test(title)) kind = /\brm\b|delet|remov/i.test(reason) ? 'delete' : 'command';
  else if (/^Create file\b/i.test(title)) kind = 'create';
  else if (/^(Edit|Update|Write) file\b/i.test(title)) kind = 'edit';
  else if (/^(Fetch|Web ?fetch|Web search)\b/i.test(title)) kind = 'fetch';   // review 1: the known titles only
  const opts = box.pp.options;
  const allow = opts.find((o) => o.label === 'Yes');
  const deny = opts.find((o) => /^No\b/.test(o.label));
  if (!allow || !deny) return null;
  const isCommand = kind === 'command' || kind === 'delete';
  const isFile = kind === 'create' || kind === 'edit';
  /* Review 2: only a MEASURED shape puts a line where the person reads it without opening the details: a command's
     description, a file's name. Any other box (an MCP tool's, a layout not captured) keeps its lines under Show
     details, so a request's arguments never reach the headline. */
  const ruled = segs.length >= 3;
  /* Review 4: only the MEASURED shape is a card, its body between two dashed rules. Without them there is no telling
     where the request is, and a card could offer Allow with nothing under Show details; null keeps the old text. */
  if (!ruled) return null;
  const extra = ((isCommand || isFile) && subSure) ? '' : sub;
  // A file's text is drawn with a line-number gutter ("  1 hello"); the details show the text (review 2).
  // kosmos#7017 reviews 4 and 5: only a gutter that numbers EVERY line 1, 2, 3 with no gap is one. A blank line is drawn
  // "  2 " (trimmed here to "2"); a line Claude Code wraps itself carries no number, so its continuation breaks the run
  // and the text is kept as drawn, numbers and all, rather than losing a number that was part of the text ("777").
  const gutterLines = detail ? detail.split('\n') : [];
  // Review 6: the strict run is for a new file (drawn from line 1). A change is drawn as a diff from its own line
  // numbers ("  41 -old"), which keeps the earlier reading.
  const gutter = kind === 'create' ? (gutterLines.length > 0
    && gutterLines.every((l, k) => { const m = l.match(/^\s*(\d+)(\s|$)/); return Boolean(m) && Number(m[1]) === k + 1; }))
    : (isFile && Boolean(detail) && gutterLines.every((l) => !l.trim() || /^\s*\d+\s/.test(l)));
  const fileText = gutter ? detail.split('\n').map((l) => l.replace(/^\s*\d+\s?/, '')).join('\n') : detail;
  return { kind, title, says: isCommand && subSure ? sub : '', target: isFile && subSure ? sub : '',
    detail: [extra, fileText].filter(Boolean).join('\n'), reason, allow: allow.n, deny: deny.n };
}
/* kosmos#7017 part 2: one permission request's fingerprint, from its card (permissionCard): sha256 hex of what the card
   says the request is, joined with U+001F. Every permission prompt asks "Do you want to proceed?" with "Yes" and "No", so
   the question line alone cannot tell two commands apart. The press's `asked` (the whole box, #6054) is checked by
   the phone and again by the board; this is a second check on the card's reading of it, not a replacement for that. The phone checks a lock-screen press against the card's
   fingerprint read again just before it sends, so a notice minutes old never answers a different command with the same
   words. The same text on a pane redrawn at another width may wrap differently and read as another request: that refuses
   an honest press, the safe direction. The same words asked again later (from another folder, say) read as the same
   request: the person did read those exact words. Null for anything that is not an object (pass only permissionCard's
   result). */
function permissionRequestId(card) {
  if (!card || typeof card !== 'object') return null;
  const parts = ['kind', 'title', 'says', 'target', 'detail', 'reason'].map((k) => String(card[k] == null ? '' : card[k]));
  return require('node:crypto').createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex');
}
function questionIn(text, runner) {
  const whole = String(text == null ? '' : text);
  if (!whole.trim()) return null;
  const lines = whole.split('\n');
  /* #4034: on a Gemini pane, its question box first. Its box is at the bottom by rule, while a marker phrase
     ("Would you like to", "permission to") can sit higher up in the agent's own earlier reply; the markers would
     take that stale prose as the question. Only for Gemini: the box is a shape, not words, and another runner's
     tool output can draw one. */
  if (runner === 'gemini') {
    const g = status.geminiQuestionReading(whole);
    if (g) return { text: lines.slice(g.from).join('\n').replace(/\s+$/, '') };
  }
  /* #5406 part 2: Claude Code's question menu (status.claudeQuestionMenu) matches none of the markers; when it is the
     live screen, the region is its header or question line to the end, so the person reads the question and the
     choices. Read for any runner here, where it only shows text (its footer, free-answer entry and highlighted option
     together are Claude's); the thread route answers it by key for a Claude card only. */
  const cq = status.claudeQuestionMenu(whole);
  if (cq) return { text: lines.slice(cq.at).join('\n').replace(/\s+$/, '') };
  /* #6054 review 2: Claude Code's permission prompt, as its whole box: from under the full-width rule that opens it
     ("Bash command", "Create file") to its footer. The person reads the whole command, and questionAbove's identity is
     every line of it: the six-line run-up below cut a long command's head off, so two commands with the same tail
     could share an identity. No rule within 60 rows: the 40 rows above its question, the same bound on every read. */
  const box = permissionBox(whole);
  if (box) return { text: lines.slice(box.top >= 0 ? box.top : Math.max(0, box.pp.at - 40)).join('\n').replace(/\s+$/, '') };
  // The LAST match, not the first: a pane accumulates, and an older question
  // that has already been answered may still be on screen above the live one.
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    /* ALL runners' markers (#249): the markers do not depend on which runner
       drew the pane (only the Gemini box above does), and a Codex question
       must be findable too. */
    if (status.ALL_NEEDS_YOU_MARKERS.some((re) => re.test(lines[i]))) at = i;
  }
  /* #5051: Claude Code's safeguards model-switch menu matches none of the markers (its question is wrapped prose in a
     frame), so it was invisible here while the board named it (#5039, the same live-menu rule). When it is the live
     menu, the region starts at its "Model switch" title and runs to the end of the screen, so the person reads the
     question and both choices (and any line below it). No "below a marker" condition: a non-numbered marker line under
     the menu would otherwise start the region mid-menu (review round 1). optionsIn refuses it, so no buttons. */
  const sg = status.safeguardsMenuAt(whole);
  if (sg) {
    let title = -1;
    for (let i = sg.at - 1; i >= Math.max(0, sg.at - 16); i -= 1) if (/Model switch\s*$/.test(lines[i])) { title = i; break; }
    return { text: lines.slice(title >= 0 ? title : Math.max(0, sg.at - 10)).join('\n').replace(/\s+$/, '') };
  }
  if (at < 0) return null;
  // A few lines of run-up, because a Claude permission prompt states what it is
  // asking about above the line that matches.
  const from = Math.max(0, at - 6);
  // ⚠️ The TEXT only. A `line` index used to ride along and nothing ever
  // read it — and a line number counted against a capture the caller does not
  // hold is not a thing anybody could use safely anyway.
  return { text: lines.slice(from).join('\n').replace(/\s+$/, '') };
}

/**
 * The numbered choices inside a question, when we can be sure of them.
 *
 * ⚠️ THIS IS THE ONE PLACE IN THE PRODUCT THAT READS A PANE AS STRUCTURE, so
 * it refuses far more than it accepts. `questionIn` above deliberately does not
 * parse — it scrolls the terminal to the right place and lets the person read
 * it. This goes one step further because the pack draws BUTTONS, and a button
 * carrying the wrong option's words sends an answer the person did not give.
 * When anything is off, it returns null and the screen falls back to the
 * question as it stands today. NEVER GUESS: an unparsed menu costs a person one
 * line of typing; a mis-parsed one answers for them.
 *
 * Confident means ALL of: the numbers run 1..n with no gap and no repeat; there
 * are between 2 and 9 of them; they are CONSECUTIVE lines of the capture; and
 * one of them carries the selection marker the TUI draws.
 *
 * WARNING: THE LAST TWO RULES ARE WHAT SEPARATE A MENU FROM PROSE, and without
 * them this function was confidently wrong on ordinary agent output. Measured
 * against the shipped version:
 *
 *   '1. Do X' + forty lines of anything + '2. Do Y'   -> a two-button menu
 *   'Would you like to review the plan?
 *     1. Delete the old build folder
 *     2. Rebuild from scratch'                        -> a two-button menu
 *
 * The second is the dangerous one: `Would you like to` is itself a
 * NEEDS_YOU_MARKER (engine/status.js), so `asking` is true for exactly that
 * shape, and the page would have drawn a button that types `1` into a live
 * pane and recorded that the person chose "Delete the old build folder".
 *
 * ADJACENCY says the lines belong to one list rather than being scattered
 * through a paragraph. THE MARKER says a TUI drew it: every real menu this
 * product meets highlights one row, and prose does not contain that glyph.
 * Both refusals land on state 5, which is the screen this page shows today.
 *
 * ⚠️ THE REPEAT RULE IS DOING REAL WORK. A pane accumulates, so an ALREADY
 * ANSWERED menu can still be on screen above the live one — `questionIn` takes
 * the last marker but its run-up slice can reach back over the earlier one.
 * That reads as 1,2,1,2, which fails contiguity, which lands on state 5. The
 * screen showing no buttons over a real menu is a small loss; buttons built
 * from a menu that was answered ten minutes ago is a wrong answer sent
 * confidently.
 *
 * The frame is stripped from BOTH ends before matching. Claude draws its
 * prompts inside a box on some versions and bare on others (the captures in
 * `engine/connect.test.js` are bare, taken from a real v2.1.229), and a leading
 * `│` would make every option line invisible to a pattern anchored at the
 * number.
 *
 * ⚠️ ONLY THE BOX-DRAWING `│` IS FRAME, at either end. An earlier version also
 * took an ASCII `|` off the LEFT and not the right, which is one end believing
 * in ASCII frames while the other does not: an ASCII-framed menu then parsed
 * with the padding and the closing pipe inside every label. Nothing this
 * product meets draws boxes in ASCII, so such a menu now simply refuses, which
 * is the safe end of that choice. And `2. use a pipe |` keeps its final
 * character, which the verbatim rule two lines down requires.
 *
 * Labels ride VERBATIM, which is the pack's rule: a button carries the option's
 * own words, not our summary of them.
 */
// One digit, 1-9, not `\d+`. The count is capped at 9 anyway, and `\d+`
// accepted `01.` as option 1 through Number() -- a shape no menu draws and one
// more way for prose to look like a list.
/* ⚠️ The glyph class comes from status.js (#998), NOT a literal here. Two
   parsers keyed on this separately and disagreed: this one knew only Claude's
   ❯, while the needs-you markers knew Codex draws ›, so every Codex choice
   prompt was DETECTED and then drew no buttons.

   📌 SCOPE, STATED RATHER THAN OVERCLAIMED: this constant governs the three
   MENU-PARSING patterns in this file. It is deliberately NOT the marker lists
   in status.js -- those stay per-runner because each is an OBSERVED capture
   from a specific CLI and its docblock records what was seen, which is a
   different kind of fact from "these characters can precede an option". So
   "one source" is true of the parser, not of every glyph in the codebase. */
const OPTION_LINE = new RegExp(`^([${status.SELECTOR_GLYPHS}]\\s*)?([1-9])[.)]\\s+(\\S.*)$`);
// ⚠️ ANY digit count, deliberately wider than OPTION_LINE. It is what sees a
// line the single-digit pattern cannot read -- a tenth option -- so a menu
// longer than we can read is refused rather than served as its first nine.
/* 📌 Widened with its siblings for one-source consistency; like CONTINUATION,
   inert in practice -- the line it guards on is below the run and therefore
   unmarked, and the selector group was already optional. */
const ANY_NUMBERED = new RegExp(`^(?:[${status.SELECTOR_GLYPHS}]\\s*)?\\d+[.)]\\s+\\S`);

/**
 * The text ABOVE a confident option run, which is what tells two menus with the
 * same labels apart.
 *
 * ⚠️ IT EXISTS BECAUSE THE 409 SCREEN-CHECK WAS WEAKER THAN ITS OWN COMMENT.
 * That guard says it stops "sending an answer to a question they never saw",
 * and it compared only the LABEL for the pressed digit. Claude's
 * edit-permission menu draws the same labels for every file -- this codebase
 * says so in two places -- so a pane that redrew from "Edit file src/a.js?" to
 * "Edit file src/b.js?" between the paint and the POST passed verification, and
 * `1` approved a file the person never chose.
 *
 * The page has carried this discriminator since the hold was written
 * (`talkKey`'s `above` half). It simply never sent it, and the server never
 * asked. This is the engine's twin of that rule, so the comparison is made
 * against the same fact on both sides rather than two spellings of it.
 *
 * Returns null when there is no confident run at all -- there is then nothing
 * to disagree about, and `optionsIn` has already refused.
 */
function questionAbove(questionText) {
  // #5406 part 2: the question menu's identity is its question line.
  { const cq = status.claudeQuestionMenu(String(questionText == null ? '' : questionText)); if (cq) return cq.question; }
  /* #6054: a permission prompt's identity is every meaningful line above its options, by the same rule as below, and
     NOT its question line: "Do you want to proceed?" is the same for every command, so only the command above it tells
     one prompt from the next. Its options start right under its question line (status.claudePermissionPrompt), which
     holds even where a wrapped label makes the line rule below refuse the menu. */
  const pp = status.claudePermissionPrompt(String(questionText == null ? '' : questionText));
  const opts = pp ? pp.options : optionsIn(questionText);
  if (!opts) return null;
  const lines = String(questionText == null ? '' : questionText).split('\n');
  /* Same glyph class as OPTION_LINE (#998), and it MUST be: this finds where
     the option run starts so the question above it can be sliced off.
     ⚠️ MEASURED, because the first version of this comment guessed the
     mechanism and guessed wrong. Left on ❯ only, against
     `Edit file src/a.js?\n› 1. Yes\n  2. No`, `first` is 2 -- NOT -1. The
     marked line is skipped and the run appears to start at the UNMARKED
     second option, so the "question above" becomes
     `Edit file src/a.js?\n› 1. Yes`: the option line gets absorbed into the
     question's identity. That value is what the 409 screen-check compares, so
     the consequence is a refused press, not a wrong one -- but a half-widened
     parser is still worse than an unwidened one. */
  const OPTION_START = new RegExp(`^(?:[${status.SELECTOR_GLYPHS}]\\s*)?[1-9][.)]\\s+\\S.*$`);
  const first = pp ? pp.at + 1 : lines.findIndex((l) => OPTION_START.test(
    l.replace(/^\s*│\s?/, '').replace(/[\s│]+$/, '').replace(/^\s+/, '')));
  /**
   * ⚠️ EVERY MEANINGFUL LINE ABOVE THE RUN, and this rule has had three shapes.
   * Each earlier one was broken by a blind pass, and the reason to stop here is
   * not that this one is perfect -- it is that its failure is on the SAFE side.
   *
   *   CONTAINMENT   accepted a pane that had ACCUMULATED a new question above
   *                 the answered one, because the new window contains the old.
   *                 Measured end to end: "1" went through against `rm -rf`.
   *                 Fails OPEN.
   *   LAST THREE    dropped the discriminating text whenever it sits more than
   *                 three meaningful lines above the menu. Measured on Claude's
   *                 own edit-permission prompt: a path line above a two-line
   *                 diff hunk, so `src/alpha/index.js` and `src/beta/index.js`
   *                 produced the SAME identity and "1" approved an edit to a
   *                 file nobody chose. Fails OPEN, on the shape this function's
   *                 own docblock cites as its reason to exist.
   *   EVERY LINE    refuses a send when the window's TOP moves, which happens
   *                 when the cursor leaves the marked option: `questionIn`
   *                 anchors on the last needs-you marker and `❯ 1. Yes` is one,
   *                 so arrowing to 2 re-anchors on the prose above and the
   *                 window gains lines. Fails CLOSED.
   *
   * 🛑 A FALSE REFUSAL COSTS ONE MORE PRESS. A false ACCEPT types a digit into
   * somebody's terminal answering a question they never read. Those are not
   * comparable, and an earlier comment of mine that called a false refusal
   * "worse than the hole it closes" had the emphasis backwards: it is worse
   * than a guard that is RIGHT, not worse than a guard that is wrong the other
   * way.
   *
   * The cursor case is a KNOWN, MEASURED cost, not an oversight: the person
   * presses again and the second press carries the new identity. The route's
   * sentence is written to be true of both causes. Narrowing it further wants a
   * cursor-independent anchor, which is its own change with its own blind pass.
   *
   * ⚠️ NULL WHEN NOTHING IDENTIFIES IT. A window of only blanks or frame means
   * the screen carries nothing that could tell one question from another, and
   * inventing an identity from the options is the collision this exists to
   * prevent. Null leaves the caller with the label check it had before.
   */
  const above = lines.slice(0, first)
    .filter((l) => l.replace(/^\s*│\s?/, '').replace(/[\s│]+$/, '').trim() !== '');
  if (!above.length) return null;
  return above.join('\n').trim() || null;
}

function optionsIn(questionText) {
  /* #5051: never buttons for Claude Code's safeguards model-switch menu. Option 1 switches models and saves that choice
     in the agent's Claude settings; the person types it. Enforced here, not left to that menu's layout (review round 1). */
  if (status.safeguardsMenuAt(String(questionText == null ? '' : questionText))) return null;
  const whole = String(questionText == null ? '' : questionText);
  if (!whole.trim()) return null;
  /* #5406 part 2: Claude Code's question menu, read by its own parser (descriptions under options, and the
     "Type something." / "Chat about this" entries, which are not answers and get no button). */
  { const cq = status.claudeQuestionMenu(whole); if (cq) return cq.options.map((o) => ({ n: o.n, label: o.label })); }
  /* #6054: Claude Code's permission prompt, by its own reader too, so the buttons the page draws are the options the key
     path answers (a wrapped label is one whole option here, where the line rule below would refuse the menu). */
  { const pp = status.claudePermissionPrompt(whole); if (pp) return pp.options.map((o) => ({ n: o.n, label: o.label, ...(o.lasting ? { lasting: true } : {}) })); }   // #6172: lasting ones too
  const found = [];
  let marked = false;
  const lines = whole.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    // The frame comes off both ends, and only the box-drawing character counts
    // as frame: an ASCII `|` may be the last character of somebody's label.
    const body = lines[i].replace(/^\s*│\s?/, '').replace(/[\s│]+$/, '');
    const bare = body.replace(/^\s+/, '');
    const m = OPTION_LINE.exec(bare);
    if (!m) continue;
    if (m[1]) marked = true;
    found.push({ n: Number(m[2]), label: m[3], at: i });
  }
  if (found.length < 2) return null;
  for (let i = 0; i < found.length; i += 1) {
    // 1..n, no gap and no repeat.
    if (found[i].n !== i + 1) return null;
    /**
     * ⚠️ CONSECUTIVE LINES OF THE CAPTURE. A list, not two sentences that
     * happen to start with numbers, and not a list with anything drawn between
     * its rows -- which is also what refuses a menu whose label wrapped, since
     * the wrapped line sits between two options. That refusal is deliberate;
     * see the note above the scan.
     */
    if (i > 0 && found[i].at !== found[i - 1].at + 1) return null;
  }
  /**
   * WHY ANYTHING BELOW THE RUN MATTERS AT ALL.
   *
   * A NUMBERED line is a menu longer than the single-digit pattern can read.
   * Nine buttons over a ten-option prompt is worse than none, because it reads
   * as the whole choice. (This replaced a `found.length > 9` test that the
   * one-digit pattern had made unreachable.)
   *
   * An INDENTED line is either a wrapped label, which we have decided not to
   * guess at, or pane furniture. See the note above the scan for why those two
   * cannot be told apart from a capture alone.
   *
   * ⚠️ THIS BLOCK USED TO OPEN "NOTHING MAY HANG BELOW THE RUN … three shapes,
   * all three refusals", named two, and was contradicted by the docblock
   * directly beneath it. The correction was written and the sentence it
   * corrected was left standing, so a reader going top-down was told an
   * absolute the code deliberately does not have. Deleted rather than softened.
   */
  const lastRun = found[found.length - 1];
  /**
   * WARNING: WHAT MAY FOLLOW THE RUN, and the previous version of this guard
   * was wrong in three ways at once.
   *
   * It said "nothing may hang below" and named three shapes while checking
   * two, and neither claim was true: a line at or LEFT of the options was
   * accepted, one BLANK line let a tenth option through, and the indent it
   * compared against came from the LAST option -- whose own indent depends on
   * where the cursor is sitting, since the marked row starts a column left of
   * the others. The same menu with the cursor moved gave different answers.
   *
   * So: the comparison is against the DEEPEST option, which is the indent of
   * the unmarked rows and is where the box actually starts its content -- the
   * marked row is drawn a column left of it, so the shallowest option moves
   * with the cursor and the deepest does not. (Measured: using the shallowest
   * put the reference at the marked row and refused every real screen,
   * including a composer line sitting at column zero.) Blank lines are skipped
   * when looking for a numbered continuation, because a gap does not make a
   * tenth option disappear. And a following line at or past that indent is
   * refused rather than only one that is deeper, which is what stops a
   * same-indent wrapped label being silently truncated onto the button.
   *
   * ⚠️ AND SOMETHING UNINDENTED BELOW IS FINE ON PURPOSE. A live pane always
   * has its composer under the menu, and `questionIn` slices to the end of the
   * capture, so a rule refusing everything below would refuse every real
   * screen. The indent is what separates the box's own contents from what
   * comes after it.
   */
  const optIndent = found.reduce((deepest, o) => {
    const body = lines[o.at].replace(/^\s*│\s?/, '');
    const indent = body.length - body.replace(/^\s+/, '').length;
    return Math.max(deepest, indent);
  }, 0);
  for (let i = lastRun.at + 1; i < lines.length; i += 1) {
    const body = lines[i].replace(/^\s*│\s?/, '').replace(/[\s│]+$/, '');
    const bare = body.replace(/^\s+/, '');
    // A blank or frame-only line does not end the search for a numbered
    // continuation: a menu with a gap in it is still a menu we cannot read.
    if (!bare) continue;
    if (ANY_NUMBERED.test(bare)) return null;
    const indent = body.length - bare.length;
    if (indent >= optIndent) return null;
    break;
  }
  /**
   * ⚠️ AND PAST THE COMPOSER, FOR THE CONTINUATION ONLY.
   *
   * The loop above stops at the first unindented line, deliberately, because a
   * live pane always has its composer under the menu. That left the guard's
   * whole purpose reachable around it: MEASURED on the shipped parser, a menu
   * of ten whose tenth option sits below any unindented line ("Press esc to
   * cancel") returned NINE buttons -- exactly the "nine over a ten-option
   * prompt reads as the whole choice" harm the block above names, arrived at
   * by walking around the check rather than through it.
   *
   * So the scan continues past that line, but only for the CONTINUATION: a
   * line numbered exactly one past the run. Not for any numbered line, because
   * `questionIn` slices to the end of the capture and unrelated output below a
   * composer routinely contains "1." or "2." -- refusing on those would refuse
   * real menus for text that has nothing to do with them. A line numbered
   * `found.length + 1` is the signature of a list this pattern truncated, and
   * almost nothing else.
   */
  /* The truncation guard: a line numbered one past the run means this pattern
     read only part of a list, and refusing beats serving a ten-option menu as
     its first nine.
     📌 THE GLYPH CLASS HERE IS FOR CONSISTENCY, NOT FOR A BUG (#998). An
     earlier comment claimed leaving it on ❯ would let a truncated Codex menu
     slip past. It would not, and I checked rather than kept asserting: the
     selector group is OPTIONAL, and a continuation line is unmarked BY
     CONSTRUCTION -- only one row in a menu carries the cursor and it is inside
     the run. Measured: the ❯-only pattern matches `10. option 10`. So this
     widening is inert. It stays because three patterns deriving one fact
     should derive it from one place, which is the whole point of #998; it is
     not load-bearing, and a comment claiming a harm that cannot occur is what
     the next maintainer would trust. */
  const CONTINUATION = new RegExp(`^(?:[${status.SELECTOR_GLYPHS}]\\s*)?0*${found.length + 1}[.)]\\s+\\S`);
  for (let i = lastRun.at + 1; i < lines.length; i += 1) {
    const bare = lines[i].replace(/^\s*│\s?/, '').replace(/[\s│]+$/, '').replace(/^\s+/, '');
    if (CONTINUATION.test(bare)) return null;
  }
  // Somebody's TUI drew this. Prose does not carry a selection marker.
  if (!marked) return null;
  /**
   * WARNING: NOTHING MAY ASK A NEWER QUESTION BELOW THE MENU.
   *
   * The adjacency and marker rules above say "this is a list something drew".
   * They do NOT say the list belongs to the question being asked now, and a
   * pane accumulates. Measured, on the shape a permission prompt actually
   * leaves behind:
   *
   *     Do you want to proceed?
   *     ❯ 1. Yes
   *       2. No
   *
   *     Build cleaned. Would you like to run the tests now?
   *
   * `questionIn` takes the LAST marker (the prose question at the bottom) and
   * slices from six lines above it, so the ANSWERED menu rides along inside the
   * slice -- adjacent, marked, numbered 1..n. The docblock's repeat rule does
   * not cover this: that one only fires when the live question ALSO draws a
   * menu, and here the live question is prose, which is the exact shape the
   * marker rule was added for.
   *
   * So: if any line BELOW the run is itself a needs-you marker, something newer
   * is being asked and this menu is not its answer. Lines inside the run are
   * excluded, because an option's own label can legitimately contain one
   * ("2. No, and ask permission to continue").
   */
  /* ⚠️ FROM JUST AFTER THE LAST OPTION'S OWN LINE. Starting ON it would refuse
     a menu whose own label says "No, and ask permission to continue" -- that
     is the label's words rather than a newer question, and there is a test for
     exactly it. */
  for (let i = lastRun.at + 1; i < lines.length; i += 1) {
    if (status.ALL_NEEDS_YOU_MARKERS.some((re) => re.test(lines[i]))) return null;
  }

  /**
   * WARNING: A CONTROL CHARACTER REFUSES THE WHOLE MENU rather than one option.
   * A label carrying one cannot be kept (`messageProblem` refuses it on the way
   * into the record), so the button would send the digit and the bubble would
   * silently degrade to a bare "1" -- the record describing a mechanism the
   * person did not use. And a capture with escapes in it is not a screen we
   * understand well enough to put buttons on.
   */
  if (found.some((o) => messageProblem(o.label))) return null;
  found.forEach((o) => { delete o.at; });
  /**
   * ⚠️ THERE IS NO EMPTY-LABEL CHECK HERE, and its absence is deliberate rather
   * than an oversight. One was written, and it could not fail: the pattern's
   * capture is `(\S.*)`, so a matched line always has a non-space first
   * character. `1. ` does not produce an empty label, it produces NO MATCH, and
   * a menu of two such lines lands on the length test above.
   *
   * It was removed rather than left, for the reason 18e removed the dead
   * `.pjthread` declarations: a guard that reads as protection and cannot fire
   * teaches the next reader that the case is handled here. The refusal is real
   * and it is one line up — the test that names it now says which test catches
   * it.
   */
  return found;
}

/* ── what is ours to keep ────────────────────────────────────────────────── */

/**
 * ⚠️ A project id is a path segment here, so it is checked rather than trusted.
 * `projects.idFor` only ever produces `[a-z0-9_-]`, but this module is reached
 * from a URL and "the producer is careful" is not a property of the input a
 * route receives. `..` is the case that matters and this refuses it outright
 * rather than stripping it — a stripped id silently becomes a DIFFERENT
 * thread's file, which is worse than an error.
 */
/**
 * ⚠️ THE LENGTH IS DELIBERATELY GENEROUS, and the reason is a defect rather
 * than a preference. `projects.idFor` now bounds new ids at 64, but this ran at
 * 80 while `cleanName` allowed a 120-character NAME — so a project created
 * before that bound, with a long-but-ordinary name, DELIVERED messages and
 * recorded none of them, under the sentence "that is not a project we can
 * read" about a project the same screen had just listed.
 *
 * The job of this pattern is the CHARSET — refusing `..`, a separator, anything
 * that could point the write at another thread's file. The length is a
 * sanity bound, not the guard, so it sits well above every id the producer can
 * now make and above the historical ones too. Tightening it would re-open a
 * silent no-record for records that already exist on somebody's disk.
 */
const PROJECT_ID = /^[a-z0-9_-]{1,128}$/;

/**
 * The scope token for the thread between the person and ONE agent, which
 * belongs to no project. It is deliberately a value PROJECT_ID refuses (`@` is
 * outside the charset), so a project route can never reach the direct arm by
 * accident: those resolve an id through `projects.get` and 404 before this
 * module is asked anything.
 */
const DIRECT = '@you';

/**
 * ⚠️ The agent name must ALREADY be its own key. `store.safeKey` strips, so
 * `worker.2` and `worker2` collapse to one file — `engine/commitments.js`
 * guards the identical hazard the identical way, and for a thread a collision
 * would show one person's messages under another agent's name.
 */
function threadFile(projectId, agent) {
  const id = String(projectId == null ? '' : projectId);
  const name = String(agent == null ? '' : agent);
  const direct = id === DIRECT;
  if (!direct && !PROJECT_ID.test(id)) throw badRequest('that is not a project we can read');
  let key;
  try { key = store.safeKey(name); } catch { key = null; }
  if (!key || key !== name) throw badRequest('that is not an agent name we can keep a thread under');
  /**
   * ⚠️ TWO DOTS, AND THE SECOND ONE IS THE GUARD. A project id never contains
   * a dot (PROJECT_ID forbids it), so no project thread can ever produce or
   * collide with `direct..<key>.json` — including a real project literally
   * named "Direct", whose file is `direct.<key>.json` with one dot. Reserving
   * the id `direct` in projects.idFor instead would have left every
   * already-existing project of that name colliding on disk; the filename
   * makes the collision impossible rather than merely unlikely.
   *
   * The token itself (`@you`) fails PROJECT_ID, so a project route can never
   * reach this arm by accident: those resolve the id through projects.get
   * first and 404 before chat is asked anything.
   */
  if (direct) return path.join(DIR(), `direct..${key}.json`);
  return path.join(DIR(), `${id}.${key}.json`);
}

function badRequest(message) {
  const err = new Error(message);
  err.code = 'BAD_THREAD';
  return err;
}

/**
 * The person's side of one thread.
 *
 * ⚠️ AN ABSENT FILE IS AN EMPTY THREAD; AN UNREADABLE ONE IS AN ERROR. Those
 * are different facts and `engine/projects.js` learned the difference the hard
 * way — a bare catch there rendered "No projects yet" over a file nobody could
 * read. Nothing here may tell somebody they have said nothing when we simply
 * could not look.
 */
/**
 * @param {string} [bornAt] the project's own `createdAt`. When given, and when
 *   the stored record carries one too, a MISMATCH is refused — see below.
 */
function readThread(projectId, agent, bornAt) {
  const file = threadFile(projectId, agent);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { project: String(projectId), agent: String(agent), messages: [] };
    const unreadable = new Error('we cannot read this conversation on this computer right now');
    unreadable.code = 'UNREADABLE';
    throw unreadable;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNPARSEABLE';
    throw damaged;
  }
  if (!parsed || !Array.isArray(parsed.messages)) {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNPARSEABLE';
    throw damaged;
  }
  // ⚠️ PER-ELEMENT shape too (round 27): `messages: [null]` passed every
  // gate here and threw a TypeError in the page's renderer -- outside its
  // try, unawaited, so the thread area stayed blank forever with the poll
  // re-throwing every five seconds. The stranded-with-no-sentence state is
  // the one this file's whole damage taxonomy exists to remove, and every
  // OTHER damage mode was already first-class. UNPARSEABLE routes it into
  // the existing set-aside-and-start-again repair, so the file is kept.
  /* ⚠️ `from` IS NOT CHECKED HERE, deliberately: absent is the operator, and a
     file written before this field existed is not damaged. What IS checked is
     that a present one is a string, because a non-string reaches the renderer
     and the whole point of this gate is that nothing unrenderable gets past. */
  if (parsed.messages.some((m) => !m || typeof m !== 'object' || typeof m.text !== 'string'
      || (m.from !== undefined && m.from !== null && typeof m.from !== 'string'))) {
    const damaged = new Error('this conversation is there but we cannot make sense of it');
    damaged.code = 'UNPARSEABLE';
    throw damaged;
  }
  /**
   * ⚠️ The record has to say whose it is, and it is checked on the way out.
   * `commitments.read` refuses a record whose stored name does not match for
   * the same reason: a file that ends up under the wrong key by any route at
   * all must not be rendered as this agent's conversation.
   */
  if (parsed.agent !== String(agent)) {
    const wrong = new Error('this conversation is filed under a different agent');
    wrong.code = 'UNPARSEABLE';
    throw wrong;
  }
  /**
   * ⚠️ THE SAME NAME IS NOT THE SAME PROJECT, and without this the messages
   * come back attached to work they were never about.
   *
   * A project id is derived from its NAME, and removing a project frees the id.
   * So: make "Henderson lease", say six things to Mara about the lease, remove
   * the project, make a new "Henderson lease" months later for a different
   * building — and the thread opens holding the old conversation, under the new
   * project's heading, as though it had been said about this work. Nothing on
   * screen would suggest otherwise.
   *
   * The project's own `createdAt` distinguishes them, and a mismatch is refused
   * exactly like the agent mismatch above. NOTHING IS DELETED: the record stays
   * on disk, and the sentence says the messages exist and belong to a project
   * that had this name before. `appendMessage` is what moves the old file aside
   * so the new project can keep its own conversation — a refusal alone would
   * leave the new thread permanently unable to record anything, which would be a
   * worse bug than the one being fixed.
   *
   * ⚠️ ONLY when BOTH stamps are present. A record written before this existed
   * carries none, and inventing a mismatch for it would refuse a conversation
   * that is very probably this project's own.
   */
  if (bornAt && parsed.projectBornAt && parsed.projectBornAt !== String(bornAt)) {
    const other = new Error('these messages were sent to an earlier project that had this name, '
      + 'so we are not showing them here. They are still on this computer.');
    other.code = 'OTHER_PROJECT';
    throw other;
  }
  return {
    project: String(projectId),
    agent: String(agent),
    messages: parsed.messages,
    projectBornAt: parsed.projectBornAt || null,
    // kosmos#5841: the name of the full file this one continues (a rollover at MAX_MESSAGES), or null.
    continues: typeof parsed.continues === 'string' && parsed.continues ? parsed.continues : null,
    // kosmos#5841: how many leading rows are COPIES of the end of the file it continues (carried at a rollover).
    carried: parsed.continues && Number.isInteger(parsed.carried) && parsed.carried >= 0 && parsed.carried <= parsed.messages.length ? parsed.carried : 0,
  };
}

/**
 * Add one of the person's messages, with the verdict on delivering it.
 *
 * ⚠️ RECORDING AND DELIVERING ARE TWO ACTS AND TWO SENTENCES. This is called
 * AFTER the send, with whatever the send answered, so a failed delivery is
 * still written down: "I asked casey this and it did not get there" is a thing
 * the person needs to be able to see later, and a thread that only remembers
 * the successes is a thread that quietly rewrites history.
 *
 * ⚠️ AND IT NEVER THROWS ON A FULL OR UNWRITABLE STORE. It answers
 * `{recorded: false, because}` so the route can report the delivery and the
 * recording separately. A message that went through and could not be written
 * down must not come back looking like a message that was not sent.
 */
/**
 * Hold the thread file while it is read, changed and written back.
 *
 * ⚠️ `appendMessage` IS A READ-MODIFY-WRITE, and without this two windows lose
 * a message. Both read a thread of five, both append their own sixth, both
 * rename their seven-message file into place, and the second one wins — the
 * first person's message is delivered to the agent and then vanishes from the
 * record of it. Silent, and unrecoverable from the screen.
 *
 * ⚠️ `mkdir` IS THE LOCK, which is the same primitive the fleet's own
 * `claude-msg` transport uses for the same reason: it is atomic on every
 * filesystem this product runs on, needs no cleanup daemon, and its failure
 * mode is a refusal rather than a corrupt file. `writeFileSync` with `wx` would
 * do as well; `mkdir` is chosen because the pattern already exists here.
 *
 * ⚠️ A STALE LOCK EXPIRES. A process killed between `mkdir` and `rmdir` would
 * otherwise wedge that one conversation forever, so a lock older than the bound
 * is broken rather than waited on — the window it protects is two file
 * operations, so anything older is debris rather than a live writer.
 * (The lock itself now lives in engine/filelock.js, kosmos#1823; withThreadLock
 * below delegates to it. This rationale is kept because the wait below is still
 * paid on chat.js's own thread.)
 */

/**
 * Pause without a subprocess.
 *
 * ⚠️ THIS WAS `execFileSync('/bin/sleep')` AND IT BROKE THE MODULE'S CONTRACT.
 * `appendMessage` promises never to throw — a recording failure is REPORTED,
 * because it is reached with a message that has already been delivered. An
 * unguarded subprocess spawn breaks that promise the moment the machine is out
 * of process slots or `/bin/sleep` is not where it is expected: the throw
 * escapes to the route's 400 handler and a DELIVERED message is reported to the
 * person as a failed send. That is precisely the inversion the contract exists
 * to prevent, introduced by the fix for a different one.
 *
 * `Atomics.wait` on a private buffer blocks this thread for the timeout with no
 * process, no file descriptor and nothing to throw.
 *
 * ⚠️ AND IT BLOCKS THE WHOLE SERVER, which is single-threaded: while one
 * request waits out lock contention (up to ~2s, filelock's LOCK_WAIT_MS), every other
 * request on the machine stalls behind it. Bounded and rare (the lock is
 * per-thread-file and held for one read-modify-write), and far better than
 * the 15-second unbounded spin it replaced -- but a wait here is everybody
 * waiting, which is the cost to weigh before raising the lock wait. And the
 * lock is the SMALL half of the request's blocking budget: deliver's tmux
 * path is up to three execFileSync calls at 5s timeout each (probe, text,
 * Enter), so a wedged tmux stalls the whole board ~15s on its own. ⚠️ A
 * NUMBERED ANSWER ADDS A FOURTH: the route reads the pane once more to check
 * the words against the menu before sending, so that path is ~20s. The number
 * in this sentence has already been wrong once by being left behind when a
 * call was added.
 * Consistent with the codebase's synchronous design; named so the number
 * being watched is the real one (round 19).
 */
const PARK = new Int32Array(new SharedArrayBuffer(4));
function pauseMs(ms) {
  Atomics.wait(PARK, 0, 0, ms);
}

/* The paste→Enter gap (#3419), resolved once so its test seam and its
 * production behaviour cannot drift.
 *   - An injected `pauser` (the test seam, like `runner` for tmux) always wins,
 *     so a test that wants to ASSERT the gap records it without sleeping.
 *   - With NO pauser but an injected `runner`, tmux is stubbed — there is no
 *     real pane whose paste we are waiting to flush — so the real sleep is
 *     pointless and is SKIPPED. This keeps the synchronous board (and the
 *     ~8k-test suite) from paying a real 250ms+ per send against a fake tmux;
 *     the gap exists for a live TUI, which by definition has runner=null.
 *   - Production (runner=null, pauser=null) takes the real `pauseMs` wait.
 *
 * #4468: HTTP messages and posts call `deliverAsync`, whose timer preserves
 * this full gap while letting the board answer other requests. Internal
 * synchronous callers keep this function and its old return contract. A room
 * fanout remains sequential so recipient order does not change. Parallel
 * fanout is a separate performance choice, not part of removing the measured
 * event-loop block. */
function submitGap(ms) {
  if (pauser) { pauser(ms); return; }
  if (runner) return; // stubbed tmux (tests): no real pane to wait on
  pauseMs(ms);
}

function withThreadLock(file, fn) {
  // Delegates to the shared primitive (kosmos#1823). `busy` and `cannotAccess`
  // are this module's own messages; the rename-steal, age-staleness, owner-token
  // release and umask chmod now live in engine/filelock.js, the one home for a
  // lock chat.js and sendertoken.js had each copied.
  return withFileLock(file, fn, {
    busy: lockedBecause,
    cannotAccess: 'we could not get exclusive access to this conversation',
  });
}

/**
 * ⚠️ ONE SENTENCE, BECAUSE WE CANNOT TELL THE TWO APART. The wait is 2s and a
 * lock is only called stale after 10s, so for eight seconds a lock left behind
 * by a window that CRASHED was being described as "another window is writing to
 * this conversation right now" — a confident claim about a process that is not
 * running.
 *
 * A first fix branched on the lock's age, and that branch was almost never
 * taken: by the time we give up, we have waited the full 2s, so the lock is
 * essentially always older than the wait. A distinction that is real in
 * principle and unreachable in practice is worse than none, because it reads as
 * though something was determined. We waited, somebody else holds it, and we do
 * not know whether they are still there — so that is what it says.
 */
function lockedBecause() {
  return 'this conversation is locked by another window, or by one that stopped part-way through a send';
}

/**
 * #3419: the agent's live `needs_you` question rendered AS A THREAD MESSAGE, not
 * only as the interruptive "waiting on an answer" banner.
 *
 * Pure and view-level: it takes the messages the route already read plus the
 * question the route already derived (live `questionIn`, or the reported
 * fallback), and returns the messages with a synthetic question row added: appended
 * last when undated, placed at its time when dated (#5943, see below).
 * NOTHING is persisted — the question is derived live each poll, exactly like the
 * `asking`/`question` banner fields it replaces, so this row appears while the
 * question stands and clears with the state (the state-keyed lifecycle
 * PigeonPete's #3417-categoryB pointer asks for, not a stored history entry).
 *
 * The row carries only what marks it as the agent speaking: `from: <agent>`,
 * `delivery: null` (no delivery verdict; set explicitly where an agent reply omits
 * the field, both falsy), `kind: 'question'` for the UI to key on, and `reported`
 * so the page can distinguish "the agent told us this" from "it is on screen". How
 * the thread RENDERS such a row is described in the plan, not asserted here, since
 * Mona's #3419 UI half reworks that path (repo convention #5).
 *
 * CONTRACT the engine relies on. The web-render specifics (which renderer, which
 * repaint key, which "just spoke" loop) live in the plan, per repo convention #5:
 * cross-module behavioural assertions go stale silently in a shipped comment, and
 * Mona's #3419 UI half reworks that exact render path. The engine depends only on
 * these two invariants:
 *   - STABLE `id` (`needs-you-question:<agent>`): a needs_you question is a
 *     STANDING STATE, so one row per agent whose identity does not vary across
 *     polls. Stored messages carry no `id`, so this cannot collide with a real row,
 *     and a stable id lets the bubble update its text in place as the question
 *     changes rather than churning the thread's repaint key.
 *   - NO per-poll `at`. ⚠️ Do NOT stamp the row with the clock: it would churn the
 *     thread's repaint key every ~5s (breaking the #1926 anchor for a reader on the
 *     question) and re-stamp the agent as having "just spoken" while it is WAITING.
 *     #5943: a REPORTED question passes `question.at`, when it was first asked (a
 *     fixed time, so neither problem arises), and the row is dated with it and placed
 *     in time (see the function). A question read off the screen alone has no such
 *     time and stays dateless and last. The page does not count the row as speech.
 *
 * DEDUP (undated): only the TRAILING real row is compared by text. If the agent typed its
 * own question (or any same-text row trails), no synthetic row is added -- the
 * question is already shown. A same-text question sitting further back with a
 * newer real row after it is NOT deduped -- a rare transient double that clears
 * when the needs_you state clears and co-lands away with the banner removal, so it
 * is not worth a full-thread scan that could over-suppress a legitimately repeated
 * question. Returns the input unchanged when there is no question.
 */
// The synthetic question row's stable id prefix. One standing-question row per
// agent (see withQuestionRow); a fixed prefix so the id does not vary across
// polls. Stored messages carry no `id`, so this cannot collide with a real row.
const NEEDS_YOU_QUESTION_ID_PREFIX = 'needs-you-question:';
const QUESTION_TYPED_BEFORE_MS = 60000;   // #5943 review 1: a reply of the same words just before the report

function withQuestionRow(messages, agentName, question) {
  const list = Array.isArray(messages) ? messages : [];
  if (!question || typeof question.text !== 'string' || !question.text) return list;
  const row = {
    id: NEEDS_YOU_QUESTION_ID_PREFIX + String(agentName),
    at: null,
    text: question.text,
    from: String(agentName),
    delivery: null,
    kind: 'question',
    reported: Boolean(question.reported),
    ...(question.clearable === true ? { clearable: true } : {}),
  };
  /* #5943: a question the agent REPORTED carries when it was first asked (selfreport askedAt). That time is stable
     across polls, so it is not the per-poll clock the note above forbids: the row takes its place in time, and the
     person's answer and everything after it sit below it instead of under it. Undated (a question read off the screen
     alone) keeps the old rule: appended last, deduped against the trailing row only. */
  const askedMs = typeof question.at === 'string' ? Date.parse(question.at) : NaN;
  if (!Number.isFinite(askedMs)) {
    const last = list.length ? list[list.length - 1] : null;
    if (last && typeof last.text === 'string' && last.text === question.text) return list;
    return list.concat([row]);
  }
  // The agent typed the same words itself at or after the ask, or in the minute before it (posted, then reported):
  // the question is already in the thread.
  const typedAt = list.findIndex((m) => m && m.from === row.from && m.text === question.text
    && Number.isFinite(Date.parse(m.at)) && Date.parse(m.at) >= askedMs - QUESTION_TYPED_BEFORE_MS);
  if (typedAt >= 0) {
    if (!row.clearable) return list;
    /* Review 2: not drawn twice, but the person must still be able to see its age and clear it: the agent's own message
       carries both (a copy; the stored row is untouched). */
    const out = list.slice();
    out[typedAt] = { ...list[typedAt], questionClearable: true, questionAt: new Date(askedMs).toISOString() };
    return out;
  }
  // After the last row dated at or before the ask (a row with no readable time does not move it).
  let place = 0;
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i] ? Date.parse(list[i].at) : NaN;
    if (Number.isFinite(t) && t <= askedMs) place = i + 1;
  }
  row.at = new Date(askedMs).toISOString();
  return list.slice(0, place).concat([row], list.slice(place));
}

/**
 * #3723: Kosmos's own line in an agent's Direct Message thread while the agent is stopped by its
 * account (engine/accountproblem.js). Like withQuestionRow it is NOT stored: it is derived from the
 * agent's card on every read, so there is exactly one line per problem and it goes away by itself
 * the moment the card no longer shows the problem. `kind: 'kosmos'` draws it as Kosmos's quiet band,
 * not as a message from the agent or the person.
 */
const ACCOUNT_ROW_ID_PREFIX = 'kosmos-account:';
function withAccountRow(messages, agentName, problem) {
  const list = Array.isArray(messages) ? messages : [];
  if (!problem || typeof problem.text !== 'string' || !problem.text) return list;
  return list.concat([{
    id: ACCOUNT_ROW_ID_PREFIX + String(agentName),
    at: null,
    text: problem.text,
    from: null,
    delivery: null,
    kind: 'kosmos',
  }]);
}

function appendMessage(projectId, agent, entry, bornAt) {
  // ⚠️ EVERYTHING from the read to the rename happens inside the lock. Holding
  // it for the write alone would not help: the loss is in the gap between the
  // read and the write, not in the write itself.
  let file;
  try { file = threadFile(projectId, agent); }
  catch (err) { return { recorded: false, because: String((err && err.message) || 'we could not find that conversation') }; }
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  catch { /* the write below reports what it cannot do */ }
  /**
   * ⚠️ THE NEVER-THROWS PROMISE IS HELD BY CODE, not by the docblock that makes
   * it. Everything below runs with a message that has ALREADY BEEN DELIVERED,
   * so a throw escaping here reaches the route's 400 handler and reports a
   * delivered message as a failed send — the one inversion this contract
   * exists to prevent. `pauseMs` was an unguarded subprocess spawn once for
   * exactly this reason; a promise that depends on nothing inside ever throwing
   * again is a promise waiting to be broken by the next edit.
   */
  let held;
  try {
    held = withThreadLock(file, () => appendLocked(projectId, agent, entry, bornAt));
  } catch {
    return { recorded: false, because: 'we could not write this conversation down on this computer' };
  }
  if (!held.ok) return { recorded: false, because: held.because };
  return held.value;
}

/** An attachment record by its known fields (what is CHECKED is what is KEPT). */
function keptAttachment(a) {
  return {
    id: a.id, name: String(a.name || ''), type: String(a.type || ''),
    size: Number(a.size) || 0, kind: String(a.kind || 'other'),
    url: String(a.url || ''), preview: a.preview == null ? null : String(a.preview),
  };
}
function appendLocked(projectId, agent, entry, bornAt) {
  let existing;
  let supersededBecause = null;
  let otherProject = false;   // kosmos#5841
  let rolledAside = null;   // kosmos#5841: the rollover's set-aside ({ aside, linked }), undone if the write then fails
  try {
    existing = readThread(projectId, agent, bornAt);
  } catch (err) {
    if (err && err.code === 'OTHER_PROJECT') {
      /**
       * ⚠️ MOVED ASIDE, NEVER DELETED, and never appended to either.
       *
       * The file under this key belongs to an earlier project that had this
       * name (see `readThread`). Appending would mix two projects' conversations
       * into one record; refusing forever would leave this project unable to
       * keep a single message, which is a worse bug than the one being fixed.
       * So the old record is RENAMED out of the way — every word of it still on
       * disk — and this project starts its own.
       *
       * A failure to move it is not a failure to send: we say we could not
       * record, and the old file stays exactly as it was.
       */
      const moved = supersede(projectId, agent, 'superseded');
      if (!moved.ok) {
        return { recorded: false, because: moved.because };
      }
      existing = { messages: [] };
      supersededBecause = 'an earlier project had this name; its messages have been kept aside.';
      otherProject = true;   // kosmos#5841: a new conversation, never reattached to the old one's full files
    } else if (err && err.code === 'UNPARSEABLE') {
      /**
       * ⚠️ A DAMAGED FILE LOCKED RECORDING OUT FOREVER, and the argument
       * against that is already written three paragraphs up: refusing forever
       * is a worse bug than the one being fixed. A thread file that will not
       * parse is not a thread we can add to — and it is also not a reason for
       * this conversation to stop being kept for the rest of time. Every send
       * after the damage was delivered and silently unrecorded.
       *
       * Same treatment, different suffix: the damaged file is RENAMED aside
       * (nothing deleted, in case a person or a tool can still salvage it) and
       * this conversation starts again. The suffix differs from the
       * `projectBornAt` one on purpose, so the two kinds of aside can never be
       * mistaken for each other on disk or collide.
       *
       * ⚠️ `UNPARSEABLE`, NOT `UNREADABLE`, AND THE SPLIT IS THE WHOLE POINT.
       * The first version of this branch caught both, and `readThread` throws
       * `UNREADABLE` for a `readFileSync` that failed on an INTACT file —
       * EACCES, EMFILE, EIO. Measured: `chmod 000` on a healthy six-message
       * thread plus one send renamed it aside as `.damaged` and replaced the
       * conversation with an empty one, while the screen asserted damage
       * nothing had established. A transient permission problem is not a
       * corrupt file, and the destructive repair for one must never fire for
       * the other.
       *
       * `readThread` was already writing two different SENTENCES for these two
       * cases ("we cannot read this conversation right now" versus "it is there
       * but we cannot make sense of it"); the distinction existed in the prose
       * and not in the code. It is in the code now.
       */
      const moved = supersede(projectId, agent, 'damaged');
      if (!moved.ok) {
        return { recorded: false, because: moved.because };
      }
      existing = { messages: [] };
      supersededBecause = 'an earlier damaged file was set aside, and this conversation started again.';
    } else {
      return { recorded: false, because: String((err && err.message) || 'we could not read this conversation to add to it') };
    }
  }
  if (existing.messages.length >= MAX_MESSAGES) {
    /* kosmos#5841: ROLL OVER rather than stop. The full file is SET ASIDE (`supersede`, kind 'full': hard-linked under
       the aside name and the new file written over the original, or renamed where a link cannot be made; nothing is
       deleted, so "nothing of the user's is ever deleted" still holds) and the conversation goes on in a fresh file
       that names it (`continues`), so the earlier messages stay reachable (asideChain, the older route). Before this,
       a full thread refused every later send for good. If the move aside fails, it refuses as before, saying why. */
    const moved = supersede(projectId, agent, ROLL_KIND, true);
    if (!moved.ok) {
      return {
        recorded: false,
        because: `this conversation has reached the ${MAX_MESSAGES} messages Kosmos keeps in one file, and ${moved.because}`,
      };
    }
    /* The last ROLL_CARRY rows are COPIED into the new file (`carried` says how many), so every reader of recent rows
       in the current file (the first-reply nudge, reactions, replies, held deliveries, the agent's inbox, the view's
       tail) keeps working unchanged. The full file keeps them too; the chain skips the overlap, so nothing doubles. */
    const carry = existing.messages.slice(-ROLL_CARRY);
    existing = { messages: carry, projectBornAt: existing.projectBornAt || null, continues: path.basename(moved.aside), carried: carry.length };
    rolledAside = moved;
    ASIDE_META.delete(path.basename(moved.aside));
  } else if (!existing.continues && !existing.messages.length && !otherProject) {
    /* An EMPTY current file with this conversation's own full files on disk (a crash between a rollover's rename and
       its write, or a DAMAGED current file set aside): continue from the newest, so the earlier messages are not
       orphaned. Never when the file was just set aside for ANOTHER project: that is a new conversation. And only a
       file of THIS conversation (same projectBornAt). */
    const newest = newestOwnAside(projectId, agent, existing.projectBornAt || (bornAt ? String(bornAt) : null));
    if (newest) existing = { ...existing, continues: newest };
  }
  const record = {
    project: String(projectId),
    agent: String(agent),
    // Stamped so a LATER project that reuses this name cannot inherit these
    // messages. Carried forward when the record already had one, so an existing
    // conversation is not re-stamped by a read that happened to know the date.
    projectBornAt: existing.projectBornAt || (bornAt ? String(bornAt) : null),
    // kosmos#5841: kept on every write, so the chain to the earlier files is never dropped.
    ...(existing.continues ? { continues: existing.continues } : {}),
    ...(existing.continues && existing.carried ? { carried: existing.carried } : {}),
    messages: [...existing.messages, {
      at: (entry && entry.at) || new Date().toISOString(),
      // #1927: store the paragraph-preserving shape. `deliver` still flattens
      // for the pane; `wire` (one field down) stays flattened because it is the
      // single-line thing that was actually typed (a menu digit).
      text: storeText(entry && entry.text),
      /**
       * 🛑 WHO SPOKE, AND THE ABSENCE OF THIS FIELD IS WHY AN AGENT COULD NOT
       * ANSWER AT ALL. Every row in a thread was the operator's by definition
       * — the readers stamp `kind: 'operator'` on the way out — so the format
       * had no way to represent a reply, and there was nothing for a command
       * to write into. A person said hello, watched the answer appear in the
       * agent's terminal, and waited (#175).
       *
       * ⚠️ ABSENT MEANS THE OPERATOR, and that is load-bearing rather than
       * tidy: every thread file already on a person's disk was written without
       * this field, and they must go on rendering exactly as they do now. A
       * required field would have made the change a migration.
       *
       * ⚠️ AND IT IS THE SESSION NAME, never a display name. The log holds what
       * the wire holds; display-name resolution happens at the surface, which
       * is the same rule `send` follows.
       */
      from: (entry && typeof entry.from === 'string' && entry.from.trim())
        ? entry.from.trim() : null,
      /**
       * ⚠️ WHAT WAS TYPED, when it is not what the bubble shows. A numbered
       * answer sends the digit the agent's prompt is waiting for and shows the
       * option's own words, so `text` alone would either read as a bare "1" a
       * week later or misdescribe the mechanism. Null on every message the
       * person TYPES, because there the two are the same thing; set only by a
       * button send. (It said "every message today" when written, which stopped
       * being true in the same branch that wrote it.)
       */
      /* ⚠️ THROUGH `cleanMessage`, LIKE `text` ONE FIELD UP. This module's
         contract is that what was CHECKED is what gets KEPT, and for `wire`
         the checking lived entirely in the one caller: an engine that claims
         the guarantee was taking this field on trust. A no-op for every value
         produced today (the digit), which is exactly when to move a guarantee
         back inside the thing that promises it. */
      wire: (entry && typeof entry.wire === 'string' && cleanMessage(entry.wire)) || null,
      /* An attached document (#358): the record the page draws against,
         kept by its known fields for the same reason `wire` is re-checked:
         what is CHECKED is what gets KEPT. `preview` is null, never absent. */
      ...(entry && entry.attachment && typeof entry.attachment === 'object' && typeof entry.attachment.id === 'string'
        ? { attachment: keptAttachment(entry.attachment) }
        : {}),
      ...(entry && Array.isArray(entry.attachments) && entry.attachments.length
        ? { attachments: entry.attachments.filter((a) => a && typeof a === 'object' && typeof a.id === 'string').map(keptAttachment) }
        : {}),
      /* #4256: the message this one answers, by its `at` (a DM row has no id). The route has already
         checked it names a message in this conversation; kept only as a string, and only when set. */
      ...(entry && typeof entry.replyTo === 'string' && entry.replyTo ? { replyTo: entry.replyTo } : {}),
      /* #4354: Kosmos's own words written in the agent's name (the daily-limit notice). dmOwes counts such a row as
         the agent having said something only while it stands (noticeStands: paused, and written in this pause). Kept only as `true`, and only when set: every
         row already on disk reads as the agent's own words, as it always has. */
      ...(entry && entry.kosmos === true ? { kosmos: true } : {}),
      /**
       * 🛑 A ROW WITH A SENDER HAS NO DELIVERY, and the default here was
       * claiming one. `state` falls back to COULD_NOT — which is right for the
       * person's messages, where the fallback means "we have no evidence it
       * arrived" — and an agent's reply is written straight into this record.
       * There is no crossing to fail, so COULD_NOT is a claim about a mechanism
       * that never ran.
       *
       * ⚠️ IT WAS NOT VISIBLE ON THE SCREEN, which is why this is worth
       * spelling out: `dmRow` skips the verdict for these rows, so the box
       * looked correct. The CONVERSATION view does not — it reads
       * `m.delivery.state` straight out, and would have printed "Not sent."
       * under a reply that arrived. Found by running an append and reading the
       * record back, not by looking at the page.
       */
      delivery: (entry && typeof entry.from === 'string' && entry.from.trim()) ? null : {
        state: (entry && entry.delivery && entry.delivery.state) || DELIVERY.COULD_NOT,
        because: (entry && entry.delivery && entry.delivery.because) || null,
        /**
         * ⚠️ THE PANE'S STATE IS KEPT WITH THE MESSAGE, not just shown once.
         * "It was mid-task when you sent this" is the answer to the question
         * somebody asks an hour later — why did nothing happen? — and a note
         * that lives only in the moment of sending cannot answer it. It is a
         * record of what was observed then, which is why the sentence is past
         * tense and stays past tense on every later read.
         */
        paneState: (entry && entry.delivery && entry.delivery.paneState) || null,
        paneNote: (entry && entry.delivery && entry.delivery.paneNote) || null,
        // #5805 slice 2b: a held row keeps when it is to be sent (null when no time is known).
        ...(entry && entry.delivery && entry.delivery.state === 'held' ? {
          heldUntil: typeof entry.delivery.heldUntil === 'string' ? entry.delivery.heldUntil : null,
          ...(entry.delivery.behind === true ? { behind: true } : {}),   // held behind kept messages, not on the limit
          // #6774: why it is held (#5948 signed out, #6774 a stuck input box), so a reloaded page says the same words.
          ...(entry.delivery.heldFor === 'signin' || entry.delivery.heldFor === 'input' ? { heldFor: entry.delivery.heldFor } : {}),
          ...(entry.delivery.behindFor === 'input' ? { behindFor: 'input' } : {}),
        } : {}),
        // #6774: a re-send not sent because the same words were already kept above (the page words it so).
        ...(entry && entry.delivery && typeof entry.delivery.duplicateOf === 'string' ? { duplicateOf: entry.delivery.duplicateOf } : {}),
        // kosmos#6720: a person's plain message that did not go, kept as one Try again may send (the route decides).
        ...(entry && entry.delivery && entry.delivery.state === DELIVERY.COULD_NOT && entry.delivery.retryable === true ? { retryable: true } : {}),
      },
    }],
  };
  try {
    const file = threadFile(projectId, agent);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename, like every other record in this store: an interrupted
    // write must not leave a half-written file that parses as no messages and
    // silently loses the lot.
    // #5434 slice 18: store.saveFlushed (flushed before the rename, the folder after on POSIX; a unique temp), so a crash cannot leave the thread at full length but zero-filled (#5431), which parses as no messages.
    store.saveFlushed(file, JSON.stringify(record, null, 2));
  } catch {
    /* kosmos#5841: a rollover set the full file aside and the write of the new one failed: undo it, so the conversation
       is as it was (it was not written; nothing is lost either way). */
    if (rolledAside) {
      try {
        const tf = threadFile(projectId, agent);
        /* Linked: the full file is still in place, so only the extra name goes, and ONLY while both names are still
           the same file. Had the save replaced the original before it threw, the aside would be the full file's only
           name, and removing it would delete the rows that were not carried. Renamed: move it back. */
        if (rolledAside.linked) {
          // bigint: a Windows (NTFS) file id can pass 2^53, where a plain number could make two files compare equal.
          const a = fs.statSync(rolledAside.aside, { bigint: true }); const c = fs.statSync(tf, { bigint: true });
          if (a.ino === c.ino && a.dev === c.dev) fs.unlinkSync(rolledAside.aside);
        }
        else if (!fs.existsSync(tf)) fs.renameSync(rolledAside.aside, tf);
      } catch { /* the reattach covers it on the next send */ }
    }
    /**
     * ⚠️ OUR SENTENCE, NOT THE ERRNO. Forwarding `err.message` put
     * "EISDIR: illegal operation on a directory, open '/var/folders/rn/…/
     * lease.casey.json.4821.new'" on screen — an error code and an internal
     * temp path, to somebody who wanted to message their agent. `folderState`
     * has answered these in plain language since the day it shipped; this is
     * the same rule for the same reason. The detail is dropped rather than
     * appended: there is nothing in it a person can act on.
     *
     * ⚠️ AND THE ASIDE IS REPORTED EVEN THOUGH THE WRITE FAILED. `supersede`
     * may already have RENAMED an earlier project's conversation out of the
     * way — a change to somebody's disk — and only the success return carried
     * word of it, so that move could happen with no sentence anywhere. It
     * travels on both returns now.
     */
    return {
      recorded: false,
      because: 'we could not write this conversation down on this computer',
      supersededBecause,
    };
  }
  return { recorded: true, because: null, messages: record.messages, supersededBecause };
}

/** kosmos#5841: the kind a rolled-over full thread file is set aside under. */
const ROLL_KIND = 'full';
/** kosmos#5841: rows copied into the new file at a rollover (the view's tail is 200). */
const ROLL_CARRY = 200;
/* A rolled-over file's count and the name it continues, by name. A `.full` aside is never written again, so what is
   read once stays true: the 5 s poll re-reads only the CURRENT file, not the earlier ones. */
const ASIDE_META = new Map();

/**
 * kosmos#5841: the files a conversation CONTINUES, oldest first: each is a thread file set aside full at
 * MAX_MESSAGES (`continues` names the one before). Returns [{ name, carried, messages }] when `withRows` (ALL its rows;
 * `chainRows` merges them), else [{ name, carried, count }] where count is its OWN rows (length minus the rows it
 * carried from the file before it). A name is followed ONLY if it is this thread's own `.full` aside (the same
 * directory, the thread file's name as its prefix, no separator, the ROLL_KIND suffix) AND it belongs to the same
 * conversation: the same agent and the same `projectBornAt` (a project deleted and re-created under its name must not
 * inherit the old one's messages, which is what bornAt guards everywhere else), or no `projectBornAt` at all
 * (kosmos#5900: a file written before conversations were dated, read as readThread reads one). That reading has
 * readThread's cost: a project from before dates, deleted and re-created under its name, reaches the old one's
 * undated files too. A cycle or a broken link ends the
 * chain where it is: what was read is kept, nothing is invented. A count is taken from the cache only while its file
 * has the same size and modification time.
 */
function asideChain(projectId, agent, withRows, from, bornAt) {
  const file = threadFile(projectId, agent);
  const dir = path.dirname(file);
  const base = path.basename(file);
  const ok = (n) => typeof n === 'string' && n.startsWith(base + '.') && n.endsWith('.' + ROLL_KIND)
    && !n.includes('/') && !n.includes('\\') && n.length < 300;
  // `from`/`bornAt`: what the caller already read with the current file (one read, so a rollover in between cannot
  // double the rows); otherwise read them here.
  let next = from;
  let born = bornAt === undefined ? undefined : (bornAt || null);
  if (next === undefined || born === undefined) {
    try { const cur = readThread(projectId, agent); if (next === undefined) next = cur.continues; if (born === undefined) born = cur.projectBornAt || null; }
    catch { return []; }
  }
  const out = [];
  const seen = new Set();
  while (ok(next) && !seen.has(next) && out.length < 1000) {
    seen.add(next);
    const known = ASIDE_META.get(next);
    let st = null; try { st = fs.statSync(path.join(dir, next)); } catch { st = null; }
    if (known && !withRows && (known.born === born || known.born === null) && st && st.size === known.size && st.mtimeMs === known.mtime) {
      if (known.born === null) born = null;
      out.unshift({ name: next, carried: known.carried, count: known.count });
      next = known.continues;
      continue;
    }
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, next), 'utf8')); } catch { break; }
    if (!rec || rec.agent !== String(agent) || !Array.isArray(rec.messages)) break;
    // Another conversation's file is never part of this chain. kosmos#5900: a file with NO date is followed when this
    // conversation's link names it, as readThread reads an undated file (a mismatch only when both are dated). After
    // the first undated file, only undated files can follow: appendMessage keeps a date once a file has one, so an
    // undated file's predecessor is undated too.
    const recBorn = rec.projectBornAt || null;
    if (recBorn !== born) {
      if (recBorn !== null) break;
      born = null;
    }
    const cont = typeof rec.continues === 'string' ? rec.continues : null;
    const rows = rec.messages.filter((m) => m && typeof m === 'object' && typeof m.text === 'string');
    const carried = cont && Number.isInteger(rec.carried) && rec.carried > 0 ? Math.min(rec.carried, rows.length) : 0;
    ASIDE_META.set(next, { count: rows.length - carried, carried, continues: cont, born: recBorn, size: st ? st.size : -1, mtime: st ? st.mtimeMs : -1 });
    out.unshift(withRows ? { name: next, carried, messages: rows } : { name: next, carried, count: rows.length - carried });
    next = cont;
  }
  return out;
}

/**
 * kosmos#5841: the whole conversation, oldest first, from `asideChain(..., true)` plus the current file. Each file's
 * first `carried` rows COPY the end of the file before it; the overlap is served from the NEWER copy (the later file,
 * the current one last), because only the newest copy gets edits made after the rollover (a reaction, a delivery
 * state). Position of a row is its index here, the same as the thread route's count.
 */
function chainRows(earlier, currentRows, currentCarried) {
  const out = [];
  const add = (rows, carried) => {
    if (!carried) { out.push(...rows); return; }
    // The first file read may itself have carried rows from a file the walk could not follow: those positions are
    // dropped here as the counts drop them (count = own rows), so both routes agree on every position.
    if (!out.length) { out.push(...rows.slice(carried)); return; }
    out.splice(Math.max(0, out.length - carried), carried);
    out.push(...rows);
  };
  for (const a of earlier) add(a.messages, a.carried);
  add(Array.isArray(currentRows) ? currentRows : [], earlier.length ? (currentCarried || 0) : 0);
  return out;
}

/* kosmos#5841: this thread's own newest `.full` file on disk (by the rename time in its name), or null. */
function newestOwnAside(projectId, agent, born) {
  let file;
  try { file = threadFile(projectId, agent); } catch { return null; }
  const dir = path.dirname(file); const base = path.basename(file);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const found = [];
  for (const n of names) {
    if (!n.startsWith(base + '.') || !n.endsWith('.' + ROLL_KIND)) continue;
    /* Ordered by the time IN THE NAME (supersede stamps the rename's millisecond: <file>.<stamp>.<pid>.<ms>[.<n>].full),
       not the file's mtime, which a backup, a copy or a restore can move. */
    const ms = (n.slice(base.length).match(/\.(\d{13})(?:\.\d+)?\.[a-z]+$/) || [])[1];
    found.push({ n, at: ms ? Number(ms) : -1 });
  }
  found.sort((a, b) => b.at - a.at);
  for (const { n } of found) {
    // Only a file of THIS conversation: the same agent and the same projectBornAt.
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (rec && rec.agent === String(agent) && (rec.projectBornAt || null) === (born || null)) return n;
    } catch { /* unreadable: not this one */ }
  }
  return null;
}

/**
 * Move an earlier project's thread out of the way, keeping every word of it.
 *
 * ⚠️ A RENAME, and the destination name never collides: it carries the stamp of
 * the project the messages belonged to, plus the pid, so two windows doing this
 * at once cannot rename over each other. If the destination somehow exists, we
 * refuse rather than overwrite — this whole function exists so that nothing of
 * the person's is lost, and clobbering the file we are rescuing would be the
 * one way to fail at that.
 */
function supersede(projectId, agent, kind, keepInPlace) {
  let file;
  try { file = threadFile(projectId, agent); }
  catch (err) { return { ok: false, because: String((err && err.message) || 'we could not find that conversation') }; }
  let stamp = 'earlier';
  try {
    const was = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (was && was.projectBornAt) stamp = String(was.projectBornAt).replace(/[^0-9A-Za-z-]/g, '');
  } catch { /* the name is a label, not a lookup key */ }
  /**
   * ⚠️ THE KIND is in the name: a file set aside because a previous project had
   * this name is a different thing from one set aside because it was damaged,
   * and a person looking at the directory should be able to tell.
   *
   * ⚠️ AND THE NAME MUST BE UNIQUE, which the first version was not — it
   * reopened the very lockout it was written to fix, one occurrence later.
   * `stamp` falls back to the literal `'earlier'` for a DAMAGED file (there is
   * no `projectBornAt` to read out of a file that will not parse), so
   * `<file>.earlier.<pid>.damaged` was a CONSTANT for one project+agent inside
   * one server process. Measured: a second sequential damage computed the same
   * path, hit the `existsSync` guard, and answered `recorded: false` for good.
   *
   * The bounded counter is what makes the refusal below the cannot-happen
   * guard it was always described as, instead of the second-time-through
   * path; the millisecond stamp only spreads names across time and would be
   * redundant on its own (a same-ms collision falls through to `.2`).
   */
  // ⚠️ The counter sits BEFORE the kind. Appending it after
  // (`...damaged.2`) breaks the property the first warning above promises:
  // the kind stops being the last segment, so a person (or a suffix match)
  // reading the directory can no longer tell what the second aside was.
  const stem = `${file}.${stamp}.${process.pid}.${Date.now()}`;
  const suffix = kind || 'superseded';
  let aside = `${stem}.${suffix}`;
  for (let n = 2; fs.existsSync(aside) && n <= 50; n += 1) aside = `${stem}.${n}.${suffix}`;
  if (fs.existsSync(aside)) {
    // Fifty asides for one project+agent, in one process, inside one
    // millisecond. Refusing beats overwriting the file we are rescuing.
    return { ok: false, because: cannotMoveAside(kind) };
  }
  /* kosmos#5841: a rollover asks to KEEP the file in place: a hard link puts it under the aside name and the caller then
     writes the new file over the original atomically, so a reader without the lock never finds the thread missing (a
     rename left no file between it and the write: an empty conversation, a reply refused as gone). A filesystem that
     cannot link falls back to the rename. */
  if (keepInPlace) {
    try { fs.linkSync(file, aside); return { ok: true, aside, linked: true }; } catch (err) {
      // The name appeared since the check above: a rename would OVERWRITE that file, so refuse rather than fall back.
      if (err && err.code === 'EEXIST') return { ok: false, because: cannotMoveAside(kind) };
    }
  }
  try {
    fs.renameSync(file, aside);
    return { ok: true, aside };
  } catch {
    // Plain language, same rule as the write failure above: an errno and an
    // internal path are not things a person can act on.
    return { ok: false, because: cannotMoveAside(kind) };
  }
}

/**
 * ⚠️ THE SENTENCE FOLLOWS THE KIND. Both failure returns used to say "an
 * earlier project's messages" whatever they had been asked to move — so a
 * DAMAGED file that could not be renamed was reported as a project-name clash,
 * which is a different thing that would send somebody looking for a project
 * they never made.
 */
function cannotMoveAside(kind) {
  if (kind === ROLL_KIND) return 'we could not move the full file aside to start a new one, so we did not add to it';
  return kind === 'damaged'
    ? 'we could not move the damaged file aside, so we did not add to it'
    : 'we could not move an earlier project’s messages aside, so we did not add to them';
}

/* ── who answers ─────────────────────────────────────────────────────────── */

/**
 * Which agent a project's thread opens on. The member the others report to
 * first (#4557), then the role-text manager, then the first agent.
 *
 * ⚠️ ONE agent answers, and this is the rule that decides which. The screen
 * this replaces said the room was waiting on exactly this question ("when five
 * agents are on a project, who answers"), and the settled answer is: every
 * message is addressed to ONE agent, chosen here, changeable by the person, and
 * the others are visible and silent. Everything answering at once and nothing
 * answering are the same bug.
 *
 * The manager goes first because that is what a manager is for; with no
 * manager, the first agent on the project. Pure, so the rule is testable
 * without a fleet.
 */
function defaultAgentFor(members) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (!list.length) return null;
  // #4557 (April, #4555 review): the org chart first; the role text is only a guess ("Social Media
  // Manager" matched before the CMO a seeded team reports to). The top of the chart is the member others
  // report to who reports to nobody here; with no single one, most direct reports, a tie in list order.
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const reportedTo = (m) => list.some((o) => o !== m && same(o.reportsTo, m.sessionName));
  const reportsHere = (m) => list.some((o) => o !== m && same(m.reportsTo, o.sessionName));
  const roots = list.filter((m) => reportedTo(m) && !reportsHere(m));
  if (roots.length === 1) return roots[0].sessionName;
  // Several tops (two charts on one project): the choice is among THEM, never a middle manager under
  // one of them. No top at all (a loop): among everyone.
  let head = null;
  let most = 0;
  for (const m of (roots.length ? roots : list)) {
    const n = list.filter((o) => o !== m && same(o.reportsTo, m.sessionName)).length;
    if (n > most) { most = n; head = m; }
  }
  if (head) return head.sessionName;
  const manager = list.find((m) => looksLikeManager(m.role));
  return (manager || list[0]).sessionName;
}

/**
 * ⚠️ Matched on the ROLE TEXT, which is a sentence a person or a role template
 * wrote, not an enum. `engine/roles.js` ships "project manager"; a person may
 * have typed "PM" or "Ops manager" into the role field. So this is a loose
 * match on purpose — being wrong costs a preselected dropdown entry the person
 * can change in one click, which is the cheapest wrong answer in this product.
 */
function looksLikeManager(role) {
  const said = String(role == null ? '' : role).toLowerCase();
  if (!said) return false;
  return /manager|\bpm\b|project lead|\blead\b/.test(said);
}

/**
 * #4354: does a row Kosmos wrote in the agent's name (`kosmos: true`, the daily-limit notice) stand in for the
 * agent having said something? Only while the agent is paused (`pause.paused`) AND the row was written during THIS
 * pause (at or after `pause.pausedSince`): a notice from an earlier pause says nothing about now. A pause with no
 * readable start time counts any marked row. Shared by dmOwes and firstreply-nudge's firstContact, so the two
 * cannot disagree. A row without the mark is not asked about.
 */
function noticeStands(row, pause) {
  if (!pause || pause.paused !== true || !row) return false;
  const since = typeof pause.pausedSince === 'string' ? Date.parse(pause.pausedSince) : NaN;
  if (!Number.isFinite(since)) return true;
  const at = typeof row.at === 'string' ? Date.parse(row.at) : NaN;
  return Number.isFinite(at) && at >= since;
}

/**
 * #4340: does the agent owe the person an answer in their ONE-TO-ONE thread, from that thread's own rows?
 *
 * The DM thread's "Nothing back yet." (web dmOwesLine) used to ask messages.owesReply, which reads the
 * `kosmos msg` / room-post log. A person's DM and the agent's `kosmos reply` are not in that log; they are the
 * rows of this DIRECT thread. So a person's DM never made it owe, and a colleague's `kosmos msg` could make it
 * owe under a thread whose answer is visible. This reads the thread the page draws.
 *
 * Who writes a DIRECT thread: the person's message has NO `from` (see readThread), with a `delivery`; every
 * agent row goes through keepAgentReply with `from` equal to the agent (its `kosmos reply`, a drained reply, and
 * Kosmos's own daily-limit notice said in the agent's name). #4354: that notice is marked `kosmos: true` and clears
 * the debt only while it stands (noticeStands: paused now, and written in this pause; `opts` is swarm.pauseOf's
 * answer): it says why no answer is coming and when, so a "Nothing back yet." under it would read as the agent
 * ignoring them. Once the agent runs again it is not an answer, and a question still unanswered owes again. A
 * caller that cannot say (no opts) gets not-paused, so the line comes back rather than staying hidden.
 *
 * Only a person message that REACHED the agent (`delivery.state === placed`) can put it in debt: one that could
 * not be delivered was never received (the page draws only this answer, timed from `lastHeardAt`, so the rule
 * lives here alone). A MENU ANSWER (a row with a `wire`: the keystroke that picked one of the agent's own buttons, stored by appendMessage) is not a
 * message to answer: the agent carries on working and owes nothing.
 * ⚠️ A TYPED answer to a question the agent asked in prose is NOT told apart and still counts as owed: nothing
 * stored says a typed row answered a question, and NEEDS_YOU at send time is not that fact (a reported needs_you
 * can stand for hours while the person writes about other things). Known limit, recorded on #4340. Owes when the newest remaining person message is newer than the
 * agent's newest row. Never spoken to: clear.
 *
 * `rows === null` is a thread we could not read: UNKNOWN, never a confident clear. Returns {state, lastHeardAt,
 * lastSentAt, because}, the shape dmOwesLine reads.
 */
function dmOwes(rows, agent, opts) {
  const name = String(agent == null ? '' : agent);
  if (rows === null || rows === undefined || !Array.isArray(rows)) {
    return { state: 'unknown', lastHeardAt: null, lastSentAt: null, because: 'we could not read this conversation' };
  }
  const when = (at) => (typeof at === 'string' && Number.isFinite(Date.parse(at)) ? Date.parse(at) : null);
  let heard = null; let heardAt = null;
  let sent = null; let sentAt = null;
  for (const m of rows) {
    if (!m || typeof m !== 'object') continue;
    const t = when(m.at);
    if (t === null) continue;
    if (m.from === undefined || m.from === null) {
      if (!(m.delivery && m.delivery.state === DELIVERY.PLACED)) continue;
      if (typeof m.wire === 'string' && m.wire) continue;   // a menu answer, not a message to reply to
      if (heard === null || t > heard) { heard = t; heardAt = m.at; }
    } else if (m.from === name) {
      if (m.kosmos === true && !noticeStands(m, opts)) continue;   // #4354: Kosmos's notice, not from this pause
      if (sent === null || t > sent) { sent = t; sentAt = m.at; }
    }
  }
  const owes = heard !== null && (sent === null || heard > sent);
  return { state: owes ? 'owes' : 'clear', lastHeardAt: heardAt, lastSentAt: sentAt, because: null };
}

/* #2863: the per-AGENT read cursor for the operator's 1:1 DM channel, the exact
   analog of messages.js `room-seen.json` but keyed by agent rather than project,
   because a DM thread is one person and one agent, not a room. "Unread" is every
   REPLY the agent posted to its DIRECT thread after the moment the person last
   opened it; the person's own messages never count (they carry no `from`, see
   readThread). Held on disk beside room-seen.json so it survives a reload and a
   restart. A cursor file we cannot read is UNKNOWN, never "never opened": the
   count answers null and the badge draws nothing, the same rule readThread and
   the room precedent both follow. */
const DM_SEEN = path.join(store.ROOT, 'dm-seen.json');

function dmSeenRead() {
  let raw;
  try { raw = fs.readFileSync(DM_SEEN, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return null;
  }
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch { return null; }
}

/** The person opened this agent's DM thread now (or at `now`). Returns the ISO
 *  moment kept. Same validation + atomic write as messages.markSeen. */
function markDmSeen(agent, now) {
  const name = String(agent == null ? '' : agent);
  if (!name) throw badRequest('say which agent was opened');
  // The cursor is keyed by the same name the thread file is keyed by; a name we
  // could not keep a thread under is a name we will not record a cursor for.
  let key;
  try { key = store.safeKey(name); } catch { key = null; }
  if (!key || key !== name) throw badRequest('that is not an agent name we can keep a DM cursor under');
  const cur = dmSeenRead() || {};
  cur[name] = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  fs.mkdirSync(path.dirname(DM_SEEN), { recursive: true });
  store.saveFlushed(DM_SEEN, JSON.stringify(cur, null, 2) + '\n');   // #5434 slice 18: flushed before the rename
  return cur[name];
}

/* Matches only the DIRECT thread files, `chats/direct..<key>.json` (see
   threadFile). The two dots are the same guard the filename uses: a project
   thread is `<id>.<key>.json` with one dot and a project id can never be
   `direct`, so this pattern can never pick up a project thread. `(.+)` is the
   agent key, which for any thread that exists equals the agent name (threadFile
   refuses to write one where safeKey(name) !== name). */
const DIRECT_THREAD_FILE = /^direct\.\.(.+)\.json$/;

/**
 * Unread DM replies per agent, `{ [agent]: n }`, one pass per DIRECT thread.
 *
 * Divergence from the room precedent (messages.unreadAll), and why: the room
 * count reads ONE shared log, so one read failure is total and it returns null
 * for everything. DIRECT threads are INDEPENDENT files, so a single unreadable
 * or unparseable thread is made that ONE agent's `null` (unknown, not zero)
 * while every other agent keeps its real count. The whole map is null only when
 * the shared inputs are unreadable: the seen cursor, or the chats directory
 * itself. Unknown is never reported as zero, at either scope.
 *
 * Uncached by design, matching unreadAll: this reads the chats dir plus one file
 * per DIRECT thread on each call, and the caller (server.js withDmUnread) runs
 * it on the 5s status poll. That mirrors unreadAll, which re-reads the whole
 * message log every poll with no memo; the reads here are small per-file and
 * bounded by the fleet size. A cache would need invalidation on every reply
 * append, which is the complexity the room precedent deliberately does without.
 */
function dmSummaryAll() {
  const seen = dmSeenRead();
  if (seen === null) return null;
  let files;
  try { files = fs.readdirSync(DIR()); } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return null;
  }
  const out = {};
  for (const f of files) {
    const m = DIRECT_THREAD_FILE.exec(f);
    if (!m) continue;
    const agent = m[1];
    let thread;
    try {
      thread = readThread(DIRECT, agent);
    } catch {
      // UNREADABLE / UNPARSEABLE / a bad name: unknown for THIS agent only.
      out[agent] = null;
      continue;
    }
    const since = seen[agent] ? Date.parse(seen[agent]) : -Infinity;
    let n = 0;
    let lastAt = null;
    let lastAgentAt = null;
    for (const msg of thread.messages) {
      const at = Date.parse(msg && msg.at);
      if (Number.isFinite(at)) {
        if (lastAt === null || at > lastAt) lastAt = at;
        if (typeof msg.from === 'string' && msg.from && (lastAgentAt === null || at > lastAgentAt)) lastAgentAt = at;
      }
      // A present string `from` is the agent's reply; an absent one is the
      // operator's own message and never counts (readThread's own contract).
      if (!msg || typeof msg.from !== 'string' || !msg.from) continue;
      if (!Number.isFinite(at) || at <= since) continue;
      n += 1;
    }
    out[agent] = {
      unread: n,
      lastAt: lastAt === null ? null : new Date(lastAt).toISOString(),
      lastAgentAt: lastAgentAt === null ? null : new Date(lastAgentAt).toISOString(),
    };
  }
  return out;
}

function dmUnreadAll() {
  const summary = dmSummaryAll();
  if (summary === null) return null;
  return Object.fromEntries(Object.entries(summary).map(([agent, row]) => [agent, row === null ? null : row.unread]));
}

/** Unread DM replies for one agent. null when unknown (see dmUnreadAll). */
function dmUnread(agent) {
  const all = dmUnreadAll();
  if (all === null) return null;
  const v = all[String(agent)];
  return v === undefined ? 0 : v;
}

/* #3650: emoji REACTIONS in a Direct Message, the DM half of #2255/#3570 (Josh,
   2026-09-24: "the ability for users to denote emojis on posts, in both their
   conversations and projects").

   The room keeps reactions as append-only events in the message log. A DM is a
   different store: one JSON thread file, rewritten whole under its lock on every
   append. So a DM reaction lives ON the message it reacts to, as `reactions` (the
   emojis the person currently has on it), and `reactionsTold` (the ones the agent
   has already been told about). Both ride along untouched when later messages are
   appended, because appendLocked carries existing rows over whole.

   Only the PERSON reacts here, and only to the AGENT's messages. An agent reacting
   back in a DM is not built (rooms have `kosmos react`; a DM has no verb for it yet).

   DELIVERY is not a push. A reaction is feedback and needs no reply (the doctrine
   section "When someone reacts to your post"), so it must not wake the agent into a
   turn of its own. It is told on the person's NEXT message in the DM, as one
   `[kosmos]` note after their words, the way the room shows reactions on the next
   `kosmos room` read. A reaction the person takes back before then is never told. */

/* The emojis the person currently has on message `m`, normalised and de-duplicated.
   A stored value that is not an array, or an entry that is not a valid emoji, is
   skipped rather than treated as damage: the thread file is not ours alone to
   validate, and a stray field must never make a whole conversation unreadable. */
// Typed into a pane, so never carried there: C1 controls and bidi overrides/isolates.
const DM_PANE_UNSAFE = /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/;
function dmReactions(m) {
  const { normalizeReactionEmoji } = require('./messages');   // lazy: messages.js requires this file
  const out = [];
  for (const raw of (m && Array.isArray(m.reactions)) ? m.reactions : []) {
    const e = normalizeReactionEmoji(raw);
    if (e && !DM_PANE_UNSAFE.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/* The pill list the page draws, in the room's shape ({emoji, count, who, mine}), so
   the DM row reuses the room's renderer unchanged. The person is the only reactor. */
function dmReactionPills(m) {
  return dmReactions(m).map((emoji) => ({ emoji, count: 1, who: ['you'], mine: true }));
}

/* Toggle the person's `emoji` on the agent's message sent at `at`. The message is
   found by its `at` (a DM row has no id; `at` is the key the page's anchor already
   uses) and must be the AGENT's (`from` is this agent); any other row is refused.
   Two agent rows sharing one `at` are refused too, rather than guessing which was
   meant. An emoji carrying a C1 control or a bidi override is refused (DM_PANE_UNSAFE),
   and dmReactions skips one already in the file, so the page, the note and the
   told-marker all read the same list.
   Returns {ok, op, emoji, at, reactions} or {ok:false, because}. */
function reactDirect(agent, at, emoji) {
  const { normalizeReactionEmoji } = require('./messages');
  const name = String(agent == null ? '' : agent).trim();
  const when = String(at == null ? '' : at).trim();
  const e = normalizeReactionEmoji(emoji);
  if (!name) return { ok: false, because: 'we could not tell which conversation this is' };
  if (!when) return { ok: false, because: 'we could not tell which message to react to' };
  if (!e || DM_PANE_UNSAFE.test(e)) return { ok: false, because: 'that is not an emoji we can react with' };
  let file;
  try { file = threadFile(DIRECT, name); }
  catch (err) { return { ok: false, because: String((err && err.message) || 'we could not find that conversation') }; }
  let held;
  try {
    held = withThreadLock(file, () => {
      let thread;
      try { thread = readThread(DIRECT, name); }
      catch (err) { return { ok: false, because: String((err && err.message) || 'we cannot read this conversation right now') }; }
      const hits = [];
      thread.messages.forEach((m, i) => { if (m && m.at === when && m.from === name) hits.push(i); });
      if (!hits.length) {
        // kosmos#5841: a row older than the latest carried rows lives only in an earlier file, which is kept as it was.
        const earlier = thread.continues ? asideChain(DIRECT, name, true, thread.continues, thread.projectBornAt) : [];
        if (earlier.some((a) => a.messages.some((m) => m && m.at === when && m.from === name))) {
          return { ok: false, because: 'that message is in an earlier part of this conversation, which is kept as it was, so it cannot be reacted to' };
        }
        return { ok: false, because: 'there is no message from this agent at that time to react to' };
      }
      if (hits.length > 1) return { ok: false, because: 'two of this agent\'s messages share that time, so we could not tell which one you meant' };
      const m = thread.messages[hits[0]];
      const cur = dmReactions(m);
      const op = cur.includes(e) ? 'remove' : 'add';
      if (op === 'add' && cur.length >= DM_REACTIONS_PER_MESSAGE) {
        return { ok: false, because: 'that message already has as many reactions as it can hold' };
      }
      const next = op === 'add' ? [...cur, e] : cur.filter((x) => x !== e);
      const messages = thread.messages.slice();
      messages[hits[0]] = { ...m, reactions: next };
      const record = { ...thread, messages };
      try {
        store.saveFlushed(file, JSON.stringify(record, null, 2));   // #5434 slice 18: flushed before the rename
      } catch {
        return { ok: false, because: 'we could not write this reaction down on this computer' };
      }
      return { ok: true, op, emoji: e, at: when, reactions: dmReactionPills(messages[hits[0]]) };
    });
  } catch {
    return { ok: false, because: 'we could not write this reaction down on this computer' };
  }
  if (!held.ok) return { ok: false, because: held.because };
  return held.value;
}

/* The `[kosmos]` note for the person's next message: every reaction on the agent's
   messages the agent has not been told about yet, oldest message first, with the
   start of each message so the agent can tell which one is meant. '' when there is
   nothing new. One line, no control characters: it is typed into a pane.
   dmReactionNews also returns `named` ({at: emojis}), what the note covers, for
   markDmReactionsTold. */
const DM_REACTION_SNIPPET = 48;          // enough of a message's start to recognise it, short enough for one line
const DM_REACTION_NOTE_MESSAGES = 5;     // messages quoted per note; the rest are counted
const DM_REACTIONS_PER_MESSAGE = 20;     // one person's reactions on one message; bounds the row a toggle rewrites
function dmReactionNews(agent) {
  const none = { note: '', named: {} };
  let thread;
  try { thread = readThread(DIRECT, String(agent)); } catch { return none; }
  const parts = [];
  const named = {};
  for (const m of thread.messages) {
    if (!m || m.from !== String(agent)) continue;
    const told = new Set(Array.isArray(m.reactionsTold) ? m.reactionsTold : []);
    const fresh = dmReactions(m).filter((e) => !told.has(e));
    if (!fresh.length) continue;
    // Every message with fresh reactions is recorded as told, the ones only counted below too.
    named[String(m.at)] = (named[String(m.at)] || []).concat(fresh);
    const words = String(m.text || '').replace(new RegExp(DM_PANE_UNSAFE.source, 'g'), ' ').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
    // By code point, so an emoji at the cut is never split into half a surrogate pair.
    const chars = Array.from(words);
    const snippet = chars.length > DM_REACTION_SNIPPET ? chars.slice(0, DM_REACTION_SNIPPET).join('').trimEnd() + '…' : words;
    parts.push(fresh.join(' ') + ' on your message "' + snippet.replace(/"/g, '\'') + '"');
  }
  if (!parts.length) return none;
  /* Bounded: at most DM_REACTION_NOTE_MESSAGES messages named, the rest counted, so a
     backlog of reactions cannot turn one message into a wall of text in the pane. */
  const shown = parts.slice(-DM_REACTION_NOTE_MESSAGES);
  const more = parts.length - shown.length;
  const note = ' [kosmos] reactions from the person you have not been told about yet: '
    + (more ? 'reactions on ' + more + ' earlier message' + (more === 1 ? '' : 's') + '; ' : '') + shown.join('; ')
    + '. A reaction is feedback, not a message: it needs no reply.';
  return { note, named };
}
function dmReactionNote(agent) {
  return dmReactionNews(agent).note;
}

/* #5943: the person writes while the agent has a REPORTED question standing (needs_you). Kosmos cannot know whether
   this message answers it and never guesses (an answered-looking reply is not an answer), so it hands the decision to
   the agent: clear it, or leave it open and say what it still needs, or replace it. Without this a question answered in
   passing stood for 12 days. One line, no control characters (it is typed into a pane), the question's start only. */
const DM_QUESTION_SNIPPET = 80;
/* Review 1: the note goes ONCE per ask (agent + when it was asked), recorded once a message carrying it was placed.
   Kept in memory: a board restart may tell it once more, which is the cheap direction (a missed note is the other). */
/* Review 2: and again once DM_QUESTION_RENOTE_MS has passed, so a note spent on "thanks, will look soon" does not leave
   the real answer, hours later, without it. */
const DM_QUESTION_TOLD = new Map();
const DM_QUESTION_RENOTE_MS = 6 * 60 * 60 * 1000;
function dmQuestionTold(agent, askedAt, nowMs) {
  const t = DM_QUESTION_TOLD.get(String(agent));
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return Boolean(t && t.askedAt === String(askedAt) && now - t.at < DM_QUESTION_RENOTE_MS);
}
function markDmQuestionTold(agent, askedAt, nowMs) {
  DM_QUESTION_TOLD.set(String(agent), { askedAt: String(askedAt), at: Number.isFinite(nowMs) ? nowMs : Date.now() });
}
function dmStandingQuestionNote(question) {
  if (typeof question !== 'string' || !question.trim()) return '';
  const words = question.replace(new RegExp(DM_PANE_UNSAFE.source, 'g'), ' ').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  const chars = Array.from(words);
  const snippet = chars.length > DM_QUESTION_SNIPPET ? chars.slice(0, DM_QUESTION_SNIPPET).join('').trimEnd() + '…' : words;
  if (!snippet) return '';
  return ' [kosmos] your question to this person is still open on the board: "' + snippet.replace(/"/g, '\'') + '".'
    + ' If this message answers it, act on the answer and run: kosmos report clear.'
    + ' If it does not, leave it open and tell them what you still need (or report the new question instead).';
}

/* Whether the note may ride this message at all. Never on a numbered menu answer: the
   pane gets a bare digit there, and anything typed after it could land in whatever
   prompt comes next. Checked on `chose` (the button that was pressed) AND on the text,
   because the route drops `chose` when no menu is showing and a bare digit is exactly
   what a menu takes. */
function dmNoteMayRide(text, chose) {
  if (chose) return false;
  return !/^\s*\d+\s*$/.test(String(text == null ? '' : text));
}

/* After a message carrying that note reached the pane, record that the agent has now
   been told what the note NAMED (`named` from dmReactionNews), not whatever is on the
   message by the time this runs. A reaction taken back since drops out of
   `reactionsTold`, so putting it back later is told again. Returns false, marking
   nothing, without `named`. */
function markDmReactionsTold(agent, named) {
  const name = String(agent);
  if (!named || typeof named !== 'object') return false;
  let file;
  try { file = threadFile(DIRECT, name); } catch { return false; }
  try {
    const held = withThreadLock(file, () => {
      const thread = readThread(DIRECT, name);
      let changed = false;
      const messages = thread.messages.map((m) => {
        if (!m || m.from !== name) return m;
        const now = dmReactions(m);
        const told = Array.isArray(m.reactionsTold) ? m.reactionsTold : [];
        const said = Array.isArray(named[String(m.at)]) ? named[String(m.at)] : [];
        const next = now.filter((e) => told.includes(e) || said.includes(e));
        if (next.length === told.length && next.every((e) => told.includes(e))) return m;
        changed = true;
        return { ...m, reactionsTold: next };
      });
      if (!changed) return true;
      store.saveFlushed(file, JSON.stringify({ ...thread, messages }, null, 2));   // #5434 slice 18: flushed before the rename
      return true;
    });
    return !!(held && held.ok);
  } catch { return false; }
}

/* #5805 slice 2b: a person's held message was typed later (the minute sweep, or Send now anyway), or dropped: its row,
   found by `at`, takes the new delivery. Only a row that is still held changes. A delivery that is itself 'held' (the
   sweep tried and could not type it) keeps the row held, with its time and flags, and records why in `stuck` (not
   rewritten when the reason is the same). Never throws; true when written. */
function updateDmDelivery(agent, at, delivery) {
  const name = String(agent);
  if (typeof at !== 'string' || !delivery || typeof delivery.state !== 'string') return false;
  let file;
  try { file = threadFile(DIRECT, name); } catch { return false; }
  try {
    let wrote = false;
    const held = withThreadLock(file, () => {
      const thread = readThread(DIRECT, name);
      const messages = thread.messages.map((m) => {
        if (!m || m.at !== at || m.from || !m.delivery || m.delivery.state !== 'held') return m;
        if (delivery.state === 'held') {
          const stuck = typeof delivery.stuck === 'string' && delivery.stuck ? delivery.stuck : null;
          if (!stuck || (m.delivery.stuck && m.delivery.stuck.because === stuck)) return m;
          wrote = true;
          return { ...m, delivery: { ...m.delivery, stuck: { because: stuck, at: new Date().toISOString() } } };
        }
        wrote = true;
        return { ...m, delivery: { state: delivery.state, because: delivery.because || null, paneState: delivery.paneState || null, paneNote: delivery.paneNote || null } };
      });
      if (wrote) store.saveFlushed(file, JSON.stringify({ ...thread, messages }, null, 2));
      return true;
    });
    return !!(held && held.ok) && wrote;
  } catch { return false; }
}

/**
 * kosmos#6720: a person's message that did not go (COULD_NOT: nothing of it reached the pane), sent again from its own
 * row, takes the new verdict IN PLACE rather than a second row, so the conversation shows one message either way.
 *
 * ⚠️ TWO WRITES, AND THE FIRST IS BEFORE ANY KEY. `retryDmBegin` turns the row UNCONFIRMED ("being sent again") under
 * the thread lock BEFORE anything is typed, and `retryDmFinish` writes the real verdict only over a row still carrying
 * that mark. So a board that stops mid-send, or a final write that fails, leaves a row that may have gone and offers
 * no Try again. Two presses in one running board are stopped first by the route's in-memory mark; the record is what
 * still holds across a restart or a failed final write (review 1).
 * Only a row still COULD_NOT, marked retryable when it was kept, with exactly these words. Its `at` stays (the row's
 * identity, which reactions and replies key on); the try's own time rides as `retriedAt`. Each returns true when
 * the row was rewritten.
 */
const RETRYING_BECAUSE = 'it was being sent again when Kosmos last looked, so it may have arrived; check its window before sending it again';
function rewriteDmRow(agent, at, text, pick, make, newestOnly) {
  const name = String(agent);
  if (typeof at !== 'string' || typeof text !== 'string') return false;
  let file;
  try { file = threadFile(DIRECT, name); } catch { return false; }
  try {
    let wrote = false;
    const held = withThreadLock(file, () => {
      const thread = readThread(DIRECT, name);
      /* Review 2: "the person's newest message" is decided HERE, under the lock, so a message sent meanwhile (another
         tab) is seen before this one is typed behind it. */
      if (newestOnly) {
        const own = thread.messages.filter((m) => m && !m.from && m.kind !== 'kosmos' && m.kind !== 'question');
        if (!own.length || own[own.length - 1].at !== at) return true;
      }
      const messages = thread.messages.map((m) => {
        if (wrote || !m || m.at !== at || m.from || m.text !== text || !m.delivery || !pick(m.delivery)) return m;
        wrote = true;
        return { ...m, delivery: make(m.delivery) };
      });
      if (wrote) store.saveFlushed(file, JSON.stringify({ ...thread, messages }, null, 2));
      return true;
    });
    return !!(held && held.ok) && wrote;
  } catch { return false; }
}
function retryDmBegin(agent, at, text) {
  return rewriteDmRow(agent, at, text,
    (d) => d.state === DELIVERY.COULD_NOT && d.retryable === true,
    () => ({ state: DELIVERY.UNCONFIRMED, because: RETRYING_BECAUSE, retrying: true, retriedAt: new Date().toISOString(), paneState: null, paneNote: null }),
    true);
}
function retryDmFinish(agent, at, text, delivery) {
  if (!delivery || typeof delivery.state !== 'string') return false;
  return rewriteDmRow(agent, at, text,
    (d) => d.retrying === true,
    (d) => ({ state: delivery.state, because: delivery.because || null, paneState: delivery.paneState || null,
      paneNote: delivery.paneNote || null, retriedAt: d.retriedAt,
      ...(delivery.state === DELIVERY.COULD_NOT ? { retryable: true } : {}) }));   // nothing typed again: it may be tried again
}

module.exports = {
  retryDmBegin, retryDmFinish,   // kosmos#6720
  setEarlierSubmittedHook,   // #6256 item 2
  inputBoxEmpty,   // #6256 item 1
  updateDmDelivery,   // #5805 slice 2b
  setMovedTell,   // #5400
  DELIVERY, DIRECT, dmOwes, noticeStands, MAX_TEXT, MAX_MESSAGES, VIEWPORT_LINES, STORE_GROWTH, storedWithin, storedProblem,
  cleanMessage, acknowledgementOnly, storeText, messageProblem, addressable, resolveCard, paneTarget,
  dmReactions, dmReactionPills, reactDirect, dmReactionNews, dmReactionNote, markDmReactionsTold, dmNoteMayRide,
  dmStandingQuestionNote, dmQuestionTold, markDmQuestionTold,   // #5943
  chunkUtf8, pasteToEnterMs, PASTE_CHUNK_BYTES,
  composerText, composerHolds, SUBMIT_SETTLE_MS, SUBMIT_LOOK_MS, UNSENT_RETRY_MS, UNSENT_TAIL_MS,   // #6249, kosmos#6436
  setUnsentRetryScheduler, restartUnsentForTests, setRosterSource,   // kosmos#6436
  recoverStuckInput, setDraftSaver, withDraftRows, STUCK_INPUT_MS, stuckShrunk,   // kosmos#6717
  deliver, deliverAutomatic, deliverAutomaticAsync, deliverAsync, menuHeld, limitHeldVerdict, signinHeldVerdict, accountHeldVerdict, limitable, limitReleased, limitQueueReleased, interrupt, stopHelpers, WIN32_NO_KEYS_SENTENCE, NO_WINDOW_BECAUSE, answerGeminiQuotaStop, answerCodexHooks, answerQuestionMenu, closeQuestionMenu, permissionAnswerable, permissionCard, permissionRequestId, viewport, questionIn, optionsIn, questionAbove, waitingNote, spawnFailure, verifyAtSend,
  withQuestionRow,
  withAccountRow,
  threadFile, readThread, appendMessage, supersede, withThreadLock, asideChain, chainRows,
  defaultAgentFor, looksLikeManager,
  dmSeenRead, markDmSeen, dmSummaryAll, dmUnreadAll, dmUnread, DM_SEEN,
  setRunner, setDryRun, setPauser, setChannel, resetForTests, CODEX_ENTER_GAP_MS,
  chatsDir: DIR,
};

/**
 * ⚠️ READABLE, so a fixture can ASSERT this seam is armed the way it believes.
 *
 * `engine/create.js` exports its own `DRY_RUN`, and `thread-server.js` asserts
 * it — which is exactly what caught that file one line away from making a real
 * launchd job on this machine. The same fixture then called
 * `chat.setDryRun(false)` with no way to check what it had done, so two seams
 * in one file were held to different standards, and the one that types into a
 * live agent was the unguarded one.
 *
 * A GETTER rather than the flag's value: it changes at runtime, and a snapshot
 * exported at load would answer about the past.
 */
Object.defineProperty(module.exports, 'DRY_RUN', { get: () => DRY_RUN, enumerable: true });
// Same live-read contract as DRY_RUN, for the same fixture-assertable reason.
Object.defineProperty(module.exports, 'VERIFY_FORMAT', { get: verifyFormat, enumerable: true });
