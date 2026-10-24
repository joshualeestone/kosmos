---
pre_challenge: true
method: challenge-loop
branch: nativechat-7008
diff_hash: 34fcc7c4d53e2f3baa273bca3ea027f74feb6f08862513cdf7a6a038006f6362
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T01:18:43Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, alternating opus and sonnet blind reviewers. The run spanned one restart: iterations 1 to 5 were
run by the session before 19:55 CDT and are summarised from its handoff; iterations 6 to 8 are this session's.
**Converged:** Yes (iteration 8: 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 5 NITs)
**Fixed:** every BLOCKER and WARNING in iterations 1 to 7 | **Deferred:** the NITs listed under iteration 8 and
three accepted NITs from iteration 7 (below) | **Asked:** 0

Validation, at cacde6030d (rebased onto origin/main 559b55dad9):
- `bash ios/LogicTests/run.sh`: VERDICT: PASS 621/621.
- Debug simulator build (iPhone, iOS 27 runtime, deployment target 16.0): BUILD SUCCEEDED.
- Release simulator build: `strings` finds 0 `KOSMOS_SAMPLE_` markers; the Debug build finds 3 (the control).
- Mutants, each run against the full logic suite and restored: a no-session read wiping the chats, no chats-owner
  check, 5xx read as a refusal, no epoch guard on retry, any URL scheme accepted as a link, no forgetting on another
  Mac, accountChanged without stopping the loop, and a Mac change clearing the chats' owner. Every one went red.
- Not exercised in the simulator (no tool on this Mac can tap it): the SwiftUI behaviour of the chat (keyboard pin,
  epoch pop, VoiceOver actions, the 44 pt tap target). A screenshot shows the composer laid out as before.

Subdirectory CLAUDE.md audit: none under ios/.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the first design drew its own copy of a sent message and offered a retry on a held one, which duplicated
  rows and could queue a held message twice. Fixed: a send waits for the Mac's own row; held rows are never re-sent.

#### Iterations 2 to 5
**Reviewer models:** sonnet, opus, sonnet, opus
- [WARNING] (iteration 3) no-answer matching by words could hide a never-sent short message. Fixed: matches only rows
  newer than the newest row shown before the send.
- [WARNING] (iteration 4) unconfirmed sends without a row, retry double taps, reads crossing a reset. Fixed.
- [WARNING] (iteration 5) chats leaked across a Mac change; draft rows; unfilable history; unrecorded deliveries.
  Fixed.

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] a Keychain read that found no session wiped open chats and drafts. Fixed: kept; a sign-out reported by
  the web view drops them (PushNotificationManager.accountChanges); a different session drops them (chatsOwner).
- [WARNING] a 5xx answer to a send was read as a refusal. Fixed: no answer, so a retry reads first.
- [WARNING] retry settled across a chat reset. Fixed: epoch guard.
- [WARNING] unfilable history left a delivered message unsettled. Decided, no change: it stays shown as sent under the
  Mac's reason (plan, Decided).
- [WARNING] Markdown links could hide non-web schemes. Fixed: http and https only.
- [WARNING] draft overwritten if the chat reappears. Fixed: loads only into an empty box.
- [WARNING] send tap target 34 pt. Fixed: 44 pt.
- [NIT] accessibility label on the text field, plan wording, a misplaced comment. Fixed.

#### Iteration 7
**Reviewer model:** opus
- [WARNING] accountChanged forgot without stopping the loop, so a status read in flight could put the old list back.
  Fixed: stop, forget, restart if it was running.
- [WARNING] VoiceOver could not reach links in a message. Fixed: one action per link.
- [NIT] a test check that could not fail (removed); the chats' owner cleared on a Mac change (fixed); Delete offered
  where it does nothing (fixed).
- [NIT] accepted: an unrecorded delivery can drop one read early; refused(nil) shares failed(nil) with no answer;
  the onChange wiring to accountChanged has no unit test (SwiftUI).

#### Iteration 8
**Reviewer model:** sonnet
- No BLOCKER and no WARNING.
- [NIT] forgetChats ran twice on a Mac change. Fixed (cacde6030d).
- [NIT] several links on one host read alike. Fixed: numbered.
- [NIT] deferred: the unnamed accessibility action is present when it does nothing; links(in:) re-parses on each
  redraw; a redundant send-suppression assertion was removed.
- [CONVENTION] deferred: links(in:) is untested and could move into BoardLogic.
