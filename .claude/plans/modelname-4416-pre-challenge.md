---
pre_challenge: true
method: challenge-loop
branch: modelname-4416
diff_hash: 9a6fc75cabe70566d1b48ebd768b1af121881be5260a4307f41807d62823955f
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T06:18:31Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6: two NITs, both accepted and stated in the plan)
**Total findings:** 17 across iterations 1 to 5, plus 2 accepted NITs in iteration 6 (the plan and commits record findings but not their severities, so none is guessed here)
**Fixed:** 17 | **Deferred:** 1 (cosmetic casing of ids outside MODEL_WORDS; no version is mis-said) | **Asked (awaiting user):** 0 | **Accepted as stated:** 2

**Final gate:** validation PASSED on d5e6e3868 (VAL_RC=0, AUDIT_RC=0, hash 9a6fc75cabe7, clean worktree, run modelname-4416-g5, 00:51:45 to 01:18:26 CDT 2026-09-29). Earlier runs: g3 green on eaa73232 (before iterations
4 to 6); g4 on 9c56c7dc2 RED on ONE test, mine: the #1777 guard requires a test that skips on a win32 host to be
listed, and the iteration-5 test was in neither list. Fixed in d5e6e3868 by excluding it from the Windows run with
its reason (the guard it tests compares a rollout with the launch plist's mtime, which a Scheduled Task lacks).

**What the branch does:** an agent's model reads in plain language (Gemini 3.8 Flash, Grok 4.6, GPT 5.6 Sol) unless
reading could mis-say a version (two number-only parts side by side, or a date part, stay raw). The card's model is
read from each runner's own record (agy conversation, Gemini session, Grok current_model_id, Codex turn_context),
never asked of the agent. Before a first turn the job's own model wins on both platforms, and a Gemini/Grok job with
no recorded model names the launcher's pinned default, marked "(default)".

### Per-Iteration Breakdown

Full text of each finding is in the iteration commit bodies and the plan's "Review iteration N" lines.

#### Iteration 1 (dfbd25706)
- a stopped Gemini/Grok/Codex agent's "Will start on" read "Claude Gemini 2.5 Flash" --> FIXED (runner kept; dropping it reds the test)
- plannedFor read the job's model from the Mac plist only --> FIXED (readJob on Windows too)
- two default-model tables --> FIXED (win32keyed.DEFAULT_MODEL is the one)
- the OpenAI picker needed the raw id on either platform --> FIXED (create.plannedModelId)
- stale #246/#3566 comments; a source regex standing in for behaviour --> FIXED (behavioural tests)

#### Iteration 2 (4545b91cb)
- the stopped list read the launch file one to three times per agent per poll --> FIXED (codex rows only, runner read once)
- grok-4.6-1 read as "Grok 4.6 1" --> FIXED (stays raw)
- card vs picker difference for a running codex agent after /model was unstated --> FIXED (stated in the plan)

#### Iteration 3 (aee459d7c)
- two reads of the same plist per agent per poll --> FIXED (create.plannedModelOf, one read; tested on real launch files)
- the Gemini/Grok menu and switch dialog said "picks its own model", false once Kosmos passes -m --> FIXED
- stale comments (four); acronyms read as words; a bare codex model; an unused require --> FIXED

#### Iteration 4 (4429b51bb)
- a stopped Gemini's menu and card named two different models --> FIXED (the menu reads the card's line; the old expression reds the test)
- a stale assertion message --> FIXED

#### Iteration 5 (76aa4089f)
- my iteration-4 helper made modelLine call a new function, and 7 tests in 4 files that lift it alone threw --> FIXED (self-contained again)
- Codex writes its rollout on the first turn (measured, codex-cli 0.149.1), so after a Kosmos model switch the card named the old model --> FIXED (a rollout older than the job file drops its model; disabling the guard reds the test)
- ids outside MODEL_WORDS keep simple casing --> DEFERRED (cosmetic, no version mis-said)

#### Iteration 6 (9c56c7dc2)
- a Codex switch that saves the job but fails to restart names the new model until the old process's next turn --> ACCEPTED (the switch response already says the old model still runs; reviewer checked every job writer)
- a plain-object lookup would misread an id named "constructor" --> ACCEPTED (no model id has that shape)
**Converged.**

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Stated limits
- The Windows arm (job.model from the Scheduled Task) is REASONED from readJob's win32 shape, not driven: no test here injects a task spec.
- Muse records no model Kosmos can read and still shows the provider.

### Strengths
- The model is read from what Kosmos can see, never self-reported, per Josh's ask.
- Mutations reddened a test for each behavioural fix; the one red validation was mine, named, and fixed.
