# #7367: a damaged projects file must not silence every room

**Posture:** production

## Problem
#7185 (engine/projectborn.js) hides room and task rows stamped before their project's createdAt, so a deleted-and-re-made
project does not read its predecessor's words. It failed CLOSED: with the projects file unreadable or unparseable,
every project-tagged row was hidden, and messages.sendPostWithDelivery, react and freeClaim refused with "we could not
read this room right now". One torn file (a crash can leave a JSON store all-NUL on Windows) therefore stopped every
agent talking, where before 0.7.70 it only broke the Projects page.

## Change
- projectborn: when the file exists but cannot be read or parsed, `ok` is false and `earlier()` is false for every row
  (fails open, the pre-#7185 behaviour). The unreadable answer is cached against the file's stat for 5 s only
  (UNREADABLE_KEEP_MS), so a passing read error on a good file is retried rather than kept until the file changes.
- messages.sweepUnanswered does nothing while the stamps are unknown: it ACTS on rows (types a nudge, writes a row),
  and would otherwise nudge about a deleted project's never-answered ask.
- messages.record(): `ok` reflects the LOG only; `stampsUnknown` still reports the projects file. The three refusals
  go. lastPostAt no longer answers undefined for unknown stamps.
- receipt: still never keeps a receipt from a read made with unknown stamps (unchanged code, comment updated).
- taskchat / taskseen: comments only (they read through olderThanProject, which now keeps rows).

## Accepted cost
While the projects file is damaged, a re-made project's predecessor rows show again. Showing a room is better than
silencing every room; the Projects page reports the damaged file. Also accepted (pre-#7185 behaviour, narrow): the
"which room did you mean" check and the room valve count a deleted project's posts from the last hour while the file is
damaged, so a project deleted and re-made within the hour of the damage can see one extra hold. Likewise the #4580
fold: a post identical to the same sender's post in a deleted same-id project, inside the fold window, reads as a
retry of it while the file is damaged. And a reaction or freed claim given a deleted same-id project's post id writes its
row against that post (orphaned and unseen once the file reads again). And the room's "no reply yet" markers (server.js,
from unanswered()) are not drawn while the file is damaged: unanswered() answers nothing then, because the sweep acts on
it; a missing marker is a display loss for the length of the damage, never a wrong nudge.

## Readers that ACT on or KEEP rows: gated while the stamps are unknown
receipt keep (before and after its read), messages.sweepUnanswered and unanswered(), undo.plan (before and after its
read; apply plans through it), holdstale.owed. Loops over projects.readAll() are gated naturally while the file is
truly damaged (it throws).

## Tests
messages.test.js: for an all-NUL file and a truncated file, a room post is PLACED and the room reads whole, with a
good-file control post; a reaction lands and a freed claim answers the same as with a good file. taskchat.remade-7185:
the unreadable case now shows the rows and reports stampsUnknown.

The sweepUnanswered gate is defensive: unanswered() (which every nudge goes through) carries the load-bearing gate and
its own test; the sweep's gate saves the per-project reads and is kept for that.

## Review rounds (blind challenge loop, fleet cap 8)
- Round 1: no blocker. [WARNING] a passing read error was cached until the file changed --> FIXED: 5 s, test with a repaired control. [WARNING] no test of recovery after repair --> FIXED: damage/repair test. [NIT] freed-claim test frees no real claim --> ACCEPTED. [NIT] "can only show rows" understated: the unanswered sweep acts --> FIXED: sweep gated.
- Round 2: no blocker. [WARNING] the sweep gate had no test --> FIXED: test with repaired control. [NIT] which-room/valve count a deleted project's last hour --> ACCEPTED (plan). [NIT] record() early returns lacked stampsUnknown --> FIXED. [NIT] plan out of date --> FIXED.
- Round 3: no blocker. [WARNING] the sweep's second read (unanswered) ungated --> FIXED. [WARNING] undo could plan from a deleted task's edits --> FIXED: undo.plan gated, test. [NIT] externalKeptOn comment --> FIXED.
- Round 4: no blocker. [WARNING] hold-stale sweep acts on unfiltered rows --> FIXED: owed() gated, test. [NIT] undo re-check after read --> FIXED. [NIT] #4580 fold --> ACCEPTED (plan).
- Round 5: no blocker. [WARNING] hold-stale timer read rows without their stamps; owed had no after-read check --> FIXED both. [NIT] reaction/claim rows on a deleted project's post --> ACCEPTED (plan).
- Round 6: no blocker. [WARNING] unanswered() gate and the after-read gates had no test reaching them --> FIXED: direct and mid-read tests, each failing without its gate.
- Round 7: no blocker. [WARNING] receipt keep gate untested --> FIXED: damaged and mid-read tests. [NIT] unanswered markers hidden while damaged --> ACCEPTED (plan).
- Round 8: no blocker. [WARNING] the before-read gates (holdstale, undo, receipt) had no test that fails without them --> FIXED after the round: "unknown at entry, repaired mid-read" tests, each verified to fail with only its before-gate removed. NOT re-reviewed (cap reached). [NIT] sweep gate redundant --> ACCEPTED, documented as defensive.
