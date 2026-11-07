---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0796
diff_hash: 0263ec560adee42298460cb4df7dda5a8a211100fc1b175012a1dcc73cc3ada8
validation: passed (Mortals, 27874 tests, 0 fail, entry status clean 2026-11-07T09:46:45Z)
subdir_audit: passed
timestamp: 2026-11-07T09:49:44Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 22 (0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 14 NITs)
**Fixed:** 7 WARNINGs and 11 NITs | **Deferred:** 1 CONVENTION, 3 NITs | **Asked (awaiting user):** 0

Validation ran once on Mortals (mortals-validate, a real run, not a skip). A second local call at 6j started a full
local suite, because the first call's skipped entry no longer unlocks a skip; it was stopped at once, wrote no entry,
and left no process. The Mortals clean entry is the validation of record for this hash.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default (opus)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] release/whats-new-pool.json - Always Allow worded as "now lasts" though it never reached a release --> FIXED (3a88aafd14)
- [WARNING] release/whats-new-pool.json - shared-tasks line named the iPhone, which is not in this cut --> FIXED (3a88aafd14)
- [WARNING] release/whats-new-pool.json - line-spacing item ranked into the window for a 0.45px change --> FIXED (3a88aafd14, rank 17)
- [NIT] plan - per-platform counts wrong --> FIXED (3a88aafd14)
- [NIT] plan - #8140's other pieces not accounted for --> FIXED (3a88aafd14)
- [NIT] pool - app words not quoted --> FIXED (3a88aafd14)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json - "when they last worked" is wrong for Grok (its date is key expiry) --> FIXED (5f0647ef47)
- [NIT] pool - "line spacing 1.6" is jargon --> FIXED (5f0647ef47)
- [NIT] plan - #4926 is not invisible --> FIXED (5f0647ef47)
- [NIT] plan - Windows prod read cannot be rechecked by the reviewer --> DEFERRED: time-stamped; re-read live 11-07 03:0x (0.7.94)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json - untagged sign-ins item names Meta Muse, which is Mac-only --> FIXED (fa4716ae8f, split into Grok untagged + Muse mac)
- [NIT] pool - "each sheet as a tab" (one sheet draws no tab bar) --> FIXED (fa4716ae8f)
- [NIT] pool - room line spacing does not reach .msg.ext --> DEFERRED: "posts in a project room" is true; not in the window
- [NIT] plan - #7420 is iPhone-only --> FIXED (fa4716ae8f)
- [NIT] plan - no notesOnly for #4926 / #8140 item 3 --> FIXED (decision recorded in plan, fa4716ae8f)
- [NIT] first commit message has round-0 wording --> FIXED (noted in plan; PR body carries final wording)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] release/whats-new-pool.json - c209c254b5 (on-hold subtask count) shipped in 0.7.95 with no pool item --> FIXED (bfab487e4a, since 0.7.95, rank 17.2)
- [NIT] plan - #8036 is visible --> FIXED (bfab487e4a)
- [NIT] plan - "beside the six" stale --> FIXED (bfab487e4a)
- [NIT] pool - "Grok sign-in" covers the subscription sign-in only --> DEFERRED: plain word for a highlight

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (.xlsm omission)
- [WARNING] release/whats-new-pool.json - Grok row was amber "Signed in" before, never green --> FIXED (2e4d5b0d59)
- [NIT] pool - two task items word the CLI differently --> FIXED (2e4d5b0d59)
- [NIT] pool - "On the Mac," in mac-tagged lines --> DEFERRED: the platform-word rule (platformsNamed) wants the word
- [NIT] plan - round 2 bullet quotes replaced wording --> FIXED (2e4d5b0d59)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 2 (.xlsm, first commit message)
- [CONVENTION] .claude/plans/ - no pre-challenge proof file yet --> DEFERRED: by design; this loop writes it at Step 7
- [NIT] plan - #8165 labelled "no visible change" though agents see a refusal --> DEFERRED: agent-facing, same class as #4926
**Converged** - no new actionable findings (no BLOCKER or WARNING; the CONVENTION is the loop's own output).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | Always Allow "now lasts" | FIXED | 3a88aafd14 |
| 2 | 1 | WARNING | release/whats-new-pool.json | BRANCH | iPhone named in shared-tasks line | FIXED | 3a88aafd14 |
| 3 | 1 | WARNING | release/whats-new-pool.json | BRANCH | line spacing ranked into window | FIXED | 3a88aafd14 |
| 4 | 2 | WARNING | release/whats-new-pool.json | BRANCH | Grok "last worked" | FIXED | 5f0647ef47 |
| 5 | 3 | WARNING | release/whats-new-pool.json | BRANCH | Muse untagged | FIXED | fa4716ae8f |
| 6 | 4 | WARNING | release/whats-new-pool.json | BRANCH | on-hold count missing | FIXED | bfab487e4a |
| 7 | 5 | WARNING | release/whats-new-pool.json | BRANCH | Grok "not green" | FIXED | 2e4d5b0d59 |
| 8 | 6 | CONVENTION | .claude/plans/ | BRANCH | no proof file | DEFERRED | written at Step 7 |

### NITs (non-blocking, across all iterations)
- .xlsm not named in the spreadsheet line (iterations 3, 5, 6): an omission to fit 140 characters, not a false claim.
- Room line spacing does not reach messages from outside Kosmos (iteration 3).
- "Grok sign-in" means the subscription sign-in (iteration 4).
- #8165's plan label (iteration 6).

### Strengths (across all iterations)
- web/whats-new.json is byte-identical to `choose(pool, 5)` and `problems()` is empty (every round).
- prod-check passes: lastProd 0.7.94 = prod (every round).
- Before/after reading against the 0.7.94 bump c9311fc3ef confirmed each item (iteration 6).
- Browser-check trailer accepted by tools/lib/browser-check-gate.sh (iterations 4, 5).
