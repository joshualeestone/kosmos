---
pre_challenge: true
method: challenge-loop
branch: cli-install-3713
diff_hash: 830b599d161cc628aee32cdb7b17c82964ffbc972c8c983fc8d70b867d933fbd
validation: passed (full kosmos sequence on be3de3a4, after merging main: 9281 tests, 9133 pass, 0 failed, 148 skipped; surface gate passed with per-check trailers)
subdir_audit: passed
timestamp: 2026-09-25T12:12:35Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviewer models: opus, sonnet, opus, sonnet)
**Converged:** Yes, at iteration 4 on 750fff38 (one NIT, recorded). The commits after it are an empty trailer commit and a merge of main (conflicts only in the browser-check list and the reason-grep counts, re-measured).
**Total findings:** 0 BLOCKERs, 9 WARNINGs, 7 NITs
**Fixed:** 9 WARNINGs and 5 NITs | **Deferred:** 0 | **Answered, not changed:** 2 NITs

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] the Gemini launcher baked absolute node and script paths; a moved Homebrew node left it present and unrunnable with no way back --> FIXED (5bb22c04: relative bundle, Kosmos runtime node first, launcherHasNode makes it read missing so Connect reinstalls)
- [WARNING] the key and Grok sign-in routes accepted a tool mid-install --> FIXED (5bb22c04: runners.installing in both routes; a server test with a control)
- [WARNING] Windows was offered a download the engine always refuses --> FIXED (5bb22c04: said plainly on Windows)
- [WARNING] leaving first run left the download watcher polling (and, found by the new arm, made the next Connect close the box) --> FIXED (5bb22c04: frClose and frGo close it)
- [WARNING] focus fell to the body in three places --> FIXED (5bb22c04)
- [NIT] Settings had no "Not now" --> ANSWERED (the provider picker is Settings' way out; the plan's claim corrected)
- [NIT] no sign of a running download on return --> FIXED (joins it)
- [NIT] a bad Grok archive said "check disk space" --> FIXED ("could not be unpacked")
- [NIT] a failed expand leaked a file handle --> FIXED (stream pipeline)
- [NIT] a helper sat inside an old test's slice --> FIXED (moved)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 2 (both in iteration 1's fixes)
- [WARNING] the Grok sign-in's missing-tool sentence promised a download on Windows --> FIXED (833c3e6d: grokMissingTool)
- [WARNING] Settings' download box could start twice when the presence probe landed after Download --> FIXED (833c3e6d: a repeat show only refreshes the words)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2
- [WARNING] first run's Add opened the download box on Windows when the tool went missing after the box opened --> FIXED (750fff38)
- [WARNING] "Choose Grok again" led nowhere in Settings --> FIXED (750fff38: the sign-in opens the caller's download box through an onMissing hook)
- [NIT] focus after a download in a Grok sign in again went to a hidden control --> FIXED (750fff38)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- Perturbed each iteration-3 fix itself; each reds its check. Traced every missing-tool path: Mac opens the download box, Windows says it plainly, in both screens.
- [NIT] the Mac branch of grokMissingTool() is now unreachable (both callers supply the hook) --> RECORDED (kept as the fallback for a caller with no box, as its comment says)

### Validation history
- Earlier full runs on this branch passed every node test; one run each was red only on tools/test-kosmos-addr-reclaim-3079.sh (fixed port 17629, colliding with other agents' concurrent suites; green alone; filed as #3716) or on the surface gate (answered with per-check trailers, gate alone rc=0).
- cadd420f: validation PASSED (9215 tests, 0 failed). be3de3a4 (after merging main): validation PASSED (9281, 0 failed). This proof's hash is from that run.

### Not proven here (on the card)
- Watching the real Gemini and Grok binaries answer --version: the permission layer denies me running freshly downloaded vendor binaries. install()'s own prove step does it on the person's machine and refuses a build that does not run.
- A Grok subscription sign-in completed through Kosmos on 1.0.41 (started and measured by Renet; completion needs-operator on #3391).

### Process
Every reviewer ran blind, was forbidden to edit the worktree or run vendor binaries, did mutation runs only in its own mktemp copy; orphans after cleanup: 0 each.
