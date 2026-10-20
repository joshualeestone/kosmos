---
pre_challenge: true
method: challenge-loop
branch: recoverykey4-6609
diff_hash: 8df4765f2354dd3d35cf07cfb343a6dc6d730c86b6911b1a1e4ad98aca6702b7
validation: passed (rebased on origin/main: 143 node tests across tools.check-list-6609, install.manifest-sig-6468, tools.release-gate, tools.every-test-runs and the other promote/signer readers; tools/test-staging-channel-2036.sh ALL PASS incl. the real promote run with the check on both ways; tools/test-promote-channel-win.sh ALL PASS; tools/test-release-detached.sh 0 failures; every new guard's mutant measured red)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T10:33:16Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 raised NITs only)
**Total findings:** 0 BLOCKERs; WARNINGs, CONVENTIONs and NITs as bracketed in the plan log
**Fixed:** every WARNING except the ones recorded with reasons (Windows release, probe seam, check-served after a revocation, promote's on/off from the tool checkout, a release.sh real-run arm) | **Asked (awaiting user):** 0

Reviewer models alternated opus (odd iterations) and sonnet (even).

### Per-Iteration Breakdown (from .claude/plans/recoverykey4-6609.md)
#### Iteration 1 (opus)
- [WARNING] fixed: check-list ignored the checkout's MIN_KEY_LIST_SEQ, so after a revocation a served older list naming the key passed while every fresh install of the cut would refuse it. Now refused, with an arm (the floor rewritten to 2 in the scratch tree; a list at 1 refused, at 2 passing). Mutant measured red.
- [WARNING] fixed: nothing could catch an inverted refusal in release.sh (every release-gate arm sets the probe seam, which skips the block). The text test asserts the literal `if ! node ... check-list`, and the block-end index is checked before slicing (the vacuous-slice NIT). Mutant (`if node`) measured red. Not done: a release-gate arm driving the real block with the probe seam unset (it needs a stub secrets map and a sandbox site); recorded.
- [WARNING] partly fixed: promote-channel.sh now runs a new `verify-under-list` on a signed manifest (after the prod-keys check), so a staging build signed by a key a later list dropped is not promoted. Arms for the tool (named, dropped, no list, off) and for the call's place and refusal. Mutant (call removed) measured red. Recorded, not changed: the Windows release (build-kosmos-windows.sh, publish-r2.ps1) has no served-list check, as it has no automatic check-served (a manual step); and a leftover KOSMOS_MANIFEST_KEY_PROBE_BIN skips the CUT check as it skips check-served (an older seam; promote does not read it). Both fail safe (installs refuse) and matter only once on.
- [WARNING] recorded as a phase-2 requirement: after a revocation, check-served still demands the new key in the served release's pinned_keys, while a served release with the check on trusts the list. Rule for activation: the replacement key is pinned in a release BEFORE any revocation (or check-served learns to defer to the list, which needs a manifest field saying the check is on).
#### Iteration 2 (sonnet)
- [WARNING] fixed: promote read the list from the site's WORKING TREE, which promote never fetches, so a stale checkout could pass a manifest signed by a key a newer served list dropped. Promote now asks `needs-list` and, only when on, fetches the site and reads the list from origin/main, as release.sh does. Off, nothing is fetched (no new way for an off promote to fail). Mutants measured red: needs-list always off, the fetch removed, the refusal not stopping, the list read from the working tree.
- [WARNING] fixed: the check sat inside the signed-manifest branch, so an unsigned manifest skipped it. It now runs after both branches; the text test asserts that placement.
- [NIT] accepted: the promote text test's line-shape assumption (it is re-anchored with an index check now).
#### Iteration 3 (opus)
- [WARNING] fixed: needs-list read a crash as "off" (a verifier failing to load exits 1, which was the off code), so promote skipped the list check exactly when the tool was broken. Off is now exit 3; promote refuses on anything but 0 or 3. Arms: off answers 3, a verifier that throws on load answers neither 0 nor 3, and promote's case refuses the rest. Mutants measured red (off back to 1; the case removed). The same crash-as-no hole in needs-sig (exit 1 read as "prod does not check signatures") predates this branch and is noted for #6468's owner, not changed here.
- [WARNING] recorded as an activation rule: promote decides on or off from the TOOL checkout it runs from, not from the release prod serves, so a checkout older than activation reads off and could promote a build signed by a dropped key. Rule: from activation on, promote runs only from a checkout at or after the activation commit. The lasting fix is the manifest field phase 2 needs anyway ("this release checks the list"), which promote should key on, as needs-sig keys on the served manifest.
- [NIT] fixed: release.sh's refusal sentence named the signing key for all four causes; it now says the check failed and points at the line above.
- [NIT] fixed: promote's list folder is checked when made and removed by the EXIT trap on any exit, a signal included.
#### Iteration 4 (sonnet)
- [WARNING] fixed: nothing ran promote-channel.sh itself with the check on (text matches only). tools/test-staging-channel-2036.sh now runs the REAL promote from a scratch copy of tools/ with throwaway keys rewritten into manifest-verify.js, against a git site with a bare origin serving a signed list: a manifest signed by a key the list names is promoted; one signed by a key the list dropped is refused, prod untouched. Mutant (the refusal removed from promote) measured red. The test is ALL PASS.
- [NIT] fixed: the plan said a leftover probe seam skips promote's check; it skips the cut's only.
#### Iteration 5 (opus): converged
- [NIT] accepted: promote's refusal sentence is generic for every verify-under-list failure; node's own line, which names the cause, prints just above it.
- [NIT] accepted: the "dropped" shell case matches that generic sentence; the paired "named" case, built the same way, is what rules out "no list" or "bad list".
