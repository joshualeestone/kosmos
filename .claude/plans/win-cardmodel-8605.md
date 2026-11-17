# win-cardmodel-8605: #8601 round 8 follow-ups (per-poll cost, cache and session comments, one reply rule) (kosmos#8605)

**Posture:** production

## Finished means
- readModel's age check stats the agent's job file ONCE per reading (it was twice), with a test that counts the stats
  and fails against origin/main's status.js.
- The Windows task-cache premise, the "no session given" premise and the named-world gap are written where a later
  reader will see them (code comments), so none is left implicit.
- newestReplyAt has one rule for what counts as a reply (isReplyLine), with no second, dead check.
- The cut-first-line gap is recorded (comment) as a known, bounded case.
- Behaviour otherwise unchanged: the #8601 tests, the Codex #4416 tests and status.test.js pass as before.

## Change (engine/status.js only, plus one test)
- `jobMtime(agentName)`: the one job-file lookup, one stat, ms or null. `writtenBeforeJob` (the Codex rule) and
  `readBeforeJob` (the Claude rule) each call it once. `jobWrittenAfter` and `jobExists` are gone.
- `newestReplyAt`: the `<synthetic>` check is removed; `isReplyLine` (hasReplied's test) already rules it out.
- Comments: the Windows `cachedTaskSpec` premise (model changes only through the board's `create.setModel`, verified:
  its only callers are server.js routes); the "no session" callers; the named-world gap; the cut-first-line gap.

## Decisions
- Not done: refreshing the Windows task cache when the task file is newer than the cached read. Every model change is
  already in the board process, which refreshes it; adding a refresh would be a stat plus a possible schtasks query per
  poll for a path that does not exist. The comment names the rule a new path must follow.
- Not done: a test for the cut-first-line case; it is the documented fallback (file time) and bounded by the next reply.

## Weakest premise
That no process other than the board changes an agent's model on Windows. True today (setModel's callers are server.js
routes); a CLI that wrote the task directly would break it silently, which the comment now says.

## Tests
- engine/status.cardmodel-8601.test.js: new "kosmos#8605: one stat of the job file per reading" (counts statSync calls
  on the job file; 1 on the branch, 2 against origin/main's status.js).
- The 8601 files, status.test.js, earlier-model-6716, modelname-4416, codex-model-switch-4416 and the policy tests:
  357 + 1 pass.
