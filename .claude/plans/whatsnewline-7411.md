# whatsnewline-7411: agents' working rules name `kosmos whats-new` (kosmos#7411, follow-up 1)

## Problem
#7411 (merged as PR #7477) gave both CLIs `kosmos whats-new`, which prints the release notes since a version and
says which fixes need an agent restarted. Nothing in an agent's instructions mentions it, so an agent asked "what
changed in the update?" has no way to know the command exists.

## Decision
One short paragraph in the working-rules block (engine/defaults.js), at the end of "Kosmos itself is not yours to
edit", right after the line on updating Kosmos: run `kosmos whats-new` for the newest version's notes, or
`--since <the version you were on>` for every note after it; a note marked for it says the fix needs a restart, and an
unmarked one says nothing either way (review: no note carries the restart mark yet, so absence must not read as "no
restart needed"). DOCTRINE_VERSION 42, logged with its weakest premise; the fingerprint
pinned in engine/defaults.test.js; engine/doctrine-past.js regenerated (tools/doctrine-past.js), so an agent holding
an unedited copy of 41 is offered 42.

No new heading, so (as with 32 and 41) an agent's edited copy of that section is not re-offered it.

Rejected: a new section (the block is read whole by every agent; four lines beside the update sentence is where it
is read in context).

## Tests
The test files that name defaults or doctrine (20 files, 564 tests) pass; they red until the version, its log line, the fingerprint and the past
table move together (measured: 3 red before the bump, 1 before the pin).
