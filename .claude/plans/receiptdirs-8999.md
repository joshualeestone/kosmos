# receiptdirs-8999: a receipt reads each transcript folder once (kosmos#8999)

## Problem
`claudeWork` (engine/receipt.js) reads every folder `transcriptDirs` lists, one per Claude account. Accounts often share one
`projects` folder through a link, so the same transcripts are read once per account (8 times on this Mac), and a row with
no message id is counted once per account.

## Call
Merge by real path where the folders are read, in claudeWork. Not in transcriptDirs: engine/agentevents.js compares its
names (which agent a folder belongs to). agentevents' own reading loop is left alone: it may key what it has
read by file path, and changing which path is kept is not this card's.

## Weakest premise
VERSION stays 3, so a receipt kept before this with a row counted once per account stays as it was. Recomputing it could
lose work whose transcripts have since been pruned, and only rows with no id were ever counted twice.
A folder that cannot be resolved is read as spelled (some Windows volumes refuse to resolve one they can list).

## Test
engine/receipt-5153.test.js: three account folders, two of them one folder; an id-less row counted once. Red without the
merge. And a folder that lists but does not resolve is still read; red if it is dropped.
