---
pre_challenge: true
method: challenge-loop
branch: gatestale-4352
diff_hash: 36f1816cc34ce120952dfcfdd11b6176092b6afa8cc2852f15f4e133cd8ce8df
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T16:19:29Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: no new actionable finding; its two WARNINGs were judgments already disclosed, deferred below with reasons)
**Total findings:** 6 actionable (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs), and NITs
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

The 6c-bis provenance lookup (git blame per finding) was NOT run this loop, so "Self-generated"
reads "not measured" rather than a number filled in by judgement.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] tunnel-handshake-gate.sh:222 scoping every leftover to this gate's TMPDIR could miss a real connector from a gate run under another TMPDIR spelling (a false PASS) --> FIXED 724147b (a leftover whose state names this identity counts wherever it lives; only unreadable ones are scoped)
- [WARNING] tunnel-handshake-gate.sh:225 an empty ps output was taken to mean exited, fail open --> FIXED 724147b (skip only when kill -0 says gone; a live pid with no readable command line counts; a second kill -0 for the exit-between-reads race)
- [WARNING] test:211 the ps-shim row certified skipping a LIVE connector --> FIXED 724147b (replaced by a real dead-pid row via a pgrep shim, plus a fail-closed live-pid row)
- [WARNING] header/inline docs did not name the new blind spot --> FIXED 724147b (NOT COVERED names it)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] the unreadable-state scoping is a narrow reduction in coverage --> DEFERRED: the reviewer flags it "for visibility, not as a defect"; it is the only way to stop one run's stand-in holding another's (pgrep is machine-wide), and it is stated in the gate's NOT COVERED header and the plan. A leftover whose state still names this identity is seen everywhere.
- [WARNING] no test reproduces two full concurrent runs --> DEFERRED: measured by hand, recorded in the plan and on kosmos#4352 (2 copies before: 51/2; after: 3 copies at once each 57/57). Each mechanism has its own row, red under its own mutant. A concurrent-run test inside the suite would itself be the flaky cross-run shape this card removes.
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tunnel-handshake-gate.sh:222 | not measured | false-PASS from TMPDIR scoping | FIXED | 724147b |
| 2 | 1 | WARNING | tunnel-handshake-gate.sh:225 | not measured | empty ps fails open | FIXED | 724147b |
| 3 | 1 | WARNING | test-tunnel-handshake-gate.sh:211 | not measured | shim modelled a live pid as exited | FIXED | 724147b |
| 4 | 1 | WARNING | tunnel-handshake-gate.sh:40 | not measured | docs miss the blind spot | FIXED | 724147b |
| 5 | 2 | WARNING | tunnel-handshake-gate.sh:217 | not measured | unreadable scoping narrows coverage | DEFERRED | disclosed; necessary for isolation |
| 6 | 2 | WARNING | test-tunnel-handshake-gate.sh | not measured | no in-suite concurrent test | DEFERRED | measured by hand, per-mechanism rows |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] lowercasing the mktemp suffix narrows the per-run HOST space (negligible collision chance) (1)
- [NIT] a printf style choice in the ps shim (1)
- [NIT] kill -0 cannot tell EPERM (another user's process) from gone; pgrep of another user's command line is already unreliable on macOS (2)
- [NIT] a mid-sentence forward reference in the header comment (2)

### Strengths (across all iterations)
- The redirect-error leak (`/address: No such file`) is closed with a brace-group redirect (1, 2)
- Each new row isolates one mechanism with an adjacent control, and each goes red under its own mutant (1, 2)
- The row pin (57) was independently recounted by the reviewer (2)
- Validation: full kosmos suite 11095/0 on this diff; the gate test 57/57 alone and in 3 concurrent copies
