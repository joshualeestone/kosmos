# donewhen-5152: slice 0 of kosmos#5152, instruction-only "done when" contract

Josh, #admin 2026-10-03 11:07: "it would be ideal if the agent wrote that and the task". Splinter's go (11:10): slice 0,
instruction-only, measured before merge; editable checks and a home for no-project chats wait until after Monday.

## Done looks like
- The working-rules block (engine/defaults.js) has a new section, "### Put the work on a task first", right after
  "Knowing when you are finished". It tells an agent:
  - to put work that takes more than a reply on a task before starting, with "Done when:" checks
  - not to add a second task when the work came as one, but to message the checks onto it
  - to report each check in the built note
  - that small talk is not a task, and that with no project the checks go in the reply
- DOCTRINE_VERSION 24, logged; fingerprint pinned; doctrine-past has the v24 row and the new section's hash (main's
  rows kept).
- Existing agents are offered the section (new heading, missingFrom).
- Measured with claude -p before merge.

## Measured (claude -p, --setting-sources project, stand-in kosmos logging calls)
- v1 text: work requests 4/4 filed with Done when and reported each check; control (v23) 0/4; small talk 0/2.
- v2 text (review round 1 added the existing-task case and where the number comes from):
  - work requests 11/13 filed and marked built (8 onboarding: 6/8; 2 newsletter: 2/2; 3 with an empty task list: 3/3)
  - given as task 3: 3/3 added no task, messaged the checks onto task 3, and marked task 3 built
  - small talk 1/1 filed nothing
- v3 text (review round 2 added the 200-character line limit and "run kosmos task list right after and note your number"):
  - work requests 4/4 filed with Done when, ran task list, and marked built
  - given as task 3: 2/2 added none, messaged the checks, and marked task 3 built
  - small talk 1/1 filed nothing

- v4 text (review round 3 added single quotes for a check with a backtick or $, one task between agents asked in one
  room, and work outside every project going in the reply):
  - a work request 1/1 listed first, filed with Done when, and marked built reporting each check
  - given as task 3: 1/1 added none, messaged the checks onto task 3, marked it built
  - small talk 1/1 filed nothing
  - work outside every project (a wedding toast) 1/1 filed no task; whether its reply held checks is not visible to the
    stand-in (the reply goes over stdin)
- Content test proven able to fail: a mutant ("add a task each") reds the #5152 test and the fingerprint.

## Steps
- [x] Section text, measured; rewrapped to the block's width.
- [x] Version 24, log entry, pin, doctrine-past rows.
- [x] Content test (reds on main's block).
- [x] Block-reading tests: defaults, doctrine, doctrine-4890, create*, connect-agent, discover, reports, dmfiles, identity,
      machine, team.newrole, render-talk-goldencard, server.agent-projects, windows CLI parity.

## Known gaps (named, not built)
- The agent cannot read its checks back later: `kosmos task list` shows only the task's first line; the checks are in
  its detail. An agent restarted mid-task loses them. A `task show` verb, or the editable-checks slice, closes it.
- Codex and Gemini agents not measured.
- `kosmos task add` does not print the new task's number (install/kosmos and tools/windows/kosmos-cli.js), so the
  section has the agent run `kosmos task list` right after. Follow-up for both CLIs to print it; routed to Splinter.
- tools/doctrine-past.js regenerated here drops two v21 rows that main carries; kept main's rows by hand. Worth a card.
