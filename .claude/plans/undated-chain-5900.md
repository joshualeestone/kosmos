# undated-chain-5900

Card: joshualeestone/kosmos#5900. A conversation file written before projectBornAt existed rolls over on a dated send:
the fresh file is dated, the full file set aside is not, and asideChain refused to follow it (800 older messages
out of view, still on disk).

## Call
Option 1 from the card, scoped: asideChain follows an UNDATED `.full` file when the conversation's own `continues`
link names it (the reading readThread already gives an undated file: a mismatch only when both are dated). Once the
chain enters undated files it stays there; a file with a DIFFERENT date still breaks the chain, so the
recreated-project guard (server.dm-rollover-5841.test.js) holds.

## Rejected
Option 2 (do not stamp the fresh file at a rollover): every ordinary send already stamps an undated file
(`existing.projectBornAt || bornAt`), so it only delays the break by one message.

## Not changed (residual)
newestOwnAside (the reattach after a lost current file) still matches dates strictly. Relaxing it would let a lost
current file of a RE-CREATED project reattach to an undated old project's file, the leak bornAt guards. A lost current
file of a dated-after-rollover conversation therefore does not reattach to its undated earlier file.

## Accepted residual (named, not new in kind)
A project from BEFORE dates, deleted and re-created under its name, already adopts the old undated current file
(readThread refuses only when both are dated); with this change it also reaches that conversation's undated earlier
`.full` files, not just the 200 carried rows. An undated file of a re-created project is indistinguishable from the
#5900 case, so this is the same policy readThread applies. The dated-old-project guard is unchanged.

## Coordination
Sonya Blade's #5855 step 2 (daily-log tool) follows the same rule and has a test asserting asideChain follows nothing
in this state (not on main). Tracked on the #5855 card (comment 6118110114): whichever merges second rebases.
