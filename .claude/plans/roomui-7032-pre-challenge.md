---
pre_challenge: true
method: challenge-loop
branch: roomui-7032
diff_hash: e6c701a59a4336fd5542e35edba2a3bdaef2287feb418a77f68c2c934e55e70f
validation: passed (full suite via validation_log_run_or_skip at c414bd368c, hash=e6c701a59a43, EXIT=0, shell-shard 286/286, 2026-10-24 11:33 CDT)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-24T16:34:21Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap; one fresh blind reviewer at a time)
**Converged:** No. Round 8 found one BLOCKER (a re-spaced post never settled its bubble). It is fixed and pinned by a test with a different-words control, but it was not re-reviewed by a fresh agent because the cap was reached.
**Total findings:** 3 BLOCKERs, 39 WARNINGs, 0 CONVENTIONs, 9 NITs. All fixed. Deferred: 0. Asked: 0.

Commit shas below are from before the 10:45 rebase onto origin/main (28 commits, conflict-free). After the rebase, at c414bd368c: run-room 119/119, run.sh 931/931, run-actions 97/97, run-settings 41/41, server.phonenotice-post-7032 4/4, web.phone-notify-catalog-6487 6/6, simulator Debug build (-warn-long-expression-type-checking=100, 0 warnings) and KOSMOS_STORE_SHOTS Release build both SUCCEEDED, then the full validation above.

