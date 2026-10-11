# prune-ended-5208: bound the history of ended agents (kosmos#5208)

## The defect
`ended-agents.jsonl` (engine/sendertoken.js noteEnded) only grows: every revoke appends a line, including every create
that got past its name checks, and every token-only removal reads it whole (endedSince). Measured 2026-10-11: the
file does not exist yet on Agent1s or on Mortals (the #5809 removal check is new), so this is a preventive bound.

## The rule
endedSince(names, since) is true when ANY line for those names (matched by slug) is after `since` (or at it,
inclusive). So for each slug only its NEWEST line (largest `at`) can decide an answer, for every `since`, strict or
inclusive. A compaction keeps that line per slug and changes no answer. No reference to births, clocks, a floor or
which agents exist: the history grows with distinct names, not with events. endedSince's only reader is the token-only
removal check (Angel confirmed).

## How no end is lost
- The LIVE file is the only file appended to. noteEnded appends under a lock on it; if the lock cannot be had it still
  appends, unlocked.
- Compaction (inside noteEnded's lock, once the live file passes 64 KiB):
  1. renames the live file to `ended-agents.d/sealed.<ms>.<pid>.<hex>.jsonl` (atomic; a later append starts a new
     live file; an append that opened the old one lands in the sealed file);
  2. rewrites `ended-agents.d/compact.jsonl` (temp file and rename) from itself plus every sealed file;
  3. deletes a sealed file only once read in this run AND unchanged for an hour (SEALED_KEEP_MS).
  Anything it cannot read whole (a torn line, a bad `at`) stops it before step 2; the sealed files stay and are read.
- endedSince reads the live file, then every sealed file, then compact.jsonl. A compaction running meanwhile cannot
  slip a line past that order: a live file sealed after the read was read; one sealed before is listed next; a sealed
  file deleted before it is read was already in compact.jsonl, which is written before any deletion.
- A compaction that wakes late after its lock was stolen may overwrite compact.jsonl with older content, but every
  sealed file under an hour old is still read, so nothing is lost unless it slept for more than an hour.
- setup-assistant.js denies token-only agents writes to `ended-agents.d` (permission rule and sandbox denyWrite), as
  it already does for the live file: an agent that could delete a sealed file could erase its own end.

## Decided after review 1 (opus), which found the first design unsafe
The first design (decided on the card) pruned by a cutoff from the births log and rewrote the live file. Review 1
found: a BLOCKER (a rewrite loses an end appended between its read and its rename, through the unlocked fallback or a
stolen lock: fail open), and that the births-based cutoff barely bounds (one never-recreated agent-made name pins it)
and trusts a births log that can go missing. The newest-per-name rule needs neither; the seal-then-compact files remove
the rewrite of anything appended to. The create.js/server.js refactor that design needed is reverted.

## Weakest premise
That endedSince stays the only reader and keeps "any line after since" semantics; a reader that counted lines, or
needed an older line for a name, would break on a compacted history. Second: a compaction asleep for over an hour
after its lock was stolen could drop the lines of a sealed file deleted meanwhile.

## Tests (engine/sendertoken.prune-ended-5208.test.js, plus boardkeychain-4491 for the deny rules)
- newestPerName keeps the newest per slug (case variants fold) and refuses on three unreadable shapes.
- a compaction changes no endedSince answer: 300 lines over four names (two share a slug), every boundary time,
  strict and inclusive.
- a stale compaction overwriting compact.jsonl drops nothing; a sealed file is read.
- a sealed file is deleted only when old and unchanged, and its ends are answered from compact.jsonl after.
- nothing under the bound; a torn line stops it and still refuses.
- noteEnded compacts past the bound, keeping the end that triggered it.
- an end is appended while the lock is held elsewhere.
- the deny rules cover ended-agents.d in permissions and sandbox, with a control on the module's own paths.
- a stuck compaction (an unreadable line) is said once per process, naming the folder (Angel's review).
- Mutations, each red (restored and byte-compared): sealed files not read; a young sealed file deleted; the live file
  copied instead of renamed; the oldest line kept; a bad line skipped; no unlocked fallback; the size bound ignored;
  compact.jsonl not read; the stuck note said every time; ended-agents.d not denied (permission); not denied (sandbox).
- 58 existing test files around removal, revoke, the birth log and the setup-assistant guard: 1546 tests, 0 fail.

## Review 1 (opus, blind, on ee0b19003): led to the redesign above
- FIXED (BLOCKER): a rewrite lost an end appended mid-prune (unlocked fallback; stolen lock). Seal-then-compact.
- FIXED (WARNING): the births-based cutoff barely bounded. Replaced by newest-per-name.
- FIXED (WARNING): a missing births log pruned to the floor. The births log is no longer read.
- NOTED (WARNING): noteEnded now takes a lock (bounded wait, LOCK_WAIT_MS) on every revoke; stated here. Lock order is
  session lock then this one, never the reverse.
- FIXED (WARNING): nothing proved noteEnded compacts; a test now does.
- GONE (NITs): bytes vs code units, the mode carried by writeFileSync, slugFor binding, the forward-clock edge: all were
  about code the redesign removed.

## Review 2 (sonnet, blind, on dc0d35100): no BLOCKER
- FIXED (WARNING): a stuck compaction's note now names the file holding the bad line (it named only the folder).
- FIXED (WARNING): the lock taken to append an end (ended-agents.jsonl.lock) is now write-denied for token-only
  agents too (permission and sandbox): one holding it would delay every revoke by the lock's wait.
- FIXED (WARNING): tests for the untested arms: a sealed file changed since read is not deleted; an unreadable sealed
  file or compact.jsonl refuses; a sealed file deleted between listing and read is answered from compact.jsonl; and
  the READ ORDER itself (a mutation reading compact.jsonl first survived every test until this one, which stages a
  compaction folding in and deleting an old sealed file just after the reader read compact.jsonl).
- FIXED (NIT): a comment named ENDED_DIR; stale compact temp files are cleared after an hour; one sentence on slugFor
  stability.

## Review 3 (opus, blind, on 5239198e2)
- FIXED (WARNING): a rollback to a build from before this change (the Windows app's Roll back) read only the live
  file and answered "nothing ended" for ends compacted into ended-agents.d: fail open. After a compaction the compacted
  lines are appended to the live file too, so that build answers exactly as this one (test: a reader of the live file
  alone answers the same before and after; mutation red). The trigger is now "the live file has grown 64 KiB past
  compact.jsonl", so the carried copy does not re-trigger it.
- FIXED (WARNING): a compaction that slept after its lock was stolen could write over a newer compact.jsonl. It now
  re-checks compact.jsonl (inode, size, mtime) just before the rename and stops if it changed (test; mutation red).
- FIXED (CONVENTION): the second ENDED_DIR in a comment.
- FIXED (NIT): compactEnded's return shapes documented; server.js's refusal log names ended-agents.d too; the new test
  file runs in the Windows job (tools/windows-tests.js).
- Tests force a compaction with `force: true` (the size test still runs without it).
