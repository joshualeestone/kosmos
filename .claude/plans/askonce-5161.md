# #5161: the Assigner asks once per state of a project, and remembers across a restart

## Problem
The goal ask ("this project has no open tasks ... add up to 3 or say so in the room") came back with nothing changed.
Two installs reported it, and Feedback and Community here was asked at 14:44 and 21:20 CDT on 10-02.
- GOAL_ASK_MS (24 h) lives only in the runner's in-memory `assignerPrev`, so every board restart (release install,
  update) forgets every ask. That is the likely cause of a 6.5 h repeat.
- Even without a restart, an unchanged project was asked again every 24 h.

## Decision
- The goal ask keeps a signature of the project per ask: the goal text, each task (number, sentence, detail, closed,
  on hold, built, webhook-added, the parts' holders and closings), and who is on the project (sorted). The ask is skipped while the signature matches the last landed ask, however long ago that was. The 24 h
  floor still applies on top.
- The asked-at times and signatures persist to $ROOT/assigner-asked.json (atomic write, written only on change,
  untrusted on read: malformed, future-dated or unknown-version entries are dropped).
- An ask that did not land (COULD_NOT, a throw, a quota hold) puts the previous signature back, so a refusing pane
  never silences a project.

## Rejected
- Room posts in the signature (built first, removed after review 1). Counting every post: the agent's own "nothing to
  add" re-arms the ask it answered. Counting only non-members' posts: the person's "ok, thanks" re-arms it one step
  later, and a failed message-log read (readLog drops record()'s ok flag) changes the signature and causes an ask.
  A person's room post already reaches the project's agents, so a re-ask adds nothing to it.
- A longer GOAL_ASK_MS: still re-asks an unchanged project, only less often, and a restart still resets it.

## Weakest premise
That new direction worth an ask arrives as a task, a goal edit, or a new member, not only as a room post. Direction
given only in the room does not re-arm the ask; it is delivered to the agents in the room already.

## Review 1 (opus, blind)
3 WARNINGs: (1) a failed log read re-armed the ask; (2) the person's reply re-armed it; both FIXED by removing room
posts. (3) person actions outside the signature silenced a project with no time limit: FIXED for membership (sorted
agents in the signature, pinned). ACCEPTED: an edit to BRIEF.md outside the Goal section (the ask quotes only the
goal), and an un-pause of a project already asked in the same state (nothing about the ask's subject changed).
NITs: builtAt is redundant (a built task is open, which blocks the ask); readLog cost moot now.

## Known edge (accepted)
Switching the Assigner off resets its memory (step returns emptyMemory, as before), and the file then saves empty.
Switching it back on asks once per project again. That is the existing off/on behaviour, kept.