## Iteration 1
Reviewer: fresh blind agent, head a27e6718cb. All fixed in 2c9c03daad.
- [BLOCKER] Room notices never opened the room: the relay's APNs payload (kosmos-relay apns.rs) carries no projectId. Fixed: the computer's /api/phone/notice answer names `project`; the extension writes `projectId` (PhoneNotice.withRoom). Tested from the relay's real payload shape (run.sh) and the real route (server.phonenotice-post-7032.test.js).
- [BLOCKER] KOSMOS_STORE_SHOTS build failed: roomRequest declared only in #else. Fixed; the CI command built locally, BUILD SUCCEEDED.
- [WARNING] Re-read gap after >50 new rows: Board.refreshRoom replaces on no overlap. Tested.
- [WARNING] Room B opened over room A kept A's state: RoomView .id(p.id).
- [WARNING] Pending post settled on an earlier same-words post: settledPosts uses ids before the press (#6168 rule). Tested.
- [WARNING] Refused words lost: handed back to an empty box with the reply.
- [WARNING] Reply on external rows always refused: Reply/reactions only on .post.
- [WARNING] Reply @mention used display name: session name, prepended to the box (pjReplyMention). Tested.
- [WARNING] Folded refusals duplicated across page boundary: fold at draw time (foldRefusals). Tested with a split page.
- [WARNING] Kosmos-line id test could not fail: exact id asserted.
- [NIT] list refresh, false "Original message unavailable", older-page retry, double name map, prefix mention highlight, archived opens natively: all fixed. Not fixed: source-text tests kept; projects fixture has no members (captured that way).
Checks: run-room 85/85, run.sh 865/865, run-actions 97/97, run-settings 41/41, phonenotice node 17/17, sim Debug build + shots Release build SUCCEEDED.

## Iteration 2
Reviewer: fresh blind agent, head 2c9c03daad. No blockers. All warnings fixed in 6f18e799ee.
- [WARNING] Account or Mac switch left the old rooms: RoomStore.reset on chatEpoch, epoch guard on every read.
- [WARNING] Cold launch showed "cannot read your projects": reaching while starting/connecting/waiting for Allow.
- [WARNING] Store screenshot of a project room showed the native list: shots start tab via AppTabs.barTab.
- [WARNING] Tasks could no longer be earned (no tab hosts the board page): earned from the native /api/status poll. Tested.
- [WARNING] Chat opened from a room had dead board links: openOnBoard wired as AgentsView.
- [WARNING] New posts yanked a reader up the room down: follow only at the bottom.
- [WARNING] Refusal fold and words differed from the board: pjFoldRoomRows rules and pjRoomRow words; suite asserts web/index.html still draws them.
- [NIT] unsure words back to box; no markSeen after failed read; mixed-precision time sort (tested); fresh list read before falling back; stale catalog/doc wording. Fixed.
- [NIT] reaction race, attachments and held strip not drawn: stated as known gaps in the plan.
Checks: run-room 96/96, run.sh 865/865, run-actions 97/97, run-settings 41/41, notice node tests 32/32, sim Debug + shots Release builds SUCCEEDED.

## Iteration 3
Reviewer: fresh blind agent, head 6f18e799ee. No blockers. Fixed in f3653226ce.
- [WARNING] Unsure post handed back could be posted twice: bubble kept marked; box cleared when a read shows it kept (pend.onKept).
- [WARNING] Refused words lost if the room was left: hand-back kept in RoomStore.returned.
- [WARNING] Re-read loop restarted while hidden and marked seen: runs only while visible.
- [WARNING] Notification room request stayed armed on a failed list: falls back to the board's room page.
- [WARNING] List never refreshed while shown: follows the client's poll while shown.
- [WARNING] Kept post blinked out before the re-read: bubble removed after loadRoom.
- [WARNING] Opening a long room loaded an older page at once: gated on the first scroll, anchor kept after prepend.
- [WARNING] Unbuilt spec items not listed: 64pt rows and the tab badge built (badge tested); the rest listed in the plan's known gaps.
- [WARNING] Two tab-follow tests could not fail: rewritten on .tasks, plus a control that the move fires from another tab.
- [NIT] all-archived hides Archived: fixed. Concurrent older/replace: fixed. Leftover note: cleared at press. Status parsed twice: kept (one small extra parse per poll). Another Mac's no-Tasks: listed as a known gap.
Checks: run-room 98/98, run.sh 866/866, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.

## Iteration 4
Reviewer: fresh blind agent, head f3653226ce. No blockers. Fixed in b365357e24.
- [WARNING] Unsure or in-flight post settled by an older same-words post loaded later: settle requires a row after the newest shown at the press; a late refusal re-adds the bubble. Tested with a control.
- [WARNING] Over-long or unconnected post read "Not confirmed": refused before sending. Tested with a control at the limit.
- [WARNING] Older-page spinner could spin forever: keeps loading while the top shows.
- [WARNING] Notification fallback could open nothing (macURL nil): host carried in the request.
- [WARNING] Two source-text tests: kept-computer decision is PushBridge.roomOpening, tested both ways.
- [NIT] scroll on count drop, mark-read after leaving, handed-back words on empty, VoiceOver React: fixed. Badge includes open room, lock drops store: known gaps.
Checks: run-room 106/106, run.sh 866/866, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.

## Iteration 5
Reviewer: fresh blind agent, head b365357e24. No blockers. Fixed in 7f1fa0a129.
- [WARNING] Second Reply stacked @mentions (confirmed by the reviewer running it): swapped via previous mention. Tested with a control.
- [WARNING] Mention-only box could be posted (confirmed by running): Post disabled, isOnlyMention tested both ways.
- [WARNING] Earlier refused words refilled the box on Post: the draft-change refill is gone.
- [WARNING] Outside sender drawn under a local agent's name: raw name for external rows.
- [NIT] seen by newest row; mid-send disconnect is Not posted; ordered list reads, fallback only from the re-read; older pages gated on the end of the room appearing; react ids guarded. All fixed.
Checks: run-room 112/112, run.sh 866/866, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.

## Iteration 6
Reviewer: fresh blind agent, head 7f1fa0a129. No blockers. Fixed in 5f067df0b5.
- [WARNING] Draft and reply lost on leaving the room: kept per project in RoomStore.drafts.
- [WARNING] Settle only on the end marker: also when the top marker leaves (ChatView's rule).
- [WARNING] Kept post vanished on a failed re-read: bubble removed only by settle.
- [NIT] cancelled read treated as failure; inconsistent merge sort; stale kept value: all fixed. Room notices grouped by room (tested both ways). Stale known gap removed.
Checks: run-room 112/112, run.sh 868/868, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.

## Iteration 7
Reviewer: fresh blind agent, head 5f067df0b5. No blockers. Fixed in c20eb47a76.
- [WARNING] Posts above the newest page never refreshed (reviewer confirmed by a probe): react answer patches the row; the whole-room unanswered map applied to every post. Both tested with controls.
- [WARNING] Room marked seen after a failed read with cached rows: gated on loadRoom's result.
- [NIT] older-page anchor on a post id; live project for header and pinned line; Post disabled before the first read. All fixed.
Checks: run-room 116/116, run.sh 868/868, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.

## Iteration 8
Reviewer: fresh blind agent, head c20eb47a76. Fixed in 9d5a76d05a. This is the last round under the 8-round cap, so these fixes were not re-reviewed by a fresh agent; each is pinned by a test with a control, and the stored form was measured by running the engine's own storeText.
- [BLOCKER] A post re-spaced by the computer never settled its bubble (reviewer confirmed with node and swiftc): whitespace-flattened comparison as the board; kept bubble dropped once a re-read lands. Tested with the measured stored form and a different-words control.
- [WARNING] A first page that fits on one screen never settled, so older pages never loaded: settle when the end is already showing.
- [NIT] Unreadable folder with no reason showed no line: the board's fallback sentence. Tested.
Checks: run-room 119/119, run.sh 868/868, run-actions 97/97, run-settings 41/41, sim Debug + shots Release builds SUCCEEDED.
