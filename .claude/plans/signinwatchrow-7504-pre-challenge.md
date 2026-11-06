---
pre_challenge: true
method: challenge-loop
branch: signinwatchrow-7504
diff_hash: 556e5fa2b7948ad033138162362b214c488810d9c5537f7bbf54ba458e7fa340
validation: pending (full suite queued after convergence, per the fleet's queue rule; focused suites, the browser check and both browser-check gates passed every round)
subdir_audit: passed
timestamp: 2026-11-06T03:03:13Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 raised no BLOCKER, WARNING or CONVENTION)
**Total findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, about 20 NITs
**Fixed:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 10 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Between iterations 1 and 2 the design changed on Mona Lisa's design review (the page owns the words, worded per
failure kind); iterations 2 to 5 each reviewed the whole branch after that change. Every fix was checked by a
mutation that undoes it and turns a test red (14 mutations), restored by byte comparison. Focused suites at the last
head: web.win32-start-at-sign-in, engine/win32board.start-at-sign-in, engine/win32boardwatch (135/135),
tools.win-launcher-native (16 pass, 14 Windows-only skipped), docs/browser-checks/render-signin-recovery-7504 (all
passed, Chromium and WebKit, desktop and phone).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] web/index.html startAtSignInRecoverySaid - the full-stop rule kept only a bracket after a full stop (superseded by the redesign)
- [NIT] web/index.html machineSwitchClick - when the rows cannot be read back, the recovery line wins over the unread line (left)
- [NIT] plan - a switched-off answer with a failed watchdog is theoretical (the engine registers only on switching on)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the detail taken from the first line of `out`, written after the design review)
- [BLOCKER] engine/win32board.js installWatchdog - on Windows schtasks writes its refusal to stderr and `out` falls back to Node's "Command failed: schtasks.exe ... C:\Users\<name>\..." message, so the page would have shown a command and the person's folder --> FIXED (run() adds stderr and timedOut; detail only from an ERROR: line)
- [WARNING] engine/win32board.js installWatchdog - every failed /Create was refused, including a timeout and a missing schtasks --> FIXED (timeout is no-time, no ERROR: line is other)
- [WARNING] web/index.html - "will not reopen on its own if it closes yet" read as "closes yet" --> FIXED ("on its own yet if it closes")
- [CONVENTION] .claude/plans/signinwatchrow-7504.md - the first design's sections read first --> FIXED (marked superseded)
- [NIT] installWatchdog doc comment did not name kind/detail --> FIXED
- [NIT] mobile-shots entry split the keep-awake comment from its entries --> FIXED
- [NIT] kind other from an unknowable folder offers a retry that cannot help (left)
- [NIT] rows unreadable after a click: the line may name a switch the page removed (left)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (the WARNING is older than this branch, from #7498)
- [WARNING] engine/win32board.js installWatchdog - `because` still quoted Node's command line with the person's folder, and the route and the boot log carry it --> FIXED (quotes schtasks' ERROR: line when there is one)
- [NIT] detail had no length cap --> FIXED (120 characters)
- [NIT] a path-bearing ERROR: line was refused --> FIXED (other)
- [NIT] timedOut also true for any signal --> FIXED in iteration 4
- [NIT] withWatchdog answers carry no kind (left; only the boot log reads them)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the refused rule written in iteration 2)
- [WARNING] engine/win32board.js installWatchdog - refused meant any ERROR: line, including our own mistakes ("The task XML is malformed.") --> FIXED (refused needs denied, policy, privilege or not permitted)
- [WARNING] engine/win32board.js ensureWatchdog / web/index.html - a watchdog whose presence could not be read was said as "will not reopen" --> FIXED (kind unknown, its own sentence)
- [NIT] with no schtasks words, because fell back to Node's command line --> FIXED
- [NIT] timedOut true for any signal --> FIXED (ETIMEDOUT only)
- [NIT] a detail ending in ? or ! got an extra full stop --> FIXED
- [NIT] a localized ERROR: prefix is other (left)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] a denial naming a user without a separator would reach the page (schtasks' real denial does not)
- [NIT] the route now returns kind and detail beside because (loopback, the person's own page)
- [NIT] kind other from an unknowable folder offers a retry that cannot help (known)
- [NIT] the plan's iteration-3 note about signals describes the code as it was then
- [NIT] withWatchdog and localized prefixes (known)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | BLOCKER | engine/win32board.js installWatchdog | SELF | detail from Node's command line and path | FIXED | 3664a8eb21 |
| 2 | 2 | WARNING | engine/win32board.js installWatchdog | SELF | timeout and missing exe called refused | FIXED | 3664a8eb21 |
| 3 | 2 | WARNING | web/index.html startAtSignInNoReopenYet | SELF | "closes yet" word order | FIXED | 3664a8eb21 |
| 4 | 2 | CONVENTION | .claude/plans/signinwatchrow-7504.md | BRANCH | superseded design read first | FIXED | 3664a8eb21 |
| 5 | 3 | WARNING | engine/win32board.js installWatchdog | BRANCH | because quoted Node's command line (from #7498) | FIXED | be8ff9e191 |
| 6 | 4 | WARNING | engine/win32board.js installWatchdog | SELF | refused for our own schtasks errors | FIXED | 32fd6e96c6 |
| 7 | 4 | WARNING | engine/win32board.js ensureWatchdog | BRANCH | unreadable presence said as "will not reopen" | FIXED | 32fd6e96c6 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Kind other from an unknowable folder offers a retry that will give the same answer (iterations 2, 5).
- When the rows cannot be read back after a click, the line may name a switch the page has just removed (iterations 1, 2).
- A localized ERROR: prefix (FEHLER:, ERREUR:) is other, so a German refusal shows no Windows words (iterations 4, 5).
- withWatchdog's boot-path answers carry no kind; only the boot log reads them (iterations 3, 5).
- A denial naming a user without a separator would reach the page; schtasks' real denial does not (iteration 5).

### Strengths (across all iterations)
- The page owns all five sentences; the engine's `because` never reaches the DOM, asserted for every kind (iterations 3, 5).
- Text only (textContent); markup in Windows' words is shown as text, checked in two browser engines (iterations 1, 2).
- run() only gained fields; `out` and `code` are unchanged for every existing reader (iterations 3, 4).
- Fixtures follow the real Windows failure shapes: refusal on stderr with CRLF, inside Node's message, timeout, missing exe (iterations 4, 5).
