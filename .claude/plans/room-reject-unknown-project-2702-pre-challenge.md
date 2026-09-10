---
pre_challenge: true
method: challenge-loop
branch: room-reject-unknown-project-2702
diff_hash: 37fab42060444681a6db8255fd970b77e965536c101440ee72c1c0c3caeef666
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T22:59:52Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2, opus, zero actionable findings)
**Total findings:** 6 (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 4 | **Deferred:** 2 (both NITs, documented) | **Asked:** 0

Model rotation (kosmos#2032): iteration 1 sonnet, iteration 2 opus. Convergence witnessed by both models; the converging pass (opus) verified the fix by source and found nothing actionable.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (first reviewer, 6.0 passed so ITER_COMMITS empty; all BRANCH)
- [WARNING] install/kosmos cmd_room -- `printf '%s\n'` doubled the server body's own trailing newline (a spurious blank line after every `kosmos room`) --> FIXED (89780990): `printf '%s'`. Verified: split + printf reproduces the body with exactly its single trailing newline.
- [WARNING] server.js -- the fail-open branch (an unreadable projects store must not become a false 404) was the load-bearing safety property and was untested --> FIXED (89780990): added a chmod-000 regression test; readAll() throws UNREADABLE on a permission fault (returns [] only on ENOENT), so the catch fires and the route falls through to 200. Perturb-verified (breaking the catch reds the test).
- [CONVENTION] server.js -- the reject arm re-derived the `?as=text` computation the render arm already does (the repo's most-flagged two-derivations defect) --> FIXED (89780990): hoisted one `asText` to the top of the route, both arms read it.
- [NIT] plan doc -- imprecise "matches the sibling react route's 404" --> FIXED (89780990): the `{error}` shape matches the real web consumer loadRoom()'s body.error; siblings are not uniform.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both deferred)
**Self-generated:** 0
**Converged** -- verified by source: the existence check matches the siblings' id set with no write-on-read, the fail-open is genuine and pinned, the asText hoist is single-sourced, the bash 3.2 discipline is exact, and the web consumer degrades gracefully. Only STRENGTHs otherwise.
- [NIT] install/kosmos cmd_room -- the `-w`/split/exit CLI parsing has no behavioral test (no CLI harness exists in the repo; only `bash -n`). DEFERRED: documented tradeoff in the plan ("otherwise the server test covers the core"); the reviewer verified every case (multi-line, single-line, empty, no-trailing-newline, 404) by hand.
- [NIT] engine/projects.js readAll docstring is stale (pre-existing, NOT in this diff; says "empty list when unparseable" but it throws UNREADABLE). DEFERRED: out of scope for this PR (not in the diff); the reviewer recommends a later pass. The fix's correctness depends on the correct throw behavior, which holds.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos | BRANCH | printf doubled the trailing newline | FIXED | 89780990 |
| 2 | 1 | WARNING | server.js | BRANCH | fail-open branch untested | FIXED | 89780990 (perturb-verified) |
| 3 | 1 | CONVENTION | server.js | BRANCH | asText re-derived (two derivations) | FIXED | 89780990 |
| 4 | 1 | NIT | plan doc | BRANCH | sibling-404 wording imprecise | FIXED | 89780990 |
| 5 | 2 | NIT | install/kosmos | BRANCH | CLI parsing has no behavioral test | DEFERRED | documented (no CLI harness) |
| 6 | 2 | NIT | engine/projects.js | BRANCH | stale readAll docstring (pre-existing) | DEFERRED | out of scope for this PR |

### Outstanding questions (ASKED)
None. Converged naturally at iteration 2.

### Deferred (documented)
- cmd_room CLI parsing behavioral test: no CLI/integration harness exists in the repo; the server-side 404 test covers the core, and the CLI change is a thin status-check over the server's 404. Every case was hand-verified.
- engine/projects.js readAll docstring: pre-existing, not in this diff; a later-pass one-line correction. The fix depends only on the actual (correct) throw-on-fault behavior.

### Strengths
- `readAll().some(id)` over `projects.get(id, roster)` avoids a write side-effect (describe/writeAll) on a read path while matching the siblings' exact id set.
- The fix distinguishes "does not exist" (404) from "exists but empty" (200) -- existence, not post-count -- pinned by the real-empty-project control arm.
- Fails OPEN on a transient store fault (readAll throws UNREADABLE) so a read fault never becomes a false 404; pinned by a chmod-000 test and perturb-verified.
- bash 3.2 discipline: `local`-then-substitute, `|| _rc=$?`, `printf '%s'`, 4xx/5xx-only exit 1, transport-failure arm intact.
