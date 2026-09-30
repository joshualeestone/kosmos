# agyhold-4588: automatic senders hold while the shared Google quota is out (#4588 PR B)

Card: #4588. Stacked on PR A (branch agyquota-4588, not yet merged). Design and its correction are on the card
(comments 5903144658 and 5903315136).

## Call
- engine/agyquota.js `poolHeldUntil(roster, now)` / `heldForQuota(session, roster, now)`: Antigravity sign-in is
  machine-wide, so while any antigravity card's `quotaUntil` is ahead of now, every antigravity card is held.
- engine/chat.js `deliverAutomatic`: for timers only. Held: `COULD_NOT` with `held: true` and `heldUntil`, nothing
  typed. Otherwise it is `deliver`. A person's own message uses `deliver` and is never held.
- Callers: the unanswered sweep (messages.js), auto-handoff, first-reply nudge, account notice,
  recommender, assigner ask, agent nudge (server.js closures), auto-retell (`retellMember(..., { automatic: true })`
  through `speakOfMembership`). PR A's resume sweep stays on `deliver`.
- A hold spends no one-shot budget that a delivery could have used (a STOPPED agent's retell line is refused with or
  without a hold, as before this branch): first-reply and agent nudge keep their try; the unanswered sweep writes no row;
  the assigner refunds its ask charge with no failure counted; the recommender does not convene a held stuck agent.
- The assigner does not pick a held agent (its idle clock is kept); `givePart` in assigner mode refuses a held agent
  before assigning, as a backstop.

- The schedule (SUPERSEDED by reviews 4 and 5; the current rule is under review 5 below): each agy agent's last-seen reset is remembered by session (a card that shows a new
  reset corrects only itself; an entry is dropped once served; resets over 8 days ahead are not believed). The pool is
  paused until the latest of them. After it (R), the resume owns the first slots, R + GRACE_MS + k * STAGGER_MS, and
  waits the grace after R even for an agent whose own reset came earlier; the held senders come back one agent per
  slot after that, R + GRACE_MS + (n + i) * STAGGER_MS, i by session name.

## Rejected
- A check inside `chat.deliver`: it cannot tell a person from a timer.
- A fourth DELIVERY state: chat.js documents that every refusal before the first keystroke is COULD_NOT.
- A server-side wrapper around the closures: the unanswered sweep calls chat directly and would be missed.
- Holding only the card that hit the error: its colleagues on the same account are the ones still spending.

## Weakest premise
The pool is one per machine, not per model. The card's evidence is Google's plans page as quoted by the user's team
("every agent signed in to the same Google account draws on the same 5-hour allowance and the same weekly allowance"),
and all six of their agents ran one model. A per-model quota is unmeasured; if it exists, one model's pause holds the
other models' agents until its reset (delay only, bounded by MAX_POOL_MS).
Nothing releases a hold early: a card reading working is no proof the pool refilled, so a hold lasts to its recorded
reset (bounded by MAX_POOL_MS, 8 days). If Google refills early, the timers wait longer than they had to: delay only.
One machine is one Google account (`~/.gemini/antigravity-cli`, measured in PR A). A second account on one machine is
held needlessly until the reset: the safe direction, it costs only delay.

## Decided, not missed
- A held recommender peer is not asked for that item, like any unreachable peer.
- The outbox drain replays an agent's own saved message and is not held, like a live send.
- Connection heal stays on chat.deliver: it counts a try before delivering.
- Review WARNING 2 (no persistent hold state; after a board restart the hold reappears only while a card still shows
  quotaUntil ahead): KEPT. It fails toward typing one line into an empty pool, which the agent then reports (and that
  report re-arms the hold); persisting the pool memory is a later card.
