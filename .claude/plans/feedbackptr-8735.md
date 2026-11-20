# feedbackptr-8735: #8735 slice 3, item 3 (the daily feedback routine)

Proposed on kosmos#8735 (comment 7027148803) before building.

## Why
"Once a day: help make Kosmos better" (about 1,650 characters) is in the Project Manager role only (`engine/roles.js`),
and since #7374 the board types the whole routine into one agent a day, Project Manager first
(`engine/feedbacknudge.js` nudgeText): the questions, the commands, the names and secrets rule. Two copies of one fact.

## Change
- `engine/roles.js`: the PM section keeps that the ask comes (PM first) and is about Kosmos itself, "when it asks you,
  do it", the no usernames / agent names / project names / secrets rule (safety text, as slice 1 kept the community
  safety rules), and the sent-to-the-team sentence. The questions and commands go.
- `engine/feedbacknudge.js`: question 4 takes Josh's #3563 wording in full ("what went well, what was bad or ugly, how
  tasks are being used, and anything that is stuck. Describe tasks, do not count them: no task tallies, and no task
  titles or what a task says"), since the ask is now the one copy; it had a shortened form. Comments updated.
- `engine/feedback-triage.js`: FORM_QUESTIONS is now held equal to the ask, not roles.js (comment and test).

## Tests
`roles.feedback-2037b.test.js`: the PM brief is pinned on what it keeps; #2037's questions and #3563's wording are
pinned on nudgeText; the PM-only sweep keys on the section heading, with its control. `feedback-triage.test.js`: the
drift check reads nudgeText. Perturbed: "bad or ugly" removed from the ask -> red; the names rule cut from the brief
-> red; restored -> green.

## Measured
pm brief 51,610 -> 50,365 (1,245). Other roles unchanged; director is 49,337, so the next slices must cut across roles.

## Decided
A report now exists only when the board's ask reaches an agent. Before, a PM could also write one on its own initiative,
so these cases lose it (review 1 listed them from feedbacknudge.js plan() and makeTick()):
- sending switched off, or its setting unreadable: nobody is asked;
- the operator brake AGENT_WORKFORCE_FEEDBACK_NUDGE_OFF, or live execution not yet allowed;
- a board that is closed every evening (the ask goes at NUDGE_HOUR, 17:00 local, or later);
- every agent that worked is busy at every tick, or quiet hours cover the evening;
- every delivery refused for MAX_TRIES ticks.
Taken because #7374 exists for exactly this: its telemetry (8 installs in 7 days sent nothing) shows the PM's own
initiative rarely produced a report, and the ask is the mechanism that does. The PM brief now says the ask comes "while
sending is on", so it is true on every install.
Local triage (`kosmos feedback triage` with no pulled folder, engine/feedback.js) does read this computer's own reports,
so an install with sending off that triages locally loses them. Kept anyway: that install chose not to send, the ask
would not run there either way after #7374, and the fleet's own triage reads pulled reports from installs that send.
What would change my mind: a person who runs local triage with sending off. Rejected: a `kosmos feedback --how` verb (a
third copy of a routine the board already delivers).

## Review 1 (Opus)
- BLOCKER fixed: three test files I had not run pinned removed PM text (defaults.platform-8506, feedbackday-7875,
  cli.feedback-unchanged-8269). Found every test reading a removed phrase and ran each; exactly those three failed.
  #8506's per-platform form now lives in the ask on every platform, so its test pins that and that no PM brief names a
  feedback command; #7875 and #8269 keep their ask halves.
- WARNINGs answered in Decided above (the full list of lost cases; the local triage reader).
- NIT fixed: the brief says the ask comes "while sending is on". pm now 50,321.
- NIT kept: "a note about the product, not about who did what" and "the value is never what makes the report useful"
  are dropped; the names and secrets rule stays in both places.

## Review 2 (Sonnet)
- BLOCKER fixed: my round 1 claim "exactly those three failed" was false. Two more failed:
  - feedbacknudge-7374's "the role and the ask agree that the report is sent" test. My round 1 rewording broke it, and I
    had not re-run that file. The brief says "sent to the Kosmos team (scrubbed)" again.
  - The Windows verbs parity sweep. It read the feedback verbs from the PM role only, so moving them left the daily ask,
    now the one text that teaches them, unchecked. The ask is in the sweep, and its control now requires `feedback
    write` to be read from the ask.
- Then ran every test file that loads roles or feedbacknudge, or mentions `kosmos feedback` (39 files) one by one. Only
  two failed, and both fail the same way on main when run outside the checkout's root (web.role-picker reads
  web/index.html by a relative path; server.test's #1304 probe resolves engine/ from the cwd); full validation runs them
  from the root.

## Review 3 (Opus)
- No BLOCKER. Ran the 13 test files that read the removed text or the ask, from the worktree root: all pass.
- WARNING fixed: the size ceiling is lowered to 50,400 (pm 50,322), with the slice 3 figure in the test's header. It
  will conflict on that line with slice 2 (#8774, 48,900); whichever merges second takes the lower measured figure.
- NIT fixed: no role, the PM included, may teach `kosmos feedback write` (the ask is its one teacher), with the ask as
  the control. Perturbed: the verb added to the director role -> red.
- NITs kept: the sending-off trade-off is recorded in Decided; "first" means first among agents that worked (#8572),
  which is fine for a brief; feedback-triage.test.js:200's comment about how roles.js wrapped the question; a long line
  in feedbacknudge.js's header.
