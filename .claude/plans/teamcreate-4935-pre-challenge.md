---
pre_challenge: true
method: challenge-loop
branch: teamcreate-4935
diff_hash: 6e161205c654c680230f7a23533c9aa52408ba7fe983dedee982b57251402c7f
validation: passed for the touched surface (all 304 web.*.test.js files, 2281 tests; engine/teamseed and server.teamseed-4557; render-teamcreate-4557 ALL PASSED both engines at 56d811aad, the last code commit); the full suite runs as PR CI and the merge waits for green
subdir_audit: not run (no subdir CLAUDE.md in this diff)
timestamp: 2026-10-02T03:28:00Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17 (models alternated opus / sonnet)
**Converged:** Yes. Iteration 17 found no BLOCKER, WARNING or CONVENTION.
**Fixed:** every actionable finding of iterations 1-16 (one commit per iteration; the plan file records each round's
changes under "Review N changes"). **Deferred:** recorded in the plan with reasons. **Asked:** 0.

**Honest notes.** At iteration 10 a commit landed with 4 unit tests red (a test stub lacked clearTimeout; the commit
command was not gated on the test exit). Fixed one commit later (7c33c8ff2) and every later commit was gated. At
iteration 15 a review found web.settings-agy-3874 red (a sentence count, 4 -> 5): the focused test list had missed it;
from then on the whole web unit suite ran before each commit. Several earlier browser-check runs read a tree being
edited; those results were discarded and the check was rerun in a frozen worktree at a named commit.

### Per-Iteration Breakdown (headline finding per round; full detail in the plan file and commit messages)

#### Iteration 1 (opus) - W: tcSyncModel ran from every screen (catalogue read); W: model carried between teams; W: step-1 CSS hit the org-chart block --> FIXED f5b5e5893
#### Iteration 2 (sonnet) - W: OpenAI/vendor/loading branches untested; W: stale OpenAI list could land in the next team; W: Create pressable while loading --> FIXED 9394022e1
#### Iteration 3 (opus) - W: Try again pressable while loading; W: phone footer squeezed --> FIXED 8c33e1ce3
#### Iteration 4 (sonnet) - W: the loading hold set too late on several paths; W: late accounts not synced; W: flags kept across teams --> FIXED 927fd6c43
#### Iteration 5 (opus) - W: two controls both announced as "Model" --> FIXED 73c83474e
#### Iteration 6 (sonnet) - W: Create stuck after a provider switch mid-load (SELF, from iteration 4); W: failed roles read retried in a loop (SELF, from iteration 5) --> FIXED 931a99737
#### Iteration 7 (opus) - W: failed-roles comment overpromised, recovery untested; N: unknown provider got a Claude key --> FIXED ae0d3c988
#### Iteration 8 (sonnet) - W: model painted while menus filling; W: stale note on a new team --> FIXED d15f8dd6a; spinner-restart W DEFERRED (verified inside the signature gate)
#### Iteration 9 (opus) - W: OpenAI read unbounded --> FIXED e82d31ad3
#### Iteration 10 (sonnet) - N: merged comment (SELF) --> FIXED 4aea913c5 / 7c33c8ff2; resume-after-reload W DEFERRED (TC never persisted)
#### Iteration 11 (opus) - W: timeout worded as signed out; W: roles read unbounded --> FIXED af8e7f076; auto-retry after timeout DEFERRED (would poll)
#### Iteration 12 (sonnet) - W: failed request worded as signed out --> FIXED 7e3d1f1ac
#### Iteration 13 (opus) - W: disabled-look comment contradicted the code --> FIXED a642cec61; April merge W DEFERRED (coordinated)
#### Iteration 14 (sonnet) - W: model menu released only by the next tcPaint --> FIXED 6bf79e9e2; Claude default pinned DEFERRED (deliberate, as the single create)
#### Iteration 15 (opus) - B: web.settings-agy-3874 count; W: locked look after a refused lead; W: wait under a cold check --> FIXED 56d811aad
#### Iteration 16 (sonnet) - W: README row read as unguarded --> FIXED e2b64cd3e
#### Iteration 17 (opus) - NITs only. **Converged.**

### NITs (iteration 17, recorded not changed)
- No assertion that the making row holds exactly one spinner (it is inside the signature gate today).
- The new-team reset leaves .tc-making until the first tcPaint (every menu is disabled then anyway).
- tcSyncModel after the fill sits after try/finally rather than inside finally.
- #tc-model-why not tied by aria-describedby (same as the single create).

### Strengths
- Engine, route and page each tested with controls; the browser check measures layout, the spinner, names staying put
  (control by hand: without the fixed column they move), locked menus, the model on every member, the next team on
  the default, and the footer at 390, in Chromium and WebKit.
