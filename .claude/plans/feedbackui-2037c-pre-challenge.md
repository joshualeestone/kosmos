---
pre_challenge: true
method: challenge-loop
branch: feedbackui-2037c
diff_hash: 384ff21e50e4f4eac3a11c1f09b617ab40f397cd890debc487ca4a6864b6d60f
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T23:02:24Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5's only new findings deduplicated against the operator-confirmed privacy decision; the one new NIT was fixed)
**Total findings:** 5 WARNINGs (1 code re-send hole, 1 loose test grep, 2 stale-prose clusters, 1 recurring operator-confirmed privacy flag), several NITs.
**Fixed:** all code/prose findings | **Deferred:** the privacy/consent flag (operator-confirmed) + 2 by-design NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] engine/feedbacksend.js — sendDailyOnce ignored markSent's failure: a failed mark-write + successful POST would re-POST the same day forever --> FIXED (7bc7fc68): send only if the mark persisted; test forces a write failure with asserted preconditions.
- [NIT] read() called twice --> FIXED (one read per tick). [NIT] mark-before-POST tradeoff --> DEFERRED (documented, by design).

#### Iteration 2
- [WARNING] the sweep-wiring source-grep was too loose (lazy `[\s\S]*?` could span another sweep) --> FIXED (559d6f59): anchored to `const feedbackSweep = setInterval` + bounded by `[^}]`, verified it breaks on a moved call.
- [NIT] dead sentOn export --> FIXED (removed). [NIT] route test not self-contained --> FIXED (leading cleanup).

#### Iteration 3
- [WARNING] cluster: the default-ON fold-in left stale "default OFF / nothing leaves the machine" prose across 4 files (the engine banner most dangerously) --> FIXED (a078ddc0): corrected all sites.
- [NIT] sendDailyOnce recorded a phantom `sent` under test --> FIXED (early underTest guard).
- [WARNING] privacy: default-ON before install disclosure --> DEFERRED (operator-confirmed).

#### Iteration 4
- [WARNING] the PLAN body still carried default-OFF prose (Traps even said to pin read().on===false) --> FIXED (70c9946b): corrected the plan to default-ON with a do-not-restore note.
- [WARNING] privacy (dup, deferred). [WARNING] dedup sends first-seen snapshot --> DEFERRED (matches the #2161 author-once cadence). [NIT] HEAD-with-body --> DEFERRED (pre-existing route convention, mirrors ping-setting).

#### Iteration 5
- [WARNING] x2 privacy/consent-before-disclosure --> DEDUP of the operator-confirmed privacy decision (Josh "baked in day one"; Splinter sequencing PR-C2 before testers).
- [NIT] stale maybeSend reachability excuse ("dormant until PR-C wires the trigger") --> FIXED (1df8ed40): removed it; the guard now protects maybeSend by real transitive reachability.
- **Converged** — zero new actionable findings after dedup.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/feedbacksend.js | re-POST-forever on a failed mark-write | FIXED | 7bc7fc68 |
| 2 | 2 | WARNING | web.feedback-switch-2037.test.js | sweep-wiring grep too loose | FIXED | 559d6f59 |
| 3 | 3 | WARNING | (4 files) | stale default-OFF prose after the fold-in | FIXED | a078ddc0 |
| 4 | 4 | WARNING | .claude/plans/*.md | plan body still default-OFF | FIXED | 70c9946b |
| 5 | 3-5 | WARNING | engine/feedbacksend.js | default-ON content phone-home before install disclosure | DEFERRED | Josh "baked in day one"; PR-C2 install disclosure sequenced before testers (Splinter) |
| 6 | 5 | NIT | engine.reachable.test.js | stale maybeSend "dormant" excuse | FIXED | 1df8ed40 |

### Deferred (operator-confirmed / by-design)
- The privacy/consent gap (default-ON ships with the Settings switch as the only disclosure; the install-flow Screen 6 disclosure is the fast-follow, PR-C2). Josh ruled default-ON "baked in day one"; Splinter is sequencing the launch cut so PR-C2 lands before the ~6 testers.
- Dedup sends the first-seen daily report (matches #2161's author-once-per-day cadence; deliberate anti-re-POST-spam tradeoff).
- HEAD-with-body on the setting route (mirrors the pre-existing ping-setting convention).

### Strengths (across iterations)
- Mark-sent-before-POST with send-only-if-persisted closes the re-POST-forever hole; forced-write-failure test with asserted preconditions.
- write() preserves both on + sent across partial writes (setOn can't wipe the marker, markSent can't flip the opt-in).
- ENOENT defaults ON, unreadable/corrupt fails OFF (safe direction), both arms tested.
- Privacy could-not-read treatment: knob hidden on a 403, never a false Off; the board reads the setting server-side so the opt-out holds on an enforcing board.
- underTest guard layered (early in sendDailyOnce + in maybeSend); sweep unref'd + best-effort; wiring pinned by an anchored bounded grep; browser-check per-toggle default map.
