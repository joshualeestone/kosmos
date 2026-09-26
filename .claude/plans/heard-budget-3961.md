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
- A fleet-wide ceiling stays behind it, read from #3959's AGENT_RUNAWAY_PER_HOUR (the
  same number, one constant). It does not refuse or persist the way #3959's breaker
  does; it only stops the typing. Since #4019 the task breaker and the parts valve
  each allow that many agent-made writes an hour. One looping agent is stopped by its
  assignee's 30 long before the ceiling; the ceiling binds only when about seventeen or
  more screens are each paged thirty times in an hour. This departs from the card's
  option 1 wording ("removes the shared ceiling"): it keeps one, far above any real
  batch, for that case.
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
  - the fleet ceiling via a test seam, and it is the limit named when both are spent;
  - one allowance whatever the name's case, since delivery ignores case;
  - tasks leave the parts valve alone.
- #761 round 6 is rebuilt: its failed deliveries used to go to a different agent than
  the real one, which a per-assignee allowance can never charge, so it could not fail.
  Now 31 failed deliveries go to one agent, which must still be told once reachable.
