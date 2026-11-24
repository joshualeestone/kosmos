# builtwait-9011: a project whose work is built and waiting on review no longer reads as idle (kosmos#9011, part 2)

**Posture:** production

**Finished looks like:** a project with nothing running and nobody needing the person, whose open tasks are marked built
(`kosmos task built`) and wait for the person to check them, shows a calm "Built but waiting" pill on its card, not the
empty idle card. Part 1 (an agent's own wait vanishing unexplained) is branch heldwait-9011.

## Change
- engine/projects.js describe(): summary.builtWaiting, the project's open tasks whose taskState is 'built' (a task's own
  hold outranks built, so a held one is not counted; a closed one is done). No roster needed; 0 on an archived project,
  as heldForYou.
- web/index.html pjPillOf: "Built but waiting" (Josh's own words for the task state, #3951; the Tasks page's tile of the
  same name) when builtWaiting > 0, BELOW Issue, Question (both kinds), Paused, Working and Restarting.
- engine/builtwaiting-9011.test.js: the count (held, closed, archived excluded) and the pill's place in the order.
- docs/browser-checks/render-projects-badges-4730.js: a #9011 block in grid and list, light and dark.

## Decided
- A pill, not a word elsewhere on the card, and under Josh's #4730 rule ("only display a badge if something is actually
  running"): #7797 already shows a calm Question for a task held for the person when nothing runs, because the person
  has something to do. A built task waiting for the person to check it is the same kind of thing. Calm, no red border:
  it is work done, not a problem.
- Josh's words, not new ones: the card asks for "waiting on review"; the product already calls this "Built but waiting".

## Rejected
- A new red or attention state: nothing is wrong, and red is reserved for "somebody is waiting on you" in the sense of a
  blocked agent.
- Counting it above Working: a project with an agent busy on it is busy; its built tasks show on the Tasks page.
- The phone apps' project lists: they draw their own pill; not changed here (follow-up if wanted).

## Weakest premise
That this sits inside #4730 the way #7797's Question does, rather than bending it as #5391's Paused did (which was left
for Josh to choose). If Josh reads #4730 strictly, the pill line is one line to remove.

## Tests
- node --test engine/builtwaiting-9011.test.js: 2/2. Mutations: the pill line removed fails the order test; the count
  removed fails the summary test.
- render-projects-badges-4730.js headless: 85 PASS. Pill line removed: the four "Built but waiting" arms FAIL.
- Existing project pill and built tests pass (1303e, 6483, 5391, 7916, 7788, 3951).
