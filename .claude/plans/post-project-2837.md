# #2837 producer half - a working agent's post carries its project

## Problem
#2837 (consumer, merged) made the project overview light a working member's tile
only when the work is attributable: the report named the project, OR the agent is on
exactly one active project. A MULTI-project working agent whose working heartbeats
name no project therefore lights NONE of its tiles (false-calm). The producer gap:
nothing NAMES which project a multi-project agent is working in. The automatic
`working` heartbeat (PreToolUse hook) carries nothing by design, and selfreport's
#763 carry-forward only propagates a project once something has named one.

## Mechanism (decided per Splinter's greenlight; reversible in a commit)
A `kosmos post <project-id>` into a project room is a TRUTHFUL signal that the agent
is working in THAT project ("the activity carries which project it belongs to"). So
on a successful `/api/post`, if the poster is ALREADY `working`, carry that project
onto its working state via `selfreport.record(who, {state:'working', project:<id>,
auto:true})`. The carry-forward then propagates the project to subsequent auto
`working` heartbeats until the agent posts elsewhere or stops.

Key design choices:
- **Only when already `working`.** The overview lights 'working' tiles, so the
  project matters only then. We NEVER force a state: an idle poster stays idle (no
  idle agent lights a tile), a needs_you/blocked poster is left untouched (posting a
  question does not claim the agent is working). This keeps the single-project common
  case (Splinter's caution) exactly as it was - verified by a dedicated idle test and
  the full suite (server.test.js was 297/0 before and after; an earlier draft that
  forced `working` reddened 10 of its tests by flipping idle agents, which is how this
  narrower rule was found).
- **Keyed on the RESOLVED project id** (`projects.get(...).id`), not the raw input,
  so it matches what the overview keys on (#763 stateProject === project.id).
- **In the /api/post ROUTE, not the shared `sendRoomPostAsAgent`** (which the outbox
  drain also calls) - so a delayed drained replay does not re-attribute a project the
  agent has since moved on from.
- **Best-effort and fail-safe.** Wrapped so a failure never changes the post's own
  verdict (the post already happened). Sender resolved exactly as /api/report does
  (`resolveAgentSender`, token-first/pane-second, with the same enforcing-board
  denyPaneFallback).

## Weakest premise (owned)
Attribution is tied to POSTS: a working multi-project agent that works in X but never
posts to X's room is not attributed (lights none, as before). Posting is the truthful
signal; silent work is not attributed. This is strictly better than before (posts now
attribute) and truthful (no guessing which of N projects). A richer per-activity
project signal is a future extension. What would change my mind: if agents routinely
work a project without ever posting to its room, a launch/assignment-time signal would
be needed too.

## Tests (mutation-verified)
`server.post-project-2837.test.js` (real server): a working poster is attributed; a
second post re-points (multi-project); an IDLE poster is NOT forced to working / not
attributed (the common-case guard); a FAILED post attributes nothing even for a
working agent; a needs_you poster stays needs_you and unattributed. The two positive
tests redden when the attribution is disabled; the three guard tests stay green. Full
suite green (6867/6867).

## Delivery / gate
Kosmos engine/server change (no web/ change, no #1720 browser-check gate). Staging-
first; prod Josh-gated. Built on current main (169c1a33, which includes #2977).
