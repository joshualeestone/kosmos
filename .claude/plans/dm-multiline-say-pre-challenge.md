---
pre_challenge: true
method: challenge-loop
branch: dm-multiline-say
diff_hash: ef214995d69ae638704dd7f3645e873d2ae99b0807f768d5f1b31a6f5016546a
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T04:50:25Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 fresh blind passes (Sonnet / Opus / Opus)
**Converged:** Yes (iteration 3, Opus, found zero BLOCKER/WARNING/CONVENTION on the behaviour bytes)
**Reviewer models:** sonnet, opus, opus (multi-model witness per 6a)
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs (1 declined, 1 doc fixed)
**Fixed:** the WARNING + the doc NIT | **Declined:** 1 NIT (provable no-op) | **Asked:** 0

Josh 6.72 (#3208): the direct-agent "Talk to X" composer #d-say was an <input type="text">,
which strips newlines, so a user's paragraph breaks compressed to one line. The rest of the
pipeline already supported multi-line (send .trim()s but keeps internal \n; store keeps breaks
per #1927; .dm-b is pre-wrap + pjRich). Fix: #d-say -> <textarea rows=1> mirroring #pj-post
(Enter sends, Shift+Enter newlines, IME rule preserved, autosize, programmatic writes regrow).

### Per-Iteration Breakdown

#### Iteration 1 (blind, sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
- Clean. Reviewer independently ran the new browser-check (all pass) and its negative control
  (4 assertions fail on the pre-fix <input>), and confirmed all three programmatic #d-say value
  writes regrow, the IME ordering, and that the Terminal box #d-term-say was correctly left as
  an input.

#### Iteration 2 (blind, opus)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html: the input->textarea change silently dropped the composer's
  disabled-dimming -- the rule was `.dmbar input[disabled] { opacity:.5 }`, which no longer
  matched #d-say as a <textarea>, so a disabled (agent-off) composer rendered at full opacity
  instead of looking closed (#991). Empirically confirmed opacity .5 -> 1. FIXED (0a106d2fe):
  added a `.dmbar textarea[disabled]` arm + a check assertion (disabled ~0.5); negative
  control: the assertion FAILS (disabled=1) on the input-only rule and PASSES after.
- [NIT] ATTACH_AGENT's attach config has `after: null` while ATTACH_ROOM regrows -> DECLINED:
  a provable no-op (an attach does not change the textarea value, so scrollHeight and the needed
  height are unchanged); not worth a line for cosmetic parity.

#### Iteration 3 (blind, opus) -- CONVERGED
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (doc)
- Clean on the behaviour bytes. Reviewer specifically cleared the "other input-only .dmbar CSS"
  angle (only the disabled gap existed, now fixed), ran the existing render-talk.js regression
  (clean), and verified the negative-control claims.
- [NIT, doc] the plan said "10 checks" but the check has 11 chk() calls -> FIXED (da7bd495b),
  plan now says 11.

### Post-convergence (mechanical / doc, guarded, not a behaviour change)
- The 6j validation caught #1387 (tools.browser-checks-wired.test.js): a new browser-check must
  be RUN by tools/browser-checks.sh or listed unwired. The check existed and passed locally but
  was not in the runner list. FIXED (bc8b9a2de): added render-dm-multiline-3208 to the runner
  for-loop (a one-line list addition, guarded by the #1387 meta-test, which is now 8/8 green).
  Not a code-behaviour change, so no re-witness pass; the meta-test is its guard. Not added to
  the curated per-PR CI allowlist (render-agent-lines is also absent from it); the full set runs
  at the release cut.

### Validation
Full `bash tools/run-tests.sh` sequence: 7657 pass, 0 fail; bc-surface-map 0 FAILED; coarse +
surface browser-check gates RC=0. (A first run showed 12 release-gate failures from a concurrent
install harness holding the gate's fixed port on this shared Mac -- an environment collision,
not this diff; tools.release-gate.test.js passes 26/0 in isolation once the harness exits, and
the recorded clean run has 0 failures.)
