---
pre_challenge: true
method: challenge-loop
branch: accountsverb-5359
diff_hash: 7f6650baafb1dba4d8808f8cd3d877b23f555bb36b04ecd89b4b100b9f2caf7f
validation: passed (Mortals full suite at 1688b8745, hash 7f6650baafb1, EXIT=0 23:48)
subdir_audit: passed
timestamp: 2026-10-07T03:07:46Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (blind reviewers alternated between Opus and Sonnet)
**Converged:** Yes (iteration 8, Sonnet: NITs and one already-documented CONVENTION only; no code change)
**Total findings:** 1 BLOCKER, 12 WARNINGs, 1 CONVENTION, NITs
**Fixed:** 13 | **Deferred:** 0 | **Asked (awaiting user):** 0

Local evidence at 1688b8745: cli.accounts-5359, engine/accountline-5359, tools.windows-kosmos-cli-accounts-5359,
engine.reachable, engine/windows-tests-1777 and cli.exit-code-mapping-3628 run together 43/43; engine/connections 12/12.
Mutations (review 7 by me, review 8 by the reviewer), each restored: signed_out arm removed (red), unchecked arm removed (red),
liveCheckPending arm removed (red), the sign-in suffix rule disabled (red), the default-account name arm removed (red).

### Per-Iteration Breakdown

- [BLOCKER] Iteration 1: a credential on disk is state "connected" even when its last request was refused (#874), so
  reading state alone said "signed in" for a refused account. FIXED: the badge is read first, as the board's row does.
- [WARNING] Iterations 1-2: an expired sign-in did not say when its agents stop (loginStopsAt); ChatGPT's unknown state
  read as a failure. FIXED, both pinned.
- [WARNING] Iterations 2-4: accounts named by their folder (a home path in output) and identical lines for two keyed
  accounts. FIXED: named as acctPrimaryName names the row, never the folder; keyed rows use the key ending.
- [WARNING] Iterations 3-5: a 5xx and a reasonless 4xx were read as a refusal; an error on a 200 as a refusal. FIXED:
  one classifier, answer(), on both CLIs, pinned per class.
- [WARNING] Iterations 4-6: board text with a newline or a C1 / U+2028 character could print as an extra line.
  FIXED: clean() replaces every control character.
- [WARNING] Iteration 5: the two CLIs carried two copies of the words. FIXED: engine/accountline.js, called by both.
- [WARNING] Iteration 6: the failure line lost say()'s indent; the Windows verb crashed when the module was missing.
  FIXED, pinned.
- [WARNING] Iteration 7: the badge test's control produced the same output with the badge arms deleted, so it pinned
  nothing. FIXED with fixtures where the badge and the state disagree; mutation reddens it.
- [NIT] Iteration 7: a Mac install missing the reader printed a stack trace and blamed the board. FIXED: exit 4,
  "this install looks incomplete", pinned with a control.
- [NIT] Iteration 7: internal mode repeated after a sign-in already named ("(antigravity)"); "known on the next read"
  invited a loop. FIXED.
- [CONVENTION] Iteration 8: the Mac CLI prints failures to stdout, the Windows CLI to stderr. Deferred as documented:
  each matches its own connections verb.
- [NIT] Iteration 8, decided not changed: a ChatGPT row with no state field (the server always sets one); a
  non-ChatGPT liveCheckPending row says "being checked now" where the board says "could not check" (the CLI is more
  exact); the sign-in suffix rule keys on the name's text (only the two sign-in names end that way today).
