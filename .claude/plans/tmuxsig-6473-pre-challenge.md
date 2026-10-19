---
pre_challenge: true
method: challenge-loop
branch: tmuxsig-6473
diff_hash: b83ce7438370a5235d00fe6dfc0ed24e3c9b8810338eb414d969e25ec15504ad
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T11:48:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews, opus then sonnet
**Converged:** Yes (iteration 2, sonnet: NITs only)
**Total findings:** 1 BLOCKER, 2 WARNINGs, about 9 NITs
**Fixed:** the BLOCKER, both WARNINGs, most NITs | **Asked (awaiting user):** 0

Stacked on setupsig-6468 (#6475), on manifestsig-6468 (#6472); the hash is against origin/main, the gate's base.
Validation: install.tmux-sig-6473 (12), install.manifest-sig-6468 (30), install.setup-sig-6468 (9) pass; installer runnable-guard and install-static pass. Live: the real #6472 verifier under the new installer functions skips early, fetches nothing, leaves tmux unchecked with a sentence. Mutants: a mismatched tmux let through (red), the capability check removed (red).
Not run: a real cut and test-install.sh end to end.

## Final ledger
### Iteration 1 (opus): 1 BLOCKER, 2 should-fix
- [BLOCKER] the new installer called the INSTALLED checker in two new forms (tarball "-", tmux); a Mac on the #6472
  release alone has a checker that knows neither, so every later update would die (FIXED: the checker carries a
  one-line "manifest-verify capabilities:" list; early runs only when it lists early, otherwise pre fetches as before
  and tmux goes unchecked this once, said in a sentence. Arm with an older-BEHAVING checker; mutant removing the
  capability check goes red; live: the real #6472 verifier under the new functions skips early, fetches nothing)
- [WARNING] one served tmux path for both channels: a cut with a different tmux breaks the other channel (FIXED:
  the cut refuses a tmux pair that differs from the one served unless KOSMOS_CUT_NEW_TMUX=1, which prints the cost)
- [WARNING] the early manifest folder leaked on any exit before pre (FIXED: _kosmos_on_exit removes it)
- [NIT] verifyTmux re-read the manifest after verifying it (FIXED: verify hands back the verified, parsed bytes; same
  for verifySetup on the base branch), no-key line now mentions the terminal manager (FIXED), tests for no-key through
  every phase and no-verifier fetching nothing (ADDED); text-position tests (ACCEPTED), local Kosmos + network tmux
  runs the full version check (ACCEPTED: it is a real check on what is downloaded)
### Iteration 2 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] the capability grep matched early2 (FIXED: whole word, -E, measured on the real line and three controls)
- [NIT] an unreadable served tmux pair refuses even with the opt-in; local KOSMOS_SRC + network tmux runs the full check; text-only release tests (ACCEPTED)

Rebased 06:55 onto setupsig-6468 (its 96/97 split and frozen-interface note): a conflict in engine/manifest-verify.js exports was resolved keeping both (verifyTmux, NOT_FETCHED); 51 tests pass; rehashed. Commit 6fa2cc1f17 in this history is an empty-of-meaning proof-note commit made by mistake during the paused rebase; the proof file in the tree is this one.

Rebased 08:15 onto main after #6475 merged (clean, 6 commits). Revalidated: 76 test files reading the touched files 1510 pass 0 fail; the four manifest/installer suites 67/67; staging-channel, setup-staging, bundle-names, cut-sign-preflight, runnable-guard, install-static pass. Rehashed.
