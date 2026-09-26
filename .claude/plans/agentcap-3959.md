# #3959: agents may make as many tasks and projects as they need; only a runaway loop is stopped

**Branch:** `agentcap-3959` · **Card:** kosmos#3959 (Josh, 09-26 08:40; Splinter's decision on his ruling)

## The defect

`server.js` refused the 13th agent-made TASK in any hour (#485, "#327's twelve-an-hour extended
here"), counted across ALL agents and ALL projects. Josh had agents add a batch of tasks and
every agent was refused after the twelfth; a 25-task test was blocked. The matching #327 cap on
agent-made PROJECTS was the same shape at the same number.

## The change

- One module-scope helper, `agentRunawayRefusal(times, noun)`, used by both routes. The limit is
  `AGENT_RUNAWAY_PER_HOUR = 500`: a runaway breaker far above any real batch, low enough that a
  looping agent cannot make thousands.
- It still counts from the records themselves (`addedVia`/`createdAt` on tasks, `made.via`/`made.at`
  on projects), so a restart does not reset it, exactly as before.
- The refusal (Josh's write-up asked for these three things): it names the LIMIT, says it is
  SHARED by all agents together, and says WHEN it lifts ("again in about N minutes", computed from
  the record whose leaving the hour brings the count under the limit; never "0 minutes").
- Unchanged: the screen is never counted or refused; the wording keeps "pausing agent-made
  <noun>" and "from the screen", which the Mac and Windows CLI tests and the CLI's pass-through
  already match.

## Deliberately NOT changed

- **The pane-paging budget** (`HEARD_BUDGET_MAX = 12`, shared by all agents and with the part
  routes). It does not refuse creation, but it has a user-visible effect, now stated plainly:
  past 12 agent-made assignments in an hour, the task lands and is on the assignee's list, but a
  LIVE assignee is not told until its next start (the instruction block is read at start).
  ⚠️ Corrected in review round 3: I first justified leaving it as "the task still appears in
  the instruction block", which is true but does not reach a running agent. So this branch now
  makes the skipped nudge visible: `heard` comes back `could_not` with the reason, instead of
  undefined (which reads as "no assignee"). Review round 4: the two part routes (add a part,
  reassign a part) share the same allowance, so all three routes now answer through one
  helper, `heardBudgetSkipped`. The budget itself is kosmos#3961, with a
  recommendation (per assignee instead of fleet-wide).
- **The parts valve** (`engine/tasks.js` `PARTS_PER_HOUR = 12`, #803). Splitting a task into
  parts is still refused past 12 an hour. Measured while writing the round 4 test: an
  agent-made task WITH an assignee also counts as a part write, so after 12 assigned agent tasks
  in an hour, agents cannot add or reassign parts until the hour passes. Reported on #3961. It is a different route and a different ruling, and
  it is named in the PR body so Josh sees it if a batch of tasks is also split into parts.
- The community-feed and task-message valves: different features, not part of the ruling.
- **The agent instruction line** (`engine/defaults.js`: "the hourly cap on how many one agent
  makes"). It was already wrong before this branch (the cap was shared, not per agent). Fixing it
  changes the doctrine block, which needs a DOCTRINE_VERSION bump that banners the whole fleet;
  too heavy for one phrase, and the refusal text an agent actually receives is now accurate.
  Left for the next doctrine change; noted on #3961.

## Tests

- `server.test.js`: the task route takes 30 more agent-made tasks in one hour (32 on the books,
  all 200), then with the limit lowered to 40 exactly 8 more land and the next is a 429 whose text
  names the limit, "shared by all agents", the reset time and the screen path.
- `server.projects.test.js`: the same for projects (30 land; at a lowered 33, two more land, the
  third is refused with the same four phrases; the screen still works).
- `server.test.js`: the helper directly: the production value is 500; 499 allowed, 500 refused;
  past the limit the reset comes from the right record (502 on the books, the third oldest);
  out-of-hour and undated records are not counted; the soonest it says is "1 minute".
- The route tests lower the limit through `setAgentRunawayLimitForTests` (restored in `finally`),
  so the trip is tested through the real route without making 500 records; the 500 itself is
  pinned by the direct test.

## Red checks (each made to fail, then restored and re-greened)

- Task route given the old limit of 12: the task test fails at "agent-made task #13 in the hour
  was refused".
- Project route with the refusal disabled: the project test fails (expected 429, got 200).
- The skipped-nudge answer removed: the #761 round 2 test fails at "a skipped nudge left heard
  undefined, which reads as no assignee".
- The same answer removed from part add, then from part reassign: the #3959 test fails at "part
  add (or reassign) left heard undefined with an assignee named".

## Weakest premise

That 500 an hour is "far above any real batch". It rests on Josh's 25-task test and on nothing
measured about how many tasks a large swarm makes. If a legitimate run hits it, the refusal says
so plainly and when it lifts; the number is one constant, and Josh can say "none at all".

## Windows

The same server.js ships to Windows. The Windows `kosmos` CLI passes the board's refusal text
through (its test matches "pausing agent-made projects"). Homer checks it on the PC.
