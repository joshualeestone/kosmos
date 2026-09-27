# orgchart-undo-1280: an undo for the org-chart import's bulk create

Card: joshualeestone/kosmos#1280 (Kano). Josh's design (08-28, restated 09-08): the only bulk
operation in the create list needs "a preview with a count before it commits, AND an undo". The
preview shipped in #2987; what shipped as "undo" was only "Back to the list" before committing.

## Finished means
After an import creates agents, the panel offers Undo. Undo first names every agent it will
remove and how many, and says what happens to one already working; nothing is removed until
Remove them. It removes only the agents that import created, through the board's own reversible
removal, and shows each answer. A fresh preview or a closed panel drops it.

## Decided
- Page-only: `DELETE /api/agent/:name/removal` for each name in the create response's `created[]`.
  Removal stops the agent and keeps it from starting again, and deletes nothing on disk
  (engine/remove.js header); Show removed agents restores it. So no new engine route.
- Never an agent that existed before the import: `created[]` holds only members
  `create.createAgent` made, and createAgent refuses a taken name (a folder, or a name on the
  removed list), so a pre-existing agent is in `refused[]`. Undo reads only `created[]`, never the
  board. (Liu Kang m1601 condition 1.)
- What happens to one already working (condition 2), said before acting: it stops where it is;
  its folder and anything it wrote stay; Show removed agents starts it again.
- One at a time, not in parallel: removal shells out to launchctl/tmux per agent.
- The ask shows the engine's own words: each agent's GET removal plan (keeps, loses, the
  reassurance, and a refusal's reason up front), plus one page sentence, "Any that is working now
  stops", because Liu Kang asked for exactly that and the plan's lists do not say it.
- An engine `partial` is two different states (removed but still running, or not removed at all),
  so after the run the page re-reads /api/removed: an agent on it counts as removed, with the
  engine's sentence; only one that is not is offered again.
- Undo lasts until the next preview. Back to the list steps aside while Undo asks or removes; after
  that, pressing it starts the next batch.
- Review round 1 also restored a browser-check arm (the Create POST body) the first commit dropped.
- Rejected: an engine "undo team" route (a second removal path to keep in step with remove.js),
  and a one-press Undo (Liu Kang asked for the named count first).

## Weakest part
The claim "a pre-existing agent can never be in created[]" rests on createAgent's name-taken
guard. It is pinned by engine tests, not by this branch: engine/create.test.js "an existing agent
is never quietly overwritten", "a name a live session already answers to is refused, even with no
folder", and "#1279: a member whose slug already exists is refused by name-taken". The browser
check mocks /api/team, so it proves only that Undo reads created[] and never refused[]. What would
change my mind: a create path that reports `created` for a name that already existed.

## Merge
web/ change: merges after the Mac 0.7.03 freeze (Liu Kang m1558).
