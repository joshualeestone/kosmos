# pjquiet-6341: a project's "needs you" stays quiet when it should, and every row can be dismissed (kosmos#6341)

## Why
Josh, 2026-10-16 19:43 (testing on his laptop board): "I don't think we should be flagging users for these types of
notifications about needing you on a project ... when the project's already paused or the project's been inactive ...
there's not really a way to really dismiss it." And 19:47: "a couple agents were out of usage but that should never show
in the project, only on the agent". His screenshots: four projects with a red Issue; three of them idle for days (Sep 10,
Oct 1, Oct 15) and flagged by an agent's rate limit (`stuck_rate`), which `needsYouReason` counted on every project the
agent belongs to (#3726); one with a real question. Plus the same "Recommender: X is stuck" note posted twice, 1:14 pm
and 5:15 pm, in one room.

## Change
- `engine/projects.js` `describe()`: a member's reason is QUIET (not counted in `summary.needsYou`, `needsYouHere` null,
  kept as `needsYouQuiet: {reason, because}`) when:
  - `usage`: the reason is `stuck_rate` (Josh 19:47: on the agent only), on any project, live or not;
  - `paused`: the project is paused (any reason, a question included);
  - `dismissed`: the person dismissed that member's exact reason on this project;
  - `inactive`: it is the agent's own condition (anything but its question about this project) and the room has had no
    post in 24 hours (`NEEDS_LIVE_MS`).
  A question about this project still counts in a quiet room: it is about the project, not the agent.
- Dismissals: `projects.dismissNeeds(projectId, agent, reason)` keeps `needsDismissed: {agent: reason}` on the project
  record (the board, not the browser: these can stand for weeks). `describe()` drops a dismissal once that member's reason
  is gone or different, so the same reason returning later is shown again. An agent the board cannot see is not judged.
  `elsewhere` is the reason for a row the page lists after the counted ones (#5692): it stands while nothing is counted
  for that member here.
- `engine/messages.js`: `lastPostAt(projectId)` (posts and outside messages only; Kosmos's own notes do not make a room
  live), kept incrementally against the reader's memory; `recommenderNoted(project, agent, because, since)`.
- `server.js`: `POST /api/project/<id>/needs-dismiss` `{agent, reason}` (board token; not on the agent-token list);
  the Recommender runner passes `alreadyNoted` (a matching note in the room in the last 7 days) and logs it.
- `engine/recommender.js` `runOnce`: an item whose note the room already holds is not convened again (no note, no
  asks, no playbook), its hourly charge is given back, and it is marked convened.
- `web/index.html` `pjNeedsNotice`: each row gets Dismiss beside Open/Answer (carrying the row's reason); a member with
  `needsYouQuiet` is not listed among the uncounted red rows; `pjNeedsDismissClick` posts, repaints, says it in the
  notice's status line, keeps focus on the next row's Dismiss; a refusal leaves the row and the button reads Try again.
  `pjKeepOpenFocus` keeps focus on Dismiss across the poll's repaint as it does for Open.

Same rule as Angel's join-banner dismiss (#6315 follow-up, confirmed with her 19:45): dismissed for that exact thing,
back when it changes. Hers is per browser (a join request lives minutes); this is on the board.

## Tests
- `engine/projects-needsquiet-6341.test.js` (11): inactive vs live room (25 h vs 1 h, a note does not count), usage
  never counts, paused, a question in a quiet room counts, dismiss and drop on change, unseen agent not judged,
  elsewhere, refusals, `lastPostAt`, the Recommender's room check, `recommenderNoted`. 10 of 11 red against main's
  engine (the 11th is the unchanged-question control).
- `engine/projects.test.js`: #3726 and #5688 arms updated (their rooms get a post; the rate-limited member is quiet).
- `web.project-needs-you-5688.test.js`: Dismiss on every row; quiet members not listed again. Red against main's page.
- `server.project-needs-dismiss-6341.test.js`: the route keeps and refuses. Red against main's server.
- `docs/browser-checks/render-project-needsyou-2699.js`: a visible Dismiss in Open's row, 24px+, the row's reason; a quiet
  member not listed. Red against main's page.

## Known limits
- "Inactive" is room posts only: a project busy with agents working quietly for a day loses an agent's own condition
  from its Issue (the agent's page and the Agents count still show it).
- An `elsewhere` dismissal holds while the member has no counted reason here, so a later question about another
  project stays hidden here until something is counted.
- A paused project lists nothing in its block, including a red member whose need is about another project.
