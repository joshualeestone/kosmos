# restartline-7411: kosmos#7411 step 4, the restart line

**Card:** kosmos#7411 step 4. Design: Baron's comment 6471642685; approved with four changes by Mona Lisa
(comment of 2026-10-28 10:5x CDT). Not built before that review.

## What finished looks like (from the person's side)

After an update, if a release note marked `restart: "agents"` landed since the version before, a line in the floating
notice stack names the running agents that started before this version: "Ada, Kai and 3 more need a restart to get:
<title>." and, once, "Restarting stops what they are doing now." Restart all and Show who on the line (each agent its
own Restart in the list), Not now hides it until the next update. It goes by itself once nobody named is on an old
session. Kosmos never restarts anyone by itself.

## Pieces

1. `engine/restartline.js`: `atStart(version)` adds each new version and its first board start to a history in
   version-start.json (the last 50); `markedNotes` gives each marked fix the moment it reached this computer (the
   first start of the latest run that went from below its version to it or above); `lineFor` names agents started
   before a fix they lack; `notNow(version)`.
2. `engine/status.js`: `sessionStartsAsync()`, every session's start in one list-sessions read.
3. `server.js`: `atStart` at boot (beside restartnote); `GET /api/restart-line` (roster + session starts + release
   notes, agents named by readIdentity as #7430 does); `POST /api/restart-line/not-now` (409 for an old page's version).
4. `web/index.html`: `#rline-slot`, `paintRestartLine`, `rlineClick`, `restartLineCheck` (on load and each minute).
   Restarts go through the ordinary `/api/agent/<name>/restart`, one at a time, reading the outcome with `restartTook`.
5. Tests: engine rule, route through fleet.install and the session seam, page words and markup, browser check
   `render-restart-line-7411.js`, design-shot screens in mobile-shots.js.

## Decisions

- One agent: one button named for it ("Restart Ada"), no list. Rejected: Restart all plus Show who for a list of one.
- No line when tmux, the roster or the notes cannot be read. Rejected: guessing (it would name agents that are fine).
- An agent whose session started in the same second as the board counts as after it (tmux is whole seconds).
- Not now is recorded against the version on the board, so an old page cannot hide a newer update's line.
- Each fix keeps its own moment, so a second update before the agents restart does not forget the first one's fix.
  Rejected: comparing only against the version before (it forgot an earlier update's fix, review round 4).
- A rollback below a fix and back up counts from the update back up (agents started during the rollback lack it); a
  rollback that stays below a fix says nothing for it, since the running version does not carry it.
- The first start with no record seeds the version before from the page's What's New record (seen-version.json), so
  the update that ships this file speaks for its own marked fixes. No such record means a true install: silent.
- Known limit: the history keeps the last 50 version changes; past that, a fix whose run started before the oldest
  kept entry goes silent (it fails quiet, never naming agents wrongly).
- Kosmos versions are x.y.z only (releasenotes.js holds the same rule); anything else records nothing.

## Weakest premise

That a version's first board start is when agents stop missing its fixes. An agent restarted during the update window
but before the board came back reads as old and is named once; a restart clears it.

## Known cost

Restart all calls the ordinary per-agent restart route one agent at a time, and that route drives the restart on the
board's thread. Five agents are five of those back to back, as five presses of Restart would be. A follow-up could move
the route to removal.restartAsync; it is not this card's change.

## Not in this branch

Marking any pool item `restart: "agents"`: none carries it yet, so the line shows nothing until the first one does.
