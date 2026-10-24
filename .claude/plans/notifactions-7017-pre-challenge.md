---
pre_challenge: true
method: challenge-loop
branch: notifactions-7017
diff_hash: d47672dff1fb6e4650ed7767c76ebabb5fedd6ba3ab012438aa44797c8702072
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T03:39:17Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: 0 BLOCKERs, 0 WARNINGs, lows only, both fixed)
**Fixed:** every BLOCKER and WARNING in rounds 1 to 3, and both lows in round 4 | **Deferred:** device checks (listed on #6838) | **Asked:** 0

Validation, at a4a56ea1d6 (rebased on origin/main):
- Full validation (validation-log, stack=typescript, hash d47672dff1fb): PASSED, 23,636 tests, 0 failures, EXIT=0.
- `bash ios/LogicTests/run.sh`: PASS 639/639. `run-actions.sh`: PASS 48/48. `run-settings.sh`: PASS 41/41.
- xcodebuild simulator Debug with `-warn-long-expression-type-checking=100` (CI's Xcode is older than this Mac's): SUCCEEDED.

## Round 1 findings (blind reviewer)
- BLOCKER: Reply was offered on a needs-you notice too. Typed words there could answer a menu the person cannot
  see. Fixed: Reply only on an agent's own reply (PhoneNotice.offersReply, kind "reply").
- WARNING: a reply the board kept but did not type (`could_not`) was silent. Fixed: the person is told, with the
  board's own reason; only a held reply ("Waiting to send") stays quiet.
- WARNING: the send had no hard limit inside iOS's short action window. Fixed with a total limit.
- WARNING: the follow-up notice opened nothing when tapped. Fixed: it carries the original address and agent.
- Mutation controls: both bugs put back each fail their test (29/29 restored).

## Round 2 findings
- BLOCKER: an agent can reply and then put up a menu; a lock-screen reply would answer or close it (a bare digit
  is taken as its key). Fixed: the app reads the chat first and sends only when no question is standing; an
  unreadable chat sends nothing and says why.
- Two stale comments corrected. 37/37; 2 fail with the rule disabled.

## Round 3 findings
- BLOCKER: the "question is up" rule read only the live question row (last, undated). A question the agent
  reported itself is dated and placed among the rows, and a menu the board cannot read gives no row at all.
  Fixed: the thread GET's own top-level `asking` is the signal; an older board without it falls back to the row.
- My own wrong premise (the live row is always undated and last) disclosed on the card.

## Round 4 findings
- LOW: the read's and send's idle limits could fire before their totals and report a send that went as "may not
  have gone". Fixed: idle limits sit just under each total (read 7 of 8 s, send 13 of 14 s).
- LOW: an older board's unreadable answer could be read as "not asking". Fixed: it fails closed.
- No new BLOCKER or WARNING: converged.

## Not covered here (device checks, on #6838)
- Reply appears only on an agent-reply notice; the category survives `content.updating(from: intent)` (UNMEASURED).
- A reply lands in the chat; while the agent is asking, the reply is refused with the asking notice.
- A follow-up notice tap opens the chat.
