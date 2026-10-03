# #5161: the Assigner asks once per state of a project, and remembers across a restart

## Problem
The goal ask ("this project has no open tasks ... add up to 3 or say so in the room") came back with nothing changed.
Two installs reported it, and Feedback and Community here was asked at 14:44 and 21:20 CDT on 10-02.
- GOAL_ASK_MS (24 h) lives only in the runner's in-memory `assignerPrev`, so every board restart (release install,
  update) forgets every ask. That is the likely cause of a 6.5 h repeat.
- Even without a restart, an unchanged project was asked again every 24 h.

## Decision
- The goal ask keeps a signature of the project per ask: the goal text, each task (number, sentence, detail, closed,
  on hold, built, webhook-added, the parts' holders and closings), and the newest room post by anyone NOT on the
  project. The ask is skipped while the signature matches the last landed ask, however long ago that was. The 24 h
  floor still applies on top.
- The asked-at times and signatures persist to $ROOT/assigner-asked.json (atomic write, written only on change,
  untrusted on read: malformed, future-dated or unknown-version entries are dropped).
- An ask that did not land (COULD_NOT, a throw, a quota hold) puts the previous signature back, so a refusing pane
  never silences a project.

## Rejected
- Counting every room post as a change: the agent's own "nothing to add" answer would re-arm the ask it answered.
- A longer GOAL_ASK_MS: still re-asks an unchanged project, only less often, and a restart still resets it.

## Weakest premise
That a member agent's post is never news worth a re-ask. An agent that posts real new direction without adding a
task does not re-arm the ask. The agent could add the task itself, which the ask exists to invite.

## Known edge (accepted)
Switching the Assigner off resets its memory (step returns emptyMemory, as before), and the file then saves empty.
Switching it back on asks once per project again. That is the existing off/on behaviour, kept.
