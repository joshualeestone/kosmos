---
pre_challenge: true
method: challenge-loop
branch: ownhosts-9028
diff_hash: c86d5c87e6387ba4c9d8afc2c53ddbfe16580753f42ee8f9645e3124afcf50d8
validation: partial locally (ios/LogicTests all six suites pass, run.sh 2749 of 2749 on the rebased head; the app type-checks in Debug and Release; the node tests that read ios/ pass). The full node suite was not run on this Mac; it and the iOS build and UI tests run on CI and are required green before merge. Not run in a simulator or on a phone.
subdir_audit: passed
timestamp: 2026-11-25T03:57:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: nothing new to change; a one-arm test was added after it, found by removing a condition)
**Total findings:** 19 actionable plus NITs (0 BLOCKERs, 17 WARNINGs, 2 CONVENTIONs)
**Fixed:** 15 | **Deferred:** 4

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, all fixed
- [WARNING] the account list was held on a coordinator a lock replaces (fixed: BoardWeb)
- [WARNING] back, forward and reload let in any address shaped like a computer (fixed: hosts shown; reload is the page showing)
- [WARNING] a redirect of a tapped link is reported as a tap (fixed: the rule no longer depends on the kind)
- [WARNING] the pending page was used for every navigation and never cleared (fixed: LinkTrail)
- [WARNING] the last opened host outlived an account change (fixed)
- [WARNING] Kosmos+'s own redirect stayed a denylist (fixed: only while the list is unread)
- [CONVENTION] a block split a comment from what it describes (fixed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, all fixed
- [WARNING] a computer added since the list was read went to Safari (fixed: one fresh list first)
- [WARNING] a stopped load reported late cleared the one that replaced it (fixed)
- [WARNING] a load that became a download was not cleared, though the comment said so (fixed)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, all fixed
- [WARNING] a decision that waited could act after the person moved on (fixed: a serial)
- [WARNING] a lock during the wait could send a computer's address to Safari (fixed)
- [WARNING] a refused redirect left a page behind (fixed)
- [WARNING] a step back after an account change opened Safari (fixed: does nothing)
- [CONVENTION] the fresh list read had no test (fixed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, all deferred with reasons
- [WARNING] the view's own code has no test (a phone check is required before Submit; on #9028 and #7352)
- [WARNING] a waiting tap is dropped when another page is asked for (deliberate; in the plan)
- [WARNING] a step back does nothing after an account change (deliberate; it must not open the old account's computer)
- [WARNING] a fresh list joins one already in flight (narrow; it fails to Safari)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ContentView.swift | original | list lost on lock | fixed | held on BoardWeb |
| 2 | 1 | WARNING | ShellLogic.swift | original | history let in any host | fixed | shown hosts only |
| 3 | 1 | WARNING | ContentView.swift | original | redirect kind | fixed | rule ignores the kind |
| 4 | 1 | WARNING | ContentView.swift | original | pending bookkeeping | fixed | LinkTrail |
| 5 | 1 | WARNING | ContentView.swift | original | opened host kept | fixed | accountChanged |
| 6 | 1 | WARNING | ShellLogic.swift | original | redirect denylist | fixed | unread list only |
| 7 | 1 | CONVENTION | ContentView.swift | original | comment split | fixed | moved |
| 8 | 2 | WARNING | ShellLogic.swift | fix 6 | new computer to Safari | fixed | fresh list |
| 9 | 2 | WARNING | ContentView.swift | fix 4 | late cancel clears | fixed | by address |
| 10 | 2 | WARNING | ContentView.swift | fix 4 | download not cleared | fixed | cleared |
| 11 | 3 | WARNING | ContentView.swift | fix 8 | stale answer acts | fixed | serial |
| 12 | 3 | WARNING | ContentView.swift | fix 8 | lock during wait | fixed | identity check |
| 13 | 3 | WARNING | ShellLogic.swift | fix 9 | refused redirect | fixed | ended(nil) |
| 14 | 3 | WARNING | ShellLogic.swift | fix 5 | back opens Safari | fixed | block |
| 15 | 3 | CONVENTION | BoardClient.swift | fix 8 | untested read | fixed | tests |
| 16-19 | 4 | WARNING | as above | mixed | four above | deferred | reasons above |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths (across all iterations)
- An allowlist, with a reserved name refused before any reason to let a page in, tested across every name and every kind
- The decision is a pure function; its bookkeeping is a tested value type
- Single removals: each condition removed in turn fails the suite (one survivor found and given its arm)
