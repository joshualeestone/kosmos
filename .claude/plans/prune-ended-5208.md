# prune-ended-5208: bound ended-agents.jsonl (kosmos#5208)

## The defect
`ended-agents.jsonl` (engine/sendertoken.js noteEnded) only grows: every revoke appends a line, including every
create that got past its name checks. Every token-only removal reads it whole (endedSince). Measured 2026-10-11: the
file does not exist yet on Agent1s or on Mortals (the #5809 removal check is new), so this is a preventive bound.

## The rule (decided on the card)
endedSince's only reader is the token-only removal check (server.js tokenOnlyRemoveRefusal; Angel confirmed). It
compares a line with the NEWEST birth of the target's name, and only when that birth is agent-made (`created` with
`createdByName`): the target from after its `at` (strict), the creator from its `askedAt` on (inclusive). A birth
written later is stamped later than every line already written.

- Cutoff = the earlier of (now - 30 days) and the oldest `askedAt`/`at` among the newest agent-made births per name.
  Lines strictly older than the cutoff are dropped; a line AT the cutoff is kept (the creator check is inclusive).
- A removed agent's birth still counts: its removal line keeps ownership from coming back on restore.
- Prune nothing when: the file is at most 256 KiB; the birth log cannot be read (a missing one is no births); any ended
  line does not parse or has an `at` not in toISOString's form; a counted birth's time cannot be ordered.
- "The newest created/partial birth per name" is one function, create.newestBirthBySlug, read by agentBirthOf and by
  the prune, so the prune can never keep less than the check reads.

## How
- noteEnded appends under a lock on the file (engine/filelock.js withFileLock) and prunes inside it. If the lock cannot
  be had, the line is appended anyway, unlocked, and nothing is pruned.
- The pruned text is written to a temp file beside it and renamed over it: endedSince reads without the lock, so it
  must see the old file or the new one whole, never a truncated or missing one (Angel's review point 1).

## Rejected
- Counting only agents that exist now (the card's draft): breaks "ownership does not come back on restore".
- The min over EVERY agent-made birth: safe, but the first ever pins the cutoff forever.
- Pruning on every append: a read and a rewrite each time for nothing.

## Weakest premise
That tokenOnlyRemoveRefusal stays the only reader whose answer depends on old lines. A new reader comparing against an
older time would need the cutoff widened. Also: the 30-day floor leaves a fast create-spammer unbounded within the
window (the card's note); a per-creator rate limit is the answer if a large file is ever measured.

## Tests (engine/sendertoken.prune-ended-5208.test.js)
- cutoff: newest birth per name; an older agent-made birth pulls it back; person-made births and a superseding
  `partial` do not hold it; no birth log = the floor; an unorderable birth time = no prune.
- prune text: the line exactly at the cutoff kept; three unreadable shapes each stop the prune.
- the security property: every removal-check answer (target strict, creator inclusive, an end AT askedAt) is the same
  before and after a prune; the file is replaced by rename (new inode, no temp left).
- a removed agent's removal line survives; the older noise is pruned (control).
- nothing pruned under the size bound, past a torn line, or with an unreadable birth log; a missing birth log prunes
  by the floor (control).
- an end is appended while the lock is held elsewhere; with the lock free it goes in and the lock is released.
- Mutations, each red: `>` for `>=`; in-place write; floor only; a bad birth time skipped; a bad line skipped; an
  unreadable birth log read as empty; no unlocked fallback; the size bound ignored; first birth wins.
- 29 existing test files that read endedSince, agentBirthOf, revoke or the birth log: 781 tests, 0 fail.
