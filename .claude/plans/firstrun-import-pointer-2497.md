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

> Already have agents in Claude Code or Codex on this computer? On the next screen you can import
> an existing agent.

(Wording notes: the app says "this computer", never "this Mac", per Josh's #1004 ruling enforced by
engine/machine.test.js OTHER_SPEAKING_FILES; and the second clause avoids the literal string "already
have", which the adopt-path fleet guard server.test.js:5557 forbids in the fr-fleet box to catch old
fleet-counting copy.)

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

## Known limitation (accepted, decided in-lane per Josh's reversible-call ruling)
The pointer says a user can import an agent on the next (Create) screen. That import control
(`#pick-import`, web/index.html:9069) is gated on `OWN_ROLE`, which `loadRoles` sets from
`/api/roles` `data.own` (29172); when that local fetch fails or the engine does not serve the
`own` role, both `#pick-import` AND `#pick-own` are hidden (29242/29245), so there is no way to
bring in an existing agent and the pointer over-promises for that one user.

Call: ACCEPT the narrow over-promise rather than gate or soften. Reasoning:
- Happy path is accurate, and it is essentially every real first run: a fresh install ships the
  current engine (which serves `own`) and `/api/roles` is a LOCAL call, so `OWN_ROLE` is populated
  once the user reaches the Create screen.
- The degraded state SELF-EXPLAINS: when `/api/roles` fails, the Create screen renders an explicit
  error ("We could not read the list of roles, so there is nothing safe to choose from", ~29196),
  so the user is not left silently hunting for a missing option.
- Rejected GATING the sub-line on `OWN_ROLE`: infeasible at render time. `OWN_ROLE` is null when
  `frPaintFleet` paints the welcome (it is set only by `loadRoles`, which runs on the NEXT screen
  via `openCreate`; the boot fetch at 42107 does not set it). Making the welcome depend on an async
  roles fetch is a behavior change in Angel's lane and would only guard a rare, self-explaining state.
- Rejected SOFTENING to "bring one in by hand": does not fix it. When `OWN_ROLE` is null, `#pick-own`
  is hidden too, so the manual bring-in path is equally absent; no copy-only wording is true there.
- Weakest premise: that the degraded state is rare enough and self-explaining enough to accept. If
  it proves to matter, the reversible follow-up is Angel gating the sub-line on a boot-loaded roles
  signal, or the create screen offering a fallback import path when `OWN_ROLE` is null.

## Out of scope
- The behavior change itself (#2507, merged).
- The email/Gmail door and any other #2497-adjacent copy.
