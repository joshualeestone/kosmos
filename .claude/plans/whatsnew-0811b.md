# whatsnew-0811b: #8728 part 1 joins 0.8.11's What's New

Follow-up to the 0.8.11 pool (#8740, merged c9b385c4cc), before the 0.8.11 staging cut (#1050). Data only: one pool entry, the rebuilt `web/whats-new.json`, and this plan.

## Why a follow-up
Josh asked on 11-19 (kosmos#8728) for refreshing a Claude login on a remote computer to work. Part 1 (capask-8728, merged d81b81430b) landed after #8740's base. Splinter (11:27 CST): put it in 0.8.11's What's New, and part 2 too if it merges before the pin; do not hold the cut for part 2.

## The entry
- **A restarted computer says it is still starting** (rank 8.8, top of the window): "Right after a computer restarts, a remote sign-in says Kosmos+ is still starting and to try again in a minute, not to update Kosmos."
- From capask-8728's plan, What changes (b): `remoteStepUpRefusal` returns REMOTE_STEP_UP_STARTING ("Kosmos+ is still starting on this computer ... Try again in a minute") while the board still asks the connector by itself, instead of the update sentence. (a) is the board re-asking by itself after an unanswered ask, which is why "in a minute" holds.
- Not platform-tagged: the change is in engine/remote.js and server.js, which every computer on Kosmos+ runs. The first wording said "Mac", and the build refused it untagged, correctly.

## The window after this (5)
1. A restarted computer says it is still starting (#8728 part 1, rank 8.8)
2. to 5. as in #8740 (#8699, #8719 part 1, #5167 mac, #8705)
"A long conversation keeps your place" (0.8.08) leaves the window and stays pending.

## Not in this PR
#8728 part 2 (remoteopener-8728) has no PR yet. If it merges before the 0.8.11 pin, it goes in the versions entry; a window line for it needs its own merged change to read.

## Weakest premise
"a remote sign-in" names the case Josh hit; the same refusal covers every remote step-up action, so the line understates rather than overstates.

## Would change my mind
A reviewer showing the starting sentence is not what a remote sign-in shows after a restart, or that some computer does not run this path.

## Review log
