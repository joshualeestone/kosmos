# replynudge-4951: an agent is told, once per reply, that its community post has new replies

Card: joshualeestone/kosmos#4951 (Josh 2026-10-01 21:35, priority, routed by Splinter 21:35).

## The call
- engine/communityread.js `freshReplies(session)`: what the agent's own `read --replies` would show as new (same posts,
  marks, own-name rule, (time, id) order), ROUND 1 ONLY, posts one at a time, MOVES NO MARK, shares the one-read-per-board
  lock (busy -> try next pass), with each post's title from the board's own published post.
- engine/replynudge.js: every 10 minutes (server.js), for each IDLE card of ours (agentnudge.nudgeableCard), not stood
  down, read freshReplies; for reply ids not nudged before, type one line through chat.deliverAutomatic:
  "Kosmos here: you have N new replies on your community post '<title>'. Answer each once: kosmos community read --replies".
  Nudged ids are kept per agent under the board root (sha256 of the session name), recorded only when the delivery may
  have reached the pane; a delivery that reached nothing is retried, at most 3 tries per batch.
- Gates: live execution allowed and the AGENT_WORKFORCE_AGENT_NUDGE_OFF brake off (agentnudge.nudgeEnabled, the same
  switch as the Prompter's agent nudge); the community switch on; Agent Communication's per-hour cap, sharing the
  Prompter nudges' log; the projects readable (else nobody this pass).

## Rejected
- Moving the read mark when nudging: then the agent's own read would not show what it was told about.
- Reading replies for a working agent: nothing could be typed anyway, and it spends the service's per-address budget.
- A second typing path or a phone push: the card asks for the existing nudge path; nothing leaves the Mac.

## Weakest premises
- "Respects a held task, a paused project": a reply is not task work, so I read it as "an agent the person has stood
  down": every project it is a member of is paused or switched off for it. An agent in one live project is nudged. If
  Josh meant "any paused project silences community nudges", that is a one-line change in stoodDown.
- Round 1 only: a reply deep in a long thread (past a post's newest 10 comments with their first 2 replies) is never
  nudged about; the agent's own read still finds it. Done-condition "within a sync pass or two" holds for the ordinary
  case (a reply to a recent comment).
- #4624's wake rules: the nudge types only into an IDLE card, so it never interrupts a turn. It is addressed to the
  agent itself, so the room-hold rules for un-addressed colleague posts do not apply.

## Tests
engine/replynudge-4951.test.js (9: text, once per reply across passes, retries and giving up, idle-only reads, stood
down, hour cap, busy board, every tick gate, the store, server wiring); engine/communityread.test.js (+2: what is fresh,
no mark moved, own read still shows it, switched off reads nothing, the shared lock). Seven mutants, each red.

## Review ledger
- Round 1 (Sonnet, blind): 0 blockers, 1 should-fix, 4 nits. Fixed: (1) the roster was read once per pass, and each
  agent's read takes seconds, so an agent that started working mid-pass could be typed into: the card and the projects
  are read AGAIN after the replies are read, and an agent no longer idle (or now stood down) is left for the next pass
  (tested, red with the stale card); (2) the pass yields a macrotask between agents, so the agent's own read --replies
  can take the lock between them; (5) a title's line separators, bidi controls and zero-width marks are stripped
  (tested, red when narrowed). Decided, not fixed: (3) the first pass tells an agent about up to 7 days of unanswered
  replies (the read's own first-look window): that is the card's point (replies sitting unanswered), and it is one line
  per agent, inside the shared hour cap; (4) three tries that reached nothing give up on that batch until a new reply
  arrives or the board restarts, as the sibling nudges do.
- Round 1 (Opus, blind): 1 BLOCKER, reproduced, fixed: the pass typed agent A's nudge and went on to read agent B
  holding the read lock, so A's own `read --replies` a moment later was REFUSED busy, and A's ids were already recorded,
  so A was never told again. Now: (a) READ FIRST, TYPE AFTER: every count is read, then the nudges are typed, so the lock
  is free when a told agent reads (test pins the order: red when it types mid-reads); (b) an agent's own read WAITS (up
  to 2 min) for the nudge's count instead of being refused (tested: it waits, its fetch does not run beside the count,
  then it reads; red when it refuses, red when the count takes no lock). Two agents' own reads still refuse each other
  (#4833 review 5). Should-fix, fixed: the counts are PACED (500 ms between requests, 1 s between agents), the hour cap is
  checked BEFORE reading (no reads once it is met), the shared hour log takes the time each nudge went (not the pass's
  start), the Prompter's own on/off gates it as it gates agentnudge (tested), the card is read again before typing (was
  Sonnet's 1). Tests that could not fail, fixed: the lock direction (above), titles end to end (red with no titles),
  the stood-down arm's `if` (now an assertion). Not taken: a post whose round-2 reply page keeps failing hides, in the
  agent's own read, round-1 replies it was told about (older than this card: readReplies marks such a post failed).

- Round 2 (Sonnet, blind): 0 blockers, 1 should-fix, fixed: the 1 s gap between agents was skipped after agents with nothing new (the usual case), so reads ran back to back and an agent's own waiting read could starve: the gap now follows every read that ran (tested, red without it). Nit fixed: the shared hour log is kept in time order (agentnudge prunes from the front; tested). Not taken: an agent that read its replies itself between this pass's count and its nudge gets one line about replies it has read (once; ids then recorded).
- Round 2 (Opus, blind, reviewed 28ea0dc69): 1 BLOCKER + 3 should-fix + 2 nits. Fixed: (1) an agent's own read waited up to 120 s, past the CLI's 30 s, so a read that outwaited its caller still moved the marks (agent saw 'could not reach', then nothing new): the wait is 20 s, and the count STEPS ASIDE between posts while a read waits (tested: 3 requests not 4, read well under 5 s); the unconditional gap between agents was already Sonnet's round-2 fix. (2) agents with replies they were told about but never read took cap slots, so later agents were never read: only replies not yet told about count (tested). (3) nudges typed in one burst made the told agents' own reads refuse each other: the lines are spaced 20 s (TYPE_GAP_MS), so each told agent reads with the lock free; an attempt to make reads wait for any holder instead was reverted (it cascaded 20 s holds through #4833's tests and changes #4833 review 5's decision). (4) the per-agent snapshot cost: with lines 20 s apart the snapshot before each line is spaced too (no burst blocking the loop). (5) a store that cannot be written keeps the told ids in memory, so the next pass does not repeat (tested). (6) the lock test's title now matches what it checks.
- Round 3 (Sonnet, blind): 0 blockers. Fixed: a failed delivery replaced the in-memory record and dropped the told ids it held (store unwritable), so an earlier reply could be told again (tested). DECIDED, not built: 'respects a held task' is read as N/A for the nudge itself: a reply to a community post is not task work, so a held task does not silence it (as a paused project alone does not); an agent the person stood down is left alone (stoodDown). If Josh meant held tasks to silence community nudges too, it is one condition in stoodDown.
- Round 3 (Opus, blind): 0 blockers, 3 should-fix (all reproduced), fixed and tested (each red without its fix): (1) the switch, the Prompter on/off, live execution and the brake were checked once per pass: they are asked again before EVERY line; (2) a batch given up on (MAX_TRIES) still took a cap slot every pass: it takes none; (3) any read error of the told record read as 'told nothing' (a second nudge): only a missing file is empty, an unreadable one skips the agent. Test gaps closed: the default wait (<= 20 s, under the CLI's 30 s) and line spacing (>= 15 s) are pinned; the server test checks the Prompter gate. Not taken: TYPE_GAP_MS is a heuristic (an agent that starts its read more than ~18 s late can still meet the next agent's read, which is refused with 'try again in a moment', said, not silent); a pass can outrun the 10-minute interval (the next tick is skipped, not stacked).

## Review 4 (Opus, blind): 0 blockers, 1 should-fix, 3 nits. All four fixed.
- SHOULD-FIX (reproduced): a quota-held agent took a cap slot every pass (a held delivery counts no try, so MAX_TRIES never
  frees it) and starved later agents until the quota reset. FIXED: `quotaHeld(session)` (server.js: agyquota.heldForQuota)
  is asked before the read; a held agent is not read and takes no slot. Test + mutant.
- NIT: an unreadable told record cost up to 10 service reads every pass and left no trace. FIXED: the record is read
  before the service is asked; the skip is said once (book memo `skipSaid`). Test + two mutants (order, once).
- NIT: a count cut short for a waiting read returned a partial `ok`, so one batch could be told in two lines and a given-up
  batch came back under a new key. FIXED: it returns `busy` (tried next pass). Existing test now asserts it + mutant.
- NIT: the hour's limit was not re-read mid-pass. FIXED: `limitNow` (tick passes readLimit) is re-read before each line.
  Test + mutant.

## Review 5 (Sonnet, blind): 0 blockers, 1 warning, 2 nits.
- WARNING (reasoned): lines are spaced 20 s, so a count can be minutes old when its line is typed; an agent that read its
  replies meanwhile was still told. FIXED: freshReplies returns `marksAt` (communityread.marksStamp of the local read marks);
  the pass compares `marksNow(session)` before each line and skips a changed one ('read-meanwhile'; the next pass recounts).
  Tests in both files (the stamp moves on a real read; a moved stamp types nothing) + mutant.
- NIT (kept): `skipSaid` is dropped with the memo after a later success, so a record that turns unreadable again is said
  once more. Harmless, and the right thing to say.
- NIT (kept): the first pass after deploy counts every unmarked reply in REPLIES_FIRST_DAYS. Bounded by the hour cap and
  the 20 s spacing; later passes catch up.

## Review 6 (Opus, blind): 0 blockers, 2 warnings, 3 nits.
- WARNING (reproduced): server.js's quotaHeld took a full status snapshot (sync capture-pane per agent) for EVERY agent
  each pass. FIXED: quotaHeld(session, roster) gets the pass's own roster. Test asserts the roster passed + source pin; mutant.
- WARNING (reproduced): no test could fail if the "delivery held for quota" branch went (the review-4 test overwrote its
  held deliver). FIXED: the overwrite is gone; a new test holds delivery three passes (past MAX_TRIES) and asserts the
  reply is told exactly once after; mutant.
- NIT (reproduced) FIXED: one agent's own read made every later agent's count busy for the pass. A busy count now waits
  BUSY_WAIT_MS (5 s) and asks again, up to BUSY_RETRIES (4), past an own read's two 8 s rounds. Test + mutant.
- NIT FIXED: freshReplies never backed off. A 429 or no answer now returns busy+stop, and the pass stops counting (the
  agents' own reads need the budget). 404 still skips the post (control arm). Tests + mutants.
- NIT (kept): the marks stamp can be wrong both ways in rare cases (a read that wrote floor marks only; a read whose mark
  write failed; a read still in flight). Each costs at most one delayed or one extra line; the told record still stops
  any reply being told twice.

## Review 7 (Sonnet, blind): 0 blockers, 2 warnings, 8 nits.
- WARNING FIXED: a reply past the service's 2-reply preview (a third reply under a comment) was never counted, so never
  told. freshReplies now reads the unshown replies of the newest REPLY_PAGES_PER_POST comments, exactly as the agent's own
  read does in its round 2 (paced, stepping aside, 429 stops; a post half read says nothing this pass). Test (control:
  readReplies shows the same 3) + mutant.
- WARNING FIXED: a "still being placed" refusal burned a try (three busy passes gave the batch up). chat.deliver marks that
  refusal `busy: true` (additive; chat.test asserts it); the pass counts no try for it, as for held. Test + mutant.
- NIT FIXED (tests that could not fail): nothing read for a stood-down agent; nothing read once the cap is met; a told
  record unreadable at typing time types nothing; two agents' own reads refuse each other. Mutants for the first three.
- NIT FIXED: the rig's busy wait is 0 (a test was paying the real 20 s of retries).
- NIT (kept): a failed writeNudged can leave a .tmp file; a failed delivery drops skipSaid; a cap-held line is logged each
  pass. Cosmetic.
- Reviewer note: its mutation sweep stopped at mutant 9 (removing !givenUp) without a verdict; not a finding.

## Review 8 (Opus, blind): 0 blockers, 3 warnings, 4 nits. All fixed at 40aa09967 + 02b57677b.
- WARNING (reproduced) FIXED: one post that did not answer (status 0) ended the count as busy+stop, so the agent's other
  posts were not counted and every later agent in roster order starved, every pass. Now ONE unanswered request skips that
  post (as the agent's own read skips it; a round-2 page unanswered leaves the post unsaid), and only NO_ANSWER_STOP (2) in
  a row stop; a 429 still stops at once. And the pass ROTATES: it starts after the last agent asked last pass (o.rotation,
  kept by server.js as REPLY_NUDGE_ROTATION), so a pass that ends early does not starve the same agents, and an agent
  whose posts end the count goes to the back. Tests (control: without a rotation bo is never reached) + mutants.
- WARNING (mutation-proven) FIXED: the round-2 loop was untested. Fixture: 5 comments listed newest first, each with a
  hidden reply; asserts exactly REPLY_PAGES_PER_POST pages read, the exact ids oldest first, and agreement with readReplies
  (count and every id). Second test: a failed page leaves the post unsaid, a round-2 429 stops after one page, a read that
  starts waiting during round 2 makes it step aside (busy, not stop) before the next page, and round-2 pages are paced.
  All 7 of the reviewer's surviving mutants now killed, plus fresh.sort (killed only once the fixture was newest first).
- WARNING (mutation-proven) FIXED: the stamp equality test ran with no marks ("{}" both sides). New test: the agent's read
  writes marks first, a new reply arrives, and the count's stamp must equal the written marks (asserted not "{}").
  Mutant marksStamp(sessionName, {}) killed.
- NIT FIXED: typeGap spacing tested (setTimeout spy: 2 gaps for 3 lines). Mutant killed. (Also Sonnet r7 late nit a.)
- NIT FIXED: the count-phase memo.told merge tested (store unwritable, cap 2, second agent). Mutant killed. (Sonnet r7 b.)
- NIT FIXED: the hour log is pruned before every agent's cap check, not once per pass. Test with a clock that ages an
  entry out between two agents. Mutant killed.
- NIT FIXED: a quota hold or busy pane at typing time is logged once per change of state (book waitSaid). Test asserts
  the sequence held, busy, held, nudge. Mutant killed.
- Targeted files: replynudge-4951 + communityread + chat, 241/241.

## Review 9 (Sonnet, blind): 0 blockers, 2 warnings, 3 nits. 41 mutants tried, 39 killed.
- WARNING (mutation-proven) FIXED: "two unanswered in a row" had no arm that could fail without the reset. Test: three
  posts answering fail, ok, fail must complete ok. The round-2 reset was unreachable (round 1 of the same post just
  answered, and a failed page ends the loop), so it is removed, with a comment saying why.
- WARNING FIXED: the count had no cap, so the line could say 45 while the agent's read shows 30 (REPLIES_SHOWN_MAX) and
  the other 15 were recorded as told. The count now keeps the oldest REPLIES_SHOWN_MAX across all posts, as the read
  does; the rest are counted on a later pass, after the read moves past these. Test over two posts with interleaved
  times (control: the read shows the same 30 ids; after it, the 6 left are counted). Mutants killed.
- NIT FIXED: the give-up log line (tries >= MAX_TRIES) is tested. Mutant killed.
- NIT FIXED: the between-agents gap follows the last count that asked the service (freshReplies returns `asked`), not
  one with no posts. Test + 2 mutants killed.
- NIT (kept): an unparseable told file skips that agent until someone looks. The safe direction for "never twice";
  quarantining it would risk a repeat line. The skip is logged once with its reason.
- Targeted files: 245/245.

## Review 10 (Opus, blind): 1 blocker, 2 warnings, 2 nits.
- BLOCKER (reproduced, both arms) FIXED: a post the count skipped (no answer, a non-200, a failed reply page) moved the
  cap boundary. The read a minute later could reach it, its older replies took places in the read's 30, and counted
  replies fell past the cap; those were recorded as told and never told again. Fix: a post that cannot be read makes
  the WHOLE count partial ({ ok: false, busy: true, partial: true }), so nothing is told about that agent this pass, and
  sweepOnce does not ask a partial count again in the same pass. Only a post that has failed FRESH_DOWN_PASSES (3)
  passes in a row is skipped as gone (down that long, it is down for the read too, and it must not hold the agent's
  nudges forever); its run starts over once it answers. 404/410 is gone, as in the read. Tests: partial until 3 passes,
  then skipped; counted again when it answers; a 500 counts as unreadable; two unanswered in a row still stop; a failed
  round-2 page is partial; a partial count is not retried and types nothing. 6 mutants killed.
  WEAKEST PREMISE: a post down 3 passes (30 min) is also down for the agent's read. If it comes back between the count
  and the read, the old class returns for that one pass.
- WARNING FIXED: FRESH_PACE_MS 500 -> 1500 (40 a minute at most), so two agents' own reads (40 each) fit inside the
  service's 200 a minute beside a count. Pin: perMinute + 2 reads < 200 (fails at 500, checked).
- WARNING FIXED: the in-memory told union had no test that could fail: the review-3 test now runs a fourth pass and
  asserts nothing is typed. Mutant killed.
- NIT FIXED: three comments still said "round 1 only" / "first pages"; rewritten.
- NIT FIXED: an assertion that could never fail is renamed to what it does check (no reply page asked without a cursor).
- Targeted files: 247/247.

## Review 11 (Sonnet, blind): 0 blockers, 1 warning, 4 nits. ~63 mutants, survivors listed here.
- WARNING (mutation-proven) FIXED: the round-2 "down" skip had no test. New test: a reply page that keeps failing is
  partial for FRESH_DOWN_PASSES - 1 passes, then the post is skipped and the other counted. Mutant killed.
- NIT FIXED: a 404 starting the run of failures over is tested. Mutant killed.
- NIT (kept): plan()'s MAX_TRIES check duplicates sweepOnce's givenUp gate (count phase). Kept as the planner's own
  rule (plan is exported and used alone in tests); its arm cannot fail while the gate stands, stated here.
- NIT (kept): postDown is never pruned; bounded by agents x 10 posts; a restart clears it (delays a skip by ~30 min).
- NIT (kept, as review 9): a corrupt told file skips that agent, logged once; re-telling would be worse.
- Targeted files: 249/249.

## Review 12 (Opus, blind, end to end with the real freshReplies/readReplies): 0 blockers, 1 warning, 3 nits.
- WARNING (reproduced end to end) FIXED: the line was typed first and the told record written second, so an unwritable
  store (or a crash between them) kept the ids only in memory, and a board RESTART told the same reply again (d1, d3, d4
  in the reviewer's run). Now WRITE AHEAD: the record takes the ids before the line is typed; a record that cannot be
  written types nothing (said once, no try); a line that reached nothing, was held, or met a busy pane is rolled back;
  a failed rollback misses the reply rather than repeating it. The in-memory told fallback is REMOVED (dead once the
  record is written first) with its three tests, replaced by: written-before-typing, nothing typed when unwritable
  (said once), rollback then told alone, and two restarts with no repeat. An agent whose record could not be written
  takes no cap slot on later passes (else it held one every pass). Mutants: write-ahead, both rollbacks, said-once,
  the slot rule, all killed.
- NIT FIXED: the gap between agents is BETWEEN_AGENTS_MS = 1500 (the count's pace), so the pass really keeps to ~40 a
  minute (it was ~60 with the 1 s default). Pinned against FRESH_PACE_MS; mutant killed.
- NIT FIXED: a reply within FIRST_LOOK_EDGE_MS (15 min) of the 7-day window's edge, on a post with no mark, is not
  counted (the agent's read, later, may already exclude it). Test + mutant.
- NIT FIXED: an agent whose OWN read is running right now (communityread.readingNow) is not typed into this pass; the
  stamp could not see a read whose marks were not written yet. Test + server pin + mutant. (Clearing the session at the
  read's end is redundant with the lock state; that mutant is equivalent.)
- Targeted files: 253/253.

## Review 13 (Sonnet, blind, multi-pass on a real on-disk store): 0 blockers, 2 warnings, 2 nits.
- WARNING (reproduced) FIXED: a throw from the typing path was read as "reached nothing" and rolled back, so the line
  could be typed twice (a throw can come after the paste; chat.js's own rule is that a throw is unconfirmed). It now
  keeps the written-ahead record. Test + mutant.
- WARNING (reproduced) FIXED: a batch given up on after MAX_TRIES stayed given up until a NEW reply arrived (a pane down
  for half an hour that came back never got those replies). It now rests GIVE_UP_FOR_MS (1 h) and is tried again.
  Test with an injected clock (not before the hour, yes after) + 2 mutants.
- NIT FIXED: a rollback that cannot be written is said ('missed': those replies will not be told). Test + mutant.
- NIT FIXED: the said-once flags for an unreadable and an unwritable record are cleared once the record reads / writes
  again, so a LATER outage is said too. Tests + 2 mutants.
- Targeted files: 258/258.

## Review 14 (Opus, blind, "what a person experiences"): 1 BLOCKER, 3 warnings, 2 nits.
- BLOCKER (reproduced) FIXED: the nudge counted and named replies UNDER a comment and said "Answer each once", but the
  community rule (#4833, communityblock.js) says a line with "under comment" is a reply to a reply and is NOT owed an
  answer, or the thread never ends. So every "you are welcome!" woke the agent into the endless thread Josh ruled out.
  Now only comments ON the post (x === c) are named and told; the cap is still taken over everything the read shows
  (replies included) so it falls exactly where the read's does. Four older tests pinned the old count; updated to the
  owed comments (their read-agreement checks kept). New test: a reply under a comment names nothing; a new comment does.
- WARNING (reproduced) FIXED: the 15-min window edge was applied BEFORE the cap, so edge items (which the read shows
  and caps first) moved the cap: told replies fell past it. Now the cap is over the read's exact set and edge items are
  only left unnamed after it. Test (fixture where a comment is what falls past). Also found: three tests checked
  r.text.includes(id), which a reply's "under comment <id>" line satisfies for its parent; all now match the item's own
  "(comment <id>)" line (this is why the edge mutant first survived).
- WARNING (reproduced) FIXED: a count had no age limit before its line (a long pass, or a machine asleep mid-pass:
  timers stop in sleep). A count older than COUNT_MAX_AGE_MS (= FIRST_LOOK_EDGE_MS, pinned) is not typed ('stale-count').
- WARNING FIXED: a line could land right after an agent finished a person's turn. Now an agent must have been idle at
  the pass BEFORE too (o.idleSeen, kept by server.js; agentnudge's own posture); working clears it.
- WARNING FIXED: two agents' own reads refused each other, so the second agent told about its replies could find its
  read refused and the replies wait. An own read now WAITS for another's (READ_WAIT_MS 10 s, so wait + two 8 s rounds
  stays inside the CLI's 30 s, pinned). Two #4833 tests that pinned the refusal: one now asserts the wait-then-run,
  the other bounds its second read short to keep testing "never beside".
- NIT FIXED: the log says 'could-not (try n of 3)' and 'gave-up (tried 3 times; again in 60 min)', and a refusing
  service is said once per change ('service-stop').
- NIT (kept): the line counts replies not yet told, not all waiting (it can say 1 while the read shows 4).
- Mutants: 10/10 killed after the fixture fix. Targeted files: 263/263.

## Review 15 (Sonnet, blind): 0 blockers, 2 warnings, 3 nits.
- WARNING FIXED: "idle at the pass before" sampled twice and missed a turn taken and finished between them; its marks
  also went stale when a pass ended early (cap, service stop) or a gate was off. Now judged by WHEN the agent went idle,
  from its own idle report (o.idleSince, selfreport in server.js): idle at least IDLE_FIRST_MS (one interval). A runner
  with no report falls back to the sampled marks, which are now refreshed for the whole roster at the top of every pass
  and cleared while a gate is off. Tests + 4 mutants killed.
- WARNING FIXED: readingNow covered only the lock holder, not an agent whose own read was WAITING (up to 10 or 20 s).
  readReplies now counts the session as reading from the moment it is asked (readingSessions). And a count no longer
  starts ahead of an own read that is already waiting. Tests + 2 mutants killed (a test that left its lock held on a
  failed assertion hung the file under a mutant; it now releases in finally, and the mutant fails cleanly).
- NIT FIXED: the line says COMMENTS (only comments on the post are counted) and that a line marked under comment is not
  owed; no quote marks in the typed line (an existing guard).
- NIT (stated in the code): FIRST_LOOK_EDGE_MS covers count-to-line delay only; a read hours later can show fewer than
  were told (told-but-not-shown, never repeated or lost).
- Targeted files: 266/266.
