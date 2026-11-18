# backupline-7586: the member's board says when it misses the company's backup requirement

Card: kosmos#7586 (Enterprise pilot 6/6), B2 of the plan (comment 6988600186), the board half of "backup required". The console half and the status-answer fields are kosmos-relay branch backupreq-7586. Deadline: working in production before 12-01 for the McKinney pilot.

## Finished looks like
On a board enrolled in a company whose policy requires backup (backup.required exactly true), when the coordinator's record of this member's last backup does not meet it, the joined view ends with "Your company requires this computer to be backed up, and its console shows it has not backed up yet." (no backup on record) or "... its last backup is older than your company allows." (older than max_age_hours). A family reads "Your family ...". Nothing when backup is not required, when company backup is off at the coordinator, when it is met, or when the coordinator is older and sends no backupOn.

## Change
- engine/orgpolicy.js: backupRequired, backupLate(seen, policy, nowMs).
- engine/orgenroll.js: refresh keeps backupOn/backupAt from each full status answer; never carried (an answer without them leaves none).
- server.js GET /api/org: backupLate, for this world's enrollment only.
- web/index.html: PLUS_ORG_BACKUP_NEVER / PLUS_ORG_BACKUP_LATE, plusOrgBackupLate after the reporting branch.

## Decided
- One source of truth: the board reads its last backup from the coordinator (status answer), not from a record of its own. engine/backuptick.js keeps its run state in memory only, and a second copy could disagree with the console. Cost: the full status answer is polled on the order of hours, so the board can lag the console by that.
- Judged at the last answer, and only while it is fresh (round 1): backupLate compares the backup time with when the status answer arrived (backupSeenAt), not with the page's clock, so the line describes the console as of the board's last check; an answer older than 3 hours (three missed hourly refreshes, ORG_REFRESH_MS) says nothing. With the two clocks in step, a board lags the console by up to an hour and under-claims in that time. The comparison is the board's clock (backupSeenAt) against the coordinator's (backupAt), so a board clock ahead of the coordinator's by more than the slack in max_age_hours can call a backup late early by that skew; no tolerance is added.
- Silence on the board does NOT mean the requirement is met. The line also says nothing when the last answer is over 3 hours old, before the first refresh after a join (the join builds a fresh record without backup fields; the next hourly refresh fills them), and when the coordinator sent a time it cannot read as seconds. A long-late computer whose refreshes start failing therefore loses the line after 3 hours and gets it back on the next good refresh. The console is the place that says whether it is met.
- The two sides read the policy from different places: the console reads the coordinator's newest saved policy, the board its locally applied one. They can disagree while a new policy has not reached or been refused by this computer; the board's line then follows what this computer actually applies, which is the same rule every other policy line on the board follows.
- A family whose words are not accepted here (the wordsNeeded branches) gets no backup line: with no accepted words it backs up nothing, so the reporting line there already says the state that matters.
- The line names "this computer", but backupAt is the member's newest backup in the company, the same per-member fact the console's Inventory reads. A member with two joined computers, only one of them backing up, sees no line on the other. That under-claims, and matches what the admin sees.
- Flag, do not un-enroll (the card body's "must have backup on to stay enrolled"): removing the computer would also remove the company's AI policy from it.

## Measured
- After round 3: engine/orgpolicy-backup-7586 7/7, engine/orgenroll-backup-7586 2/2, server.orgenroll-5531 42/42, web.joined-backup-7586 3/3, web.joined-required-7586 4/4.
- Before the loop (commit 53d106bc13): the 71 test files that name orgenroll, orgpolicy, /api/org, plus-org-say or the reporting line, plus the new ones: 1871 tests, 1869 pass, 0 fail, 2 skipped (the same 2 before the change). The full suite runs once, through the heavy queue, at the final gate.
- Browser check render-orgenroll-5531 30/30 with O15b; with plusOrgBackupLate removed from the sentence, O15b FAILS.
- Mutations, each red: backupOn gate, the late comparison, the never arm, the stale limit, judging at backupSeenAt, ORG_REFRESH_MS changed (orgpolicy); backupAt kept with backup off, carried over (orgenroll); server wiring forced null.

## Weakest premise
That company backup is switched on in production before 12-01 (#8526: Josh's go, #8528, #7590). Until then backupOn is false and this says nothing, which is correct and dark.

## Ledger
- Round 1 (blind, default model): 2 WARNINGs, 4 NITs. W1 the board judged lateness on its own clock against an hourly-refreshed time, so it could claim the console shows "late" when it no longer does; W2 the "never carried" comment overstated: a failed refresh keeps the old record indefinitely. Both FIXED by backupSeenAt (judge at the answer, ignore past 3 hours), with tests for each and both guards mutated red. NITs: policy source and family branch recorded as decisions above; empty ledger filled; duplicated sentence pins across two test files kept (the repo's pinning style).
- Round 2 (blind, sonnet): 1 WARNING, 4 NITs. W the 3-hour stale limit was tied to the hourly refresh only in prose: FIXED with a test that reads server.js ORG_REFRESH_MS and asserts the limit is three of it (mutated red by changing ORG_REFRESH_MS). NITs taken: the policy is read once in backupLate; a backup time ahead of the answer (clock skew) is pinned as met. NITs left: a non-boolean backupOn reads as an older coordinator (says nothing, the safe direction); the family wordsNeeded branch is the recorded decision above.
- Round 3 (blind, default model): 1 CONVENTION, 3 NITs. CONVENTION the Measured counts were stale: FIXED (rerun, rewritten). NIT the plan said the board "never" over-claims, untrue under clock skew: the claim is removed and the skew stated. NIT per-member data under "this computer" wording: recorded as a decision. NIT a board clock moved backward keeps an answer fresh until it catches up: left (negligible, and it delays silence rather than inventing a claim).
- Round 4 (blind, sonnet): 1 WARNING, 3 NITs. W the plan did not say that silence on the board is not "met" (the stale cutoff can drop and restore the line): FIXED, stated in Decided with every silent case. NIT a backupAt sent in milliseconds would read as met: pinned by a test (it says nothing). NIT the join path has no backup fields until the next refresh: in the same Decided line. NIT current() read per /api/org poll: left (cheap, wrapped).
