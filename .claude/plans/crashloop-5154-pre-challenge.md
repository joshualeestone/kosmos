---
pre_challenge: true
method: challenge-loop
branch: crashloop-5154
diff_hash: 88020797eb45dca1079679414946c568a2cf360125372c4e6f8a3f06302931f6
validation: passed
subdir_audit: passed
timestamp: 2026-10-03T17:34:21Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 6 (2 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 5 | **Deferred:** 1 (accepted, reviewer's own call) | **Asked (awaiting user):** 0

Validation on the exact head 4f5695954: tools/run-tests.sh through validation-log (hash 88020797eb45, matching this
proof), 14936 tests, 14713 pass, 0 fail, 0 cancelled, 223 skipped; subdir audit passed. Browser: the 6 checks this
change touches ran at the review-1 head, 5 PASS, and render-connlost-reconnect-3410 failed on its members-list arm
only; FIXED in 4f5695954 and re-run alone at that head: PASS (crashloop and gave_up phases, members row included).
The FULL tools/browser-checks.sh on 4f5695954 (Agent1s, 19:2x to 20:29 CDT): "all page checks passed", EXIT 0, no FAIL
line, including render-connlost-reconnect-3410's crashloop and gave_up phases. (An earlier queued attempt was dropped by
the queue's wait bound before it ran, and was requeued with a longer bound.)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.js phone tick read safeRoster(), which holds only live sessions, so the first push was late and later sightings re-pushed --> FIXED (7c5d6c404): crashloop.tellLoops over the run files; tested told once, a missing pass not forgotten
- [BLOCKER] web/index.html cardStOf forced the needs-you presence, so an offline looping agent drew a live dot and hid Start --> FIXED (7c5d6c404): st attn, the state's own pres; tested with a control
- [WARNING] engine/crashloop.js deliberate exclusion read the disruption record, which status.js clears --> FIXED (7c5d6c404): disruption.begin writes a "kosmos" mark into the run file; tested through read() after clear()
- [WARNING] supervisor: a launch failing before the watch loop wrote nothing --> FIXED (7c5d6c404): record_run start opens the launch block
- [WARNING] a removed then re-created agent inherited the old run file --> FIXED (7c5d6c404): remove, delete-leftover and create call crashloop.forget
- [NIT] open run under 2 min keeps looping:true --> kept (clearing sooner would flap every retry)
- [NIT] "Open it to see what it shows" for an offline row --> covered once Start shows
- [NIT] Windows writes no run files --> said on the card (Mac-first beta)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the "start ends at the next start" rule, written in iteration 1's fix)
- [WARNING] engine/crashloop.js: a bounced live agent (stopped and started by a person or an update) read as a loop --> FIXED (88323cbac): such a run is an orphan and never counted; a failed launch gets a real end line from the supervisor's EXIT trap; mutations red (orphans counted, no trap end)
- [WARNING] Restart pressed on an already-looping card can flap it --> ACCEPTED (reviewer's call; the push is unaffected)
- [NIT] CRASHLOOP_TOLD in memory re-pushes once after a board restart mid-loop --> accepted
- [NIT] safeRoster reads one small run file per agent per call --> accepted; memo if it shows

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
Scope: the iteration-2 fix (88323cbac) and the members-row fix (4f5695954). Checked: every failed-launch exit path
runs the EXIT trap with RUN_STARTED 0 (no set -e in the supervisor; HUP/INT/TERM routed through exit), no duplicate
end line, bash 3.2 safe; every members-row producer carries crashLoop and the page reads it guarded.
- [NIT] a bounce landing before the session exists counts as a short run --> accepted (rarely reaches 3 in 30 min)
- [NIT] a hand-run supervisor racing launchd orphans one run --> accepted (self-limiting)
- [NIT] crashloop.js header and parse comment still describe the iteration-1 rule --> deferred to a follow-up (doc only; fixing it would void the validated head)
- [NIT] describe() always emits crashLoop, so pjMember's LAST fallback never fires for /api/projects rows --> accepted (invisible: such a member is not present)

Converged: iteration 3 surfaced no new BLOCKER or WARNING.
