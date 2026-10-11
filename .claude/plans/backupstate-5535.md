# kosmos#5535 E0.6 slice (c), first half: what one backup run keeps for the next

Design on #5535 (comment 6114619425): no state between runs. engine/backupstate.js keeps, per (org, member), one
owner-only file (0600 in a 0700 folder, store.ROOT/backupstate, hashed name, as backupmemberkey's file):
- job: engine/backupjob.js's state (lostEpoch, waitUntilMs, waits), cleaned on write and read;
- period: { label (ISO week), namingKey (a SECRET), bucket, index (name -> key, lockedUntilMs, memberKeyId) }.
readState: missing is empty; a link, unreadable, malformed or another (org, member)'s file is refused (never read as
empty, so nothing overwrites it). writeState refuses a state it would not read back. forPeriod reuses the period's key
and index or starts fresh; withRun folds a takeSnapshot result in (staleIndex or another bucket drops the old index).

## Decided
- The naming key is kept on disk for the period, so later runs deduplicate. It is the Mac's OWN key in its own 0600
  file, not taken from storage, so backupkeys.js's "never name new chunks from a stored wrap" rule is untouched.
- Every index entry must be filed under the period it is in (the key's 4th segment), as backupsnapshot keyProblem asks.
- Rejected: keeping state in the member key file (different lifetimes; a malformed index must never cost the key).
- Weakest premise: each slot's index can reach 200000 entries (CHUNK_ALLOWANCE), about 35 MB; two slots about 70 MB, read whole each run.

## Checks
- (As first built; the current count and mutants are in the latest Review section below.)
- 7 tests: round trip and modes; 10 not-ours forms refused with a control; a link refused; job fields cleaned;
  writeState refuses unreadable states and writes nothing; forPeriod same and fresh; withRun merge, staleIndex,
  another bucket, no bucket, a first run; all written and read back.
- Mutants, each red: the period-of-key check, index-needs-bucket, the naming key id check, writeState's refusal,
  staleIndex, another bucket dropping the index, the member check, the duplicate check, the link check, forPeriod's
  reuse. (One mutant line was a no-op swap after a pattern split; not counted.)
- engine.reachable.test.js excuses forPeriod and withRun by name with the reason (the guard flagged them; its run now passes 7/7).

## Review 1 (sonnet, blind, on 29d70fdda): NOT CONVERGED
- FIXED (BLOCKER): withRun read takeSnapshot's bucket null as "another bucket" and dropped the index, but null comes
  back on EVERY failure before the index is read (a bad root, the clock, a key, a context): one transient failure
  would wipe a week's index and the next runs re-upload it all. Now only staleIndex or a DIFFERENT non-null bucket drops
  it. Test (the early failure keeps it); mutant red.
- FIXED (WARNING): no way out of a refused file. discardState renames it aside (.bad-<time>), never deletes it; the
  next read is a fresh start. Test; mutant red.
- FIXED (WARNING): withRun folded unchecked rows, so writeState could throw after a finished upload. Rows are checked
  as on read (a bad one left out) and the index is capped at MAX_INDEX. Tests (a bad row, another period's row, the cap
  at 200000); mutants red.
- FIXED (WARNING): resuming a period now prunes entries sealed to another member key (#5744 rotation) or whose lock has
  ended, which takeSnapshot would refuse as a stale index. forPeriod takes { memberKeyId, nowMs }. Test; two mutants red.
- FIXED (WARNING): the header states the caller's duties: write the new period (its naming key) BEFORE the snapshot,
  write after, one run at a time per (org, member); and what a killed run costs.
- FIXED (NITs): the chmod-after-trust comment; MAX_INDEX enforced in withRun.
- MEASURED (NIT, read cost): 200000 entries = 34.6 MB; writeState 283 ms, readState 251 ms on this Mac, once each per
  run, blocking. Acceptable for an hourly run; the run may move it off the event loop later.

## Review 2 (opus, blind, on 1c3329b80): NOT CONVERGED
- Checked: every takeSnapshot return path through withRun leaves the right index (success, every early failure, every
  staleIndex, overAllowance before and after batches, a batch from another bucket, grantedPeriod, a thrown uploader,
  outlastsChunks with and without a boundary, otherBucket with and without an index; an earlier epoch's entry is always
  another member key, so pruned).
- FIXED (WARNING): an EARLIER label started fresh and threw away the later period's naming key and index, which
  happens when the coordinator grants a week ahead of this Mac's clock (grantedPeriod) and a retry reads the clock.
  Now the stored later period is returned; the caller uses the returned label. Tests (and across a year); mutant red.
- FIXED (NIT): the lock prune is documented as defensive, not as takeSnapshot's check (that one is against the
  manifest lock, which every kept row passed for its period).
- FIXED (NIT): withRun returns leftOut (not persisted), so a caller passing the wrong period shows. Test; mutant red.
- FIXED (NIT): the "would not read back" test now reaches that refusal (a 31-byte key had thrown earlier).
- Documented: discardState's .bad files are kept for a person, never removed here.

## Review 3 (sonnet, blind, on f635fc54b): NOT CONVERGED
- FIXED (WARNING): a stored LATER period was kept however far ahead, so one written under a wrong clock held every later
  run in that week (each grant answering newPeriod for the real week, forPeriod handing the wrong one back). Kept now
  only up to a day ahead of nowMs; further ahead starts fresh. Tests (a day ahead kept, three weeks ahead not); mutant red.
- FIXED (WARNING): org and member were not checked: a number hashed to the same file and then read as another member's.
  Every function now requires non-empty strings (a caller mistake throws). Tests; mutant red.
- FIXED (WARNING): a passing read error (EBUSY, EAGAIN, EPERM, EACCES) looked like a foreign file, inviting a discard
  of a good one. Now retry, and the header says never discard on retry. Test (and a not-ours file is not retry); mutant red.
- FIXED (NIT): PERIOD_RE accepts weeks 01 to 53 only, so string comparison holds. Test; mutant red.
- FIXED (NIT): discardState's aside name has a random suffix (two in one millisecond no longer collide).

## Review 4 (opus, blind, on f55d0971f): NOT CONVERGED
- FIXED (BLOCKER): my review-2 rule ("an earlier label keeps the later stored period") overrode the COORDINATOR'S
  grantedPeriod when its clock is BEHIND this one: a fresh W42, grants filed under W41 (newPeriod, grantedPeriod W41),
  forPeriod handing W42 back, a wasted batch every attempt until the coordinator crossed Monday. Now forPeriod takes
  { granted: true } for a coordinator-named label, always honoured; only a label read from this clock can keep a later
  stored period. Test (an earlier granted label wins); mutant red.
- FIXED (WARNING): the one-day bound disagreed with takeSnapshot's own skew (SKEW_MS, one hour, periodsNear): a stored
  next week kept on a Sunday afternoon was refused by takeSnapshot on every run. Now kept only when it is the period this
  clock reaches within SKEW_MS (exported from backupsnapshot, not copied). Tests: kept at Sunday 23:30, not at 22:00,
  not mid-week; the one-day mutant, which the earlier tests could not see, is now red.
- FIXED (NIT): "for good" overstated the loss; starting fresh costs deduplication only (the key is in every manifest).
- FIXED (NIT): a time past Date's range (periodOf NaN-WNaN) is refused, never compared. Test; mutant red.
- Process: rounds 2 to 4 each corrected the rule before (clever-ahead, then too-wide, then source-blind). The rule now
  takes the label's source as an input instead of inferring it.

## Review 5 (sonnet, blind, on 1bcbbd8a9): NOT CONVERGED
- FIXED (WARNING): the rule kept a stored LATER period but not an EARLIER one, so with the coordinator BEHIND, each run
  past Monday 00:00 started W42, was granted in W41, and made W41 fresh again: a new naming key and a re-upload every
  run for the hour. Rounds 2, 4 and 5 had each patched one side; now the rule is takeSnapshot's own acceptance: for a
  clock label, the STORED period is kept whenever it is in periodsNear (this clock's period, an hour either way). A
  granted label still always wins.
- FIXED (WARNING): no test ran the caller loop. Added: runs every 10 minutes from Sunday 22:30 to Monday 01:40 with the
  coordinator 30 minutes ahead and behind; no period ever gets a second naming key, at most one extra attempt per run.
  Mutants red: either side of the window removed (the simulation fails), the keep removed.
- FIXED (NIT): a label not granted must be this clock's own (periodOf(nowMs)); otherwise a caller mistake throws. Test;
  mutant red.
- NO CHANGE (NIT): forPeriod's nowMs and takeSnapshot's now() are read separately; a run starting at the exact edge can
  disagree, which costs one newPeriod answer (the granted path), never a loop.

## Review 6 (opus, blind, on 7552ef681): NOT CONVERGED; the period policy is removed
- BLOCKER, measured by the reviewer with the real uploadManifest: keeping last week's period after this Mac's Monday
  00:00 can never deduplicate: chunks granted mid-week are locked to their week's end + 30 days + 15 minutes, and a new
  manifest's lock is later, so uploadManifest refuses it (outlastsChunks) before any grant, even with both clocks in
  sync. A wasted run or two per member per week, and the dedup the keep existed for never happens.
- WARNING: my caller-loop test did not model takeSnapshot (no precheck, no manifest floor, grantedPeriod assumed on
  every path), so it proved nothing about the real rules.
- DECIDED: rounds 2, 4, 5 and 6 each found the previous keep rule wrong in a new direction. A pure state module cannot
  see takeSnapshot's answers, so it should not choose the week. forPeriod now resumes ONLY an equal label (pruned) and
  otherwise starts fresh; the caller runs this clock's period, and once more with grantedPeriod after a newPeriod
  answer (stated in the header's duties). Cost, stated in the header: a re-upload at most once a week, in the hour
  around Monday 00:00 when the coordinator's clock is ahead. The simulation test is removed (it could not fail on the
  real rules); the SKEW_MS export from backupsnapshot is reverted (nothing uses it now).
- WARNING not taken here: backupsnapshot's manifest wrong-period result carries no grantedPeriod. With this design the
  caller then just uses its clock's period next run; adding it is a backupsnapshot change for the run slice to judge.
- FIXED (NITs): the prune comment names uploadManifest's stricter floor; a stale "compare as strings" comment removed.
- Tests: 11. Mutant (resume the stored period for any label): red. backup*.test.js + reachable: 372 pass.

## Review 7 (sonnet, blind, on cd31ec42c): NOT CONVERGED
- Checked: the manifest lock (coordinator retain_until_for(period_end)) against the defensive prune; review 6's point;
  withRun against every takeSnapshot result field; no dead code left.
- FIXED (WARNING): the stated cost was wrong. With ONE period slot, this clock's week and the coordinator's granted week
  overwrote each other's key and index on every run near Monday, so EVERY run in the skew window re-uploaded the tree
  (not "once a week"). Now TWO slots (SLOTS), most recently used first (withPeriod), forPeriod resuming the slot of an
  equal label: the caller still chooses the week, and each week keeps its key and index. Real cost now: the first batch
  of each such run, uploaded under the wrong week. State shape: `periods` (a list) replaces `period`. Tests (resume
  the other kept week; LRU eviction; two-slot round trip; three slots and repeated labels refused); mutants red (one
  slot, appended not first, the duplicate-label check).
- FIXED (NIT): leftOut counts added rows dropped for want of a bucket. Test; mutant red.

## Review 8 (opus, blind, on 3acb8a4c7): NOT CONVERGED; caller walk confirmed
- Checked: a caller following the header's duties across Monday 00:00 with the coordinator behind and ahead (files
  changed) loses nothing and pays the stated first batch; withRun against every result; no other one-period assumption.
- DOCUMENTED (WARNING): the idle Mac with the coordinator ahead answers staleIndex (manifest granted next week outlives
  this week's chunks), so that run takes no snapshot and drops the index; the next first batch is the whole tree. Stated
  in the header as a cost, with the caller's option (on staleIndex within an hour of its Monday, run periodOf(now + 1 h)
  once). Not encoded here: the week is the caller's call (review 6's decision).
