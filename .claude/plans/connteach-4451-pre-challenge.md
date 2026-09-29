---
pre_challenge: true
method: challenge-loop
branch: connteach-4451
diff_hash: b0fcc119d02df87bc81d607a452b31bf6579e032bbb23a9a7518946168c12f7e
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T03:13:56Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iterations 5 and 6 raised no BLOCKER or WARNING)
**Total findings:** 20 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 15 NITs; summed from the lines below)
**Fixed:** 5 WARNINGs, 8 NITs | **Kept:** 7 NITs (reasons below and in the plan) | **Asked (awaiting user):** 0

Iteration 6 was run because code changed after iteration 5 converged: validation found that the Windows `kosmos` command lacked the two verbs Kosmos now teaches, and the fix (de878601f) is new code.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] An interrupt while the door checked the token left the token in its temp file. Fixed with a trap, with a test and a mutant.
- [WARNING] "Not on argv" checked the test's own spawn arguments, so it could not fail. Fixed with a curl shim that records curl's real arguments and each @file's mode.
- [NIT] Verbs sat under whoami's header. [NIT] Held rows lacked their connect word. [NIT] Cloudflare printed lowercase. [NIT] A refusal repeated the service name. [NIT] Every write failure said "empty". [NIT] The browser control looked for one id. All fixed.
**Self-generated:** 0

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] The trap ran only after curl returned, so SIGTERM waited up to 30s. Fixed: the request runs in the background and is waited on; the test now asserts a stop within 2s.
- [NIT] Every signal exited 130. Fixed: 128 plus the signal.
**Self-generated:** 0

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] Killing the background function's subshell left the board token's header file on disk. Fixed: the trap stops the curl inside it and waits for the subshell; pkill and wait guarded under set -e.
- [NIT] The 2s bound against a 4s hold. Fixed: the hold is 8s.
**Self-generated:** 0

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] The token writer ran in the foreground, so an open stdin made connect deaf to interrupts. Fixed: backgrounded and waited on; both interrupt tests fail after 6s instead of hanging.
**Self-generated:** 0

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] A signal between `&` and `$!` can orphan the writer (which then recreates the token file) or leave pkill with no curl to stop. KEPT: a microsecond window, not practically testable.
- [NIT] A signal during the answer file's mktemp can leave an empty answer file. KEPT: it holds no secret.
- (Not in the plan file: recorded here, because an edit to the plan after validation changes the diff hash.)
**Self-generated:** 0

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
- [NIT] Windows refuses extra arguments to connect. KEPT: stricter and safer.
- [NIT] Windows reads `error` only as a string. KEPT: no server path sends another shape.
- [NIT] No "kosmos start" hint on Windows. KEPT: Windows has no kosmos start.
- [NIT] The stdin mock does not check the 64 KB cap is passed. KEPT for a follow-up.
- [NIT] The "token was printed" check covers some paths only. KEPT for the same follow-up.
**Self-generated:** 0

### Final validation (6j)
- PASSED on d89875105 (stack typescript, 11582 tests, 0 fail, build passed), hash b0fcc119d02d.
- Earlier reds, all from this branch, none contention (each fixed and recorded in the plan):
  - The parity test: Kosmos taught `kosmos connect` and `kosmos connections`, and the Windows command had neither. Both added (tools/windows/kosmos-cli.js), with 6 tests and 4 mutants, each red.
  - browser-checks-reason-grep: the new check's run-count guard is one more emit site (199 -> 200).
  - cli.exit-code-mapping-3628: three spawn sites in cli.connections-4451.test.js did not check for a numeric exit code.
  - A leak of 8 kosmos-cli4451 temp dirs: the file now requires test-support/tmpscope.
  - tools/test-kosmos-help-exit0-3036.sh pinned exact verb lists. It now matches them as prefixes and asserts no read-only verb is in the exit-0 case (6 controls).
- Gated browser check render-conn-ask-4451 (36 arms) passes.
