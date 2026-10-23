---
pre_challenge: true
method: challenge-loop
branch: pkglist-6609
diff_hash: b3f26e40935931cbb0b0b780e9517244862e60d6eb541ffcf2be63e596bb767b
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T22:26:38Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 10 WARNINGs, 0 BLOCKERs, 1 CONVENTION (no-op: plan present), NITs listed per iteration
**Fixed:** 8 WARNINGs | **Deferred:** 2 (one duplicate, one by design) | **Asked (awaiting user):** 0

Validation for this branch: install.pkg-verify-keylist-6609.test.js and install.pkg-verify-6576.test.js 28/28 on
macOS with swiftc; every test reading engine/manifest-verify.js, the signing tool, the Windows updater or the
postinstall, plus the file-scanning guards: 968 tests, 0 failed (103 platform skips); tools/test-postinstall-inline-
quoting.sh, test-gnu-only-forms-6808.sh, test-pkg-input-guard.sh exit 0. Mutants measured red: built-in keys kept
beside the list; the list floor removed; the form check removed; the record seq ignored; the postinstall passing 0;
the small-order check removed from the Swift copy; and from the JS copy. One mutant (the boolean seq clause) survived
because the form check covers it, so the clause was removed. origin/main had not moved at the final run.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] install/pkg-verify/main.swift — a list with a field named twice read differently by JSONSerialization and JSON.parse --> FIXED (8d38032559: the list must be the signing tool's exact bytes)
- [WARNING] install/pkg-verify/main.swift — encodings the JS refuses (BOM, UTF-16) taken --> FIXED (same commit)
- [WARNING] install/pkg-verify/main.swift header — rotation sentence false when on; limit unstated --> FIXED (header)
- [NIT] stricter signature decoding than the JS (refuse-only); list fetch cost while off; status comment did not say the path is off --> documented / FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (a test comment claiming what the JS takes, unasserted)
- [NIT] test comment overclaimed --> FIXED (52f3d88485: JS_TAKES asserted)
- [NIT] tangled status sentence --> FIXED
- [NIT] plan cites mutants --> kept (they were run; listed above)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] install/pkg-verify/main.swift — the postinstall runs for existing installs too, so the plan's reason for no record was wrong --> FIXED (3c903588cb: the root step passes the existing install's record seq; the helper's floor is never below it)
- [NIT] cache-buster reused across retries; list fetched while off --> recorded in the plan (time, not trust)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION (no-op), 3 NITs
**Self-generated:** 0
- [WARNING] same-seq list with other keys taken where trustedKeys refuses --> FIXED (documented in the header and plan; needs the recovery key to sign two lists with one seq, which it never does)
- [WARNING] a home path with a space defeats the record read (a pre-existing USER_HOME line) --> FIXED (documented in the plan's uncovered cases)
- [NIT] argument wording --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] install/pkg-verify/main.swift — small-order public keys accepted as keys --> FIXED (205d1bed52: refused in both copies, list checked by curve arithmetic; reproduced before fixing)
- [WARNING] engine/manifest-verify.js — status comment listed the Windows updater as not done (#6692 did it) --> FIXED
- [NIT] header usage line --> FIXED; unlistable record folder and large folders --> name-only reads, raise-only (accepted)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] no-record floor on a Mac without Kosmos at the default home --> DEFERRED: duplicate of iterations 3-5, documented in the header
- [WARNING] a user can raise their own record seq and refuse their own .pkg install --> DEFERRED: by design, raise-only; the installed copy's own record behaves the same
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/pkg-verify/main.swift | BRANCH | repeated field parity | FIXED | 8d38032559 |
| 2 | 1 | WARNING | install/pkg-verify/main.swift | BRANCH | encoding parity | FIXED | 8d38032559 |
| 3 | 1 | WARNING | install/pkg-verify/main.swift | BRANCH | header rotation claim | FIXED | 8d38032559 |
| 4 | 3 | WARNING | install/pkg-verify/main.swift | BRANCH | existing installs' record | FIXED | 3c903588cb |
| 5 | 4 | WARNING | install/pkg-verify/main.swift | SELF | same-seq other keys | FIXED (documented) | 811e4719e8 |
| 6 | 4 | WARNING | install/pkg-scripts/postinstall | BRANCH | home path with a space | FIXED (documented) | 811e4719e8 |
| 7 | 5 | WARNING | install/pkg-verify/main.swift | BRANCH | small-order keys | FIXED | 205d1bed52 |
| 8 | 5 | WARNING | engine/manifest-verify.js | SELF | stale Windows status | FIXED | 205d1bed52 |
| 9 | 6 | WARNING | install/pkg-verify/main.swift | SELF | no-record floor | DEFERRED | duplicate, documented |
| 10 | 6 | WARNING | install/pkg-scripts/postinstall | SELF | user raises own floor | DEFERRED | by design, raise-only |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- On, the release keys come from the list only; no fallback to the built-in keys (iterations 1-6)
- Every list case runs through both copies; the real signing tool's output is tested end to end (iterations 2-6)
- The postinstall root step is lifted verbatim and run against a file:// site (iterations 1-6)
