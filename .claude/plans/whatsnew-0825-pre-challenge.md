---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0825
diff_hash: 65645f279d9fce9c61616d61aab661faed954f77317a920e9158a8f24a242035
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-26T10:08:25Z
iterations: 5
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** No. I stopped the loop after iteration 5 to cut 0.8.25 (the gap alarm, #1050). No BLOCKER was open. Iteration 5's one WARNING was the third finding about how precisely a single line states its trigger, and I deferred it with the reason below. Changing the line would have restarted the validation that was already running on this hash.
**Total findings:** 1: 3 WARNINGs, 2 NITs; 2: 3 WARNINGs, 2 NITs, 1 CONVENTION; 3: 1 WARNING, 2 NITs; 4: 1 WARNING, 3 NITs; 5: 1 WARNING, 5 NITs
**Fixed:** every WARNING of iterations 1 to 4, and most NITs | **Deferred:** iteration 5's WARNING and NITs, below | **Asked (awaiting user):** 0

Models alternated: 1 opus, 2 sonnet, 3 opus, 4 sonnet, 5 opus. Each reviewer was told to check every highlight's claim
against the code on every platform it shows on.

Validation: mortals-validate.sh at 44a2de1d4d PASSED at 04:08 CST, hash 65645f279d9f (the hash above). The subdir audit
passed locally. The pool and engine What's New tests passed 68 of 68 on that head, and whats-new-check 0.8.25 gives mac 4,
windows 1. Main moved 4 commits after the base: they are #9113, a test-only change to tools/test-tunnel-handshake-gate.sh.
The merge is clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] web/whats-new.json:17: the #9083 line was untagged, but its fix reads tmux screens, which Windows agents do not have --> FIXED (aa470e7943: tagged mac; Linux misses it, stated in the plan)
- [WARNING] web/whats-new.json:17: "a command or tool" over-claimed, since the fix covers only !, Bash, BashOutput, Monitor and MCP tools --> FIXED (aa470e7943: "a command or MCP tool")
- [WARNING] .claude/plans/whatsnew-0825.md:7: #9112 is not internal; on Windows a send now answers 409 --> FIXED (aa470e7943: left out, with the reason given in the plan)
- [NIT] .claude/plans/whatsnew-0825.md:34: the carry-overs were unchecked --> FIXED (the reviewer checked them; recorded)
- [NIT] .claude/plans/whatsnew-0825.md:7: #9119 was not listed --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 (the plan's counts and platform line, made stale by iteration 1's fix)
- [WARNING] web/whats-new.json:11: "An expired Claude login is said" was untagged, but off macOS it rests on #9097's unseen read --> FIXED (108100c124: tagged mac)
- [WARNING] .claude/plans/whatsnew-0825.md:12: the plan said "every platform" for #9083 --> FIXED (108100c124)
- [WARNING] .claude/plans/whatsnew-0825.md:34: the counts were stale --> FIXED (108100c124)
- [CONVENTION]: no em dash --> confirmed none
- [NIT] .claude/plans/whatsnew-0825.md: rerun the tests after the retag --> FIXED (68 of 68)
- [NIT] release/whats-new-pool.json: the held #9097 Refresh button was unverified on Windows --> DEFERRED: it is held until seen on the box

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json:2938: the held #9097 line named Mac as well as Windows while tagged windows only; the build would refuse it once set pending --> FIXED (c04d92e2c1; problems() returns the refusal on the old text and nothing on the new)
- [NIT] .claude/plans/whatsnew-0825.md:8: #9119 has no notesOnly entry --> FIXED (the plan says why)
- [NIT] engine/status.js: a code comment drifts from OUTPUT_HEAD --> DEFERRED: outside this branch

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json:2931: the line implied any printed "Not logged in" is covered --> FIXED (eaa290cf35 and 44a2de1d4d: "Claude's own Not logged in line". The first wording was 148 characters and the build refused it, while my commit chain did not check the build's result, so the pool was briefly pushed ahead of the window. Caught on the next build and fixed within 140.)
- [NIT] release/whats-new-pool.json:2933: Linux misses the mac-tagged line --> DEFERRED: stated in the plan
- [NIT] release/whats-new-pool.json:2943: once set pending, the held item makes 5 --> FIXED (the plan says so)
- [NIT] release/whats-new-pool.json:2949: the notesOnly title reads awkwardly --> DEFERRED: cosmetic

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the WARNING is about iteration 4's own rewording)
- [WARNING] release/whats-new-pool.json:2927: the #9083 line holds for the common case, a short single output block, but not when the sentence follows a blank line or sits in a later output block --> DEFERRED: the reviewer offered accepting the gap as a fix. This is the third round on this one line's precision, and a highlight that lists every condition reads worse than it informs. The common case is what a person meets, and the residual is a card that still says signed out, exactly as before 0.8.25, never a new wrong state.
- [NIT] release/whats-new-pool.json:2938: the held #9097 line says "an agent ... gets a warning", but the warning is a board notice to the person --> DEFERRED to the day it is set pending (noted on kosmos#9097)
- [NIT] .claude/plans/whatsnew-0825.md:10: #9097 affects Linux too, not only Windows --> DEFERRED: recorded here; Linux has no tag, so no line can be written for it
- [NIT] .claude/plans/whatsnew-0825.md:6: #9079 is the staging agent-online check, not the promote gate --> DEFERRED: a label; it is internal either way
- [NIT] release/whats-new-pool.json:2948: did-you-mean appears only for one close match, under five command groups --> DEFERRED: a notesOnly line
- [NIT] release/whats-new-pool.json:2870: the carry-over's "for 12 hours" is "for up to 12 hours" --> DEFERRED: minor; noted for the next pool edit

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:17 | BRANCH | #9083 untagged on Windows | FIXED | aa470e7943 |
| 2 | 1 | WARNING | web/whats-new.json:17 | BRANCH | "command or tool" over-claims | FIXED | aa470e7943 |
| 3 | 1 | WARNING | .claude/plans/whatsnew-0825.md:7 | BRANCH | #9112 called internal | FIXED | aa470e7943 |
| 4 | 2 | WARNING | web/whats-new.json:11 | BRANCH | expired-login untagged | FIXED | 108100c124 |
| 5 | 2 | WARNING | .claude/plans/whatsnew-0825.md:12 | SELF | stale platform line | FIXED | 108100c124 |
| 6 | 2 | WARNING | .claude/plans/whatsnew-0825.md:34 | SELF | stale counts | FIXED | 108100c124 |
| 7 | 3 | WARNING | release/whats-new-pool.json:2938 | BRANCH | held line names Mac | FIXED | c04d92e2c1 |
| 8 | 4 | WARNING | release/whats-new-pool.json:2931 | BRANCH | any printed line implied | FIXED | 44a2de1d4d |
| 9 | 5 | WARNING | release/whats-new-pool.json:2927 | SELF | blank-line and later-block cases | DEFERRED | common case true; residual is the old behaviour |
