# heard-budget-3961: the paging allowance is per assignee (#3961)

## Why

After #3959 an agent can make any number of tasks (up to a 500-an-hour runaway
breaker), but only 12 agent-made assignments an hour, across the WHOLE fleet,
were typed into the assignee's screen. In Josh's case, an agent handing out 25
tasks, the last 13 assignees were never nudged, and one busy agent silenced
every other agent's assignments for the rest of the hour.

## Decided (option 1 on the card)

- The allowance counts per assignee: 30 an hour for one agent's screen. That is
  what the valve protects, one pane from being flooded.
- A fleet-wide ceiling of 500 an hour stays as a runaway breaker only, the same
  number and shape as #3959's task breaker.
- The skip answer names which limit it hit. The per-agent sentence says the
  agent was already told N times this hour; the ceiling's sentence says agents
  were stopped.
- Only a real placement spends it, and the screen and the Assigner never do.
  Both are unchanged.

## Rejected

- Option 2, raising the shared budget to 500: a looping agent could then type
  into one pane hundreds of times an hour.
- Option 3, leaving it and only reporting the skip: #3959 already reports the
  skip, and Josh's case still fails.

## Baron's second valve, measured and not reproduced

The card says an agent-made task with an assignee also spends the parts write
valve (#803). Measured twice on this branch's base:
- 13 process-made assigned tasks (no live pane): `partValve().count` stays 0,
  and a process part add afterwards succeeds.
- 12 PLACED assigned tasks (a live fake pane, inside the #3959 test): the count
  stays 0, and the tasks store no parts.

Tasks keep `who` on the task, and parts are derived on read, so nothing is
written that the valve counts. The #3959 test's comment claimed otherwise. The
new test asserts the count does not move across 30 assigned tasks.

## Weakest premise

The allowance resets on restart (in memory), as before. 30 is a judgement: high
enough for a real batch to one agent, low enough that a loop aimed at one pane
stops within the hour.

## Tests

server.test.js:
- #761 round 2: the task after the parts valve trips is now typed.
- The #3959 test is rewritten as the #3961 test:
  - a per-assignee limit at 30;
  - another assignee is unaffected;
  - the reassign and no-assignee answers;
  - the fleet ceiling via a test seam;
  - tasks leave the parts valve alone.
