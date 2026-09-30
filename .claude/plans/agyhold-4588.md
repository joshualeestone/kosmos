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
- A hold spends no one-shot budget: first-reply and agent nudge keep their try; the unanswered sweep writes no row;
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
Nothing releases a hold early: a card reading working is no proof the pool refilled, so a hold lasts to its recorded
reset (bounded by MAX_POOL_MS, 8 days). If Google refills early, the timers wait longer than they had to: delay only.
One machine is one Google account (`~/.gemini/antigravity-cli`, measured in PR A). A second account on one machine is
held needlessly until the reset: the safe direction, it costs only delay.

## Decided, not missed
- A held recommender peer is not asked for that item, like any unreachable peer.
- The outbox drain replays an agent's own saved message and is not held, like a live send.
- Connection heal stays on chat.deliver: it counts a try before delivering, and an agy card never reads connection_lost.

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
