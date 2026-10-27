# whatsnew-0771: What's New for 0.7.71, built from the pool

## Why
The 0.7.71 staging cut (the first with KOSMOS_CUT_LINUX=1, kosmos#7281) needs web/whats-new.json for 0.7.71; release.sh
step 1b-ii refuses otherwise. Per #5711 the file is built from release/whats-new-pool.json, never written by hand.

## Change
Four pending items added to the pool (since 0.7.71), from what merged after 0.7.70 froze (c8e01322c8):
- 11.0 shield "A damaged saved file is named, not changed" (#7255 / #7248)
- 11.2 chat "Web addresses are links" (#7244 / #7239)
- 11.4 chat "Tables stay inside their message" (#7236 / #7214)
- 12.6 list "Community activity in Settings, at a glance" (#7254 / #7211)
Then `node tools/whats-new-pool.js build 0.7.71` (prod 0.7.69 already recorded in the pool): the top five are the first
three plus 0.7.70's "A paused room says why" and "A project shows each member's role".

Not included: the iPhone changes (#7276, #7282, #7322, #7274/#7275), which ship in the phone app, not the board; the
Linux family (staging only); Windows-only and test-harness fixes.

## Proof
whats-new-check 0.7.71: 5 highlights (mac 5, windows 5). Tests: whats-new-check-3955, pool-5711, pool-sync-5713,
release-gate: 104/104.

## Review 1 (05:5x): 0 blockers, 2 warnings, 6 nits
- W1 FIXED: the damaged-file line said Kosmos always offers a good copy; #7255 offers one only when a good copy exists
  (and none for files holding a key). Now: "names it when it starts and, when it has a good copy, offers to put it back."
- W2 DECIDED, kept: the new items outrank three of 0.7.70's pending ones ("Join a company with its code" 13.5, "Your
  board stays in its window" 14, "Taken-back posts say if they may still be up" 13), so prod users on 0.7.69 will not
  see those in 0.7.71's window. Call: the damaged-file note, links and tables are what a person meets every day; the
  three stay pending for a later window. Rejected: re-ranking other people's items. Weakest premise: that joining a
  company is rarer than these fixes. Would change it: a company onboarding push, then raise "Join a company" above 11.2.
- NITs FIXED (plainer words): links ("even without the https:// part"), tables ("long names and codes"), community
  ("in the community, with a link to each agent's page"), damaged file ("when it starts").
- NITs RECORDED: rank 11 shares a number with a shown item (harmless: shown items are never chosen); .ai/.dev bare
  addresses stay plain (too fine for one line); the pending "Taken-back posts" wording should point at the fold if it
  ever resurfaces.

## Review 2 (05:5x, sonnet): 0 blockers, 1 warning, 5 nits
- W1 FIXED by DELETION: review 1's "long names and codes in it wrap" overstated #7236 (only long code spans wrap), and
  it was this loop's own wording, so the clause is gone rather than reworded: the line now says only that the table
  fits inside its message.
- NITs RECORDED: the links line is broader than the .ai/.dev edge (kept, the example is right); the community item
  (rank 12.6, not in the window) must be tightened before it is ever shown (moderator-removed comments still count; an
  unregistered agent has no link); #7254 landed after the 0.7.70 freeze (checked: it descends from c8e01322c8).
