---
pre_challenge: true
method: challenge-loop
branch: setupsig-6468
diff_hash: 52a12058be57f70e83848ca91679dfd6bd53138a25524d2c1e8cca736894e66d
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T11:30:55Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews, opus then sonnet
**Converged:** Yes (iteration 2, sonnet: NITs only)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, about 9 NITs
**Fixed:** 1 WARNING and the NITs | **Deferred:** 2 WARNINGs as cards #6473, #6474 | **Asked (awaiting user):** 0

Stacked on manifestsig-6468 (PR #6472); the hash is against origin/main, the gate's base.
Validation after rebasing onto origin/manifestsig-6468: install.setup-sig-6468 (9), cli.update-ifnewer-4382 (15), engine/update.test.js (26), install.manifest-sig-6468 (31) all pass. Shell guards (installer-runnable-guard, install-static, kosmos-help-exit0, addr-reclaim, msg-newlines) pass. A sweep of every test reading install/kosmos, engine/update or manifest-verify: 14 failures that fail identically on a clean origin/main in this shell (environmental). Mutants: refusal removed (2 red), NODE_OPTIONS kept (red), stdin passed through (red).

## Final ledger
### Iteration 1 (opus): 0 BLOCKERs, 3 should-fix
- [WARNING] exit 3 (no key pinned, or a manifest without setup_sha256) ran the installer unchecked; a cut gone
  wrong would let a site run any installer (FIXED: run-setup refuses on 3; the cli arm flipped to "runs nothing")
- [WARNING] the tmux bundle is fetched, checked only against a same-host sha, and run before the manifest check
  (DEFERRED as card #6473: needs its own manifest field and an earlier fetch; stated as a limit)
- [WARNING] the .pkg postinstall runs the site installer with only a same-host sha (DEFERRED as card #6474)
- [NIT] 97 wording now says try again (FIXED), stale curl|sh comments (FIXED), the liveExec label (FIXED), arm64
  coupling noted (FIXED), two source-text tests (ACCEPTED: the cli arms run the real path end to end)
### Iteration 2 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] an empty home is now an explicit refusal (FIXED + arm); an installer exiting 97 itself is reported as 1 (FIXED + arm)
