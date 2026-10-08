# #5400: the failover's "your part was moved" line rides on whatever Kosmos next types into the agent

## The problem (from #5382's 13th blind review)
When failover moves a rate-limited agent's part to another agent, the part records that the first agent is owed a line
(owedTell), and engine/failovertell.js types it once the agent reads idle on two passes. A person usually resumes a
Claude agent themselves, with a message at the reset, so the agent could carry on with the moved part before it read
idle and was told.

## Change
- engine/chat.js setMovedTell(hook): deliver() and deliverAsync() put failovertell.noteFor(items) in FRONT of the line
  (so an attached file's path stays with its words), for every part the agent is owed and the line does not already
  name (the idle sweep's own line and agyquota's carry-on line name theirs). Asked by the card's own session name.
- Marked told only when the verdict is PLACED, on the synchronous and the promise path.
- No note on: a line starting with "/" or "!" (a command must start the line), a single short token (a menu answer),
  a caller passing { movedNote: false } (the restart-for-handoff request; the note rides the restarted session's
  pickup line), a card that reads rate_limited or needs_you (Claude Code's limit menu, a prompt), or a message the note
  would push over the length limit. In each case the note rides the next real line.
- A throwing or incomplete hook never costs a line.
- server.js installs the hook beside the idle tell sweep: records read at most every 5 s, anyOwed first; told drops the
  cached read.
- failovertell.noteFor: the sweep's line without "reply with one word" (the line it rides is already a turn).

## Reviews (blind, opus and sonnet alternating)
1. BLOCKER the note in front of /clear and /compact; W told on UNCONFIRMED (certain non-submits). Fixed. The "sync line
   in an async gap" worry does not happen (deliver refuses a busy window), now pinned.
2. BLOCKER a menu digit got the note (the limit menu is when it is owed). Fixed (single short tokens).
3. W the restart-for-handoff request (the session ends right after). Fixed ({ movedNote: false }, pinned in source).
4. W leading-space commands and the 12-character bound unpinned; "!" shell mode. Fixed and pinned.
5. W the limit menu itself (a capped card); the server wiring unpinned. Fixed and pinned.
6. W needs_you unpinned. Pinned.
7. W a short real sentence and owed's wiring unpinned; a mis-cased caller skipped the note. Fixed and pinned.
8. W the hook-failure guards unpinned. Pinned.
9. W the promise path (production's async lines) untested. Pinned.
10. CONVERGED, no BLOCKER or WARNING.
Every rule above is mutation-checked: removing it reds a test in engine/chat.movedtell-5400.test.js (25 tests).

## Decided
- The thread and room keep the message without the note (the note is for the agent).
- A card reads capped for a minute past its reset, so a line in that minute goes without the note.
- An agent whose sign-in failed still gets the note (told only on PLACED).

## Weakest premise
That Claude Code's "continue after reset" resumes the interrupted turn (inferred from its menu labels, not observed);
and Enter pressed on its own limit menu reaches no Kosmos line, so that resume stays covered only by the idle sweep.

## Rebased onto failover-5382 after #5382 merged main (2026-10-07)
- Rebased the 11 #5400 commits from 76ae966d6 onto failover-5382 @ 699301322 with no conflicts; 340 related tests green.
- FIXED (a composition defect between the two branches): #5382's post-merge review 3 made owedFor name the agent now
  holding a part by its card name, given the roster. This branch's note hook called owedFor without one, so its note
  still named agents by session key. The hook now passes a roster cached with the records (read only when something is
  owed). The review 7 source pin requires it; it reddened on the old call.
- The proof's hash is over the stacked diff and is recomputed after #5382 merges and this is rebased onto main.
