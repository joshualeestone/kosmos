---
pre_challenge: true
method: challenge-loop
branch: heldcount-8140
diff_hash: 4102da7fc8eda940816f91dda102409092c4fff218c09aa9ef85cc5a67c68e3f
validation: passed
subdir_audit: passed
timestamp: 2026-11-06T23:27:37Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3 raised only the zero-built nudge gap already recorded as a follow-up in round 2, plus NITs)
**Total findings:** 8 actionable (0 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs), 7 NITs
**Fixed:** 6 | **Deferred:** 2 (follow-ups, stated on the card) | **Asked:** 0

Validation (local; the full suite queue runs on Mortals; the PR's CI is the remaining gate): the five touched test
files 103/103 after round 1 and 64/64 for the two changed in round 2; after merging origin/main, the static guard set
plus the subtask-reading tests 3959/3959; the browser-check surface gate passes. Mutations: dropping `|| held > 0` in the
nudge and reverting the task page's "On hold" each turn their new arm red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:71331 — the hidden " subtasks done" came after ", N on hold" (a screen reader heard "3 on hold subtasks done") --> FIXED (98ba6e5553)
- [WARNING] web/index.html:72654 — the task page's Subtasks list read a held child as Open --> FIXED (98ba6e5553)
- [WARNING] engine/agentnudge.js:152 — the nudge counted held children as not finished --> FIXED (98ba6e5553)
- [WARNING] install/kosmos:6434 — the CLIs' held branch untested --> FIXED (98ba6e5553, a server arm for both)
- [WARNING] ios/Kosmos/TasksLogic.swift — iOS has its own count and does not read held --> DEFERRED: out of this branch's surfaces; a follow-up card

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentnudge.js:154 — the built-plus-held-only arm untested --> FIXED (5af4a601fd; a mutant turns it red)
- [WARNING] web/index.html:72671 — the "On hold" label untested --> FIXED (5af4a601fd; reverting it turns it red)
- [WARNING] engine/agentnudge.js:106 — no subtask line when no child is built (a built parent with only held children) --> DEFERRED: needs its own wording and changes pinned nudges; a follow-up on the card

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs (the one raised duplicates the round-2 follow-up), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:71331 | BRANCH | Screen-reader order | FIXED | 98ba6e5553 |
| 2 | 1 | WARNING | web/index.html:72654 | BRANCH | Task page held read Open | FIXED | 98ba6e5553 |
| 3 | 1 | WARNING | engine/agentnudge.js:152 | BRANCH | Nudge held as not finished | FIXED | 98ba6e5553 |
| 4 | 1 | WARNING | install/kosmos:6434 | BRANCH | CLI held branch untested | FIXED | 98ba6e5553 |
| 5 | 1 | WARNING | ios/Kosmos/TasksLogic.swift | BRANCH | iOS does not read held | DEFERRED | follow-up card |
| 6 | 2 | WARNING | engine/agentnudge.js:154 | SELF | Built+held arm untested | FIXED | 5af4a601fd |
| 7 | 2 | WARNING | web/index.html:72671 | SELF | On hold label untested | FIXED | 5af4a601fd |
| 8 | 2 | WARNING | engine/agentnudge.js:106 | BRANCH | Zero-built nudge says nothing | DEFERRED | follow-up on the card |

### NITs (non-blocking)
- The wider chip at phone width has not been shot; a design pass before the release
- A paused project's child reads "[on hold]" in the CLI and "Open" on the page (held follows isOnHold)
- The held text cannot appear beside "all subtasks done/built" (held is 0 there by construction), untested

### Strengths
- done, built and held are disjoint by construction, so the nudge's arithmetic cannot go negative
- Older boards (no held field) say nothing, tested; the screen-reader order is pinned both ways
- Mac and Windows CLIs at parity, one test for both with a before-and-after
