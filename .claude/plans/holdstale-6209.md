# holdstale-6209: an owner still working a held task in its room is asked about the hold (#6209 part 3)

## Problem
From a user's report: a task stayed on hold for days while its work went on in the project room between the person
and two agents, and nothing told either agent the task's state no longer matched. Parts 1 and 2 of #6209 are Angel's.

## Decision (reversible)
Signal: the task's own owners (tasks.whoOf) posting in that project's room after the hold was set. At least MIN_POSTS
(3) posts by the owner since the hold, and the hold at least MIN_AGE_MS (2 h) old, so a hold set mid-conversation is
not flagged at once. Each such owner gets ONE line per hold, typed into its session like the missed-run tell: the
task, when it was put on hold and by whom, how many times it posted in the room since, and `kosmos task unhold
<project> <n>` (or, for the person's own hold, to ask the person, since only they can lift it), else to say on the task
why it stays held.

Rejected:
- matching "task N" in the room text: there is no existing matcher, agents and the person often do not name the
  number, and the reported case did not need it;
- lifting the hold automatically: a hold is often deliberate (the person's especially);
- a note in the agent's instructions only: refreshed with the instructions, not a prompt, which is what was missing.

## Change
- engine/holdstale.js: owed() (pure but for the task history it reads), tellText(), markTold() (holdStaleTold per owner
  on the task, and a hold-stale event in the task's history), sweep() with missedtell's gates (live execution, the
  brake, Agent Communication's hour, idle for a minute, one line per owner per pass, MAX_TRIES).
- server.js: its own minute timer; reads the message log only when some open task is on hold.

## Weakest premise
That an owner posting in the room means the held task's work is going on. An owner busy with another task in the same
project would be asked once per hold about one it is not working; the line says "if its work is going on" and names
the way to keep it held, so the cost is one line. The number (3 posts, 2 h) is a judgement, not measured.

## Tests
engine/holdstale.test.js: told once with the right words; controls (2 posts, posts before the hold, another room, a
non-owner, a young hold, a paused project, a closed task); the person's hold asks the person and names no command; a
new hold is told again; held while the owner is busy or typing is off; the server timer is wired with the same gates.
Mutating the paused, closed, post-count and person gates each reds a test.