- Room deliveries (review WARNING 1): a colleague's room post, addressed or not, is automatic from the member's side and
  goes through deliverAutomatic / the new deliverAutomaticAsync; the person's post (operator: true) stays on deliver /
  deliverAsync and is never held. External (federated) rows are only recorded, never typed, so they need no gate. A held
  post is kept in the member's #4624 roomhold list (its id marked '@' when it names the member, so the later line says
  which posts ask for an answer instead of "nothing is asked of you"), and counts as placed for the sender (no re-post).
  The #4624 idle flush now uses deliverAutomaticAsync: a held verdict is COULD_NOT, which restores the ids.
  RETRY: nothing re-typed a held post once the pool refilled if the agent's idle report came while its own timers were
  still held (the release is one agent per slot) and no further room post arrived. Added roomhold.flushReleased, run in
  the existing one-minute unanswered sweep, antigravity cards only, skipping a fresh `working` member (as #4624 does).
  With AGENT_WORKFORCE_ROOM_HOLD_OFF=1 the flushes are off, so a quota-held post is told only on the next typed arrival.

## Measured
- First build: engine/agyhold-4588.test.js 16/16, engine/agyhold-deliver-4588.test.js 4/4, server.agyhold-4588.test.js 15/15
  (the review iterations below add to these and give the current counts).
- With the existing files of the touched modules: 244 run, 1 red (PR A's resume-timer pin anchored on the FIRST
  require of engine/agyquota, which givePart's new require now precedes; re-anchored on `const agyQuota = require`).
  The agentnudge Prompter-tick pin counted `deliver(`; it now counts `deliverAutomatic(` too.
- 27 mutations by the test author, each reddening its intended arm; plus the assigner step skip removed: exactly the
  step-held test reds.
- NOT yet: the full suite (other existing pins may count these call sites).

## Review iteration 1 (blind, opus)
- (W) FIXED: the auto-retell spent its one retell per change (and wrote the instructions) before the held line, so the
  "listed" line was lost for the whole pause. The hold is now in autoretellTick's ready(): not ready, looked at again.
- (W) FIXED: every held sender fired at every agy agent in the minute the pool refilled, ahead of PR A's staggered
  resume. The pool now stays held for GRACE_MS + STAGGER_MS per agy agent after its reset. A card drops quotaUntil at
  its reset, so the latest reset is remembered in memory (POOL_MEMO; a board restart forgets it: that one tail is lost).
  And the resume sweep resumes nobody while any agy card is still paused (one pool, not one reset per card).
- (W) FIXED: heldForQuota found the card by exact sessionName while deliver uses chat.resolveCard; it now uses
  resolveCard, so the gate and the delivery mean the same card.
- (N) FIXED: the quota hold's act is quota-held (agentnudge's hourly cap already said held); a held recommender item
  is logged once per pause; the assigner comment names deliverAutomatic.
- (N) LEFT: the timer-closure pins are a hand-written list (a new timer on chat.deliver is not caught); the givePart
  pin checks order, not brace nesting; a held recommender peer is not asked for that item (decided above).
- Measured: 260/260 across the new files and the touched modules' files. Mutations: no release tail, the resume
  ignoring the pool, and ready() not held each red exactly their own test.

## Review iteration 2 (blind, sonnet)
- (W) FIXED: connection heal counts a try before delivering, so the gate could only spend its budget; it is back on
  chat.deliver (an agy card never reads connection_lost). Pinned as staying on deliver.
- (W) FIXED: the resume sweep asked only the cards while heldForQuota also asked the memory, so a card that stopped
  showing its pause before the reset let the resume type into the still-empty pool. Both now ask poolPausedUntil.
- (W) FIXED: the tail ended in one burst. Each agy agent is now released at its own slot after the reset (grace plus
  one stagger per agent before it by session name); the last one ends with the whole tail.
- (W) FIXED: the memory only rose and was never bounded. While cards show a pause it takes their current latest reset
  (a corrected card lowers it), and a reset over 8 days ahead is not believed (Google's longest window is a week).
- (N) FIXED: the assigner's held-ask branch is marked as a backstop.
- (N) LEFT: the recommender playbook tells a stuck agent nobody could be reached when peers were merely held (decided);
  whether the unanswered sweep's age window can outlast a long pause (not checked; the nudge is not spent by a hold).
- Found while fixing a pin: the pins' comment stripper did not know regex literals, and a quote inside one put it out
  of step from server.js line 3914 on, so every later comment survived stripping (the pins were right only because
  few comments name those calls). It now handles regex literals, and a guard asserts that no pure // comment line of
  server.js survives; switching regex handling off reds that guard.
- Measured: 287/287 across the new files and the touched modules' files (connlost-heal added). Mutations: the memory
  only rising, no 8-day cap, the whole tail for everyone, and the resume ignoring the memory each red exactly their test.

## Review iteration 3 (blind, opus)
- (W) FIXED: the resume and the per-agent sender release ran on two schedules that overlapped (two agents drawing on
  the refilled pool in one step, a timer line before an agent's own resume, no grace for an agent whose own reset came
  earlier). The resume now owns the first n slots after the pool's reset and waits the grace after it; the senders
  come back one per slot after those.
- (W) FIXED: the memory could not tell a correction from a disappearance (a later card that stopped showing its pause
  reopened the pool at an earlier card's reset). It is now kept by session.
- (C) FIXED: the plan said connection heal is gated and gave stale counts.
- (N) FIXED: givePart checks the hold on the roster it delivers with; the held recommender log cannot grow.
- (N) LEFT: with the resume switched off (AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1) the memory is fed only by a sender
  that targets an agy card; the scanner's regex heuristic still cannot see a regex right after `)` (the whole-file
  guard catches the desync that would cause); a held recommender peer is not asked for that item (decided).
- Measured: the three new files 24 + 4 + 17, plus the touched modules' files: 289/289. Mutations:
  memory of only what cards show now (6 tests red), senders sharing the resume's slots (3 red), no pool grace for the
  resume (1 red).

## Review iteration 4 (blind, sonnet)
- (W) FIXED: the fixed sender slots assumed the resume moves one agent per STAGGER_MS; it moves per 60 s tick, backs
  off on a failed try, and orders by reset, so a sender could land before an agent's own resume. The release now
  follows the resume's real progress: the resume sweep records pending or done for the pool's reset; every agy card
  is held while it is pending; agent i comes back at done + (i+1) * SLOT_MS (SLOT_MS is the longer of the stagger and
  the 60 s tick), by session name. If the resume never reports for a reset (switched off, or a board restart), a
  fallback sized for every agent's resume with all its tries stands in. Memory entries drop MAX_AGE_MS after their
  reset. This replaces the fixed schedule of review 3.
- (W) FIXED: a held peer was not asked and the playbook said nobody could be reached. A fresh recommender item now
  waits while any of its peers is held.
- (W) MEASURED, no change: unanswered() has only a lower age bound (UNANSWERED_AFTER_MS), so a nudge held through a
  long pause is still due after it; said so beside the hold.
- (N) LEFT: heldForQuota fails open if chat.js cannot load (then nothing works anyway); poolHeldUntil is exported for
  tests only; givePart's held 409 is read by the assigner as a plain refused give, which refunds its charge.
- Measured: engine/agyhold-4588.test.js 25/25 and the full targeted set 290/290. Mutations: pending ignored (2
  tests red), the done time moving every sweep (1), the recommender not checking peers (1).

## Review iteration 5 (blind, opus): the release is decoupled again (supersedes review 4's resume-driven schedule)
- (W) FIXED by removal: review 4 made the senders wait on the resume's reported progress, which added a way to be stuck:
  a pending report that never cleared (one agent with an implausible reset, or the resume switched off after it
  reported pending) held every agy agent until the memory's prune, measured by the reviewer at 6 h. Now, after the
  pool's reset R, agent i (by session name) is released at R + GRACE_MS + (i + 1) * SLOT_MS and waits on nothing.
  DECIDED: a timer line and a resume may then reach different agents in the same minute; the pool has refilled, and
  each stream still goes one agent at a time. That was the only gain of the coupling, and it cost a stuck state.
- (W) FIXED: the recommender held a stuck agent on ANOTHER runner for a whole Google pause if one peer was agy. It now
  holds an item only when the stuck agent itself is held; a held peer is left out of that convening's asks.
- (W) FIXED: nothing released the memory on evidence the pool serves. An antigravity card seen working now clears it
  (a turn that is refused records a new pause). Entries also drop once their release has passed.
- (N) FIXED: docstrings for sweepOnce's memo and assigner step()'s read of the pool memory.
- (N) LEFT: poolHeldUntil is the stateless reading, used by tests; a STOPPED agy card's automatic retell line is held
  with the quota as its reason rather than unreachability (COULD_NOT either way).
- Measured: engine/agyhold-4588.test.js 25/25; the targeted set 290/290. Mutations: a working agy card not clearing the
  memory, held peers still asked, and everyone released at once each red exactly their own test.

## Review iteration 6 (blind, sonnet)
- (W) FIXED by removal: review 5's "an antigravity card seen working clears the memory" released every held timer at
  once after the reset (the first resumed agent reads working), and during the pause a working card is no proof the
  pool refilled. Dropped; now named as the weakest premise.
- (W) FIXED: a pane on this machine that is not ours (isNamedOurs false) counted toward the pool and the release
  order. Only our antigravity panes count now.
- (N) FIXED: the recommender's held is a plain boolean; the peer filter makes a new array for this convening only
  (checked: step()'s own peers list is not mutated). poolHeldUntil is marked as the stateless reading.
- Measured: engine/agyhold-4588.test.js 26/26; the targeted set 291/291. Mutations: working clearing the
  memory again, and strangers counted, each red exactly their own test.

## Review iteration 7 (blind, opus)
- (W) FIXED: a regression this branch introduced into PR A's path. The resume now waits for the POOL's latest reset,
  but PR A's six-hour window counted from each agent's own reset, so an agent whose reset came over six hours before
  another's was never resumed (the reviewer simulated it). plan() now counts from the later of the two, and pool
  memory is kept MAX_AGE_MS past its release (it holds nobody after an agent's step).
- (W) FIXED: filtering held peers out of item.peers made the playbook say "No one else is on this project". A held
  peer is now not asked but stays in item.peers, so it reads as "could not be reached".
- (C) FIXED: poolPausedUntil's comment named callers it did not have. It and poolHeldUntil (test-only second copies of
  the pool rule; one counted panes that are not ours) are deleted; tests use notePool with a fresh memory.
- (N) LEFT: account-notify logs not-delivered each minute while a manager is held (behaviour right, log noisy);
  stopped agents take a release step (delay only); PR A's resume loop counts any antigravity card while the pool
  counts only ours (PR A's code, not changed here).
- Measured: engine/agyhold-4588.test.js 28/28; the targeted set 293/293. Mutations: the resume age ignoring the pool
  (1 red), held peers asked (2 red), the peer filter reintroduced (1 red: the wording test).

## Review iteration 8 (blind, sonnet)
- (W) DEFERRED, measured: the release slot and prune horizon come from the roster each caller passes, so a subset
  roster would shift them. Every gated sender passes safeRoster() cards (measured in server.js: the unanswered sweep,
  auto-handoff, first-reply, account notice, recommender, assigner, agent nudge, and the auto-retell's board()), so
  they all see the same full cards. A future sender with a thinner roster would get later or earlier steps (delay
  only) and, without quotaUntil, no hold.
- (W) DEFERRED: a STOPPED agy agent is ready() for the auto-retell before the hold check, so its one retell is spent
  and the listed line comes back COULD_NOT. A stopped pane refuses that line with or without a hold, exactly as before
  this branch, and the instructions write it needs happens either way. The plan's "no one-shot budget" line is
  narrowed to say so.
- (N) LEFT: a held fresh recommender item's hourly charge counts inside that one step before its refund (transient);
  other suites could leak POOL_MEMO only with antigravity cards carrying quotaUntil (none do); the resume waits for
  the whole pool, bounded by MAX_POOL_MS (the PR description will say so).

## Review iteration 9 (blind, opus)
- (W) FIXED: review 7's age-window extension applied to ANY later pool pause, so a pause that began days after an
  agent's own window had closed revived a stop PR A deliberately leaves alone (reproduced by the reviewer; reachable
  after a board restart). The memory now records when each pause was first seen, and heldBackBy extends an agent's
  window only by a pause first seen while that window was still open.
- (N) FIXED: connection heal's stated reason is only the counted try; the unmeasured "an agy card never reads
  connection_lost" is gone from the code, a test title and the plan. The memory comment says exactly when an entry
  is dropped.
- (N) LEFT: account-notify logs not-delivered each minute while a manager is held; deliverAutomatic reads Date.now()
  while autoretellTick passes its own now (no difference in production).
- Measured: engine/agyhold-4588.test.js 29/29; the targeted set 294/294. Mutations: any later pause extending
  (the late-pause test reds), and no extension at all (the held-back test reds).

## Review iteration 10 (blind, sonnet)
- (W) FIXED: a repeat pause of the same agent kept the first-seen time of its earlier pause (the guard only set it
  once), so it could pass as a pause that began inside another agent's window and revive a closed stop. A new pause
  after the old reset now records a fresh first-seen time; a correction of a reset still ahead keeps it.
- (W) FIXED: the prune horizon came from the roster of whichever caller prunes; it is now a constant, 2 * MAX_AGE_MS
  after the reset. A lingering entry holds nobody past its agent's step, and heldBackBy is gated by first-seen.
- (N) LEFT: account-notify's not-delivered log while a manager is held; deliverAutomatic reads Date.now().
- Measured: engine/agyhold-4588.test.js 30/30; the targeted set 295/295. Mutation: first-seen kept on a new pause
  reds the repeat-pause test.

## Review iteration 11 (blind, opus)
- (W) DEFERRED with evidence: the pool is per machine, and Antigravity's quota could be per model (unmeasured). The
  card's evidence (Google's plans page as quoted by the user's team; six agents on one model) says one account is one
  pool. Named under Weakest premise: if it is per model, the error only delays.
- (W) DEFERRED to the card: an agent whose own reset passed reads "the quota reset at R_A" while the pool holds it to
  a colleague's later reset. The card said the same before this branch (and its resume then typed into the empty
  pool), so this is not a regression; the fix belongs in status.js and is the "show the shared pool" part of #4588's
  own title. Recorded on the card (comment 5903897664), to be taken after this PR.
- (C) FIXED: plan()'s doc comment sat above heldBackBy; each comment is on its own function. sweepOnce's docstring
  reflowed.
- (N) LEFT: quota-held results in first-reply and the agent nudge are not logged (they are in results); deliverAutomatic
  reads Date.now().
- Measured: engine/agyhold-4588.test.js + engine/agyquota-4588.test.js 38/38 (comment and plan changes only).

## Review iteration 12 (blind, sonnet): CONVERGED (no new BLOCKER, WARNING or CONVENTION after dedup)
Its three WARNINGs match ledger entries already DEFERRED with reasons: the roster each caller passes (iteration 8,
measured: every gated sender passes safeRoster()); a pause the board never observed after a restart (Weakest
premise); POOL_MEMO shared by modules whose step reads it (iteration 8 NIT). NITs left: ready() reads board() twice;
quota-held results are not logged; a comment wrap.
NEXT: the full validation (the closing gate) and the proof, after PR A (agyquota-4588) is validated and merged,
since this branch is stacked on it.

## Rebased onto main after PR A merged (fd4dd0383), 2026-09-30
- Old head 3a86d5420 (it had PR A merged in twice: 5766f4b89 and 3a86d5420). New base origin/main fd4dd0383, the
  squash of PR A (#4718). Measured: `git diff 97296405f fd4dd0383` is empty, so the squash holds exactly PR A's last
  head, #4618's resolution in bin/agy-report-bridge.js included.
- How: `git -c core.commentChar=";" rebase --onto origin/main 97296405f agyhold-4588` (97296405f = PR A's final head,
  origin/agyquota-4588). Rebase rather than cherry-pick because the upstream cut is one ref and the rebase drops
  every commit reachable from it in one step. Dropped: the two merges of PR A (5766f4b89, 3a86d5420) and, with them,
  every PR A and main commit they carried. Neither merge held a resolution of its own (`git show --cc` empty for
  both). Kept: this branch's 25 non-merge commits, 1f6eb7e46 through 1584bea20. range-diff: 24 identical, 1 changed.
- One conflict, in 1f6eb7e46, engine/chat.js module.exports: main's #4607 added `answerCodexHooks`, this branch
  added `deliverAutomatic`. Both kept. No value a test measures was involved.
- Check: `git diff origin/main HEAD` is exactly this branch's 15 files, +1584 / -30, the same stat as the old head
  against PR A's head.
- Focused tests on the rebased head, one node --test run with the runner's two guards, 53 files: 1131/1131, rc 0
  (agyhooks, every 4588 file, musefront, engine/status.test.js and the status 4569 file, the selfreport files,
  goldencard-2519, report-readback-2709, report-refusal-4606, the four browser-check guards, fixture-discipline, and
  the agentnudge / assigner / recommender / firstreply / messages / chat files this branch touches). Both
  browser-check gates rc 0. No web/ change, so no browser check is selected.
- Review: the 12 blind iterations above ran on the pre-rebase tree; the rebase changed one export line.

## Review WARNING (room deliveries, idle flush), 2026-09-30
- Tests: engine/roomhold-agyhold-4588.test.js 11/11; server.agyhold-4588.test.js gains 3 pins. Focused set (every
  4588, agyhooks, messages, chat, roomhold test file, fixture-discipline, the four browser-check guards): 34 files, 617/617.
- Mutations, each restored and cmp-checked: the gate removed from room posts (6 red), deliverAutomaticAsync ungated
  (3 red), a held verdict not kept (6 red), the retry ignoring `working` (1 red, its CONTROL), the person's post gated
  (1 red, its CONTROL), the server idle flush back on chat.deliverAsync (1 red, its pin).

## Review round 2 after the room WARNING fix, 2026-09-30: 0 BLOCKER, 2 WARNING, 3 NIT
- **W1 FIXED.** With AGENT_WORKFORCE_ROOM_HOLD_OFF=1 a quota-held room post was still kept by roomhold.hold(), and
  flushOnIdle / flushReleased return nothing with the brake on, so it was stranded while reading as placed. Now the
  quota branch keeps it only when the brake is off; with the brake on it is COULD_NOT (not reached), which the sender
  sees. Rejected: typing it anyway, since the member's quota is out and it cannot act on it; the brake restores "not
  held", not "typed into a paused agent". Test arm reds with the off() check removed.
- **W2 FIXED (the data half).** A quota-held member now carries `heldUntil[name]` (ISO, from deliverAutomatic's
  heldUntil) beside `outcomes[name] = HELD`, in the reply and the stored row, present only when something was held
  (an ordinary row is byte-unchanged; a CONTROL arm pins that). No UI reads it yet: saying "held until <time>" in the
  room is a follow-up card for the room UI. Test arm reds with the assignment removed.
- **NITs, decided not built:**
  - flushReleased can type a held line mid-turn when the member made no working report for 5 minutes. Kept: the
    same staleness rule the #4624 idle flush already uses; a stricter rule would strand posts on agents that never
    report.
  - KEEP=200 drops the oldest held ids. Kept: 200 posts held for one member in one room within one quota window is
    not a real case, and the cap exists so a runaway sender cannot grow the file without bound.
  - Nudge versus pointer ordering after the reset. Kept: both arrive in the same minute and each is self-contained.
- Weakest premise: that COULD_NOT is the right brake behaviour. If the brake is meant to mean "exactly the pre-#4588
  behaviour", the answer would be to skip the quota gate entirely under the brake; that is one line and reversible.

## Review round 3, 2026-09-30: 0 BLOCKER, 1 WARNING, 4 NIT
- **WARNING FIXED, and it reverses round 2's W1 call.** Round 2 made a quota-held room post COULD_NOT under the brake.
  Round 3 showed the cost: a post whose only recipient is the paused member reaches nobody, so the whole post is
  refused and never enters the room log. Now the brake skips the quota gate for room posts (typeInto uses
  deliverToPane when roomhold.off), which is what roomhold.js's "types every post as before" always promised; the
  finish branch's off() check is removed as dead. Two arms: typed-as-before, and the single-recipient post is stored.
  Both red against the round-2 code; the first reds with the brake removed from typeInto (the second cannot, since
  without the brake check the post is held and logged, which is also not a loss).
  Weakest premise: typing into a quota-paused agent under the brake is useless to that agent until the reset. The
  brake is an escape hatch from a hold bug, and "as before" is the behaviour its operator is choosing.
- NITs, decided not built:
  - Round 2's "nothing ever flushes a hold" overstated: the next typed arrival still carries a held line. Moot now,
    since nothing is held under the brake.
  - The new arms cover the sync path only. finish() and typeInto are shared by sendPostAsync; the existing async arm
    covers the hold itself.
  - heldUntil is when the quota gate opens, not when the post is told (flushReleased skips a working agent). A UI
    must say "held until at least <time>"; noted for the room UI follow-up card.
  - A throw mid-loop leaves earlier members' holds with no logged row, and the next post can reuse the id.
    Pre-existing (#4624's putBack), made likelier by PR B marking ids as addressed. Follow-up card, not this PR.
