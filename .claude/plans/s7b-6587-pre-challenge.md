---
pre_challenge: true
method: challenge-loop
branch: s7b-6587
diff_hash: d456f109812a7a2568aa8d7cc147593e308f486e98351228435165e6f3097e1b
validation: passed (131 focused tests from the worktree root on the rebased tree, incl. engine/servicekeys-check-6587, engine/remote-servicekeys-6587, web.plus-service-keys-6587, tools.stage-service-keys-6587, server route test, standing guards and bundle.*; tools/test-release-detached.sh 0 failures; tools/test-board-deploy-manifest.sh 3/3; render-plus-panel-3829 browser check passed with a red control; both browser gates rc 0)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T10:19:52Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised NITs only, recorded)
**Total findings (bracketed markers in the plan log):** see the counts in the plan log; 0 BLOCKERs
**Fixed:** every WARNING and CONVENTION | **Deferred:** NITs with reasons (the NOT VERIFIED staging line goes with the commit of the set) | **Asked (awaiting user):** 0

Reviewer models alternated opus (odd iterations) and sonnet (even).

### Per-Iteration Breakdown (from .claude/plans/s7b-6587.md)
#### Iteration 1 (opus)
- [WARNING] fixed: the set would never have shipped. The build copies engine/*.js only, so "no build change" was false. The build now stages both files (a lone one fails the build), with a bundle.contents arm. Mutant (the .sig copy removed) measured red.
- [WARNING] fixed: a self-hosted or staging board would read `mismatch` once the check is on (its pin is that coordinator's key). New state `elsewhere`, said by nothing, when COORDINATOR() is not the production default. Mutants (no production flag passed; the elsewhere line removed) measured red.
- [NIT] fixed: the route test could not fail on a wrong folder (both arms answer off before the folder is read). engine/remote-servicekeys-6587.test.js observes the call: the tunnel state dir and the production flag. Mutant (BASE for STATE_DIR()) measured red.
#### Iteration 2 (sonnet)
- [WARNING] fixed: the Windows build and deploy/install-board.sh stage engine/*.js only, so they would have shipped without the set and answered off forever. Both now copy it, both or neither; the bundle.contents arm covered all three staging lists (replaced in iteration 3 by tools.stage-service-keys-6587.test.js). Mutants (each .sig copy removed) measured red. The scripts' own tests: 153, 108 pass, 0 fail (the rest skip, as they do on main).
- [WARNING] decided: a key rotation would make every old pin read mismatch. Rule written in the plan and the module header: the check is not turned on until slice 3 (pin refresh) ships, which the rotation plan already requires before any promote.
- [NIT] not a defect: the pin is written by rename, so no half-written read.
- [NIT] fixed: the "no set ships yet" control is now named in the plan as the line to flip.
#### Iteration 3 (opus)
- [WARNING] fixed: nothing checked the set at build time, so a set signed with the wrong key would ship and answer `refused` (silent) on every board. The three inline copies are now one function, tools/lib/stage-service-keys.sh, which copies and then runs tools/check-service-keys.js with the STAGED verifier and recovery keys; the build stops unless ok or off. The plan's "release gate catches it" and "everything is in the signed manifest" claims were corrected (the Windows manifest is unsigned).
- [WARNING] fixed: the bundle.contents arm matched text only (a guard changed to `if false`, or `exit 1` to `true`, stayed green). Replaced by tools.stage-service-keys-6587.test.js, which runs the function: no set, a lone file (refused), off, verified, and a set that does not verify (refused). Mutants measured red: the Windows call removed, the lone-file refusal returning 0, the check skipped, the check script exiting 0 on refused.
- [CONVENTION] fixed: the rule named RECOVERY_KEYS (#6609's switch). The switch for this check is committing engine/service-keys.json; the header, the plan and the test control now say so.
- [NIT] fixed: the pin is rewritten at every sign-in, so the rotation risk is computers that have not signed in since; wording corrected.
#### Iteration 4 (sonnet)
- [WARNING] fixed: the check's answer went to stdout, and deploy/install-board.sh captures stage_app's stdout as the version (`ver="$(stage_app ...)"`), so a shipped set would garble the staged-version line. The lib sends it to stderr; an arm asserts empty stdout on the verified path. Mutant (no redirect) measured red.
- [WARNING] fixed: the plan still said bundle.contents.test.js pins the copy. Corrected in both places.
- [NIT] fixed: the deploy dry-run list names the set. tools/test-board-deploy-manifest.sh 3/3.
#### Iteration 5 (opus)
- [WARNING] fixed: the release gate's expected-file list (tools/lib/release-freeze.sh release_bundle_expected_files) did not include the set, so once it is committed a build that dropped the staging call would pass the gate and ship boards answering off forever. The list now derives both files from the tree when present; tools/test-release-detached.sh has a case (a bundle without them is caught) and a control (with them it matches): 0 failures. Mutant (the line removed): 1 failure.
- [NIT] fixed: no arm held the signature in the cache tag. New arm: the same set with a changed signature reads refused. Mutant (sig dropped from the tag) measured red.
#### Iteration 6 (sonnet): converged
- [NIT] deferred to the change that commits the set: with a set committed but RECOVERY_KEYS still empty, the build passes with "off" and ships the set unchecked. That commit should make the staging line say NOT VERIFIED (or refuse); today no set exists, so nothing reaches it.
- [NIT] accepted: `. file || return 1` under POSIX sh exits the shell if the lib is missing, rather than returning. It is always in the deployed repo, and it fails closed.
- [NIT] accepted: the staging test runs the lib under bash while install-board runs it under sh; the lib uses no bash-only syntax (two reviewers read it for that).

#### Iteration 7
**Reviewer model:** sonnet
- [BLOCKER] fixed: three new test files left their temp folders behind and failed the suite leak check (#4273) after every test passed. Each now requires test-support/tmpscope first; 50 leftovers before, 0 after; reviewed, no findings.
