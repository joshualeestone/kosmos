# turnstuck-7368: blind review, final round (whole branch vs origin/main)

Branch head: f97ad48cf0 (2 commits over origin/main). Every line of the diff read as new.

Counts: 2 BLOCKER, 3 WARNING, 9 NIT.

## Findings

### [BLOCKER] B1. The message that STARTS the turn is counted as "waiting behind it"
- Where: engine/deliverystreak.js:105 (`filter((t) => t >= since)`), with the ordering at engine/win32supervisor.js:873 and engine/chat.js:3069.
- Failure: the supervisor calls `stream.wrote()` (which stamps `busySince` on an idle agent) inside the stdin write callback, and only THEN answers `{ ok: true }`. The board gets that answer, returns PLACED, and `deliverystreak.noted` calls `note()` with `Date.now()`, which is later than `busySince`. So the one message that opened the turn always satisfies `t >= since`. Result: ANY Windows agent sent ONE message whose turn runs past 60 minutes (a long build, a long autonomous task) reads "Messages stuck", wears the needs-you look, counts in needsPerson (status.js:9804, the Issue filter), and is told "1 message is waiting behind it. Restart it to free it, then send them again." Nothing is waiting, and following the advice kills productive work.
- MEASURED: driving the real publisher and deliverystreak in the order the code runs them (pub.wrote(), then ds.note(placed)), one message and nothing queued, 61 minutes later `turnStuckOf` returns `{ count: 1, lastWhy: 'turn', step: 'running "cargo build --release"', next: 'Restart it to free it, then send them again' }`. The same holds with zero delay, since equal milliseconds also pass `>=`.
- Why the tests miss it: the test plants placed times by hand at chosen offsets and never models the supervisor-then-board order.
- Fix: count on the supervisor side, where the order is known. In `wrote()`, if `current.state` was already BUSY, increment a `queued` counter (and decrement as each queued message opens its own turn, see W1), write it in the state file, and have `turnFor` return it. Drop `placedTimes` for this purpose. If the board-side count is kept, at minimum exclude the first placement at or after `since`.

### [BLOCKER] B2. "On one step" is measured from the start of the TURN, so an agent making steady progress is reported as stuck
- Where: engine/win32streamstate.js:484 (`stepChanged` updates `step` but nothing records when), engine/deliverystreak.js:100-108, web/index.html:22323-22333.
- Failure: the clock is `busySince`, the turn's start. A Windows agent doing a 70-minute autonomous turn with a new tool call every minute, with one message sent to it at minute 40, is said as "has been on one step for about 70 minutes: running "step 69"". The step named is seconds old. The sentence is false and the advice (restart) destroys live work and drops the queued message. Combined with B1, even the message that started the turn is enough.
- MEASURED: publisher fed 70 distinct Bash tool_use events plus tool_results, one placement at +40 min, `turnStuckOf` at +70 min returns a stall with `step: 'running "step 69"'`. The state record carries only `turnSince` and `step`; no step or activity age exists anywhere.
- Fix: stamp `stepSince` when the step changes, or better a `lastEventAt` refreshed on every stream event (a hung tool and a hung model both go silent), and require `now - lastActivity >= TURN_STUCK_MS` rather than `now - turnSince`. Keep `since` for "how long the messages have waited" if wanted, but the page's "on one step for" must use the step's age. Throttle the activity stamp's writes (see N2).

### [WARNING] W1. False negatives: messages queued in an earlier turn, and everything after a board restart, are not counted
- Where: engine/deliverystreak.js:39-42, 105; engine/win32streamstate.js setState.
- Failure (a): the person sends A, B, C quickly. A runs; B and C are placed during A's turn. A ends (`result`, busySince cleared), B opens a new turn (new busySince) and hangs. C is still queued behind B, but it was placed before B's turn began, so `count` is 0 and nothing is said. The stated header in win32streamstate.js confirms each written message runs as its own turn, so this sequence is real.
- Failure (b): `placedTimes` lives only in board memory. A Kosmos update or board restart empties it, so a turn with 5 messages queued shows nothing; the next send then shows "1 message is waiting", understating by 5.
- REASONED (from the code path; not driven end to end on Windows).
- Fix: the supervisor-side counter from B1 fixes both: it survives a board restart (it is in the state file) and it can carry "writes not yet opened as a turn" across turn boundaries instead of filtering by the current turn's start.

