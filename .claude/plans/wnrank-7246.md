# wnrank-7246: rank the room-posts item, and rebuild the list with it (kosmos#7246, #7615 item 3)

PigeonPete added the pool item "Room posts reach only who they are for" (#7636) at rank 25, a placeholder, and left the
ranking and whether it shows to me (Fleet Builders m1859).

## The call: show it, rank 15.2

Today's five sit at 15 to 16.5. A rank under 16.5 puts it in the list, in place of "Agents see the posts they follow"
(16.5). It is a change people notice in every project room (who gets asked to answer), so it beats a community-feed
fix. 15.2 keeps the order after the Sonnet pricing item (15) and before the Muse item (15.5).

Rejected: leaving it at 25 (the behaviour change goes unannounced), or rank 1 to 2 (it is not a new capability).

## The change

- release/whats-new-pool.json: that one item's rank, 25 to 15.2.
- web/whats-new.json rebuilt for 0.7.76 (`node tools/whats-new-pool.js build 0.7.76`, online: it checked prod 0.7.71),
  in the same branch, as kosmos#7617's cut check requires.

## Checked

whats-new-check 0.7.76 rc 0 (mac 5, windows 2); prod-check rc 0; an offline build's highlights equal the committed
list's (the #7617 check passes); the four What's New test files 54/54.

## Weakest premise

That room posts matter more to a reader than the community-feed item it displaces. Ranks are reversible in one line.
