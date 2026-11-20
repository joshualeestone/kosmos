---
pre_challenge: true
method: challenge-loop
branch: taskhow-8735
diff_hash: 3e86e0826b3e1523134f62a8be77127fa322842afaad251bb4133ae2b14e2e1b
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T23:54:51Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind rounds, Opus and Sonnet alternating.
**Converged:** No. The loop stopped at the fleet's 8-round review cap, with no BLOCKER open in any round. Rounds 7 and 8 found nothing above a NIT.
**Every round's findings and decisions:** in `.claude/plans/taskhow-8735.md`, Reviews 1 to 8.
**What the rounds changed:**
- Review 5: the per-run sentence names `kosmos report blocked` and `kosmos report clear`.
- Review 5: a running agent's changes file leaves the 47 moved task lines out as moved, built on #8743's mechanism (`changedLines` now takes a list of moved entries). Real v52 to v53 file: 56 lines marked removed before, 2 after; the 2 are the deliberate rewordings, which the conditional sentence covers.
- Review 6: a file with Windows line endings (CRLF) keeps the task entry.
- Every fix carries a test, perturbed red then restored green.

**Accepted, with reasons in the plan:**
- `task built --commit HEAD` and `--file` stay in the guide only.
- An agent whose task section a person edited is not re-offered the pointer.
- The bare `kosmos report blocked` in the per-run sentence.

Full validation on this Mac (Agent1s), not Mortals, because Baron's 0.8.11 cut held Mortals. Head ba4e1f692b, base 993d9ab0d4: PASSED, "status":"clean", hash 45275cfeaec7, 30,111 node tests, 0 failed, 0 cancelled, all four shell shards status 0; subdir audit passed (rc 0). The one commit after it (e038c5f2a8) changes only this branch's plan file (review 8 recorded).

Merged main again after the 0.8.11 hold lifted (5799fc115d): #8771 had changed tools/windows/kosmos-cli.js and
install/kosmos beside this branch's `task --how`. Clean merge; the shared-file suites pass on the merged tree
(Windows CLI verbs parity 12, Windows CLI 65, taskguide 3, instructionreread-changes 50, brief size 1, defaults 30,
doctrine 32). This head's full validation is the PR's CI, which runs the whole suite on the merge with main.
Merged main a third time (afc2df4add): #8773 (kosmos.exe on Windows) had changed install/kosmos, tools/windows/kosmos-cli.js
and tools/windows-tests.js again. Clean merge; Windows CLI verbs parity 12, Windows CLI 66, taskguide 3 and brief size 1
pass on the merged tree. CI on this head is the full run.
