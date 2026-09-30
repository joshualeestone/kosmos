---
pre_challenge: true
method: challenge-loop
branch: codexhooksui-4607
diff_hash: 3432152d6770f2a92f339ece276e10167edf72836a4fa0ab60b5bb024c042627
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T14:35:47Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (reviewer model alternated opus and sonnet, starting with opus)
**Converged:** Yes. Iteration 18 (sonnet) returned NITs only; three were taken (comments, focus on hold).
**Total findings:** 6 BLOCKERs, about 50 WARNINGs, 1 CONVENTION, many NITs
**Fixed:** all BLOCKERs and WARNINGs (fixed in code, or stated in the plan as a named residual or gap)
**Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown (full detail in each round's commit message on the branch)

#### Iteration 1 (opus)
BLOCKERs: menu key by position (a reordered menu pressed Trust for Continue); the route overclaimed "never reachable"
(the #4491 residual). WARNINGs: no lock, one hook's page named fewer hooks than Trust trusts, the open-list dead end,
"done" overclaimed. FIXED in 9f6137017 and 7d683f2a4.
#### Iteration 2 (sonnet)
4 WARNINGs: the lock bypassed by name case, the summary read scrollback, source unbounded, the trust "done" line.
FIXED in 95cf6bd7f.
#### Iteration 3 (opus)
5 WARNINGs: menu digits taken from the last 30 rows (an echo could flip a reworded menu), the menu names no hook,
the refusal said "terminal", "trusted" on an empty viewer, the uncaptured screen. FIXED in 3a2688089.
#### Iteration 4 (sonnet)
3 WARNINGs: a stale button could trust an unseen changed dialog (the page now sends `seen`), the done line, source
text. FIXED in 75ea0f68a.
#### Iteration 5 (opus)
BLOCKER: the loop continued into any hook screen (table, then trusted, then menu pressed "2" unseen). FIXED with
CODEX_HOOK_STEPS (measured steps only) in b0ce9f0f1, plus 4 WARNINGs.
#### Iteration 6 (sonnet)
2 WARNINGs: the command is shown on the hook page (the plan was wrong), and the project flag. FIXED in 2a9343ea9.
#### Iteration 7 (opus)
4 WARNINGs: the wrapped heading, a per-read probe that reused a snapshot (now verifyAtSend), the hook count, the
command cut. FIXED in bcb7a9f9a.
#### Iteration 8 (sonnet)
3 WARNINGs, all stated in the plan or labelled ("Show the full list"). FIXED in cbc4d9527.
#### Iteration 9 (opus)
BLOCKER: agent text imitating the menu above another popup got "2". FIXED: exact block only, in e3741ea6c.
#### Iteration 10 (sonnet)
BLOCKER-lean: the table was recognised by its footer alone. FIXED: codexHookScreenExact before any key, in 97d4d2a7f.
#### Iteration 11 (opus)
BLOCKER (CI): EXPECTED_SITES 213 to 214. WARNINGs on the page's honesty. FIXED in ad5c4fd30.
#### Iteration 12 (sonnet)
WARNINGs: the loose trusted-list match (an imitation drew an Escape), no decision record. FIXED in 3b2ae2b6f.
#### Iteration 13 (opus)
WARNINGs: the hook page's fixed offset at 3+ hooks, log gaps. FIXED in 720e8c586.
#### Iteration 14 (sonnet)
WARNING: failures after a trusting key did not say Trust may have taken effect. FIXED in 588e87116.
#### Iteration 15 (opus)
5 WARNINGs: the list choice split from trust, guards pinned by tests, the sentence for person and agent, and the
project-room gap stated. FIXED in f40bcfe81.
#### Iteration 16 (sonnet)
2 WARNINGs: code lines wrap, a changed summary holds the buttons. FIXED in c184a2d0f.
#### Iteration 17 (opus)
2 WARNINGs: the button hold could stick for good (now a hold number), and the branch did not merge with main (merged,
EXPECTED_SITES measured 215). FIXED in the hold commit and 8f8e20aa5.
#### Iteration 18 (sonnet)
NITs only. **Converged.** NITs taken in d1a01a439.

### Changes after convergence
- Browser checks on d1a01a439 (this Mac, queued-heavy, HEADED=0, pinned Playwright): render-codex-hooks-4607 44/44,
  render-unread-edge-3743, render-agentdm-3414, render-dm-sideways-3969 (73), render-talk-fill-2622 and
  render-dm-chatfirst-718, all rc=0.
- NEGATIVE CONTROL: render-codex-hooks-4607 against origin/main's web/index.html fails (0 PASS, rc=2) at its first probe,
  because the hooks box's buttons do not exist there. That is a crash on the absent feature, not a named assertion;
  the named assertions are pinned by the mutants in engine/chat.codex-hooks-4607.test.js.
- b413c9dd3: empty surface-record commit with per-check trailers for the five surface-mapped checks.
- 21621a1df: merged origin/main (27 commits, clean). Surface gate 0; web.*.test.js 2195/0; reason-grep 5/0 (EXPECTED_SITES
  unchanged by the merge); engine/chat.codex-hooks-4607, server.codex-hooks-4607 and engine/status tests 261/0.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- Keys only through measured steps, each after a fresh pane probe and a fresh capture of an exact measured screen
  shape. The first key must match what the person was shown, the lock is per pane, and every guard has a mutant that
  goes red.
- The person-only route is not an agent-token route. It refuses agent tokens and callers without browser headers, and
  it logs every decision and refusal. The #4491 residual is stated.

### Validation
Full suite on Mortals (detached, normal queue) at the merged head 21621a1df: clean, hash 3432152d6770 (2026-09-30T14:35:32Z).

### Changes after convergence (2026-09-30 13:20 CDT): merged main, path C

- **Validated head:** 21621a1df, full suite clean on Mortals (hash 3432152d).
- **Merged origin/main 471492a54** in 88bdd6f4c (after the #4638 revert, #4742 and #4618). Main's
  commits since the validated base touch web/index.html, server.js and browser-checks-reason-grep.test.js,
  all files of this PR: path C.
- **One hand-resolved line** (Splinter 12:13: a hand line counts for path C when a focused test measures
  it): `EXPECTED_SITES` in browser-checks-reason-grep.test.js, main 221, this branch 216 -> **222**, note
  appended. The reason-grep test measures it: 5/0.
- **Focused tests on the merged tree** (throwaway 7c096f3ae, tree 184886088, which is exactly this
  branch's tree after the merge): web.* 2200/0; engine/chat.codex-hooks-4607, server.codex-hooks-4607,
  engine/chat.codex-hooks-4589, engine.reachable and server.agent-token-gate-4491 94/0; reason-grep 5/0;
  surface gate 0; **render-codex-hooks-4607 all passed (44), Chromium and WebKit.**