- FIXED (NITs): "after Monday" now "after the COORDINATOR's Monday"; the header states the size of two full slots
  (about 70 MB, about half a second each way) and the carried previous-week slot; writeState's three-slot refusal now
  has a test (its mutant, which passed every test before, is red); the reachability excuses say up to two periods.
- Process slip: I ran the write-cap mutant BEFORE committing, and `git checkout` reverted my uncommitted header edits
  with it (memory feedback-git-checkout-discards-all-uncommitted, my own rule). Re-applied from the same text, then
  committed.

## Review 9 (sonnet, blind, on 4a1816504): NOT CONVERGED
- FIXED (WARNING): "a refused file is never overwritten" was a promise, not a check: a caller falling back to a fresh
  state after a refused or retry read would have replaced the file and lost both weeks' keys. writeState now refuses to
  replace an existing file unless it is a plain file whose first bytes are this module's for (org, member) (v, org,
  member are written first); a passing read error throws with retry. After discardState there is no file, so it writes.
  Reads only the first bytes. Tests: a corrupt and a foreign file refused and left byte-identical; discard then write;
  EBUSY refused with retry; a link refused and left; our own file replaced (control). Mutants red: the check removed,
  isFile, the head comparison, retry forced false.
- FIXED (NIT): the header bounds EACCES/EPERM retries (lasting on POSIX: a caller tells the person after a few).
- FIXED (NIT): the leftOut-not-persisted assertion now reads the file's keys (it could not fail before); the cap test
  writes and reads a full slot back and asserts leftOut 1.
