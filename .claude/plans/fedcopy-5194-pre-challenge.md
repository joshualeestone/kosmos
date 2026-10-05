---
pre_challenge: true
method: challenge-loop
branch: fedcopy-5194
diff_hash: 9ef914cb47fd1dbd0e0978807aeb366b529e92bbb7f10b698e7d3e2958b31ad6
validation: passed locally on every affected test (engine/fedseats.test.js 72/72; engine/federation*, fedseal, remote-fed-live-refresh, server.federation-3311, server.fedmsg-3311 114/114; web.fed-plus-gate + web.federation-3312 23/23 from the repo root). Both new tests red against main's fedseats.js. The full suite runs on the PR's CI; the merge is held until after Monday (Splinter 18:54).
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-03T23:57:30Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (fresh blind reviewer, read only; it ran engine/fedseats.test.js)
**Converged:** Yes. No BLOCKER, no WARNING, no fix needed.

#### Iteration 1 (fad22c13): 0 BLOCKER, 0 WARNING, 1 NIT
- [STRENGTH] An owner key is created only in ownerHello, after the coordinator lists an active edge from a pending invite and the hello checks. rotateForRevoked adds keys and never removes them. Only forgetRoom (project create or re-share, server.js) clears the room, and then the "yet" wording correctly returns.
- [STRENGTH] Self and own-code rooms (#4649) never create an owner key and never reach ownerHello, so neither line fires there. An unreadable room record falls back to the old wording.
- [STRENGTH] The #5195 line cannot double: a repeat hello takes the pinned-peer branch, concurrent hellos are serialised by sealStep and re-checked, and a second member finds hasKey already true. A crash between setRoomState and say loses the line rather than doubling it (named in the plan).
- [STRENGTH] The pre-key wording stays covered by the existing test "while an owner waits for someone to join, a post says exactly that".
- [NIT] On the refused-edge (exit 3) waiting path, "now" is no less accurate than the old "yet" was. Kept, pre-existing.

### Author's controls
- Against main's engine/fedseats.js: both new tests red (#5195: no sealed line on the owner; #5194: the "has joined yet" wording after a revoke). Restored, 72/72.
- The #5195 test asserts 0 sealed lines before any hello, 1 after the first, and still 1 after a repeat hello, so it reds on a missing line and on a doubled one.
- The #5194 test asserts the new sentence is present AND the old "nobody outside has joined" is absent.
- web.fed-plus-gate and web.federation-3312 first failed with ENOENT web/index.html when run from outside the repo. That is a relative-path read, the same on main; from the repo root they pass 23/23.

## Rebased onto main cf62a6b7e (2026-10-04 12:2x CDT, merge hold lifted)
- One conflict, engine/fedseats.test.js: main (#5228) and this branch both appended tests at the same place. Kept both, unchanged.
- engine/fedseats.test.js: 105/105 pass (33 #5191 tests from main plus this branch's #5194 and #5195 tests). Re-hashed.
