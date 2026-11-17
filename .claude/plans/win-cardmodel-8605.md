# win-cardmodel-8605: #8601 round 8 follow-ups (per-poll cost, cache and session comments, one reply rule) (kosmos#8605)

**Posture:** production

## Finished means
- readModel's age check stats the agent's job file ONCE per reading (it was twice), with a test that counts the stats
  and fails against origin/main's status.js.
- The Windows task-cache premise, the "no session given" premise and the named-world gap are written where a later
  reader will see them (code comments), so none is left implicit.
- newestReplyAt counts a reply as hasReplied does (isReplyLine), plus a check of the row's own model (review 2: the
  `<synthetic>` check is NOT dead, since isReplyLine passes a line if ANY model value on it is real; kept, commented).
- The cut-first-line gap is recorded (comment) as a known, bounded case.
- Review 4: a test that a <synthetic> row carrying another real model is not a reply (fails if the row check goes);
  fileBefore shared by both rules; a #8610 pointer at ownSession; one stat-counting helper in the tests.
- Review 3: comments only (the reply-rule header now matches the row check; rewrites named by mechanism,
  rewriteAgentJob and installPlan; the named-world gap is from #8601 review 7, card only, filed as #8610).
- Review 1: the named-world comment corrected (this process's world, not the default one) and the real gap named: a
  board in a named world has sessions `name+world`, so the #8601 rule never applies there (older than #8601; noted).
  Cache refresh list completed (install, remove, disable, enable); a second stat-count test for the file-time path.
- Behaviour otherwise unchanged: the #8601 tests, the Codex #4416 tests and status.test.js pass as before.

## Change (engine/status.js only, plus two tests)
- `jobMtime(agentName)`: the one job-file lookup, one stat, ms or null. `writtenBeforeJob` (the Codex rule) and
  `readBeforeJob` (the Claude rule) each call it once. `jobWrittenAfter` and `jobExists` are gone.
- `newestReplyAt`: the `<synthetic>` check stays, as a check of `row.message.model` (any model starting with "<"),
  with a comment saying why it is not covered by `isReplyLine`.
- Comments: the Windows `cachedTaskSpec` premise (every model-changing rewrite, `create.setModel` and `create.setProvider`,
  runs in the board process from server.js routes and goes through win32job.install, which forgets the cache first); the "no session" callers; the named-world gap; the cut-first-line gap.

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
- A second stat-count test (review 1) for the file-time path. The 8601 files, status.test.js, earlier-model-6716,
  modelname-4416, codex-model-switch-4416 and the policy tests all pass.