- Process: the clean-tree guard went first this time; three multi-line mutant specs broke the syntax (caught by
  node --check, nothing lost), redone on one line.

## Review 10 (opus, blind, on 1eb52b1ac): NOT CONVERGED
- FIXED (WARNING, measured by the reviewer): the head-only write guard let a file with our first bytes and a corrupt
  body be overwritten (readState refuses it), and refused a pretty-printed good file forever (readState accepts it).
  One definition now: the guard IS readState (absent or ok may be replaced; anything else refused, retry passed
  through). Costs one read per write (about 250 ms at 70 MB). Tests: body-corrupt refused and left byte-identical;
  a reformatted good file replaced; ids with a quote, backslash, U+2028, an emoji and a lone surrogate round-trip.
  Mutants red: the guard removed, the guard always passing, retry forced false.
- FIXED (NIT): a passing error from the atomic write itself now throws with retry (no test: it needs a Windows rename
  refusal; stated here as not covered).
- FIXED (NIT): the header names the window between the guard's read and the rename (covered by the one-run duty).
- FIXED (NIT): the plan's first Checks section says it is the first build's; current counts are here.
- Now: 16 tests pass.

## Review 11 (sonnet, blind, on a13371ab4): NOT CONVERGED
- FIXED (WARNING): the write-side retry had no test. Added: fs.renameSync stubbed to EBUSY (retry), ENOSPC and EROFS
  (not retry); the old file is left; control writes. Mutant (retry forced false) red.
- FIXED (WARNING): the write error dropped the real error. It now carries `code` and `cause` (and the code in its
  sentence, gated to a plain code), so a full disk reads differently from a bug. Mutant (code/cause dropped) red.
- FIXED (WARNING): the cost sentence said 250 ms at 70 MB; that was one slot's read. Now: 251 ms at one full slot,
  about half a second at two. (Measure, then write the sentence.)
- FIXED (NIT): mkdir/chmod are inside the write wrapper, so their errors carry retry and code too.
- FIXED (NIT): a lone surrogate in org or member is refused (it hashed to U+FFFD's file). Tests; mutant red.
- FIXED (NITs): the header says the bounded-retry duty applies to writes; a run-on sentence re-wrapped.
- Now: 17 tests pass.
