---
pre_challenge: true
method: challenge-loop
branch: codexhook-5812
diff_hash: a1391a9a76a384939402ffc4542b3763bb1c3326588e8690a41157f34403ff01
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T18:39:11Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (blind, a fresh reviewer each round; several ran the real codex 0.149.1 against a local fake model)
**Converged:** Yes (iteration 10: nothing above NIT)
**Total findings:** 1 BLOCKER, 3 MAJOR, about 20 MINOR
**Fixed:** all above NIT | **Declined with reason:** NITs only, each named in its round's commit | **Asked (awaiting user):** 0

Validation: Mortals full suite on 6499c03342 (this diff), clean: 21285 tests, 0 failed, 0 cancelled, 252 skipped.
Mortals hashed with ids at 9 (675e8c8af300); mortals-validate matched it to this diff (local a1391a9a76a3). The
real-Codex arm skips on Mortals (no codex there); it ran and passed on this Mac (codex-cli 0.149.1), 26/26 with the
supervisor tests, with its broken-record control. The validated head 6499c03342 is the PR head.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] hooks are on by default in 0.149.1 and the TUI STOPS on an untrusted hook ("Hooks need review"); the flag did
  nothing and a failed install was not a clean fallback --> FIXED (version gate, record before hooks.json, hooks.json
  removed on every refusal; measured both arms in the TUI)
- [MAJOR] the supervisor test asserted a flag that does nothing --> FIXED
- [MINOR] no handler timeout; heading matched only exactly; tests through exec not TUI --> FIXED / STATED
#### Iteration 2
- [MAJOR] the record keyed on the given home, Codex resolves it (measured) --> FIXED (canonicalOnDisk)
- [MAJOR] gate on runners.js's pin, which a bump moves --> FIXED (HASH_VERIFIED_FOR + equality test)
- [MINOR] whole-file replace window --> STATED
#### Iteration 3
- [MINOR] x7 (a real append; keep timer covers the answer; Codex's heading spacing; test titles; stale docs;
  overclaim; rollback residual) --> FIXED / STATED
#### Iteration 4
- [MINOR] an indented context line read as a heading (measured) --> FIXED (Update-hunk state)
#### Iteration 5
- [MINOR] Codex keeps leading spaces after ': ' (measured) --> FIXED; [MINOR] the account's own home could get the hook
  --> FIXED (skipped there)
#### Iteration 6
- [MINOR] codex --version wrote into the account home --> FIXED (runs against the private home)
#### Iteration 7
- [MINOR] x3 (node on PATH for --version; a 5 s bound; delete only a hooks.json exactly ours) --> FIXED (the bound
  kills the process group: the first form hung, caught by its test)
#### Iteration 8
- [MINOR] isOurs byte-equal to this build only --> FIXED (structural); [MINOR] x2 comments --> FIXED
#### Iteration 9
- [MINOR] an apply_patch sent through the shell reaches no hook (measured) --> STATED (and measured after: the payload
  has no workdir, so matching it would name the wrong file; card comment 6221247351)
#### Iteration 10
- No issues above NIT. [NIT] x2 comments --> FIXED
