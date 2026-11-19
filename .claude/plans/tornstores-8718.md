# tornstores-8718: crash-safe stores (kosmos#8718)

## Goal
The card asks: small stores written atomically; a store a crash left empty or all NUL noticed, reset, logged; a test that truncates or NUL-fills stores at start-up; a kill during write leaves the old or the new file.

## What already exists (found at review round 7, after building a duplicate)
- #5434 (closed): about 80 stores save flushed temp-then-rename (store.saveFlushed, securewrite.writeSecret), with fsync-order tests.
- #7248 (closed): engine/storecheck.js runs FIRST at board start, names every JSON store a crash left empty, NUL-filled or unparseable, in board.log and on screen (/api/board/damaged-files), offers a good copy, and never changes a store by itself.

## This branch
- engine/rawwrites-8718.test.js: a ratchet on the per-file count of `writeFileSync(` outside comments in server.js and engine/*.js (135 in 79 files on 11-18), so a new raw in-place write cannot slip in unseen. It converts no write.
- engine/saveflushed-kill-8718.test.js: a child killed with SIGKILL while saving in a loop through store.saveFlushed leaves a file that parses, and at least one save landed. Proves the rename half; the flush half is #5434's fsync-order tests.
- tools/windows-tests.js: the kill test is HOST_BRANCH_EXCLUDED with the reason.

## Rejected (and why the branch shrank)
- A second start-up scan (engine/tornstores.js). Built, reviewed six rounds, then found to duplicate storecheck.js (#7248): two lists of what a store is, two wordings in board.log for one torn file. Removed. The full history is on the branch backup-tornstores-8718-full.
- Resetting a torn store automatically: reverses deliberate fail-closed rules (phone-notify-choice.json is the person's off, #6488; heartbeat.json, Josh 2026-09-03; autobalance.json; remote.json, #4308). storecheck already refuses to; measured in round 5 by moving three of them aside.
- Extending storecheck to .jsonl and deeper folders: .jsonl readers skip a bad line, so an all-zero log reads as empty, which is what absent would; no case found where that coverage changes anything a person sees.

## Weakest premise
That the card's "silently paused for days" is the class storecheck already names. If the agent's zeroed file was in a folder storecheck does not list (it lists profiles, commitments, sendertokens, webhooks, community, communitysend, catalogue, remote and the root), it would still be silent. Recorded on the card for whoever has the file name.

## Review history
Rounds 1 to 6 reviewed the removed scan; their fixes went with it. Round 7 (opus) found the duplicate: BLOCKER fixed by removal; WARNING scan ran late (moot, removed); WARNING first commit subject described a dropped design: fixed, the branch is one new commit.
