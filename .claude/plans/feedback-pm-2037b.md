# Daily product-feedback report, slice 2b: the standing PM instruction (kosmos#2037)

Builds on slice 2a (PR #2158, merged): the `kosmos feedback write|show|list` CLI
verb (engine-direct, board-independent). Slice 2b lands the "trigger" proper: the
standing daily instruction to the agent that authors the report, plus its cadence.
Still NO send, NO privacy surface, so merge-on-green like 2a.

## The two design questions and how I answered them

### Where does the instruction live?
The product delivers standing instructions three ways (mapped this session):
- `engine/roles.js` role `instructions` -- the agent's starting CLAUDE.md body.
  Person-owned after creation, so an edit reaches only NEW agents of that role.
- `engine/defaults.js` -- a shared `## How you work` block spliced into EVERY
  agent; a NEW `###` section reaches EXISTING agents via the consented doctrine
  refresh (`engine/doctrine.js`), but the block is fleet-wide, not role-scoped.

**Decision: the PM role (`roles.js` pm.instructions).**
- The store is one markdown file per local day (`engine/feedback.js`, idempotent
  replace). More than one daily author would clobber the day's file. One
  designated author is the right shape.
- Josh's framing (feedback-report-2037.md): "an agent (probably the PM) writes
  and assembles a daily report." The plan (feedback-author-2037.md) already
  recorded "target the PM/report-writer role, not every agent."
- **Rejected: a fleet-wide `###` section in defaults.js.** It reaches existing
  agents, but it would tell every agent to write daily; with the self-check
  cadence the first agent each day would win and the rest skip, but the author
  would then be arbitrary rather than "the PM", losing the assemble intent.
- **Accepted cost:** a roles.js edit reaches only NEW PM agents (how all role
  text behaves). For a beta this is acceptable; reaching existing PM agents would
  need the defaults.js path, which is fleet-wide and contradicts PM-scoping. That
  tension is real and left for a later slice if it matters.

### How does the cadence fire?
**Self-check, because the product has no scheduler.** Confirmed: no cron / daily
/ midnight trigger exists; the only periodic machinery is minute-scale
`setInterval` sweeps in server.js and per-login launchd starts. So the instruction
tells the PM to check `kosmos feedback show` first and write today's note only if
there is not one yet. This is exactly what the plan specified.

## What shipped

- `engine/roles.js` -- a `## Once a day: what is not working about Kosmos` section
  added to the pm role's instructions: write a short note of what did not work
  about Kosmos + what would make it better, save with `kosmos feedback write`
  (args or stdin), self-check `kosmos feedback show` first. Copy stays in Josh's
  frame ("what did not work" + "what would make it better"), is explicitly about
  the Kosmos product (not the operator's own work), and says the note is saved on
  this computer (true now and after the future send layer, since the local write
  is unconditional). No reference to a send switch that does not exist yet.
- `roles.feedback-2037b.test.js` -- asserts the PM carries the write command, the
  self-check, the Kosmos-product framing, and the daily cadence; and that the
  instruction is PM-scoped (no other role carries it) with a positive control so
  the negative sweep is not vacuous.

## Not in this slice (held / deferred)

- **Slice 3, the SEND layer:** scrub + gated transmit. HELD for Splinter's design
  review before it ships (what is scrubbed, what is sent, the gate).
- **Slice 4, the opt-in switch + install wiring.** Separate slice.

## Verification

- `roles.feedback-2037b.test.js` (2 arms) + `engine/create.test.js` (146 arms,
  the role-structure + pm-boundary assertions still green). Full `node --test`
  suite + test:shell via the challenge-loop validation.
