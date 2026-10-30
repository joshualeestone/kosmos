# msgto-7408: `kosmos task message --to <agent>` tells agents besides the assignees (#7408)

## Why
An outside user's ruling, posted on an unassigned task, reached nobody, and the command's answer did not make that
obvious (#7408). Measured on main: the "say nobody was told" half already ships since #4540 ("Nobody is assigned to it,
so no agent was told."). Missing: a way to name who to tell.

## Call
- The task message route takes `to`: 1 to 10 agent names (each at most 64 characters), each an agent on the project,
  matched exactly, else by store key when exactly one agent on it has that key (an agent stored under its key). A name
  two agents share by key, and names not on the project, are refused together, before anything is recorded.
- Named agents are told as assignees are (same notification, same rails, `delivered` says each outcome); an assignee
  named again is told once; the sender is never told; an agent switched off in the project is said as not told.
- Any sender may use it, the person at a terminal included (no token, no pane the board knows: the card's own case).
  What bounds a looping sender is the shared hourly task-message limit, which now costs one per message plus one per
  agent `to` adds (not an assignee, not the sender). One count serves the check and the record; it is recorded right
  after the message is, before any delivery is awaited. A message with `to` gets its own refusal words and the wait
  for its own cost (rounded up, at most the hour), or "can never fit" with no retry time when its cost exceeds the
  whole limit; it offers "name at most N agents" only while the message itself still fits. The words say what the count
  holds (messages, and the agents they named) and that the limit is shared by all agents. A screen claim carrying `to`
  is refused: the screen names nobody.
- Both CLIs (install/kosmos, tools/windows/kosmos-cli.js): `--to <agent>`, repeatable, before the words (`--` ends
  options). On a task nobody (else) holds they add "To tell an agent anyway, name it: --to <agent>." An older board
  that ignores `to` is detected (no `to` in its answer) and said, exit 0 because the message was recorded.

Rejected: refusing `to` from a sender the board cannot name (round 2): it shut out the person at a terminal, the
card's own case (round 3 reversed it). Counting `to` only after sending (round 3): one message could pass a small limit
by its whole list (round 4). Padding the plain limit with the list (round 4): its sentence then quoted sends that never
happened (round 5).
Weakest premise: one recipient-weighted count is the right bound for `to`; a looping sender is held to the same hourly
total as before, now counted per agent reached.

## Evidence
- cli.task-message-to-7408.test.js (16 tests, real board and task engine, both CLIs where a CLI is involved): nobody
  assigned says so plus the hint; --to reaches the named agent from either CLI; an assignee named again is told once and
  the sender never; bad --to shapes refused before anything is sent; a name not on the project refused and nothing
  recorded; an older board said; the route answers the names it took; key match; any sender may use it and each agent
  it adds is counted (CONTROL: an assignee costs nothing); ambiguous name; missing project; the limit counts the list
  before sending, the screen-claim arm, the edge with an assignee, never-fits (unit and end to end), at-limit words.
- Related set (the 25 test files that touch task messages or the limit): 1094/1094 before the rebase onto main.
- Mutants, each confirmed applied, each turned the expected test red: `to` dropped from delivery; key match removed;
  the 403 for unnamed senders removed (round 2, since reversed); the valve counted once; ambiguity folded into not-on;
  the pre-count removed; the screen exemption restored; an assignee counted; never-fits removed; the plain limit
  answering first at the limit; the wait taken from the oldest entry; "name fewer" offered at the limit.

## Review
- Round 1: an older board ignoring `to`; the route answers the names it took; a sender naming only itself hears
  "Nobody is assigned"; tests read `delivered`. Fixed.
- Round 2: key-stored names refused; an unnamed sender widened to the project; tests could pass with nobody told.
  Fixed (the unnamed-sender part reversed in round 3).
- Round 3: the hint led unnamed senders into a refusal; `to` multiplied the limit's reach. Fixed together: any sender
  may use it, each agent counted. Ambiguous names and a missing project now refused.
- Round 4: the check counted one while the record counted more; a screen claim with `to` was never limited. Fixed.
- Round 5: check and record disagreed for an assignee; the refusal sentence counted placeholders; sends awaited
  delivery before being counted. Fixed.
- Round 6: at the limit a `to` message was quoted one slot's wait; older-board wording false for a named assignee;
  nits (plural, "adds", cap 0 with `to`, both refusals in one answer, C1). Fixed.
- Round 7: no blocker. W: the limit's sentence called its entries "task messages"; never-fits hid its arithmetic; the
  `to` words did not say the limit is shared; the wait was untested to the second. Fixed (a separate count of messages
  for the words; a seeded test pins the wait). Nit taken: no screen tail for a message that names agents.
- Round 8: CONVERGED, no blocker. W: at the limit, "name fewer agents" cannot help: now only the wait (test, mutant).
  Nits taken: cap 1 says "send it without --to"; clearer cap-0 words; a screen claim carrying `to` refused (it was
  limited); the CLI test counts otto once. Loop ends here (8-round cap).
