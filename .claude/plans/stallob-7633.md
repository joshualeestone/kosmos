# stallob-7633: no second needs-you for an agent a Kosmos helper already gave up on (kosmos#7633)

Stacked on stallpush-7212 (#7212), whose stall push this changes; it merges after #7212.

## The problem
#7212 pushes a needs-you when an agent's card reads "Messages stuck". When a Kosmos helper gave up on the same agent
(its idle nudge, say), the own-bounds sweep (server.js, ownbounds.sweepRoster) already pushes needs-you for it, and the
stall push has its own cooldown class, so the person got two buzzes for one problem.

## The change
deliverystreak.tellStalls takes an optional ownBound(card) hook; server.js passes ownbounds.peek (the same read-only
check /api/status uses). A card whose give-up is raised is left to the own-bounds push. A hook that throws reads as no
give-up, so the stall push still goes.

## Weakest premise
The own-bounds push is itself once per episode, so for an agent stuck for days after its give-up's episode ended and
mooted (peek says not raised), the stall push resumes, which is what we want.

## Tests
engine/stallpush-7212.test.js: a raised give-up is skipped, the rest are pushed, a throwing hook still pushes, no hook
pushes (control). Mutant (skip removed): red.

## Review rounds
- Round 1 (Opus): BLOCKER. Skipping on ownbounds.peek().raised left a stall with NO push when the own-bounds push itself
  never went out (its own needs_you cooldown, push off, Kosmos+ down: it ignores happened's answer and is not retried).
  Fixed: server.js records an own-bounds push only when phonenotify.happened says it went out (taken back when Kosmos+
  says it did not arrive), and the stall push asks ownBoundTold: told within a day, and only for the idle-nudge class
  (a quota or first-reply give-up is not "Messages stuck"). A day later the stall's daily reminder comes back.
  server.stallob-7633.test.js drives ownBoundTold; mutants (record unsent, any class) are red.
  Left as it was (not this card): own-bounds itself marks an episode told before it knows the push went out.
- Round 2 (Sonnet): no BLOCKER. The record is keyed by store.safeKey and the class on both sides (a capitalised or
  dotted name matches; a later quota push no longer overwrites the nudge record); the stall push is held only while
  ownbounds.peek still shows the nudge raised (a give-up that recovered no longer holds a new stall for the day); the
  push is counted before the send and dropped if it did not go, so a sender that answers at once cannot leave a failed
  push counted; entries older than two days are pruned. The test now uses real ownbounds records. Found while testing:
  my first test could not see a key without the class (deleting the nudge record also deleted the quota one), so it now
  has a quota-only case; that mutant is red.
- Round 3 (Opus, final read): no BLOCKER. Both directions now: an idle-nudge give-up whose agent's stall was pushed
  within the day is not pushed again (deliverystreak.stallToldWithin), so the stall-first order and the first sweeps
  after a board restart are one buzz, not two; a quota or first-reply give-up is still pushed. The own-bounds push is a
  named function (tellOwnBound) driven by its test with a fake sender: sent, not sent, a failure answered at once, an
  older failure after a newer push, a sender that throws. Mutants (always drop, never take back, no stall check): red.
- Round 4 (Sonnet, final read): BLOCKER. The reverse skip (round 3) looked only at when the stall was last pushed, so a
  nudge give-up that came after the stall had cleared was swallowed, and own-bounds marks a give-up told before it sends,
  so it was never told. Fixed: tellOwnBound skips only while the agent's card still carries the stall (stallStands, from
  the same roster read the own-bounds sweep uses); a sweep that cannot say pushes. Mutant (stands ignored): red.
  Left as it is: ownboundsPushed is in memory, so a board restart can mean one extra buzz.
- Round 5 (Opus, final read): BLOCKER, the same root as rounds 1 and 4: ownbounds.tellBounds marked an episode told
  before tell ran and never retried, so a nudge held while its stall stood was never told once the stall cleared.
  Fixed at the root: tellBounds leaves an episode unmarked when tell answers exactly false (any other answer, and a
  throw, marks it as before, so other callers keep today's behaviour). tellOwnBound answers false when it held the push
  or the push did not go out, so it is asked again next minute; that also fixes the old loss of a give-up whose push
  hit the needs_you cooldown. Its log lines are said once per episode, not each minute. A test now runs the real
  ownbounds.sweepRoster: held while the stall stands, told once when it clears, not again. Mutant (always mark): red.
  Got wrong in flight: a one-line perl edit with \n in a line-mode pattern deleted the test's roster line; restored by
  an exact edit.
- Round 6 (Sonnet, final read, whole branch, nothing settled): no BLOCKER. "I found no ordering where a real problem
  gets no push." Warnings, each decided, no code change:
  - A board restart can mean one extra buzz (ownboundsPushed is in memory). As round 4: bounded to one push per restart;
    persisting it is new state, filed as its own card.
  - A first-reply give-up can still double with a stall. Kept from round 1: only the idle-nudge give-up is "Messages
    stuck"; a first reply that never came is a different thing to tell the person, and the error is toward two pushes,
    never none.
  - A give-up whose push did not go out (no phone set up, the needs_you cooldown) is asked again each minute and pushed
    once one goes out, while it still stands. Intended: that is round 5's root fix, and a late push for a give-up that
    still stands is true.
  - A stall push that failed twice in a day stays counted and can hold the nudge push for up to a day: #7212's own
    take-back rule (once a day), bounded, not this card's.
  Nits (stale in-memory records pruned at two days, the said-once set wiped at 500, wiring pinned by source): left.
- Validation: full suite on e7504293ce (main merged in), PASSED attempt 1: node 25837 tests, 25430 pass, 0 fail,
  0 cancelled, 407 skipped; shell 4/4 shards all green (304 commands).
