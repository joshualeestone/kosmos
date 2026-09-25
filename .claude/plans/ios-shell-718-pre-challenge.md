---
pre_challenge: true
method: challenge-loop
branch: ios-shell-718
diff_hash: f7abb0b9168faabb63500dcf0dfec1d27b7170d86909cf1c23613e5054114ed9
validation: passed (full kosmos sequence on 33069258: 9040 tests, 0 failed; an earlier run on the same HEAD had 1 unrelated contention red in engine/sendertoken.test.js, green 3/3 alone, filed as #3686)
subdir_audit: passed
timestamp: 2026-09-25T04:52:02Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (reviewer models alternating: opus, sonnet, opus, sonnet, opus, sonnet, opus, sonnet, opus, sonnet)
**Converged:** Yes, at iteration 10 on HEAD 33069258 (NITs only)
**Total findings:** 30 (1 BLOCKER, 24 WARNINGs, 5 CONVENTIONs, plus NITs)
**Fixed:** 30 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Note on iteration 8 and after
Iteration 8 (sonnet, on 609bff39) found only NITs, which was a convergence. Before the PR was
opened, a colleague (Scorpion, m578) showed that the shell's `.never` scroll-view inset would put
the board (which does not use viewport-fit=cover) under the status bar. That was fixed in
c7cafc5e, and the loop was reopened rather than shipping the old convergence: iteration 9 found
four WARNINGs and a CONVENTION, fixed in 33069258, and iteration 10 converged again.

### Note on iteration 7's findings
Iteration 7's reviewer text was not kept verbatim. Its findings are recorded from the fix commit
609bff39, whose message lists them.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] ios/Kosmos/ContentView.swift : Try again and the reconnect reload depended on updateUIView seeing a change on a plain `let` ShellState, so it could never fire --> FIXED (720c23b9: retry count passed as a value)
- [WARNING] ios/Kosmos/ContentView.swift : Try again reloaded the last page that loaded, not the one that failed --> FIXED (720c23b9: NSURLErrorFailingURLErrorKey)
- [WARNING] ios/Kosmos/ContentView.swift : a new-window about:blank was mishandled --> FIXED (720c23b9)
- [WARNING] ios/Kosmos/ContentView.swift : the link rule ran on redirects and form posts, not only taps --> FIXED (720c23b9: Origin; later superseded by round 7)
- [WARNING] ios/Kosmos/ShellLogic.swift : data: and blob: refused silently --> FIXED (720c23b9: named on purpose, documented)

#### Iteration 2 (sonnet)
- [WARNING] ios/Kosmos/ContentView.swift : load failures were not logged --> FIXED (a00b76d8: domain, code and host only)
- [WARNING] ios/Kosmos/ContentView.swift : failure state survived the biometric re-lock --> FIXED (a00b76d8)
- [WARNING] ios/Kosmos/ShellLogic.swift : any third-party https page reached by script stayed in the app --> FIXED (a00b76d8; fully closed in round 7)
- [CONVENTION] ios/Kosmos/PushBridgeLogic.swift : the agent-session rule's comment did not match the board's NAME_RE --> FIXED (a00b76d8)

#### Iteration 3 (opus)
- [WARNING] ios/Kosmos/ContentView.swift : failedURL not cleared when another navigation finished --> FIXED (5ec32c7d)
- [WARNING] ios/Kosmos/ShellLogic.swift : connection lost counted as offline --> FIXED (5ec32c7d: unreachable)
- [WARNING] ios/Kosmos/ShellViews.swift : retrying could stick with no WebView --> FIXED (5ec32c7d)
- [WARNING] ios/Kosmos/ContentView.swift : the scroll view was navy against the plan --> FIXED (5ec32c7d)
- [WARNING] ios/Kosmos/ShellLogic.swift : pageFlow covered back/forward and reload too --> FIXED (5ec32c7d)
- [CONVENTION] ios/README.md : the link sentence was inaccurate --> FIXED (5ec32c7d)
- [CONVENTION] ios/Kosmos/PushBridgeLogic.swift : boardURL doc missed the agent query --> FIXED (5ec32c7d)

#### Iteration 4 (sonnet)
- [WARNING] ios/Kosmos/ContentView.swift : subframe navigations were unrestricted --> FIXED (05e6e4b4: Shell.allowsSubframe)
- [CONVENTION] ios/Kosmos/PushBridgeLogic.swift : the session length was a raw literal --> FIXED (05e6e4b4: agentSessionMaxLength)

#### Iteration 5 (opus)
- [WARNING] ios/Kosmos/ContentView.swift : a tap on a third-party page mid-flow went to Safari and stranded the flow --> FIXED (4ac521fa; superseded in round 7)
- [WARNING] ios/Kosmos/ShellLogic.swift : mailto/tel/sms could be opened by script --> FIXED (4ac521fa: a tap or requested window only)

#### Iteration 6 (sonnet)
- [WARNING] ios/Kosmos/ContentView.swift : once on a third-party page, the app could browse on indefinitely --> FIXED (f6c690db)

#### Iteration 7 (opus)
- [WARNING] ios/Kosmos/ShellLogic.swift : a hostile third-party page kept inside the app could show a fake Kosmos screen --> FIXED (609bff39: every other site goes to Safari however reached)
- [WARNING] ios/Kosmos/ShellViews.swift : the failure page could trap the person on a dead Mac --> FIXED (609bff39: Back to Kosmos)
- [WARNING] ios/Kosmos/ShellLogic.swift : media handled by a plug-in (WebKit 204) showed as a failure --> FIXED (609bff39)
- [WARNING] ios/Kosmos/ContentView.swift : the refresh spinner could hang with no WebView --> FIXED (609bff39)

#### Iteration 8 (sonnet)
NITs only. Converged (reopened, see above).

#### Iteration 9 (opus)
- [WARNING] ios/Kosmos/ContentView.swift : Back to Kosmos after a provisional failure skipped the page still showing --> FIXED (33069258: Shell.backAction, tested)
- [WARNING] ios/Kosmos/ShellViews.swift : an offline page shown while already online never retried --> FIXED (33069258: Shell.retriesOnShow, once per failure, tested)
- [WARNING] ios/Kosmos/ShellLogic.swift : the link rule's doc described the old rule --> FIXED (33069258)
- [WARNING] .claude/plans/ios-shell-718.md : Finished means described the old rule --> FIXED (33069258)
- [CONVENTION] ios/Kosmos/ShellLogic.swift : a dead `showing` parameter and its duplicate tests --> FIXED (33069258)

#### Iteration 10 (sonnet)
NITs only (README section order, plan file name suffix, the unrun callback order the plan already names). **Converged.**

### Mutation checks
Each tested rule was broken on purpose and the LogicTests went red (including Shell.backAction and Shell.retriesOnShow in iteration 9: FAIL 1 of 223 each).

### Strengths (across iterations)
- The decisions are Foundation-only and tested on a Mac without a simulator (223 checks)
- isMacHost is one derivation shared by the push tap and link routing
- The session token never reaches a log
