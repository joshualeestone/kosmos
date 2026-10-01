---
pre_challenge: true
method: challenge-loop
branch: onekosmos-4815
diff_hash: ed3a06be8c5b2488e66dc1639daf36257cf30b063c4ba59103b92f22ac85bae9
validation: focused per round (render-onekosmos-4815 with node, web.* 2216/0, engine/account-computers 9/9, gates); after round 5 every affected browser check re-run green (render-computers-4648, the eight world/worldsw checks, render-frame-phone-718, both tophead checks); controls listed in the plan; the full suite on Mortals, result recorded on the PR
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-01T01:52:18Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Round 6 (sonnet) raised nothing above NIT, and diffed every changed function's switch-ON path against main with no difference.
**Fixed:** every BLOCKER and WARNING raised | **Asked:** none

**Disclosed:** after round 1 I re-ran only the new check, so round 3's change regressed render-computers-4648 unnoticed until round 5. From round 5 on, every affected check was re-run after each change.

### Per-Iteration Breakdown

#### Round 1
**Reviewer model:** opus
- [BLOCKER] render-frame-phone-718 (gated) opens the switcher and went red --> FIXED (it sets the override)
- [BLOCKER] one failed computers read locked the menu shut and lost the name until reload --> FIXED (only an answer changes them; a failure says so in the menu)
- [WARNING] an empty menu while the read runs --> FIXED (Checking your computers...)
- [WARNING] the plain button still announced as a collapsed button --> FIXED (no aria-expanded/controls, tabindex -1)
- [WARNING] the name waited for the Kosmoses read --> FIXED
- [WARNING] engine/win32uninstall.js says "your Kosmoses" --> out of scope, in the plan (uninstall must find every Kosmos)
- [NIT] stale note re-rendered every 8 s; comment list --> FIXED

#### Round 2
**Reviewer model:** sonnet
- [WARNING] a boot read with no answer (or a mid-session sign-in) left the button plain until reload --> FIXED (background re-read)
- [WARNING] no arm covered the boot read --> FIXED (boot arms)
- [CONVENTION] hover lit the plain button in the new look --> FIXED
- [NIT] focus when the menu closes under the person; stacked comments --> FIXED

#### Round 3
**Reviewer model:** opus
- [BLOCKER] the route answers 200 with ok: false for BOTH "not signed in" and "Kosmos+ did not answer", so a Kosmos+ hiccup read as "one computer" --> FIXED (engine marks signedIn: false; the page counts only ok: true or that)
- [WARNING] the check used shapes production never sends --> FIXED; [WARNING] comments --> FIXED; [CONVENTION] plan numbers --> FIXED
- [NIT] hidden-tab re-read; seam floor --> FIXED

#### Round 4
**Reviewer model:** sonnet
- [WARNING] permanent failures retried every 15 s forever --> FIXED (back-off to 5 min)
- [WARNING] the 15 s retry ignored hidden tabs --> FIXED (one tick waits for a visible tab, never repaints an open menu)
- [WARNING] the engine mark had no test --> FIXED (present on marked answers, absent on failures; removing it fails)
- [CONVENTION] comments in page, engine and route --> FIXED

#### Round 5
**Reviewer model:** opus
- [BLOCKER] with the switch ON a failed read showed the new note where today's menu hides the section (render-computers-4648 red) --> FIXED (the helper returns at once when ON)
- [WARNING] no arm for the back-off or the visibility re-read --> FIXED (both arms; each control fails its arm)
- [NIT] visibility re-read under an open menu; NaN hook; stale plan --> FIXED

#### Round 6
**Reviewer model:** sonnet
- [NIT] the hidden-tab flag can stay set with the menu open (harmless; opening re-reads) --> left
- [NIT] worldswOneKosmos closes a menu without checking a reconnect (unreachable with the switch off) --> left
