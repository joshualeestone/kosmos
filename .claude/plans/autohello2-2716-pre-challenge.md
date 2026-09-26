---
pre_challenge: true
method: challenge-loop
branch: autohello2-2716
diff_hash: b16200f28da7786baa34872cac2a78a9e3a36bb7b7dfee5489400b5bd996f964
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T19:32:04Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (Opus and Sonnet alternating)
**Converged:** Yes
**Total findings:** 1 BLOCKER, 9 WARNINGs, 1 CONVENTION, plus NITs
**Fixed:** 10 | **Deferred:** 0 | **Reversed in flight:** 1 (the waiting line)

Carries draft PR #2732 (09-14) onto current main as a fresh branch, and fixes the race
that kept it in draft without touching changeDialog.

### Validation

Full suite on HEAD 7b31203e (main merged in), hash b16200f28da7: 8622 pass, 0 fail
(validation log clean, 2026-09-24T19:32:04Z). DEVELOPER_DIR set to CommandLineTools.
render-autohello-switch-2716.js 19/19 and render-model-restart-interstitial.js pass
headless; web.change-dialog.test.js and browser-checks-reason-grep.test.js 8/8.
Perturbations, each confirmed applied: no retry (arms 7, 11, 11b red); no deadline (9);
no margin (9b); no closed-dialog guard (4, 8); no token check (10); no provider call
site (11b); no restarted guard (11c); comparing the wrong line (8 of 19 red).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] a stale report from an earlier restart of the same agent wrote "said hello" into the next dialog (identical line) --> FIXED: report keeps its RESTART_HELLO_SEQ token; arm 10
- [WARNING] arm 7 passed on arm 6's leftover poll --> FIXED with the token (each arm supersedes the last)
- [WARNING] the check only simulated the timing --> FIXED: arm 11 clicks the real #d-model-go with the hold longer than two polls
- [WARNING] comment and plan safety claims false --> FIXED
- [NIT] bound ignored the hold test seam; helper polled with no say --> fixed

#### Iteration 2 (sonnet)
- [WARNING] provider path not driven end to end --> FIXED: arm 11b clicks #d-provider-go
- [NIT] plan's perturbation inventory incomplete --> fixed

#### Iteration 3 (opus)
- [WARNING] the dialog tells the person to say hello while the app is doing it --> first DEFERRED (Josh's #768 copy), REVERSED in iteration 5
- [WARNING] arm 9 took ~7s --> FIXED: uses the hold seam
- [NIT] provider site lacked the say guard --> fixed, pin tightened

#### Iteration 4 (sonnet, 16 mutations, all killed but one class)
- [WARNING] the one-second margin past the hold was unpinned --> FIXED: arm 9b
- [NIT] non-restart outcome guarded only by a source pin --> FIXED: arm 11c

#### Iteration 5 (opus)
- [WARNING] with real respawn times the confirmation is usually lost after Done --> FIXED: the dialog paints "Restarted on <provider>. Waking them..." and resolves it, as the restart and start flows do; interstitial check and unit test updated
- [WARNING] arm 11 flaked at 20x CPU throttle (767ms vs 600ms hold) --> FIXED: 1500ms hold
- [WARNING] arms 1-8 leaned on the token for isolation --> FIXED: 300ms test hold
- [NIT] bound "from the report" unstated --> fixed

#### Iteration 6 (sonnet)
- [WARNING] README row still quoted the old line; stale hold value --> FIXED

#### Iteration 7 (opus)
- [WARNING] registry conflicted with current main --> FIXED: merged main in (merge commit), kept both entries
- [CONVENTION] two call-site comments described the old line --> FIXED
- [NIT] plan hold numbers --> fixed

#### Iteration 8 (sonnet)
**Converged** -- one NIT on a pre-existing comment; registry set-diff against main: one addition, nothing lost.
