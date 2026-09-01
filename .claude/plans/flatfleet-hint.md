# flatfleet-hint: remove the org-chart flat-fleet hint

Josh, 2026-08-31 (via Splinter): remove the flat-fleet hint on the org chart, keep the
unplaced branch, and adapt the comment's reasoning rather than just deleting the string.

## What changed (web/index.html, paintOrg)
- Removed the flat-fleet hint ("Assign agents to each other to create a hierarchy.") that
  rendered when at least one agent existed and none had a reportsTo.
- Removed the now-unused `anyManaged` check (its only reader was the hint).
- Kept the `unplaced > 0` branch ("One or more agents could not be placed...").
- Replaced the flat-fleet comment with one that records WHY the hint is gone, so a future
  reader does not re-add it, and why the unplaced branch is different and stays.

## Why remove it
It is a self-clearing first-run hint: it renders only when agents exist but none report to
anyone, and disappears the moment any agent gets a reportsTo (never on a fresh empty board).
Josh's read: the org drawing already shows the cause (one ring = nobody reports), so the hint
only added the action, and a flat fleet is a legitimate way to run this, not a chore to nag
about. Removing it loses nothing that persists. History kept in the comment: the line was
cut to the action alone on 2026-08-22, and to nothing on 2026-08-31.

## Deliberately not changed
- The `unplaced` branch stays: "could not be placed" is a real state the drawing cannot show
  on its own, unlike the flat-fleet case which the ring already tells.
- The empty-board note ("No agents set up in Kosmos yet." / "Looking...") is a different note
  earlier in paintOrg, untouched.

## Verification
No logic change beyond dropping the note string and its guard. paintOrg parses; no test
references the hint text or `anyManaged`. Em-dash clean.
