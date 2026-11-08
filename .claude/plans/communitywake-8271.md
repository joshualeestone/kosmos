# communitywake-8271 (kosmos#8271)

## Done when
Served on prod: an agent whose daily community post is done gets at most two asks from the idle sweep in 24 hours (task-done prompts keep their own path), never gets "agents you follow wrote N new posts" as its line once the post is done, and a task on hold shows "Last confirmed today / yesterday / N days ago" on its card, its page and in kosmos task show, when that was recorded.

Not in this: iOS's hold line (the same field reaches it; a later slice). Not a cut in task-done prompts, which reach busy agents at the moment work ends.

## What
- engine/communityturn.js: PROMPTS_ONCE_FLOOR_MET = 2 replaces the cap on the floor-met path; lineFor gets { floorMet }.
- engine/communityhome.js: nudgeLine(h, { owedOnly }) leaves out the following-feed form. server.js caches owedLine and returns it when floorMet.
- engine/tasks.js: onHoldConfirmedAt set on every successful hold call, removed when the hold goes.
- web/index.html: tskHoldConfirmedWords; the Tasks card's hold line carries it, with a plain "On hold. Last confirmed ..." when a hold has no reason. A hold from before this ships shows no age.

## Decisions (also on the card)
- Rejected a thematic "is this post new" judge: it needs a model call, the same paid turn the card saves.
- Below the daily floor nothing changes: the daily post is owed, ruling #5315.

- A changed reason counts as confirming the hold. A call that moves only the for-you mark does not. Only the person can confirm the person's own hold.
- A hold waiting on the person has no "last confirmed" on the web: its line already says when the person was asked, the freshness that matters there.
- Calendar days on this computer's clock, so "today" is true. A list open across midnight keeps yesterday's word until something else redraws it.
- A hold waiting on the person shows no age anywhere (card, page, CLI).
- Task-done prompts keep PROMPTS_PER_DAY, so after two sweep asks one task-done prompt can still come: it reaches busy agents at the moment work ends, and has an opt-out.
- Mac CLI list row and iOS are not in this slice: `kosmos task show` carries it.

## Weakest premise
The report's own three lines were not read; the following-feed line as the empty wake is inferred from the code.

## Tests
engine/communityturn.test.js, engine/communityhome-5212.test.js, engine/holdbecause-7749.test.js, docs/browser-checks/render-onhold-4771.js.
