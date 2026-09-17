# Plan: #3224 suspected-misroute count in the daily digest (privacy-clean)

## Background
Josh (2026-09-17): an agent on several projects sometimes posts into the WRONG
project's room; he asked to surface HOW OFTEN. The first attempt (PR #3227) was a
per-post logger writing agent names + project ids + post ids to a new
`misroute-suspects.jsonl`. Josh flagged that as a privacy concern ("tracking we
don't cover"). His ruling: surface it in the already-covered daily digest instead
of a new tracking log. PR #3227 was closed unmerged.

## This PR: derive-from-existing, counts-only, in the daily digest
The privacy-cleanest shape (confirmed by Splinter as the safest reading of Josh's
digest ruling): a read-only, digest-time count derived from the message record we
ALREADY keep. Adds NO new hook, NO new log, NO new persistence, NO identifiers.
The digest emits only the integer, so the privacy concern that the identifier log
raised does not attach.

### Changes
1. `engine/messages.js`: new pure `suspectedMisrouteCount(sinceMs, untilMs)`.
   Read-only over the message record. A room post by agent W to project A is a
   suspected misroute if, AS OF the moment W posted it, W owed an unanswered
   ADDRESSED OPERATOR question in a DIFFERENT project B (operator post before it,
   W in `mentioned`, delivered/typed, and no room post from W in B in
   [askAt, postAt)). Mirrors `unanswered`'s definition of an owed answer, bounded
   to the post's instant. Does NOT reuse/modify `unanswered` (whose answer-check
   is unbounded) - the as-of-post-time bound is the whole point, and #185's live
   nudge callers stay untouched.
2. `engine/dailylog.js`: `renderDay` gains an optional 4th arg `misrouteCount`;
   when it is a non-negative integer it emits ONE counts-only line
   ("Suspected cross-project misroutes today: N (heuristic, see kosmos#3224).").
   `compileAll` computes each day's count via an injectable `misrouteCountForDay`
   (default derives the local day window and calls `suspectedMisrouteCount`).
   `dayWindowLocal(dayStr)` maps a YYYY-MM-DD to a DST-safe local [start,end).
   The default count fn lazy-requires messages and fails soft to null (line
   omitted, never a throw that fails the rollup).
3. Tests: `engine/messages.misroute-digest-3224.test.js` (the count, incl. the
   as-of-post-time case) and `engine/dailylog.misroute-3224.test.js` (line
   present/absent/zero, dayWindowLocal, compileAll threading).

### Why the daily digest is a privacy-safe home
`engine/forget.js` already deletes `chats-daily/` as a DERIVED view of the
conversation kind, so the rollup is inside the covered surface. A counts-only line
adds no new data category and no identifiers.

### Deliberately not done
- No per-post hook, no new log file (that was #3227, replaced).
- Counts-only, no breakdown: a per-agent or per-project breakdown would
  re-introduce the identifiers the privacy ruling is avoiding.

## AS-OF-POST-TIME (the correctness crux)
A misroute that HAPPENED counts even if W later answered B - the card measures how
often a post lands in the wrong room, not how many stay unresolved at digest time.
Using an unbounded "answered ever" check would silently under-count.

## Weakest premise
Still not reproduced against a real misroute. The heuristic can over-count (a
member of both rooms legitimately posting to A while owing B) - hence "suspected"
and counts-only. A day with room-post activity but zero conversations gets no
rollup file, so its count is not surfaced (the digest is conversation-centric);
acceptable for v1, active days (the ones with misroutes) have conversations.
