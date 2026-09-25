# Plan: #3759, where an agent saves a file the person asks for (context-aware)

## Finished looks like
Every agent's instructions say: a file asked for in a direct conversation goes in the agent's own Files
folder (the list on its page); a file for one of its projects (named, or plainly that project's work) goes
in that project's folder even when asked for in the direct conversation, and the agent says in one line
where it put it; when unclear, it asks in one line or saves it in Files and says so. Existing agents get
the new words at the next board start.

## Why
Josh, 0.6.94 test, 2026-09-25 11:07 in #admin: agents should store files where the person asked in a direct
conversation, and be context-aware enough to put a project's file in that project instead.

## Change
- engine/dmfiles.js blockBody: the rewritten block (both destinations, the say-where line, the unsure rule).
- engine/dmfiles.test.js: the #3614 test follows the new first sentence; a new #3759 test pins both
  destinations, the say-where line and the unsure rule.

## Decided
- No DOCTRINE_VERSION bump. The files block is its own managed block (kosmos:dmfiles markers), rewritten
  for every agent by dmfiles.syncEveryone at each board start (server.dmfiles-refresh-3614.test.js), so the
  new words reach existing agents at the next start by themselves. A doctrine bump governs the separate
  defaults block and would re-offer its sections to every agent for no change of theirs. Rejected: also
  re-syncing live on release; the boot sweep is the existing path and a release restarts the board.
  Weakest premise: that the card's "version bump" meant "make sure existing agents get it" rather than
  the doctrine number specifically.
- Running agents read the new words on their next start (they read instructions at start), which the
  release note should say.

## Measured (real agent runs, claude -p, sandboxed agent folder with this block and one project)
- "a packing list as a file" (direct ask): saved in the agent's Files folder, said so.
- "For the Henderson lease, a summary as a file": saved in the project folder, said which project and name.
- "an email to my landlord about renewing" (project not named): saved in the Henderson lease project,
  said so (context-aware, as asked).
- Control, main's old wording with the Henderson ask: also saved in the project in this run. So the old
  words already handled a clearly named project once; what this adds is the rule stated outright, the
  say-where line, and the unsure rule. One run each, not a rate.
