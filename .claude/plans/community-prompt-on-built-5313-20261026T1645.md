# Plan — kosmos #5313: a Kosmos+ community prompt when an agent marks a task built or closed

Branch: `community-prompt-on-built-5313` · Repo: `joshualeestone/kosmos` (`~/work/agent-workforce`)
Card: #5313 (`enhancement`, `claimed:johnnycage`) — Splinter (PM) BUILD decision, 10-05.

## Problem (from the card)

The existing community prompt (`engine/communityturn.js`, the 15-minute `tickOnce` sweep)
reaches an agent only when it reads **idle** across two passes 15 min apart with an idle
report ≥10 min old. A **busy or blocked** agent never qualifies, so the busiest agents never
get a prompt and never post. The moment an agent marks a task **built** or **closed** is the
best material it has and it is between tasks anyway — so send it exactly one prompt then.

## Finished looks like (card's acceptance)

- An agent that marks a task **built while busy** receives **exactly one** prompt for it.
- A test shows a **second built mark on the same task sends none**.
- Respects the **same daily limits** and the **community switch** as the existing prompt.
- Delivered so it is **read** (visible as Queued per #5216 when the pane is busy).
- Never prompts twice for the same task.

## Key facts established by reading the code (origin/main @ b0859093)

- The idle sweep is wired in the boot block (`server.js:26700–26746`): gates are
  `agentnudge.nudgeEnabled(liveExecution.liveExecutionAllowed(), env)` + `communityturn.brakeOn`
  (operator brake `AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1`), the global community switch
  `communitysend.switchOn()`, the prompter switch `heartbeatSetting.read().on === true`, and the
  per-agent `inCommunity(session)` (its instructions carry the community block). Delivery is
  `chat.deliverAutomatic(session, text, roster)`.
- **Built route**: `server.js:24019`. Async handler. The agent is `card` (`by = card.sessionName`,
  null when `viaScreen` = the person marked it). First build ⇒ `out.changed === true`. There is
  already a `!viaScreen && body.clear !== true && out.changed && card` block (the #6254 `ready`
  phone buzz) — the correct insertion point.
- **Close route**: `server.js:23418` (`/task/<n>/(close|reopen)`). The `act(why, replacedBy)`
  closure is **shared by close and reopen** and is synchronous (`tasks.close` → `sendJson`).
  Agent = `actor` (its token's session name; null when person/viaScreen/untokened). Must prompt on
  **close only**, not reopen.
- **Delivery / #5216**: `chat.deliverAutomatic`. The case that reaches a **busy** pane (the point of
  this card) is a mid-turn composer: chat types the line in and it is **submitted when the turn ends**
  — a `PLACED` verdict with `queued:true`, visible as Queued (#5216). That DID land, so it books.
  **Correction (challenge-loop iter 1):** an earlier draft also booked on `held`, on the belief that
  `inputHold()`'s "kept for the member's next arrival" meant the prompt had landed. It had not —
  `held` is always `state:COULD_NOT` (nothing typed): the agent is paused (quota/cap/menu/usage-limit/
  signed-out) or its composer holds the person's own unsent text (heldBy `input`). The "keep for next
  arrival" is a **room-post** behaviour; this direct event path posts no room and never retries, so a
  held delivery is **not booked** (same as the sweep) — a later mark of the same task can still reach
  the agent. Booking only on `reached` makes the per-task dedup honest and recovers the built→close retry.
- **Shared per-hour cap** `AGENT_NUDGE_SENT` is declared **inside the boot block** (`server.js:26527`),
  so the request handler (`server.js:6315`) cannot see it without lifting it to module scope — a
  refactor of the hot nudge path. The card asks for the same **daily** limits + the community switch,
  which I can honour without that refactor (see Design decisions).
- Test discovery: `run-tests.sh` globs `engine/*.test.js *.test.js` and asserts every `*.test.js` is
  considered (kosmos#1934). A new `engine/communitytaskdone.js` + `engine/communitytaskdone.test.js`
  registers itself — no manifest edit.

## Design decisions (reversible calls, documented)

1. **New engine module `engine/communitytaskdone.js`** rather than extending `communityturn.js`.
   Keeps the heavily-tested idle-sweep untouched (low blast radius) and isolates the event feature in
   its own tested unit. It imports the prompt text's command/number clause so the block's numbers stay
   in one place (#5297 item 3). Pure core + injected reads + its own on-disk dedup book, mirroring
   `communityturn.js`'s shape; **never throws** (a prompt is best-effort and must never fail a mark).

2. **Dedup key = `<projectId>\t<taskNumber>`, one prompt per task ever** (within a retention window).
   This is what makes "a second built mark on the same task sends none" true even across
   built→clear→rebuild, and makes built-then-close prompt only once. Book file
   `communitytaskdone.json` in the data root, atomic tmp+rename via `store.saveFlushed`, unreadable ⇒
   empty (same as `communityturn.json`). Entries pruned after **30 days** to bound the file (a realistic
   re-mark happens within days; documented tradeoff — a re-mark after 30 days could prompt again).

3. **"Same daily limits and the community switch"** implemented as:
   - the **community switch**: global `communitysend.switchOn()` **and** per-agent `inCommunity(session)`;
   - **daily post ceiling**: skip if the agent already has `POSTS_PER_DAY_MAX` posts in the last 24h
     (reuse the sweep's `postTimes`), same as the sweep's `due`;
   - a **per-agent daily event cap** (reuse `communityturn.PROMPTS_PER_DAY = 3`) tracked in the same
     book, so a burst of completions can't spam one agent;
   - all the **on/off gates** the sweep uses (live-exec, agent-nudge brake, community-turn brake,
     prompter switch).

   **Weakest point (named):** the event prompt does **not** count into the boot-block-scoped shared
   per-**hour** `AGENT_NUDGE_SENT` log, because sharing it would mean lifting that array to module
   scope and threading it through the hot nudge path. So in a pathological burst the *combined*
   agent-communication keystrokes could marginally exceed Agent Communication's per-hour cap. Bounded
   by: per-task dedup (one per task) + per-agent daily event cap (3) + the daily-post-max gate. If a
   real burst is ever observed, the follow-up is to lift `AGENT_NUDGE_SENT` to module scope and inject
   it here. **What would change my mind:** if a reviewer shows the per-hour cap is load-bearing for a
   realistic completion rate, I lift the array (it is a mechanical, test-covered move).

4. **Delivery** = synchronous `chat.deliverAutomatic(session, text, roster)` injected into the engine
   (engine stays delivery-agnostic, exactly like `communityturn`). Synchronous ⇒ the server's
   read-book → decide → deliver → write-book is one un-interleaved block per request, so concurrent
   marks can't race the book file. Used in **both** routes. The marking agent's own pane is a
   *different* pane from the built-notice recipients, so no collision with the route's async
   `tellBuiltMark` lines.

5. **Extract `inCommunity` to a module-scope helper** `agentInCommunity(session)` in `server.js` and
   point the existing sweep closure at it, so the route and the sweep share one definition (no drift).

6. **Prompt text** — a task-done-specific line that states the block's post command + numbers and keeps
   "never invent work": e.g. *"Kosmos here: you just marked a task built. If there is one thing from it
   worth sharing — something you finished, learned or got stuck on — post it now with `<POST_CLAUSE>`.
   If there is nothing real to share, do nothing. Never invent work or results to have something to
   post."* (the `closed` variant swaps the verb). The command/number clause is sourced from the block
   (`communityblock.FLOORS` / `MIN_WORDS`) so it cannot drift from the instructions.

## Checklist

- [x] 1. `engine/communitytaskdone.js`: `taskDoneText(trigger)` + `promptOnTaskDone(o)` pure core
      (gates, per-task dedup, daily-post-max + per-agent daily cap, deliver, book update; never throws)
      + `readBook`/`writeBook`/`bookFile` for `communitytaskdone.json`. DONE.
- [x] 2. `engine/communitytaskdone.test.js` (16 tests, all pass): built→one prompt; **second built mark
      on same task → none** (the card's named test); built-then-close → one prompt; close triggers with
      the `closed` wording; each gate off (live-exec / brake / global switch / inCommunity / prompter) →
      no send + no book; a gated-off first mark does NOT burn the task; daily-post-max reached → no send;
      per-agent daily cap reached → no send; a PLACED-into-busy-composer (Queued #5216) ⇒ booked (so a
      second mark is deduped); a HELD verdict (every heldBy, incl. `input`) ⇒ NOT booked (later mark retries);
      busy collision ⇒ NOT booked; bare COULD_NOT ⇒ NOT booked; deliver throw ⇒ UNCONFIRMED+booked;
      unreadable book ⇒ empty; bad input / throwing gate never throws; readBook/writeBook round-trip +
      retention prune. NOTE: "reopen never triggers" is a server-wiring property (the close route guards
      on `taskAct[3]==='close'`), verified by code + the reopen route tests, not an engine unit.
- [x] 3. `server.js`: added module-scope `agentInCommunity(session)`; repointed the sweep closure at it
      and removed the now-unused `cb` require in the sweep. DONE.
- [x] 4. `server.js` built route: after `sendJson` (so the synchronous keystroke never delays the 200),
      guarded by the existing `!viaScreen && body.clear !== true && out.changed && card`, calls the shared
      `promptCommunityOnTaskDone({... trigger:'built'})`. DONE.
- [x] 5. `server.js` close route (`act`): on `taskAct[3]==='close'` with `actor` present and not viaScreen,
      after `sendJson`, calls `promptCommunityOnTaskDone({... trigger:'closed'})` with the actor's display
      name (captured as `actorCard`). Reopen path untouched. DONE.
- [x] 5a. Shared `promptCommunityOnTaskDone` server helper wires the sweep's gates + `chat.deliverAutomatic`
      + the dedup-book read/write; never throws (a prompt never fails a mark). DONE.
- [x] 6. Focused tests green (engine 16/16, communityturn 45/45, built/close route tests 131/131). FULL
      gated suite CLEAN on head a00687b137: 24297 tests, 0 fail (run3; validation-log proof recorded
      clean, hash 90e0389d). An earlier run was killed mid-flight under heavy contention with one
      unrelated flake (#5536 backup/restore perf-ratio, confirmed green alone) — not a regression.
- [~] 7. Freeze lifted (staging serves 0.7.70). Rebased onto current origin/main (zero file overlap
      with the 55-file drift; head now `26a53046`). `/challenge-loop` CONVERGED over 3 blind iterations
      with model rotation (opus→sonnet→opus, kosmos#2032): iter-1 fixed the book-on-`held` booking bug
      (`8e2ea10`); iter-2 fixed 3 WARNINGs — no-op re-close guard (`closedBeforeThisCall`), writeBook
      return surfaced, route-guard pins (new `server.communitytaskdone-5313.test.js`) — plus 3 NITs
      (`26a53046`); iter-3 zero blocker/warning → 6d CONVERGED.
      **6j authoritative heavy validation on `26a53046`: RED, but every red is a contention artifact in
      UNCHANGED files, each confirmed green when re-run alone (triaged, not rubber-stamped):**
        - `server.usage.test.js` hostile-value test: `UND_ERR_HEADERS_TIMEOUT` at 301359ms under full-suite
          load; **alone 5/5 pass in 84s** (route answered 200). Not in my diff.
        - `aw-projects`/`aw-filebrowser` temp-dir LEAK (#4273) from `server.filebrowser-6724`,
          `web.filebrowser-6724`, `server.projects`: **did NOT reproduce alone** — contention-induced
          (a test SIGKILLed at the per-test/per-file limit before its cleanup ran). Not in my diff.
        - **My entire changed surface: 320/320 green alone on `26a53046`** (engine unit +
          `server.communitytaskdone-5313` wiring pins + the 3 rebased pin files + the leak-family files).
      Same wall-clock-flake class the whole fleet is hitting (Kano m6478, Sub-Zero m6474, Sonya #7258).
      **HELD at PR creation.** The box will not go genuinely quiet for a clean local full-suite proof
      (load ~9, `val-acctmodal-7202`'s full suite mid-flight), and whether CI substitutes for the
      required local-alone green is exactly Sub-Zero's m6474 gate question, already in front of Liu Kang
      and unruled. Reported blocked on the board (owner liukang); posted the state + fold-into-ruling to
      the Kosmos Inside Out room. Will NOT stack another full suite and will NOT re-ask the gate
      question. **Resume when:** (a) Liu Kang rules m6474 (apply the precedent to #5313), or (b) a
      genuinely-quiet full-suite window opens → re-run the full suite for a clean proof. Then `/create-pr`
      (push + open PR; reviewer Sonya/Liu Kang, **NOT** joshualeestone on this box; `Addresses #5313`,
      never Closes). Merge gate unchanged: clean local full-suite on the exact PR head + CI green +
      reviewer sign-off + who-has-the-box check in the merge turn.

## Test / verify commands

- Focused: `unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh --only engine/communitytaskdone.test.js`
- Full gate: `unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh` (queued-heavy on a contended box).
