---
pre_challenge: true
method: challenge-loop
branch: wn-0740
diff_hash: d095ee4d78152c84903777fe5bd29ea3d9e31f6aebaa918963d5433b6a082e69
validation: passed (Mortals full suite at fdbf19732, 18982 tests, 18739 pass, 0 fail, 0 cancelled, 2026-10-11 05:35 CDT; local helper skipped on that clean entry, hash d095ee4d7815)
subdir_audit: passed
timestamp: 2026-10-11T10:35:45Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found no new issues)
**Reviewer models:** sonnet, opus, sonnet. Each round checked every shown line against the code on main.

Findings and dispositions are in .claude/plans/wn-0740.md, copied here.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- FIXED (WARNING): "holds messages sent to it" overclaimed: only the agent's chat (the DM thread), `kosmos msg` and
  automatic lines are held, not the terminal composer or the assistant bar, and a dateless limit the board saw late is
  not held. Now: "usually holds messages from its chat and from other agents until the limit resets". The card's time
  is dropped from the window line (it shows only when Kosmos can read the reset); the versions entry keeps it, hedged.
- FIXED (WARNING): "shows which Claude agent changed a file last" now says "usually": the name comes from a
  heuristic record and shows only when one exists.
- Checked: the Windows hook sends no keep-copy (no /api/undo/keep outside install/kosmos), so the Files item stays Mac
  only; the usage-limit item's Mac-only tag rests on #5805's unmeasured Windows reading, not a code gate (under-claims).
- NITs: the paused-room and join-company lines are accurate as written.

#### Iteration 2
**Reviewer model:** opus
- FIXED (WARNING): "from other agents" overclaimed: a task message (`kosmos task message`, server.js deliverAsync) is
  typed straight in, not held. Now "most from other agents". Recorded on #5805 as a gap in the hold.
- FIXED (WARNING): "its chat" is not the app's word (the assistant bar is the "chat", and it is NOT held); the thread
  is "direct messages" in the app's own copy. Now "your direct messages to it". The versions entry matches.
- Confirmed: the title, the Mac-only tag (under-claims), and the other three items in the app's own words.

#### Iteration 3
**Reviewer model:** sonnet
- NO NEW ISSUES. CONVERGED at iteration 3. NIT not taken: the phone-screen line is 0.7.31's, unchanged and reviewed then.
