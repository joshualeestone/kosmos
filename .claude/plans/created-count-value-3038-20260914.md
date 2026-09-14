# #3038 (app-side) -- the create beacon sends a MONOTONIC created count, not the running roster

**Branch:** `created-count-value-3038`
**Card:** kosmos#3038 (app-side value fix; Splinter reassigned after Angel's #3068 beacon-restore merged)

## The bug (Josh, live; diagnosed by Baron + Splinter)
The homepage "agents created" count undercounts (Josh created 30+; it showed ~103). Baron PROVED
the pipeline + the site side (chaoskosmos-site counts.js/created.js) are correct: POST count=50 to
live /api/created grew agents by exactly 50. So it is NOT a deploy/server bug -- it is the VALUE
the app sends. The create beacon sent `roster.length + (alreadyListed?0:1)` (server.js:~4484) =
the RUNNING roster (safeRoster), and the server keeps `Math.max(existing, count)` -- so the number
FROZE at peak-running and a created-but-stopped agent never grew it. "Agents created" must count
CREATIONS.

## The fix
- **engine/create.js:** add `createdCount()` = the count of birth-log (`created.jsonl`) entries with
  outcome CREATED or PARTIAL (excludes REFUSED = nothing made, and UNKNOWN). This is the SAME
  "created or partial line is the tie" interpretation register.js already uses to decide an agent
  was ever made on this install. Exported.
- **server.js:** the create beacon now sends `create.createdCount()` instead of the running roster;
  removed the now-dead `safeRoster()`/`alreadyListed` lines and updated the stale comment. The
  just-created agent's birth is already in the log by the time this runs (recordBirth is inside the
  create), so the count includes it; the server's Math.max then tracks the true total.
- **engine/create.test.js:** a test that a CREATED grows createdCount by exactly 1, a REFUSED does
  not, and createdCount matches the created+partial birth-log entries.

## Verified
- On the REAL install's `created.jsonl` (19 lines: 9 created, 1 partial, 9 refused): `createdCount()`
  = **10** (created+partial), while the running-roster approximation was ~0 here -- exactly the
  undercount the old beacon produced. The new count is monotonic and excludes refusals.
- 178/178 tests pass, including Angel's #3038 sibling tests (createdbeacon-3038, the route test's
  `count >= 1` still holds) -- no sibling breakage. Nothing else pins the removed roster logic.

## Weakest premise / disclosures
- **The birth log only covers births since #157 shipped.** Agents created before the birth log
  existed are not in `created.jsonl` and cannot be counted here -- but the OLD code (running roster)
  captured them even less, so this is strictly better. An install that predates #157 may still show
  a total below its true lifetime creations; not fixable retroactively from the app.
- **PARTIAL is counted** (with CREATED). A partial creation made SOMETHING (folder/profile), and
  register.js treats a partial line as proof an agent was made. If the product wants "fully created
  only," drop PARTIAL -- a one-line change; I judged created+partial correct per register.js's
  established interpretation + Josh's "record of the number of agents [made]."
- Baron's separate 515 display floor (blocked on a Josh vercel re-auth) is a stopgap for the pitch;
  THIS is the real fix so the number grows correctly. They are independent.
- Verifying by creating a real agent on this box has launchd/tmux side effects; I verified via the
  real `created.jsonl` read + the sandboxed create.test.js harness (which does real creates) instead.

## NOT in scope
- The site side (counts.js/created.js) -- proven correct by Baron.
- The install-count ping (count 0) -- unchanged.
