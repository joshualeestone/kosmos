# reportsboot-1676: the reports-to fix reached nobody who already existed

kosmos#1676. The wording half is Mikey's `5be19009` and is untouched here.

## The gap

```
reports.syncEveryone       1 caller   server.js:5537, inside PUT /api/you
policyEngine.syncEveryone  3 callers  5449, 5478, 5499
```

An edit to `blockBody()` reached an existing agent **only when the person saved their own
About-you details.** For a twelve-agent org chart built this morning, that is never.

⚠️ **I misread this once and it matters.** I first reported the three `policyEngine` line
numbers as `reports`, and was one message from telling the team that Josh could deliver the
fix before a client demo by **renaming any agent**. That is a different module; it would have
delivered nothing while looking like it worked, and it would have been ticked off. Mikey
caught it. Same method name, different object, and every line number I quoted was real, which
is exactly why it read as measured.

## The fix

`reports.syncEveryone(safeRoster())` at boot, beside the connections refresh I added in
kosmos#1650, whose comment records the identical defect one module over: *"had exactly one
caller, POST /api/you"*.

**Cost already measured for that sweep:** 3.3 ms unchanged across 18 agents with 13.6 KB
instruction files, 29.7 ms on a writing pass, 0.0 ms for an empty roster.

📌 **The boot form captures its return value**, unlike the `PUT /api/you` call which throws
`told` away inside `catch {}`. A boot-time write with nobody watching has to name the first
failure or it is a silent no-op, which is the point of the whole card.

## What it does NOT buy, stated because the card is about delivery

**It writes the FILE, not the agent.** `engine/instructions.js` reads an instruction file once
at session start, so this cannot change a running agent; it makes the file right at the
agent's next start. Same claim and same limit as the connections refresh.

## Verification

`server.reports-refresh-1676.test.js`, two arms:

- an agent that existed **before** the edit has the block after a plain board start, **and the
  delivered block contains both of Mikey's sentences** - a delivered stale block is not a fix
- CONTROL: an agent with no instructions file does not get one invented

Both sibling boot-sync suites re-run green: connections-refresh 3/3, supervisor-refresh 4/4.

📌 The wording was asserted by **no test anywhere** before this (control: 4 test files mention
`reportsTo`). Mikey is adding a unit-level assertion on `blockBody`'s output; mine asserts what
arrives in the file, which is a different question.

## Known limits, found by Splinter reading the source

1. `syncEveryone` skips any agent without `isNamedOurs === true`, silently. A demo agent not
   marked ours is not synced. Unchanged by this.
2. The `PUT /api/you` call discards its result; the confirmation on screen is about a
   different sync. Unchanged by this, and worth its own card.
