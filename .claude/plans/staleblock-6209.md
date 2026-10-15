# #6209: stale states nobody is prompted about (part 1: a blocked status that outlives a brief provider error)

## Finished looks like
An agent whose provider failed one turn (Claude Code's StopFailure hook writes an automatic `blocked` on "provider api
(...)") and whose NEXT turn ends normally (the Stop hook's automatic `idle`) reads idle on the board again, instead of
blocked for days. An agent's own deliberate `blocked`, and every other protected wait, stays exactly as protected as now.

## Measured (origin/main b9c082695)
- engine/kosmos-report-hook.js: StopFailure writes `{ state: 'blocked', on: 'provider api (<kind>)', owner: 'provider' }`
  with auto; Stop writes auto `idle` ("finished responding"); PreToolUse writes auto `working` as a heartbeat.
- engine/selfreport.js record(): an automatic idle/working may not erase a standing blocked/needs_you unless it is an
  auto permission wait (#900, #1949, #2456). #2456 kept an AUTO blocked protected "because it does not auto-resolve",
  pinned by "#2456: an automatic idle does NOT clear a standing AUTO blocked either".
- engine/stalereport-nudge.js (#5959): reminds once, after a day, only for a blocked NOT written by Kosmos and only for a
  Claude agent. An automatic provider blocked is never reminded, and never cleared by the agent's later normal turns.
  That is the six days in the report.

## Decided
- An automatic `idle` (a turn that ended normally) clears a standing AUTOMATIC provider blocked (by auto, on "provider api
  (...)"). A turn that ends normally proves the provider answered a whole turn after the failure.
- An automatic `working` (PreToolUse heartbeat, mid-turn) still does not clear it: the turn could still fail.
- Untouched: a deliberate blocked or needs_you (by agent or operator) standing on the card, a legacy unmarked line, and
  the quota hold (a
  rate_limit report with `until` is held by its own rules; a later normal turn end after the reset is the same proof).
- Parts 2 (overdue summary prompt) and 3 (task on hold while work goes on elsewhere) are separate slices on this card.

## Weakest premise
That Claude Code fires StopFailure INSTEAD of Stop for a failed turn (from its hook documentation, as #5805 records; not
measured on a live agent). If both fired for one failed turn, the block would clear at once: still visible in the
activity log, but no longer red.

## Review 1 (opus), and what changed
- BLOCKER, fixed: an incoming automatic blocked may overwrite a deliberate wait (left unguarded on purpose), so clearing
  the block would have erased the agent's question too and read idle. The clear now looks at the line the block
  replaced (lineUnderProviderBlock, from the record's tail) and is refused when that is a deliberate or unmarked
  blocked/needs_you; an automatic permission wait under it does not stop the clear. Tested both ways (switching the
  check off fails the question test, measured); a legacy unmarked provider block is tested too.
- Comments fixed: the #2456 block in selfreport.js, the hook's own doc (engine/kosmos-report-hook.js) and
  install/kosmos-report-hook.sh no longer say an auto idle never clears an auto blocked.
- Known, added to the weakest premise: the hook sends reports in the background, so turn N's late Stop idle could in
  principle land after turn N+1's StopFailure and clear a fresh block (it needs a new prompt plus an immediate failure
  inside one report's latency). The next failed turn writes the block again.

## Review 2 (sonnet), and what changed
- Fixed: the check of what the block replaced fails CLOSED: a record that cannot be read, or a run of blocks reaching
  the front of the tail read, keeps the block (as before #6209). Tested; failing open fails it (measured).
- Fixed: several blocks in a row are skipped as one run to find what is under them (a run over a fresh start clears;
  stepping back only one line fails the test, measured), and a run over a question keeps it.
- Helpers moved above the #2808 comment (which describes isAutoPermissionWait again); the check became hidesWait;
  isAutoProviderBlock no longer exported.
- Known and accepted: read() and the check read the file separately (an append between them can only make one clear
  early or late; the next turn end settles it). An authentication_failed block is cleared by a turn that ended
  normally too, which is right (the turn succeeded); the sign-in hold rules (#5948) read the screen, not this line.

## Review 3 (opus), and what changed
(SUPERSEDED by review 7: re-showing the covered wait was removed.)
- Fixed: a provider block that had replaced a deliberate or unmarked wait no longer leaves that wait hidden behind a
  block nobody clears: the turn end that proves the provider answered re-appends the covered line (its own words and
  writer, marked `restored`), so the card shows the question again. Unknown (unreadable record, run past the tail):
  the block stays. Tested (the question's words and `by: agent` come back); skipping the restore fails it.
- Said explicitly: the #5805 automatic `provider api (rate_limit)` block is now cleared by the next normal turn end
  too, which fits limitReleased (an idle card is released); a deliberate report carrying `until` is untouched.
- Comments: the hook doc lists every refusal again; the new helpers sit after isAutoPermissionWait, so record()'s
  own doc comments are above record() again.

## Review 4 (sonnet), and what changed
(SUPERSEDED by review 7: re-showing the covered wait was removed.)
- Fixed: the re-shown wait keeps its ORIGINAL asking time (askedAt on the restored line, from the covered wait's own run
  start; read() honours it when it starts a run), so a days-old question is not re-dated: its age, the stale-report
  reminder's clock and a person's notice stay. Tested (askedAt equals the first report's time; ignoring it fails).
- Fixed: only the wait's own fields are restored (state, words, on, owner, project, writer; until added in review 5),
  not the old line's instance, left, waiting or final; an unmarked legacy wait stays unmarked.
- Known: two concurrent Stop reports could both re-append the wait (a duplicate line, same words and askedAt: harmless).
- The weakest premise (StopFailure INSTEAD of Stop) stands, unmeasured; if both fired for one failed turn, the block
  (the #5805 rate-limit red included) would clear at once. Measuring it needs a live failed turn on a real agent.

## Review 5 (opus), and what changed
(The readTail/latestOf split stands; the restore it fed was removed in review 7.)
- The restore re-implemented read()'s rules and disagreed with them (project carry, the cut-tail rule, until). Fixed by
  splitting read() into readTail (the record's tail as rows) and latestOf (what read() reports for rows, pure), and
  reading what the block covered as latestOf(the rows before the run): one window and one set of rules. The restored
  line keeps the wait's until, its askedAt as read() computes it, and its project only when it stated one. A wait whose
  start is past the front of a cut tail (askedAt unknown) keeps the block. Tests for each (dropping until, or restoring
  an unknown start, fails them, measured); the split itself passes every existing selfreport test unchanged.
- Line wording: "may be missed" style unchanged; the hook doc says a covered wait is shown again.

## Review 6 (sonnet), and what changed
(SUPERSEDED by review 7: re-showing the covered wait was removed.)
- Fixed: the re-shown wait states its project whenever the lines after it (the block run) would carry a different one,
  so a block line with another project cannot re-label it; askedAt is honoured only on a restored line, so no other
  line can set a run's start. Both tested; removing either fails its test (measured).
- Decided: the restored line's `at` is the time it was written (now), not the covered line's. History readers
  (projectview's work check, instructionreread's started-since) judge by row order and dates, and an out-of-order `at`
  could mislead them. Consequence, accepted: the board's freshness and decay of the wait restart from the restore (it
  is shown again then); its age, the stale-report reminder's clock and a person's notice use askedAt, which is kept.
- Known: when an automatic idle only re-shows a wait, the Stop report's own fields (a Muse turn answer) are not
  recorded; the "unknown state" warning can print twice for one bad line (read() and the check each read the tail).

## Review 7 (opus), and what changed: re-showing the covered wait is REMOVED
- Re-showing a wait the block had covered drew a defect in reviews 3, 4, 5, 6 and 7 (re-dating, dropped until, project
  carry, a re-label, and a question about a project the agent has since left coming back). Decided: remove it. A block
  that covered a wait on a person (anything but an automatic permission prompt) stays, exactly as before #6209.
  Residual, stated: such a question stays hidden behind the block until the agent's own next report; part 1 fixes the
  common case (a provider block over nothing waiting), which is the six days in the report.
- The usage-limit (rate_limit) and sign-in (authentication_failed) kinds are excluded: their own holds (#5805, #5948)
  decide, and whether a turn that ends on a limit or sign-in reply fires Stop is unmeasured. Tested both ways.
- read() is back to its original run rule (no askedAt); the readTail/latestOf split stays (behaviour-identical) and
  feeds the check of what the block covered.
