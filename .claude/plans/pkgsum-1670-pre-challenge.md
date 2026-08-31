---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: pkgsum-1670
diff_hash: PENDING
timestamp: 2026-08-31T20:45:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review with two-direction perturbation. I set `explicit_override` myself and say so rather than letting the field read as routine: I did not run the challenge-loop skill and did not spawn a review agent.

[STRENGTH] **I measured the premise before writing code, having named it on the card as the thing that would make this unbuildable.** `setup.sha256` is published (200, 72 bytes), a constructed must-fail control 404s, and the published checksum matches the served bytes today.

[STRENGTH] **The perturbation moved the defect arm and left a control green.** Reverting the postinstall makes the mismatch arm report `rc=0, ran=yes`: it executed an installer whose checksum did not match. The "matching checksum runs it" arm stays green throughout, so the test is not simply keyed on the file being changed.

[STRENGTH] **Tested against a real origin with real curl.** The verification calls `/usr/bin/curl` by absolute path, so a `PATH` stub would have tested a rewrite rather than the code. The script under test is lifted verbatim from the shipped postinstall.

[STRENGTH] **The suite guard caught that my shell test was wired to nothing, and I confirmed the fix by EXECUTION rather than by the guard going green.** `tools.every-test-runs.test.js` failed with "named nowhere in test:shell". After wiring it, I checked the test's own PASS line appears in the suite log. A guard being satisfied is not the same as the test running.

[WARNING] **This buys nothing against a malicious origin and I do not claim it does.** An origin that can serve bad bytes can serve a matching checksum. The value is against a half-published or misconfigured origin, which is the state that actually occurred.

[WARNING] **An absent checksum refuses, which is beyond what the card asked for.** The card says "refuse on mismatch" and is silent here. My reasoning is that a missing `.sha256` is a symptom of the same half-published state rather than an unrelated blip, and that proceeding without the anchor makes this path no better than `curl | sh`. **This is the reversible decision most likely to be argued with**, and the counter-argument is real: a transient CDN failure now blocks a pkg install that would previously have succeeded.

[WARNING] **I have not run the actual pkg.** This tests the lifted script, not an end-to-end `installer -pkg` run, which needs a signed package and a real install. The lift is verbatim and the invocation shape is matched, but that is not the same as having installed from a pkg.

[NIT] The two refusal messages differ deliberately: an absent checksum says a retry is safe, a mismatch says report it rather than retrying. Same refusal, opposite advice, because the causes are opposite.

[CONVENTION] No em dashes on any added line, checked before writing.

[CONVENTION] Worktree from `origin/main`, not bare `main`.

### Final Ledger

Suite: exit code 0, 3260 pass, 0 fail, 0 shell FAIL lines. Read from the EXIT CODE, not the tally.
