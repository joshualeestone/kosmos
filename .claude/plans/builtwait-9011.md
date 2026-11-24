# builtwait-9011: a project whose work is built and waiting on review no longer reads as idle (kosmos#9011, part 2)

**Posture:** production

**Finished looks like:** a project with nothing running and nobody needing the person, whose open tasks are marked built
(`kosmos task built`) and wait for the person to check them, shows a calm "Built but waiting" pill on its card, not the
empty idle card. Part 1 (an agent's own wait vanishing unexplained) is branch heldwait-9011.

## Change
- engine/projects.js describe(): summary.builtWaiting, the project's open tasks whose taskState is 'built' (waiting on a review,
  a release or the person; a task's own hold, or an agent's hold for the person, is not counted; a closed one is done;
  built work in a paused project is, #5864). No roster needed; 0 on an archived project,
  as heldForYou.
- web/index.html pjPillOf: "Built but waiting" (Josh's own words for the task state, #3951; the Tasks page's tile of the
  same name) when builtWaiting > 0, BELOW Issue, Question (both kinds), Paused, Working and Restarting.
- engine/builtwaiting-9011.test.js: the count (held, closed, archived excluded; paused counted) and the pill's order.
- ios/Kosmos/BoardRoom.swift, ProjectsView.swift, ios/LogicTests/room/main.swift: the iPhone mirror and its checks.
- docs/browser-checks/render-projects-badges-4730.js: a #9011 block in grid and list, light and dark.

## Decided
- A pill, which BENDS Josh's #4730 rule ("only display a badge if something is actually running") as #5391's Paused
  does: built work is not running. Taken because the card asks for exactly this state and "Built but waiting" is the
  product's own word for it; #7797's held-for-you Question is the nearest precedent for a calm pill on a quiet project,
  though it was not ruled on by Josh. Calm, no red border: it is work done, not a problem. If #4730 is to be read
  strictly, the one pjPillOf line (and its Swift mirror) go.
- The iPhone project list mirrors pjPillOf arm for arm (ios/Kosmos/BoardRoom.swift projectWord), so it says it too
  (review round 1): summary.builtWaiting read, .builtWaiting last, the secondary colour as Paused and Restarting.
- Josh's words, not new ones: the card asks for "waiting on review"; the product already calls this "Built but waiting".

## Rejected
- A new red or attention state: nothing is wrong, and red is reserved for "somebody is waiting on you" in the sense of a
  blocked agent.
- Counting it above Working: a project with an agent busy on it is busy; its built tasks show on the Tasks page.

## Weakest premise
That Josh wants this pill although it bends his #4730 rule, as Paused does (Paused was put to him to choose). If he
reads #4730 strictly, it is one pjPillOf line and its Swift mirror to remove.

## Tests
- node --test engine/builtwaiting-9011.test.js: 3/3 (with a paused project and an agent's hold for the person). Mutations: the pill line removed fails the order test; the count
  removed fails the summary test.
- render-projects-badges-4730.js headless: 85 PASS. Pill line removed: the four "Built but waiting" arms FAIL.
- Existing project pill and built tests pass (1303e, 6483, 5391, 7916, 7788, 3951).
- iPhone: ios/LogicTests/run-room.sh 964/964 (the new order and parse checks), run.sh 2305/2305, every run-*.sh, and the
  app builds for the simulator.
