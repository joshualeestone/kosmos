# quietbare-6244

Card: joshualeestone/kosmos#6244 (follow-up from #6239's first slice, challenge round 10's deferred NIT).

## What this branch does
In a policy's quiet hours, `engine/chat.js` `deliverWithGap` let through the look-after commands matched by
`PAUSED_SWARM_COMMANDS`, which accepts trailing text. `/compact <words>` passes its words to the agent as a summarising
instruction, so words reached an agent at night. The quiet-hours check now uses `QUIET_LOOK_AFTER`: the same five
commands, bare (case-insensitive). The paused-swarm rule is unchanged.

Round 1: what is typed is the envelope, the command and the trailer (the person's DM always carries an envelope; a
reply quotes, a file adds a note), so the exemption also requires no envelope and no trailer. The Compact and Clear
buttons (server.js's compact/clear route) send the bare command with neither, so they still work at night.

## Decided
- Bare only, for quiet hours only. Rejected: tightening PAUSED_SWARM_COMMANDS (a paused swarm's person may want
  `/compact <focus>`; that is not a policy-set limit).
- Weakest premise: nobody needs `/compact <focus>` at night for a kid's agent. A bare /compact still compacts.

## Validation
- engine/familyquiet-6239.test.js: three worded commands, and a bare /compact with an envelope or with a trailer,
  refused with nothing typed; a bare `/COMPACT` with neither still typed (control). Reverting to PAUSED_SWARM_COMMANDS,
  or dropping either the envelope or the trailer test, turns it red.
- Every engine/chat*.test.js and engine/swarm*.test.js: 369 pass. Final: full suite through queued-heavy.
