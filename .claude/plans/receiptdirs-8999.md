# receiptdirs-8999: a receipt reads each transcript folder once (kosmos#8999)

## Problem
`claudeWork` (engine/receipt.js) reads every folder `transcriptDirs` lists, one per Claude account. Accounts often share one
`projects` folder through a link, so the same transcripts are read once per account (8 times on this Mac), and a row with
no message id is counted once per account.

## Call
Merge by real path where the folders are read, in claudeWork. Not in transcriptDirs: engine/agentevents.js compares its
names as written (which agent a folder belongs to). agentevents' own reading loop is left alone: it may key what it has
read by file path, and changing which path is kept is not this card's.

## Weakest premise
A folder whose real path cannot be read is skipped. transcriptsIn already lists nothing for a folder it cannot read, so
nothing is lost, except a folder that can be listed but not resolved, which I know no case of.

## Test
engine/receipt-5153.test.js: three account folders, two of them one folder; an id-less row counted once. Red without the
merge.
