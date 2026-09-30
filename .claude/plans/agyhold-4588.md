# agyhold-4588: automatic senders hold while the shared Google quota is out (#4588 PR B)

Card: #4588. Stacked on PR A (branch agyquota-4588, not yet merged). Design and its correction are on the card
(comments 5903144658 and 5903315136).

## Call
- engine/agyquota.js `poolHeldUntil(roster, now)` / `heldForQuota(session, roster, now)`: Antigravity sign-in is
  machine-wide, so while any antigravity card's `quotaUntil` is ahead of now, every antigravity card is held.
- engine/chat.js `deliverAutomatic`: for timers only. Held: `COULD_NOT` with `held: true` and `heldUntil`, nothing
  typed. Otherwise it is `deliver`. A person's own message uses `deliver` and is never held.
- Callers: the unanswered sweep (messages.js), auto-handoff, connection heal, first-reply nudge, account notice,
  recommender, assigner ask, agent nudge (server.js closures), auto-retell (`retellMember(..., { automatic: true })`
  through `speakOfMembership`). PR A's resume sweep stays on `deliver`.
- A hold spends no one-shot budget: first-reply and agent nudge keep their try; the unanswered sweep writes no row;
  the assigner refunds its ask charge with no failure counted; the recommender does not convene a held stuck agent.
- The assigner does not pick a held agent (its idle clock is kept); `givePart` in assigner mode refuses a held agent
  before assigning, as a backstop.

## Rejected
- A check inside `chat.deliver`: it cannot tell a person from a timer.
- A fourth DELIVERY state: chat.js documents that every refusal before the first keystroke is COULD_NOT.
- A server-side wrapper around the closures: the unanswered sweep calls chat directly and would be missed.
- Holding only the card that hit the error: its colleagues on the same account are the ones still spending.

## Weakest premise
One machine is one Google account (`~/.gemini/antigravity-cli`, measured in PR A). A second account on one machine is
held needlessly until the reset: the safe direction, it costs only delay.

## Decided, not missed
- A held recommender peer is not asked for that item, like any unreachable peer.
- The outbox drain replays an agent's own saved message and is not held, like a live send.
- Connection heal is routed through the gate for uniformity; an agy card never reads connection_lost.

## Measured
- engine/agyhold-4588.test.js 16/16, engine/agyhold-deliver-4588.test.js 4/4, server.agyhold-4588.test.js 15/15.
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
