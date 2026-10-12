---
pre_challenge: true
method: challenge-loop
branch: sealeduninstall-5912
diff_hash: dd7b29c78794e86282780c6d3400484f47a9eda708e61669a6adc9f3cbda7558
validation: pending (Mortals run sealeduninstall-5912-final5 queued at 4db8e914d; PR CI runs the full suite; tools/test-install.sh harness checks are UNRUN anywhere)
subdir_audit: passed
timestamp: 2026-10-12T18:01:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (iterations 1 and 2 ran before a rebase onto main; their per-finding severities were not recorded, only what was fixed)
**Converged:** Yes, at iteration 6: no new BLOCKER, one WARNING deferred with reason, NITs fixed.
**Owed, stated plainly:** the harness changes in tools/test-install.sh have never been run anywhere. One full `yarn test:install` against a Developer ID dist is owed before this is called proven end to end. The decision function is unit-tested in install.sealed-app-5896.test.js.

## Per-Iteration Breakdown

#### Iteration 1 (pre-rebase, severities not recorded)
- decision function, note wording, comments --> FIXED (eae7a0fef)

#### Iteration 2 (pre-rebase, severities not recorded)
- [NIT] the note should say another install is inferred, not known --> FIXED (565ed4fb0)

#### Iteration 3
- [WARNING] a kept icon could not open any remaining install once the config is removed --> FIXED (sealed_opens_another: default install only)
- [WARNING] three harness checks accepted either outcome --> FIXED (sealed_icon_must_go asserts one outcome)
- [CONVENTION] a comment goes false once #5913 lands; the contract was not named --> FIXED
- [NIT] unreadable LaunchAgents read as no other install --> FIXED (missing or unreadable keeps)

#### Iteration 4
- [WARNING] harness probe world: home3's uninstall now takes the icon; old check fails, owner check vacuous --> FIXED (sealed case follows config; owner check explicit)
- [WARNING] a login job is a weak proxy for "the default install can open it" --> FIXED (bin/kosmos executable, the app's own test)
- [NIT] stale comments (harness, plan, bundle_looks_sealed) --> FIXED

#### Iteration 5
- [WARNING] probe owner check re-read the sealed state after the icon was gone (dead check) --> FIXED (first reading kept; explicit already-gone arm)
- [WARNING] harness ignored the config half of the condition --> FIXED (sealed_expect other/gone/main, read before each uninstall; 5 cases exercised in a sandbox)
- [NIT] stale test title; an ordering assertion that could not fail --> FIXED

#### Iteration 6
- [WARNING] no harness world reaches the "main" arm (icon kept for a runnable default install) --> DEFERRED (unit-tested; harness unrun anywhere; the owed full yarn test:install is where it gets exercised)
- [NIT] sweep comment, superseded plan text, the ~/Applications copy unstated --> FIXED

## Contract with #5913
PigeonPete's sealed_icon_other_users <owner-uid> joins shared_sealed_stays later; exit 0 keeps. Whoever lands second wires it.
