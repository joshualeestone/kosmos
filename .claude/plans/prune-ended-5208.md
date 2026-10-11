# prune-ended-5208: bound the history of ended agents (kosmos#5208)

## The defect
`ended-agents.jsonl` (engine/sendertoken.js noteEnded) only grows: every revoke appends a line, including every create
that got past its name checks, and every token-only removal reads it whole (endedSince). Measured 2026-10-11: the
file does not exist yet on Agent1s or on Mortals (the #5809 removal check is new), so this is a preventive bound.

## The rule
endedSince(names, since) is true when ANY line for those names is after `since` (or at it, inclusive). So for each
name only its NEWEST line (largest `at`) can decide an answer, for every `since`, strict or inclusive. A compaction
keeps the newest line per EXACT name (one exact name always has one slug, so this holds under any slug rule) and
changes no answer. No births, clocks or floor; the history grows with distinct names (not capped), not with events.
endedSince's only reader is the token-only removal check (Angel confirmed).

## How no end is lost (to this build; to an older one that reads only ended-agents.jsonl, except the two residuals under Weakest premise)
- The live file `ended-agents.jsonl` is the history every build reads, and the only file appended to. noteEnded appends
  under a lock on it; if the lock cannot be had it still appends, unlocked, and does not compact.
- compactEnded, inside that lock, when the live file has grown 64 KiB past its size after the last compaction
  (recorded in `ended-agents.d/compacted-bytes`):
  1. reads the sealed files and the live file and folds them; a line it cannot read whole stops it here (said once,
     naming the file), with every file as it was;
  2. writes the fold to a temp file in ended-agents.d (denied to token-only agents, so none can hold the file that
     becomes the live one) and FLUSHES it (securewrite.flushOrThrow); a failed flush stops it;
  3. if the live file is still the file it read (device, inode, birth time), hard-links it to `ended-agents.d/sealed.<ms>.<pid>.<hex>.jsonl`
     (the file about to be replaced, and anything appended to it even later, stays readable), RENAMES the temp over the
     live file and flushes both folders. A failed rename drops the link and the temp, says so once, and leaves the
     live file as it was. The live path is never absent: it holds the whole old history or the whole fold;
  4. appends back (and flushes) any line that reached the replaced file after the read (only an unlocked append can);
  5. only then deletes a sealed file read in this run and unchanged for at least an hour.
- endedSince reads the live file, the sealed files, then the live file again: a live file replaced after the first
  read was linked as a sealed file first (listed next if the replace came first, else its lines were read); a sealed
  file deleted before it is read was folded into the live file that replaced it before the deletion.
- setup-assistant.js denies token-only agents writes to `ended-agents.d` and to the lock `ended-agents.jsonl.lock`
  (permission rule and sandbox denyWrite), as it already does for the live file.

## Weakest premise
That endedSince stays the only reader and keeps "any line after since" semantics. Residuals, all needing an unlocked
append or a stolen lock at the same instant: a line appended to the replaced file after step 4's read reaches only the
sealed file (this build reads it for an hour; an older build does not); and a compaction that slept in the instant
between its last checks (identity, then time) and its rename can replace a newer live file, and the ends appended to
THAT file are then orphaned (fail open, for both builds). The time and identity checks sit immediately before the
rename to make that instant as small as possible; only an atomic compare-and-rename would close it.

## Decided after review 1 (opus), which found the first design unsafe
The first design (decided on the card) pruned by a cutoff from the births log and rewrote the live file. Review 1
found: a BLOCKER (a rewrite loses an end appended between its read and its rename, through the unlocked fallback or a
stolen lock: fail open), and that the births-based cutoff barely bounds (one never-recreated agent-made name pins it)
and trusts a births log that can go missing. The newest-per-name rule needs neither; the seal-then-compact files remove
the rewrite of anything appended to. The create.js/server.js refactor that design needed is reverted.

## Tests (engine/sendertoken.prune-ended-5208.test.js, plus boardkeychain-4491 for the deny rules)
- newestPerName keeps the newest per exact name and refuses on three unreadable shapes.
- a compaction changes no answer of this build or of a rolled-back one (it reads the live file only): 300 lines over
  four names, every boundary time, strict and inclusive; the live file is replaced (new inode), a sealed link holds the
  old one, no temp is left.
- every way to stop (a torn line, a failed flush, a failed rename, a live file replaced meanwhile) leaves the live file
  as it was, no sealed name and no temp, and both builds answer the same.
- a line appended between the read and the rename is kept, for both builds.
- a sealed file is kept while young and while changed since read, and deleted when old and unchanged, its ends still
  answered by both builds.
- the read order (live, sealed, live again) keeps an end a compaction folds in and deletes mid-read (staged race).
- an unreadable sealed file refuses; an empty history answers false.
- the size bound counts from the last compaction; a torn line stops it, said once, naming the file, and still refuses.
- noteEnded compacts past the bound; an end is appended even when the lock is held elsewhere.
- the deny rules cover ended-agents.d and the lock, in permissions and sandbox (boardkeychain-4491).
- Mutations, each red (restored and byte-compared): the temp not flushed; no same-file check; no sealed link; the link
  kept on a failed rename; the tail not put back; no second live read; the oldest line kept; a young sealed file
  deleted; the bound not counted from the last compaction; a changed sealed file deleted; a bad line skipped; no
  unlocked fallback; the folder or the lock not denied.

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

## Review 4 (sonnet, blind, on 6d2468c7b)
- FIXED (WARNING): the rollback carry ran only when the whole compaction succeeded; seven ways to stop after the seal
  left a rolled-back build blind to the sealed ends (fail open), the stuck path worst. Reordered: compact.jsonl, the
  sealed files and the live file are read and folded BEFORE the seal, so every way to stop that can stop does so with
  the live file untouched (a stuck compaction no longer seals at all); after the seal the folded lines, plus any line
  an unlocked append put into the sealed file after the read, go back into the live file on every path (finally).
  Tests: a rolled-back reader answers the same for a torn line, a compact.jsonl that changed, a failed rename, and an
  append between the read and the seal; mutations (carry only on success; extra not carried) red.
- FIXED (WARNING, by comment): the stale-overwrite check narrows the window and does not close it; the comment says
  so, and what bounds the loss (an hour of sealed files, still read).
- FIXED (WARNING, by comment): growth is bounded by distinct names, which are not capped; the comment says so.
- FIXED (NIT): the slugFor comment now says the real hazard (a split key cannot be undone).
- NO CHANGE (NIT): a torn line is not healed (it never was; endedSince refuses on it as on main; the stuck note names
  the file). Plan file name: this repo's other plans are <branch>.md as well.
- One consequence of the reorder: the file sealed in a run is not among those read in it, so it is deleted at the
  earliest one run later (test updated).

## Review 5 (opus, blind, on 565c2f66a): led to the second redesign
- FIXED (BLOCKER): nothing was flushed before files were deleted; a power loss after a compaction could leave a
  zero-length compact.jsonl with its sources gone (fail open). Now the fold is flushed before it replaces the live
  file, the folders after, the put-back tail too, and sealed files are deleted only after all of that.
- FIXED (WARNING): between sealing and carrying back, the live file did not exist, so an older build saw no history.
  The second redesign never removes the live path: it is replaced by an atomic rename, and the file it replaces is
  hard-linked first. compact.jsonl and the carry-back are gone.
- FIXED (WARNING): folding by slug tied the argument to slugFor never splitting a key; it folds by exact name now.
- FIXED (WARNING): a rename that always fails (antivirus) grew the history faster than no compaction, silently. Now a
  failed rename leaves everything as it was (drops its link and temp) and is said once.
- FIXED (CONVENTION): the plan described the old order; rewritten to the code.
- GONE (NITs): the always-true ternary (test rewritten); revoke's possible wait is stated at noteEnded.

## Review 6 (sonnet, blind, on 54671c540): no BLOCKER
- FIXED (WARNING): two comments still named compact.jsonl (gone in the second redesign).
- FIXED (WARNING): a hard-link failure (a file system without them, a linked folder on another device) stopped every
  compaction silently; it is said once now, like the stuck line and the failed rename (all three tested once each).
- FIXED (WARNING): "still the file that was read" compared the inode only, which Windows can report imprecisely or as
  0; it compares device, inode and birth time, and says it is best effort where none is reported.
- FIXED (WARNING, wording): the plan's headline now points at the two residuals instead of claiming none for an older
  build.
- FIXED (NIT): a failed put-back after the replace no longer reports "not compacted" (the line stays in the sealed file).
- NO CHANGE (NITs): stray temps are swept only after a successful compaction (harmless until then); the swap itself is
  one atomic rename, which a test cannot interleave.

## Review 7 (opus, blind, on 9f58e2fff): no BLOCKER
- FIXED (WARNING): the temp that becomes the live file was made in the store root, outside every deny rule; it is made
  in ended-agents.d now (test pins where it is made; mutation red).
- FIXED (WARNING): `Edit(dir/**)` does not cover the folder path itself, so a token-only agent's file tools could make a
  plain FILE named ended-agents.d (every removal would then refuse: a denial of service, not a fail-open). `Edit(dir)` is
  added beside each, for the folder and the lock (boardkeychain-4491 asserts both; mutation red).
- FIXED (NIT): the put-back of a replaced file that no longer starts with what was read had no test (all of it goes
  back; a test now rewrites the file in place mid-compaction; "always slice" mutation red).
- FIXED (NIT): a sealed file whose stat fails for any reason but ENOENT stops the compaction instead of being skipped.
- FIXED (NIT): "for an hour" is "for at least an hour" (a sealed file goes at the first compaction after the hour).
- RECORDED (NIT): once compaction is stuck (a torn line, no hard links, a rename that always fails), every noteEnded still
  reads and folds the whole history under the lock. Each stuck state is said once and is rare.

## Review 8 (sonnet, blind, on 6a61db435)
- FIXED (WARNING): a reader in flight could miss a line that reached the replaced file after the compaction read it,
  if its sealed listing came before the link and its second live read before the put-back. endedSince now lists the
  sealed files again after the second live read and reads any new one (the link precedes the rename). Test stages it
  (the compaction runs just after the reader's first listing, and the put-back fails); "no second listing" mutation red.
- FIXED (WARNING): a persistent link or rename failure (or a torn line) refolded the whole history on every end. A
  failed try records the size it saw, so the next waits for another 64 KiB (test; "no backoff" mutation red).
- RECORDED (WARNING): the new deny rules reach a token-only agent at its next session (guards are refreshed at board
  start and at each launch, setup-assistant refreshTokenOnlyGuards). Until then it can make removals refuse (a file at
  ended-agents.d, or holding the lock), and, in the same instant as a named residual, overwrite a sealed file that alone
  holds a late line (a narrow fail-open; review 17).
- FIXED (NIT): "at least an hour" is measured from the sealed file's last write; the comment says so.
- NO CHANGE (NIT): newestPerName passes engine.reachable.test.js (reachable through noteEnded and compactEnded).

## Review 9 (opus, blind, on 18a50aeab): no fail-open found
- FIXED (WARNING): the put-back could copy a torn tail (an unlocked append still being written), leaving the live file
  refusing every removal for good. Only whole lines go back now; the rest stays in the sealed file, which is read, and
  folds once whole (test: a half line written mid-compaction, then finished; mutation red).
- FIXED (WARNING): not every failure after the size check backed off, and a failed flush was never said. Every stop
  after the size check now records the size (unreadable files and the live file included), and a failed flush is said
  once (test; mutation red).
- FIXED (NIT): the stuck note is said only after re-reading the bad file, so a torn read that heals at once does not
  spend it (test; mutation red).
- FIXED (NIT): comments said "inode" (it is device, inode, birth time) and "only an unlocked append" (a compaction that
  stole the lock can too).
- FIXED (NIT): a test for a lock-stealing compaction putting a newer file in place between the check and the link.
- RECORDED (NIT): on Windows, unlinking a sealed file a reader holds open may leave it delete-pending, so a reader that
  listed it gets EPERM and endedSince refuses that once (fail closed). Treating EPERM as "missing" could fail open, so it
  is left refusing; the Windows job runs the test file.

## Review 10 (sonnet, blind, on d3efc7c7c): no BLOCKER
- FIXED (WARNING): a sealed file's deletion compared mtime only; a same-millisecond or coarse-mtime append could hide.
  Size is compared too (test keeps the mtime, changes only the size).
- FIXED (WARNING): a compaction slow enough to approach filelock's 10 s stale bound: a read-and-fold phase over 3 s
  (COMPACT_READ_BUDGET_MS) stops and backs off.
- FIXED (WARNING, wording): a line torn at the read and finished later reaches only the sealed file, so an older build
  misses it until the next compaction folds it (this build reads the sealed file meanwhile).
- FIXED (NIT): a base larger than the live file (shrunk outside this code) resets to 0.
- RECORDED (NITs): newestPerName stops on a bad line for any name, wider than endedSince's refusal (safe: it only stops
  compacting); the test's old-build model folds case, which equals slugFor for every name it uses.

## Review 11 (opus, blind, on 8f164b5bc)
- FIXED (BLOCKER): the fold was written with one writeSync and its byte count never checked; a short write (a disk
  filling partway) would be flushed, renamed over the live file, and the sealed files deleted on its strength. It is
  written with writeFileSync(fd) (which loops) and READ BACK and compared before any link or rename; a mismatch stops
  the compaction, said once (test: a short write, among the ways to stop).
- FIXED (WARNING): a sealed name that is not a regular file (a pipe, a link to a device) could hang the reader. Sealed
  files are lstat'd and read only if regular; anything else refuses (tests: a FIFO, a link to /dev/zero).
- FIXED (WARNING): revokeIfUnchanged called noteEnded under the session lock, so a compaction could outlast that lock's
  stale bound. It now records the end without compacting; the next end compacts (test with a control).
- FIXED (NITs): the identity comment says birth time is not reliable on NTFS and that safety rests on step 4's whole
  put-back; the backoff comment says "where it can write that".
- Residual named: if the put-back of a late line fails, that line is in the sealed file only until the next compaction,
  so an older build misses it meanwhile (this build reads the sealed file).

## Review 12 (sonnet, blind, on a0c068f74): no BLOCKER
- FIXED (WARNING): the FIFO/symlink test cannot run on the Windows job (no mkfifo, symlink privilege); skipped there.
- FIXED (WARNING, narrowed): a lock-stealing compaction that renamed its file over the live path between this one's
  link and rename would be overwritten. The identity is checked again after the link; if it moved, this one stops and
  drops its link (test). Residual: the gap between that check and the rename (no atomic compare-and-rename exists).
- FIXED (WARNING): a read phase over the 3 s budget (many sealed files under churn) is said once.
- FIXED (WARNING): ended-agents.d is created 0o700. Running agents keep their old sandbox until their next session
  (already recorded): the worst meanwhile is refusals.
- FIXED (NIT): the temp's mode keeps an owner floor (| 0o600).
- NO CHANGE (NITs): a power loss between the rename and the put-back hides an unlocked append from an older build until
  the next compaction (named above); compacted-bytes is written plainly (a torn read gives 0, only an earlier compaction);
  the stuck path re-folds files to name the bad one (rare path).

## Review 13 (opus, blind, on 63018a2c7): no BLOCKER, no loss outside the named residuals
- FIXED (CONVENTION): the post-link abort comment named only one of its two cases; it now states both, and the
  assumption that anything replacing the live file links the old one first (a new way of replacing it must keep that).
- FIXED (WARNING): the 3 s budget covered only the read; a total budget (6 s, inside filelock's 10 s stale bound) is
  checked again after the write, flush and read-back, before anything is linked (test; mutation red).
- FIXED (NIT): ended-agents.d is flushed between the link and the rename, so the link survives a crash before the rename.
- FIXED (NIT, by comment): Windows delete-pending (EPERM) on a sealed file refuses for that moment; noted in the code.

## Review 14 (sonnet, blind, on 0a0ad8904): no BLOCKER
- FIXED (WARNING): no clock check sat between the link and the rename, so a machine that slept there could rename an
  older fold over a newer live file after the lock went stale. The time budget is checked again last thing before the
  rename, counted from when the lock was taken (noteEnded passes it). Test (the clock jumps between the link and the
  rename); mutation red.
- FIXED (WARNING): the header comment and this plan claimed more than the code: the slept-compaction residual orphans
  the NEWER file's later ends (fail open, both builds), and older builds miss the named residual lines. Both restated.
- FIXED (WARNING): a replaced file edited in place could put a torn mid-way line into the live file; the put-back now
  goes in only if it reads whole (test; mutation red).
- FIXED (WARNING): revokeIfUnchanged waited up to 2 s for this lock while holding the session lock; it waits 200 ms,
  then appends unlocked (safe).
- NO CHANGE (NITs): line widths in one comment; compacted-bytes cannot be written if the folder cannot be made (each end
  then refolds, bounded by the file size).

## Review 15 (opus, blind, on 950744100): no BLOCKER
- FIXED (WARNING): the budgets counted from a time taken inside the locked section, later than the lock folder's own
  mtime that other processes judge staleness by; they count from the earlier of the two now (test with an 8 s old lock
  folder; mutation red).
- FIXED (NITs): identity from bigint stats (an NTFS file ID can exceed 2^53); the folder-flush comment says Windows
  relies on NTFS ordering (syncDir is a no-op there); the put-back comment says a short append fails closed; an
  unexpected throw past the size check backs off like every other stop; deletion and the temp sweep use lstat.
- My own slip, caught by the tests at once: the new identity line first sat above the declarations it used (a temporal
  dead zone its own catch turned into a quiet "not compacted"); moved below them.

## Review 16 (sonnet, blind, on df83a2d19): no BLOCKER, no fail-open beyond the named residuals
- FIXED (WARNING, by statement): a compaction runs synchronously inside revoke, so on a slow disk it can hold the event
  loop for up to the 6 s budget on the rare end that triggers one; stated in the code and here.
- FIXED (WARNING): a skewed or coarse lock-folder mtime could trip the budget on every try (fail closed, said once); the
  note now says the time is counted from the lock folder's mtime, so the cause is visible.
- DUPLICATE (WARNING): a folder that cannot be made leaves no back-off marker (recorded at review 14).
- FIXED (NIT): why no liveExecutionAllowed gate is needed (it deletes only files it made; tests use a throwaway root).
- NO CHANGE (NITs): plan file name (repo practice is <branch>.md); the Windows job is the first real Windows run of the
  test file (no Windows machine here).

## Review 17 (opus, blind, on 944a4a0c1): NITs only. CONVERGED.
- No BLOCKER, WARNING or CONVENTION. Its three NITs were overclaims in prose, corrected after convergence (comments and
  this plan only, no code): the header and the sealed-file comment now name the slept-compaction residual, which loses
  ends for both builds; the rollout record names the narrow pre-upgrade-guard overwrite of a sealed file.
