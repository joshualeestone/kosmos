# Plan: #2497 follow-on, manual-import pointer on the first-run Giddy Up welcome

## Context
#2497 (Angel, PR #2507, merged as d01abdff) changed onboarding so every first run lands on the
no-agent "Create your first agent." / Giddy Up welcome, before any disk scan, whatever the machine
has. Real agents now come in only via the manual Import Agent (#1652) on the Create Agent screen.

## Problem this branch solves
A user who already runs agents in Claude Code or Codex now lands on that bare create welcome with no
signal that (a) Kosmos is deliberately choosing not to import them, and (b) they can still bring one
in by hand. Without a word, that user asks "where are my agents?" one screen later, the exact
confusion #2497 removes, reappearing.

## The change (copy only, no behavior)
Add one quiet sub-line under "Let's get started." in `frPaintFleet` (web/index.html), styled as the
muted `.dhint` hint:

> Already have agents in Claude Code or Codex on this Mac? You can bring one into Kosmos from the
> next screen, under Import.

It is the design/copy spec drafted on the #2497 card (Mona Lisa). It is a POINTER, not a scan: it
lists nothing and finds nothing, so it does not reintroduce the auto-import garbage the card removed.
The Giddy Up action and the title are unchanged.

### Decision recorded (reversible)
Providers are NAMED ("Claude Code or Codex") over a generic "agents already on this Mac" line. It
tells a non-technical person exactly what counts as importable. This is my recorded recommendation on
the card; trivially reversible to generic if Josh prefers it. Per Josh's ruling (make the call,
implement, he can undo), no operator block.

## Guards
- `web.firstrun-panecount-9screen.test.js`: a source-match presence guard on both halves of the
  pointer (phrases chosen to sit within one string-concat fragment) plus its `.dhint` shape.
  Control-proven: the phrases are absent on origin/main, so the guard reddens without this change.
- `docs/browser-checks/render-first-run.js`: an `expectBody` field on the `firstrun-fleet-create`
  case asserts the pointer actually RENDERS in the `#fr-fleet` box, read the same way the existing
  headline check reads the title. This also satisfies the #1720 browser-check gate by touch.

## Out of scope
- The behavior change itself (#2507, merged).
- The email/Gmail door and any other #2497-adjacent copy.
