# failover-5382: when a provider rate-limits an agent, its open work can move to an idle agent on another provider

kosmos#5382 (field feedback, beta day): one provider rate-limited, its agents stopped, and Kosmos did not move the work
to another provider the person had connected; moving it by hand cleared the stall at once. Design call on the card
(comment of 2026-10-06 08:3x). Point 2 of the card (one view across worlds) is split to #5393.

## What already exists
- A card reads `rate_limited` from the vendor's own limit line (Claude, Codex, Gemini CLI) or Antigravity's structured
  report (`quotaUntil`; the shared pool's `poolUntil`).
- The Assigner (engine/assigner.js) gives an idle agent the next unassigned task in its projects. A rate-limited agent
  is never idle, so it gets nothing new, but the parts it already holds stay with it until it resets.

## Change (this PR: engine and route, inert until switched on)
- `engine/assigner-setting.js`: a `failover` flag beside `on`, **off by default**; only a stored `true` is on.
  `setFailover`; `setOn` keeps it and `setFailover` keeps `on`.
- `engine/assigner.js` step: each tick it keeps `limitedSince` per agent reading rate_limited (dropped the tick it stops).
  An agent limited for `FAILOVER_MS` (15 min) is ripe, unless its known reset is within `RESET_SOON_MS` (10 min). With
  `failover` on, an idle agent (the Assigner's usual tests: idle card, commitments free, no open work, IDLE_MS) takes a
  ripe agent's open part in a project it belongs to, **only if it runs on a different provider** (`runner`). Stalled work
  comes before the backlog. Never moved: parts on hold, in paused projects, of built, closed or webhook tasks. The
  hourly caps are shared with ordinary assignments.
- `server.js` givePart: `from` makes the write `onlyIfWho: from` plus `failover`, and a pane line that reaches nobody
  hands the part BACK to `from`, not to nobody. The runner logs "(moved from X, rate-limited)".
  `/api/assigner-setting` GET returns `failover`; PUT takes `on` or `failover`, one per request, screen only as before.
- `engine/tasks.js` assignPart: a failover move is refused if the part was finished, or its task built, put on hold or
  its project paused, since it was picked.

## Not in this PR
- The Settings switch (web). Next PR, with design shots for Mona: until then the flag can only be set by the route's
  screen caller, so the behaviour is unreachable for a person.
- The one-press "Give its tasks to another agent" on a paused card.
- (Built in reviews 7 and 8, so no longer out:) the limited agent IS told. Review 8 moved the obligation onto the part
  (`owedTell`): a failover move adds its source (a chain A -> B -> C owes A and B), any move drops the new holder, and
  the mark comes off only when a line naming the part may have reached that agent (tasks.markMoveTold).
  engine/failovertell.js sweeps after every Assigner tick, whatever the setting, telling idle owed agents (at most 3 a
  pass); agyquota's carry-on line names the same list for an Antigravity agent at its reset and marks it once reached.
  So a restart, a setting change, a week-long pause or a missed try still ends in one line (review 7's in-memory
  version lost each of those).
- A per-(part, receiver) backoff after a receiver could not be reached: a failover move and its hand-back can repeat
  each minute while that receiver stays unreachable, as the Assigner's ordinary give already does (review 7 NIT).

## Rejected
- Switching the limited agent's provider: restarts it and, for Codex, Gemini and Grok, drops its conversation.
- On by default: a moved task bills the person's other provider account.
- Moving on the first rate_limited reading: a scraped limit is a warning (#966); 15 minutes lets a misread clear and
  waits out short per-minute limits.
- Same provider, other account: possible later; the reporter's ask was another provider.
- Comparing raw runners: Antigravity and the Gemini CLI can run on one Google account and share the quota that
  stopped the first agent (#4588), so `providerOf` counts them as one provider ("google"). Raised by review 5.

## Weakest premise
That projects have members on more than one provider. If each agent is alone on its project, this never fires and the
remaining path is switching the agent's provider, which this PR does not do.

Second, from review 7: only a limit Kosmos can date moves work. Claude Code prints no date on a limit that resets within
a day, so an ordinary Claude 5-hour limit never triggers failover; a weekly one, Antigravity's quota (quotaUntil) and
the shared pool do. Codex and Gemini CLI limits carry no reset Kosmos reads, so they do not either. That is the safe
side (an old limit line on an idle screen can outlive the limit by hours) and the narrow one: the reporter's case may
well have been a 5-hour limit. What would widen it: a reset time read from Codex's and Gemini's own lines.

## Evidence
- `providerOf` (8847ca0e0): a test that an Antigravity agent's part does not move to a Gemini CLI agent, with a Claude
  control that does; red with the grouping removed.
- `engine/assigner-failover-5382.test.js`, 11 tests on real cards (fleet fixture) and real tasks: moves to another
  provider with `from`; not with failover off (and a control with it on); not to the same provider; not before the period
  and the clock restarts when the card stops reading rate_limited; waits out a reset within 10 minutes, from quotaUntil
  or poolUntil (control: one further off moves); never takes from a card that is not ours; stalled work before the
  backlog, and one stalled part to one receiver; never a part on hold, in a paused project, of a built, webhook or
  finished task; assignPart's write-time refusals (not on `from`, finished, built, on hold, paused) and a recorded move;
  the setting's defaults and independence.
- `server.assigner-failover-5382.test.js`, 4 tests through the real givePart: a delivered move is kept and marked the
  Assigner's; refused unless still on `from`; an unreached move goes back to `from`; and if `from` has left the
  project, to nobody.
- `server.recommender-assigner-2619.test.js`, 3 new route tests: failover reads off by default; set on its own and
  independent of `on`; a non-boolean is a 400 and a process caller is a 403, neither changing the store.
- The reset test caught a real bug on its first run: `Math.max` over a missing reset is NaN, which read as no reset
  known. Fixed.
- Mutations, each red: same-provider check; setting gate; failover period (this one stayed GREEN on the first version of
  the test, because the receiver had not been idle long enough either; the test now starts the receiver's idle clock
  first); the limited clock never resetting; poolUntil; ours; priority over the backlog; one receiver per part; pick-time
  on-hold and paused; write-time finished, built, on-hold and paused; hand-back to nobody instead of `from`; no fallback
  when `from` has left; the route's GET field and PUT field.
- `server.agyhold-4588.test.js` pins the assigner's give closure by its source text; the pin is updated to the closure
  with `from` (it was red on this branch until then, found by running every test that touches the assigner).
- Every test file that touches the assigner or its setting, run directly: assigner, assigner-setting, assigner-free-4552,
  assigner-failover-5382, tasks, tasks.built-3951, onhold-4771, agentnudge, agyhold-4588 (engine and server),
  server.assigner-give-3595, server.assigner-failover-5382, server.recommender-assigner-2619, web.settings-nav: green.

- Review 6 pins (e2d28e6da), each with an arm that must fire and a control, each red under its mutation:
  - movedFrom recorded by a failover move (mutation: never recorded, red); an ordinary move clears it (mutation: not
    cleared, red); control: an ordinary move never records it.
  - Bug found by that test: assignPart stored movedFrom but tasks.partsOf rebuilt parts without it, so every reader
    (server movedAwayFrom, the agyquota carry-on line) saw nothing and the next write erased it. partsOf now carries it;
    a later addPart keeps it (mutation: partsOf drops it, red).
  - A task closed as a whole with its part open refuses a failover move; control: reopened, it moves (mutation: the
    t.closedAt check removed, red).
  - nudgeText: none, empty and throwing movedAway give exactly NUDGE_TEXT; one item is named with "leave it to them",
    asked about the right agent and window (mutations: empty list not plain, throw not caught, one item says "those":
    each red).
  - sweepOnce passes o.movedAway into the delivered line; control: without it the plain line (mutation: NUDGE_TEXT
    delivered directly, red).
  - setFailover on a corrupt file is ok:false and leaves the bytes untouched; control: a good file is written (mutation:
    read().ok guard removed, red).
  - PUT /api/assigner-setting with both on and failover is 400 "change one setting at a time" and stores neither;
    control: failover alone is 200 (mutation: guard disabled, red).
  - The receiver's pane line for a failover give says "It was moved to you from <from>"; control: an ordinary Assigner
    give's line does not (mutations: note never sent, note on every give: both red).
  - movedAwayFrom (server.js) is not exported and is wired only inside start(), so it has no direct test; its input
    (movedFrom read through progressOf) is pinned above.

- Review 7 (blind, opus), each pinned and mutation-checked (32d9b236a): an undated Codex/Gemini limit moves nothing
  (red when it does); tick reads runners through readRunner and a throwing read is unknown (red when tick ignores
  them); a lifted limit is reported once and only with failover on (red when never reported); an unrecognised runner
  has no provider (red without the check); a refused failover move names the real reason; source pins for the
  readRunner and tell wiring and failoverTell's Antigravity skip and empty-list return.
- After the rebase onto main: a repeating task between runs (#4787) is not moved (red without the skip).

- Review 8 (blind, opus), each pinned and mutation-checked (b58e4ce99, 2d31a4d69): a chain owes every source (red
  when the record is not carried over); a hand-back or a person's move to the agent drops it (red when the holder is
  kept); partsOf carries owedTell (red when dropped); the sweep marks only a line that may have reached the pane (red
  when it marks a COULD_NOT); a held verdict and an owed holder, on hand-built input (red without each defensive arm);
  agyquota marks nothing when its line reached nothing (red when it does); failoverRunnerOf ends in null, not claude
  (source pin, red with the claude floor). Every test file that touches parts, the assigner or agyquota: 854/854.

- Review 9 (blind, opus), each pinned and mutation-checked (841eb7f4a): the line is said only about a part somebody
  else holds, in a live project the agent is still on and not switched off in (4 arms, each red when removed); only
  lines that may have landed count toward the cap, a card must read idle at two passes running, and skip(card) is
  honoured (3 arms, each red); the server reads no roster unless a part is owed, and leaves Antigravity agents to
  agyquota while its resume is on (source pins); markMoveTold changes owedTell only.

- Review 10 (blind, opus), each mutation-checked (a7e2bcb8b): the tell sweep no longer skips Antigravity agents (a skip
  left one untold for good when agyquota's carry-on line never came); its line to one adds "carry on with the rest", so
  whichever line lands first does the whole job (red when the resume wording is dropped, or given to every runner); a
  finished part stays owed and is named "finished by B" (red when dropped); anyOwed shares owedFor's rule (red when it
  counts records nobody can be told).

- Review 11 (blind, opus), each mutation-checked (654cbd7da): the tell sweep never tells anybody to carry on (red when
  it does); an Antigravity agent is skipped only while agyquota.resumePending (resume switched on, plan() nudge or wait
  for the current pause), and told plainly otherwise (red when the brake is ignored, or a waiting resume is not
  pending); the seen-idle memory is cleared when nothing is owed (source pin).
- Decided, from review 11's NIT: a moved part stays with the agent that took it, a repeating task included, so after
  a failover the repeating job runs on the other provider until a person moves it back. The Settings copy (next PR)
  says the work moves; a per-(part, receiver) backoff for an unreachable receiver is a follow-up.

- Review 12 (blind, opus): the tell starts a turn like any typed line, so it asks for a one-word reply (red when the
  sentence is dropped); "finished by B" only for a part B finished, "closed" for a whole-task close (red when credited).
- Review 13 (blind, opus): a part a PERSON gave the agent after its limit began stays with it (red without the skip).
  KNOWN LIMITATION, decided: the tell lands when the agent next reads idle, so a person who resumes a Claude agent
  themselves (Enter on Claude Code's limit menu, or a message right at the reset) can have it carry on with a moved part
  before the tell arrives. The full fix attaches the owed line to whatever message resumes the agent (the delivery
  path), which is a follow-up card, not this off-by-default PR.

- Review 14 (blind, opus): every way a person gives work counts for "stays during the limit" (personGiveAt: a page
  move, a part added on the page, a task created on the page with the agent on it); red when either path is dropped.
- Review 15 (blind, opus): the limit clock is saved with the Assigner memory and needs two missed readings to clear, so
  a restart or one misread tick cannot let a person's queued work move (red without saving, red without the debounce).
  This replaces the earlier "limitedSince is not saved" note.

## Not measured
- A real rate-limited agent on a live board (the tests use the fleet fixture's Claude limit line).
