# shotseed-7233: design shots show the sample room again

Card: kosmos#7233 (split out of #7225 by April). Since #7185, `engine/messages.js` gives no reader a room row stamped
before its project's `createdAt`. `docs/browser-checks/mobile-shots.js` `seed()` makes the project and then writes the
room's posts and reactions stamped from half an hour back, so every room shot since #7185 shows an empty room. The held
and refused lines (#6420, stamped 2 to 6 minutes back) were hidden the same way.

## Change
After making the project, `seed()` dates it one minute before the room's first row (`t0 - 60 s`, about 31 minutes
back) through `engine/projects.js` `mutate`, then reads it back and throws if the date did not land, so a seed that
silently failed can never photograph an empty room again.

## Decided
- **Date the project back, not the rows forward.** Stamping the rows after `createdAt` (seconds ago) would squash
  every post to "just now" and change what each room screen shows. Rejected.
- **31 minutes, not more.** The card's worry: `createdAt` also drives a project's "new" state (roomLive, the first-24-
  hours window). 31 minutes is still inside 24 hours, so "new" reads as it did before. WEAKEST PREMISE: that nothing
  else reads `createdAt` at minute resolution (a "made N minutes ago" line would now say 31). The full-set comparison
  below is what checks it.
- **Through the module's own write** (`mutate`), not a hand edit of projects.json, so the file stays in the shape the
  board reads; `projectborn` re-reads it on the file's change.

## Measured
- project-room, desktop light: on main, "Nothing here yet"; on this branch, the three seeded posts with their times
  (29, 26 and 21 minutes ago) and both reactions. The Projects tab now shows 3 unread (the posts count as unread,
  as they did before #7185).
- Full screen set (140 screens, desktop light): main twice (to find screens that differ by themselves) and this
  branch once; results below.
- Result: 132 screens in all three runs; 92 identical, 10 noisy (main vs main), 30 changed: room content, the Projects
  badge (3 unread), clock text, and cons-* rail state that comes from run order (on their own, this branch is
  pixel-identical to dc4b4e81fc, the commit before #7185). main cannot shoot project-room-held-5800 or
  project-room-held-summary-6925 at all; this branch can. The full list is on the card.
