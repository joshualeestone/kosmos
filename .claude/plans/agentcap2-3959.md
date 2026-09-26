# #3959 follow-up: the parts cap and the task-message cap become the same runaway breaker

**Branch:** `agentcap2-3959` · **Card:** kosmos#3959 (Splinter's follow-up on Josh's 09-26 ruling)

## Why

#3959 (PR #3979, shipped in Mac 0.6.97) removed the 12-an-hour cap on agent-made tasks and
projects, leaving a 500-an-hour runaway breaker. Two agent caps were still on main:
- **part changes**, `PARTS_PER_HOUR = 12` in engine/tasks.js (#803). An assigned agent-made task
  also counts as a part write, so after 12 assigned tasks in an hour agents could not add or
  reassign parts.
- **task messages**, `TASK_MSG_CAP_PER_HOUR` default 30 in server.js (#768).

Splinter: give both the same 500 breaker, and put the limit, that it is shared, and when it resets
IN the error text, because both CLIs print only the error (Homer checked).

## The change

- **engine/runaway.js** (new): `runawayRefusal(times, what, {now, limit})` and
  `AGENT_RUNAWAY_PER_HOUR = 500`. One sentence shape for every agent limit: the count, "at or over
  the limit of L an hour shared by all agents together (a safety stop for an agent stuck in a
  loop)", what is paused, "again in about M minutes", and that the person can still do it from the
  screen. The wait is when enough of the oldest writes leave the hour, capped at the hour.
- **server.js** `agentRunawayRefusal` (tasks, projects) now wraps it. Same wording as shipped in
  0.6.97, pinned by the existing tests.
- **engine/tasks.js** parts valve: `PARTS_PER_HOUR` is the shared 500; `partValve` uses the shared
  sentence. Its old "lifts in" figure was computed from the OLDEST write, which is only right at
  exactly the limit; the shared helper computes it from the write whose leaving brings the count
  under the limit. `setPartsLimitForTests` lets tests run the valve at twelve.
- **server.js** task messages: the default is the shared 500; an operator's
  `AGENT_WORKFORCE_TASK_MSG_CAP` still wins, read by `taskMsgCapFrom`:
  - a whole number of 0 or more is the cap; **0 means switched off**, and the refusal says so,
    with NO retry time (waiting does not help while the cap is 0);
  - a fraction rounds down (2.5 is 2): a fractional limit used to produce "NaN minutes";
  - ⚠️ **unset, empty or blank means not set, so the default.** Before this, an EMPTY value read
    as 0 (`Number('')` is 0) and switched messages off. Clearing the variable now restores the
    default instead of silencing agents; chosen on purpose, and pinned by a test.
  - anything else falls back to the default.
  The 429 gains `retry-after` / `retry_after_secs`, like the part routes.
- `processPartWrites` no longer returns `liftsInSecs`, which was computed from the oldest write
  and read by nobody after this change.

## Deliberately NOT changed

- **The membership valve** (`MEMBERS_PER_HOUR = 60`, engine/projects.js). It was set by an earlier
  Splinter ruling, is not one of the two named here, and 60 is not the "crazy low" number Josh
  objected to. Named on the card.
- **The pane-nudge allowance** (`HEARD_BUDGET_MAX = 12`): kosmos#3961, with a recommendation.
- **The community-feed valves**: a different feature and a per-agent design (#3485).

## Tests

- The production values are pinned: `tasks.PARTS_PER_HOUR === 500` and equal to the shared
  constant (server.parts-valve.test.js); `TASK_MSG_CAP_PER_HOUR === 500` with no override
  (server.test.js).
- The behaviour tests keep their small limits through the test-only setters (parts at 12, restored
  in `finally`; the message file already runs at an env cap of 2) and now assert the new sentence:
  the limit, "shared by all agents together", "again in about N minutes", the screen path, and the
  retry-after header equal to the field.
- The task/project breaker's own tests are unchanged and still pass, which pins that the move into
  engine/runaway.js did not change its wording.

## Red checks (each made to fail, then restored byte-identical)

- `PARTS_PER_HOUR` back to 12: fails at "the parts limit moved off the shared breaker".
- The task-message default back to 30: the default-500 pin fails.
- The shared breaker without rounding the limit: the fractional-limit test fails at
  "retryAfterSecs is NaN".
- A retry time on the switched-off cap: fails at "a switched-off cap offered a retry time".

## Weakest premise

That one number, 500, suits all four kinds of write. Task messages and part changes are cheaper
and more frequent than tasks, so a busy swarm could reach 500 messages an hour sooner than 500
tasks. The refusal says so plainly and when it lifts, and the operator override still exists for
messages. If a real run trips it, the number is one constant.
