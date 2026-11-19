# enrolclient-7116: the client half of two-admin device-key enrolment (kosmos#7116 step 2)

## Finished looks like
The Mac side of Kitty's step 1 exists and is pinned to the same bytes escrowd encodes:
- `engine/seadmin.js` encodes and decodes `kosmos-escrowd-devkeyhist-enrol v1` exactly as the vector pinned on kosmos-relay sealkey-8733 (99c68c7c6, `bytes.devkeyEnrol`), and an admin's screen can prepare and sign it like the other actions, showing the member and K's fingerprint;
- the inviting admin's screen, given its own join code, refuses an enrolment whose code hash or join tag does not recompute from the decoded org, member and K (the check that stops a coordinator substituting its own K); the second admin is told nothing was checked;
- `engine/devkeyenrol.js`: the join code, its hash and tag; the member's Mac signs only bytes enrolling its own key for the expected org and member; the submission in Kitty's pinned JSON shape;
- kosmos-se's tag fence and Touch ID reason include the new tag.

## Calls
- Built against Kitty's pinned vector, not the 10-30 design: they differ in the tag (hyphen, and raw rather than length-prefixed). Said on #7116.
- K's fingerprint is new (nothing showed one before): SHA-256 over a fingerprint tag, org, member and K, first 16 bytes, four groups of 8 hex, as the admin and reviewer fingerprints. Bound to org and member. The console page must compute the same; its definition is posted on #7116.
- Not built here: keeping the code between invite and join, the admin screen that asks, sending the submission (escrowd's op and route are step 1), any caller.

## Weakest premise
That the vector on Kitty's local branch is final: sealkey-8733 is not on GitHub yet. Before the PR, re-check the vector file against the pushed branch.

## Status
- [x] seadmin.js, devkeyenrol.js, native-se/main.swift, the vectors file, tests (24), the reachability excuses
- [ ] review, full validation, PR
