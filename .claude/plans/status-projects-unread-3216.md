# status-projects-unread-3216 -- projectsUnread in /api/status counts (#3216)

## Problem
#3216 (Josh 6.74, nav badges): the cross-tab Projects nav badge is stale on the Agents tab
because p.unread only refreshes via the visibility-gated projects poll. The always-polled
/api/status counts (total/needsYou/needsYouUnattributed) carry no projects-unread, so a live
Projects badge has nothing fresh to read. This is the ENGINE half; Mona owns the client
(branch nav-badges-tree-fit) and wires the badge.

## What finished looks like
/api/status counts carry `projectsUnread` = the RAW sum of DM-unread across ACTIVE (non-archived)
projects, refreshed every tick, one derivation with the client's pjDmTotal.

## Change
- `engine/status.js`: new pure exported `projectsUnreadTotal(projects, unreadMap)` -- sums
  `unreadMap[p.id]` (finite > 0) over non-archived projects; null unreadMap / non-array projects /
  garbage rows -> 0.
- `server.js` /api/status handler: `counts.projectsUnread = projectsUnreadTotal(projects.readAll(),
  messages.unreadAll())`, in a try/catch -> 0 (never 500s the status read).

## One derivation with pjDmTotal (verified against origin/main)
- Client pjDmTotal (web/index.html:37127): sum over `active` of `Number(p.unread)` finite>0,
  excluding PJ_CURRENT. `p.unread` = server withUnread() (server.js:2264) = `messages.unreadAll()[id]`.
- `active` = projects.list(roster) split by archived, and list(roster) = readAll().map(describe)
  (projects.js:1137, a 1:1 map, no drop), with describe setting archived from the same p.archived.
  So `readAll().filter(!archived)` == the client's `active` set (sub-projects included).
- So server `projectsUnread` and client pjDmTotal sum the SAME map over the SAME set. The only
  difference is the PJ_CURRENT exclusion, which stays client-side.

## Option (i), agreed with Mona
Server sends the RAW active total; the client does `max(0, projectsUnread - (PJ_CURRENT ?
pjById(PJ_CURRENT).unread : 0))` in tick() for exact pjDmTotal parity. The server cannot know
PJ_CURRENT (client UI state), so an honest server field is the raw total; (ii) accept-overcount was
rejected (visible badge glitch while reading a room).

## Perf note (flagged to Mona)
Adds one messages-record pass (unreadAll, single pass) + one projects-file read (readAll) per
/api/status tick. /api/status runs only while the dashboard is open, and the projects poll already
pays both. If a large record ever makes this heavy, memoize unreadAll with a short TTL -- does not
change the field or option. Not doing it now (no evidence it is heavy; premature).

## Scope
- No web/ change here (Mona's client half is separate), so the browser-check gate chain does NOT
  fire -- verified both gates exit 0.

## Test plan
- `node --test engine/status.projects-unread-3216.test.js` (9 tests: sum, archived-exclude, raw,
  missing-id, non-finite/<=0 -> 0, null map -> 0, non-array -> 0, garbage row skipped, empty).
- Full node suite green. Merge-as-green (Kosmos, no human reviewer). Then Mona rebases + wires.

Addresses #3216
