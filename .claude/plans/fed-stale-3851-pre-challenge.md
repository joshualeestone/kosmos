---
pre_challenge: true
method: challenge-loop
branch: fed-stale-3851
diff_hash: 17c8c74cced5657b1a7e6eae455ed8f9579cbc8db76d9666fc4a362f7ad9b4c3
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T07:39:59Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind reviewer passes, alternating Opus and Sonnet.
**Converged:** Yes, at iteration 4 (Sonnet): NO FINDINGS.
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs. Fixed: 6. Asked (awaiting user): 0.
**Ledger:** every finding, its fix, test and control is in `.claude/plans/fed-stale-3851.md`.
**Decided, with reasons in the plan:** createdAt as the link's project identity (not a folder path); refusing to make a project while federation.json is unreadable was rejected; a legacy link is stamped on first sight (weakest premise named); for the outside rows, the card's "keep external avatars out of the local tint space" option rather than per-row attested accounts (a data-flow change, left as a follow-up if wanted).

**Validation:** the full suite (type-check, lint-fix, test, build) passed through the validation helper on fd5324f7e: 9833 tests, 0 failed, 152 skipped; helper hash `17c8c74cced5`. The first run passed every test but failed the browser-check surface gate (#2518): three checks assert on `msg` / `msg-av`. All three were run on this branch and pass; per-check Browser-check-surface trailers record why (the new rules reach only `.msg.ext` rows).

### Per-Iteration Breakdown

#### Iteration 1 (opus): 1 WARNING, 3 NITs
- [WARNING] nothing tested the board's own projectCreatedAt. FIXED: a server-level test through the route; the stamp check now runs before the enrolled gate. Control (server reading p.created) fails by name.
- [NIT] other readers saw the raw stale link until the next check. FIXED: one stamp-aware fedseats.linkFor for every reader.
- [NIT] dark mode filled the outside disc. FIXED; asserted both themes. Control fails [dark].
- [NIT] pointer cursor with nothing to open. FIXED; asserted.

#### Iteration 2 (sonnet): 1 WARNING
- [WARNING] the legacy stamp came from a second createdAt read. FIXED: stampOf returns the value it checked. Control fails by name.

#### Iteration 3 (opus): 1 NIT
- [NIT] a post() assertion could not fail. FIXED: asserts no "stayed on this computer" note before the check. Control fails by name.

#### Iteration 4 (sonnet): NO FINDINGS
