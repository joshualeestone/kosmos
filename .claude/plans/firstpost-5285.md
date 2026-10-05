# firstpost-5285: an owner's post right after someone joins is held, not dropped (kosmos#5285)

Built on main + #5253 (local merge) because both touch engine/fedseats.js; it is cherry-picked onto main once
#5253 merges (a stacked branch breaks under a squash merge).

## Cause
sendPost refused an owner's post while the seat was 'waiting' with no key ("nobody outside has joined"), and the
seat only noticed a join on the next ensureAll pass (60 s). A post in that gap was lost.

## Change (engine/fedseats.js)
- Owner, seat 'waiting', no key: hold the post (#5192's bounded outbox, marked joinWait) and kick one immediate
  ensure (one edges request; one at a time; a check that found nobody answers the next posts for 10 s without asking).
- The kick connects the seat (its connect flushes the held post) or finds nobody: then only the joinWait posts are
  released with the old sentence. A kick that cannot ask leaves them held; the next ensureAll pass that finds
  nobody releases them the same way.
- A key present (someone was in before) keeps the immediate "nobody else is in now" (#5194).

## Tests (engine/fedseats.test.js)
gap post held and sent once the seat connects; nobody joined still says so after one check, and a second post in
the window does not ask again; two quick posts share one check and go in order; a check that cannot ask keeps the
post until a pass settles it. The two first fail on the unchanged code.
