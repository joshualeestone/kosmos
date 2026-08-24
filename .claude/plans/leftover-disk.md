# Profile-less leftovers become visible and removable (#500)

## What finished looks like

A directory in the workers root, or a com.kosmos.agent.<name>.plist in the
LaunchAgents directory, whose name has NO profile, appears in the roster as
a not-running leftover with an honest sentence saying Kosmos has no record
of it, and can be removed from the board. A test fails against
enumeration-from-profiles-only. repair() never writes a job for a
profile-less stray.

SCOPE CORRECTION (iteration 1): the card's "its name becomes usable again"
cannot be met by removal, because remove is not delete (remove.js's first
rule: nothing on disk is deleted, ever) and create refuses a name whose
folder or job file still exists. Freeing a name held by files needs a
delete-leftover feature the product deliberately does not have. This
branch ships visibility, honest sentences that promise only what removal
does, and the follow-up card for delete-leftover; it does not quietly
build a destructive delete the night before the demo.

## Why (from the card)

The survey enumerates from profiles, so a leftover with no profile is
absent from the enumeration entirely, while create.js still refuses the
name: the name is permanently unusable and the user cannot see why. #127
(#499) closed the with-profile case with one predicate; this needs disk
enumeration reconciled against what is known.

## Changes

- engine/create.js: export WORKERS_DIR and AGENTS_DIR (additive; the walk
  must read the real roots, not derive them through workerDir, which
  consults recorded folders).
- engine/register.js survey(): union the profile names with two disk
  walks: directories in WORKERS_DIR passing NAME_RE, and files in
  AGENTS_DIR matching the com.kosmos.agent.<name>.plist shape with the
  name passing NAME_RE, in both cases only names holding no profile.
  Stray entries carry profile: false; profile-backed entries profile:
  true. Both walks fail soft to an empty contribution (an unreadable
  stray sweep leaves the profile-backed roster intact, the inert
  direction; ENOENT is a fresh machine, not an error).
- engine/register.js missing: gains the profile-backed condition, so
  repair() cannot mint a launchd job for an agent nobody registered.
  This is the one place the new rows could turn into an ACTION.
- server.js offline builder: a k.profile === false row gets its own
  because sentence naming what was found (folder, job, or both) and that
  removing it frees the name. Everything else about the row flows
  through the existing map (readProfile already returns {} for a missing
  profile; agentId and shownName fall back safely, verified by reading).

## Not changed

- remove.js: exists() already gates on job-or-folder, and #499 proved
  the removal plan viable for offline leftovers.
- create.js name refusal (:715): unchanged; removal is what frees names.
- No web change: offline rows already render because sentences and carry
  the Remove control (the #499 precedent).

## Done when

The card's done-when as corrected above, plus: the survey unit pins live
in engine/register.test.js, the route-level roster and removal-plan pins
in server.stray-removable.test.js, and the missing/repair guard has its
own failing-direction assertion.
