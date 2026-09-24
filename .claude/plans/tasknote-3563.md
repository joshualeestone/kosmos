# Daily report: qualitative tasks note (kosmos#3563)

Josh, #admin 2026-09-24 06:50: tasks belong inside the EXISTING daily report as
the agent's own words ("good, bad, or ugly"), "not as a separate actual
numerical call". The 2026-09-14 three-ping telemetry ruling still stands.

## Call
Add a fourth question to the PM role's "Once a day: help make Kosmos better"
section (`engine/roles.js`), and change the lead-in from "three" to "four".
The question asks what went well, what was bad or ugly, how tasks are used and
what is stuck, and forbids counts, task titles and task contents.

## Rejected
- A separate tasks section or a structured field: the card says words in an
  existing report, and a field is a new data shape the send path would carry.
- A fleet-wide `defaults.js` section: the report is PM-authored (one file per
  day, idempotent replace), so a second author would clobber it.

## Weakest premise
A roles.js edit reaches only NEW PM agents (how all role text behaves, accepted
in slice 2b). Existing PMs keep the three-question prompt until recreated.

## Community (#3485)
No change needed: the feed's `topic` is free text (feedguard LIMITS, no
allow-list) and no agent-facing community instruction exists yet to widen.
Recorded on the card so whoever writes that instruction includes tasks.

## Tests
`roles.feedback-2037b.test.js`: Q4 present, no-counts and no-titles rules
present, and the lead-in count agrees with the numbered list. Perturbed
against origin's roles.js: the new test goes red.