### [WARNING] W2. The step is agent-controlled command text shown and logged without secret masking
- Where: engine/win32streamstate.js:94-108 (`stepOfEvent`), engine/deliverystreak.js turnLine (board stdout log), web/index.html:22328 (page sentence, and through pillSay the pill's title and hidden text).
- Failure: the step is the first 79 characters of the agent's shell command. Commands routinely carry credentials early: `GH_TOKEN=ghp_... gh pr ...`, `curl -H "Authorization: Bearer ..."`. That text goes to the board's persisted stdout log and onto the card and agent page. The repo already has masks for exactly this (engine/secretmask.js `mask`, engine/win32supervisorlog.js `redactSecrets`), and this path bypasses both.
- REASONED.
- Fix: run the folded text through `secretmask.mask` (or `redactSecrets`) BEFORE cutting to STEP_MAX (cutting first can leave a token fragment too short for a pattern to match), or show only the program name (`running npm`) rather than the full command line.

### [WARNING] W3. Three of the five behaviour changes have no test that goes red
- Where: engine/status.js:1792-1795 (precedence), server.js:26185-26193 (once per turn in the log), web/index.html:22323-22333 (the page sentence).
- MEASURED: deleting the whole #7368 block from `deliveryStallOf` in status.js leaves engine/deliverystreak.turn-7368.test.js (6/6) and engine/heldwarn2-7212.test.js (20/20) green. Nothing references `turnSaid` or lifts the turn branch of `stateReason`. The two mobile-shots screens are a screenshot tool's stand-ins, not assertions in a suite.
- Fix: (1) a `deliveryStallOf` test with a pane whose `command` is win32roster's WIN32_COMMAND, a planted state file, state working, asserting the turn wins over a live streak, and a control with state idle and a non-Windows pane asserting the streak is returned; (2) lift `stateReason` as heldwarn2-7212.test.js:170 does and assert the turn sentence, its count wording and that it is placed before the streak branch; (3) extract the server's turn-saying loop into deliverystreak (like `stallsToSay`) so it can be tested for once-per-turn.

### [NIT] N1. Stale contract comments in win32streamstate.js
- win32streamstate.js:390 still says "Writes only on a TRANSITION, so a turn of a hundred events costs two writes." Every new step now writes. Line 410's shape comment `{ pid, sessionId, state, limit }` omits `busySince`, `step`, `reachedModel`. REASONED. Fix: update both.

### [NIT] N2. One fsynced write per tool call
- win32streamstate.js:484-510. A turn of N distinct tool calls now costs N+2 `saveFlushed` writes (write, fsync, rename). Tool calls are seconds apart, so the rate is modest, but each rename widens the Windows EPERM window, and two failures in a row clear the file (the card falls to "Can't tell" until the next write). The step only matters after 60 minutes. REASONED. Fix: throttle step writes (for example at most one per 30 s, always written on a state transition), or only write `step` once the turn is older than a few minutes.

### [NIT] N3. "1 message is waiting behind it. ... then send them again."
- web/index.html:22331 with deliverystreak.js:162. MEASURED output: "Ada has been on one step for about 61 minutes: running "npm install". 1 message is waiting behind it. Restart it to free it, then send them again." Fix: "send it again" when the count is 1 (the page already branches on n === 1).

### [NIT] N4. "Said once per turn" breaks on a one-read flicker
- server.js:26187 deletes `turnSaid[n]` whenever the card does not carry the turn on this read (a single "Can't tell" read, see N2, or a flicker to idle). The next read with the same `since` says it again. REASONED. Fix: prune only when the agent leaves the roster or `since` changes.

### [NIT] N5. The #7212 comment now sits over the #7368 block
- web/index.html:22318-22322: the #7212 comment ("no message has been seen to reach it ... After the unsent-text sentence above") is now followed by the turn branch, not the code it describes. Fix: move the #7368 comment and branch above the #7212 comment.

### [NIT] N6. WHY_WORDS.turn says it is "the board log's and the phone's short reason"; neither reads it
- deliverystreak.js:149-152. `turnLine` builds its own words, and nothing in the repo reads `deliveryStall.words` for the turn case except the mobile-shots stand-in. REASONED (grep of engine, server.js, web). Fix: correct the comment, or say what reads it (an outside phone client, if that is the meaning).

### [NIT] N7. The cut and the fold are not character-safe
- win32streamstate.js:103-104. `slice(0, 79)` can split a surrogate pair (emoji in a path), and `\s` folds whitespace but not control characters, so an ESC sequence in a command reaches the board's stdout log (turnLine). Fix: strip `[\u0000-\u001f\u007f]` and cut by code point (`Array.from`).

### [NIT] N8. `turnFor` trusts a state file without the pid and session check `stateFor` uses
- win32streamstate.js:114-120 versus 341-346. A card can read Working from the agent's self-report while the file is a leftover of a dead process. `started()` rewrites the file at once, so the window is small. REASONED. Fix: pass the live identity and match it as `stateFor` does.

### [NIT] N9. Applies to every Windows runner, not only Claude
- status.js:1792 gates on `isWin32Pane`, which includes Codex, Gemini and Grok agents (win32codexsup.js:189 calls `stream.wrote()` per turn). There the step is always null and no test covers it. The claim scopes the change to Claude. REASONED. Fix: say so in the claim, or gate on the Claude runner, and add a test either way.

## What I checked (no finding)
- Turn clock, MEASURED with the real publisher: a mid-turn `system` init keeps `busySince`; `rekey` keeps it and re-stamps the session; a rate-limit `rejected` event keeps it, and the refused turn's `result` ends it (idle, no turnSince); a restart (`stopped` then `started`) writes idle with no turn, and the first message after opens a new turn.
- Clock skew: `busySince` is stamped in the supervisor and placed times on the board, both on the same Windows machine and OS clock. No skew issue; the problem is ordering (B1), not clocks.
- Limit and needs_you precedence: `deliveryStallOf` returns null for every state but idle and working, so a needs_you, a sign-in or a rate_limited card is never covered; a Windows Claude limit makes `stateFor` report the limit token, so the card is not Working and the turn path is skipped.
- Previous session of the same name: placed times are filtered by the current turn's start, which is after any earlier session's placements, and `sweep` drops names gone from the board (test 6 guards it).
- PLACED_KEEP 200: only caps the count shown; counting non-Windows agents costs at most 200 numbers each. Not a problem (and moot under the B1 fix).
- HTML injection: the sentence reaches the page only through `esc()` (card title via pillTitle/stateReadAttrs, pillVh) and `textContent` (d-task). The step cannot inject markup. Quotes instead of backticks: no backtick references to the step remain in the diff, tests or mobile-shots.
- Tests: the new file passes 6/6. Mutation controls, each copied to scratch and restored, `git status --porcelain` clean after each: dropping the idle-to-busy guard in setState, dropping the `t >= since` filter, dropping `rec.state !== BUSY` in turnFor, and dropping the placedTimes sweep each turned exactly the matching test red. Deleting the status.js block turned nothing red (W3).
- Related suites green on this branch: heldwarn-7212 (11), heldwarn2-7212 (20), win32streamstate (26), cardlabel-5959 (7), win32limit-5805 (30), win32capture.stream-570 (5), win32codexsup (11), win32supervisor (64), win32usage-6570 (15), state21.fsync-5434 (3), status.codex-state-3446 (3), crashloop-5154 (17), signedout-5948 (5), remove.win32-restart-3431 (15).

## Author's response (Mona Lisa, 13:4x CDT)
My model of the timing was wrong, so the counting is rebuilt on the supervisor side, not patched.
- **B1 (the message that starts a turn counted as waiting): FIXED.** The supervisor counts `queued`: +1 only when a message is written into an agent that is ALREADY busy, -1 when the agent starts a turn by itself (taking its next queued message). The message that starts a turn queues nothing. Mutation: counting every write turns the B1 test red.
- **B2 (timed from the turn's start, not the step): FIXED.** The clock is `stepSince`, moved by ANY stream event while busy, and written in 5-minute buckets. A message arriving does not move it. An agent calling a tool every minute is never "on one step".
- **W1 (A, B, C sent together; board restart empties placed times): FIXED by the same counter.** The queue survives a turn ending and a board restart, because it is in the state file. Test: A starts, B and C queue (2), A ends (still 2), B taken (1), C taken (0). Mutation: dropping the -1 turns the W1 test red. The board's in-memory placed times are gone.
- **W2 (the step not masked): FIXED.** `secretmask.mask` runs before the cut. The test plants a ghp_ token and finds it masked.
- **W3 (precedence, page sentence untested): FIXED.** There is a test for status.deliveryStallOf, covering a Windows Claude card reading Working, idle, another runner, and a Mac pane. There is a test lifting stateReason for the turn sentence (singular and plural), with the #7212 sentence as a control. And there is a test for the log line.
- **NITs:**
  - FIXED: the stale "two writes" comment, now with the extra writes named. The 'them' for one message is now 'send that message again' (turnNext). The log is said once per step+clock key and survives a one-read flicker. The misplaced and over-claiming comments are corrected. The cut is by character, with control characters dropped. The check is Claude only (Codex, Gemini and Grok supervisors are excluded).
  - KEPT: one write per step change, because steps change at most once per tool call. `turnFor` without a pid/session check, because the card must already read Working (live-confirmed) and the supervisor clears its file on stop.
- An existing test (win32streamstate #570 7c-5, two back-to-back messages) compared raw writes. It now compares state transitions, and also checks the queue ends empty.
- Related suites: 656 tests, 654 pass, 0 fail (2 skipped).
