---
pre_challenge: true
method: challenge-loop
branch: openticketapp-6406
diff_hash: 9ff5ef2069373be62dda720a7651e183211863dffd2108653962b9abace37f90
validation: passed (after rebasing onto main: engine/remote.openticket-6406 3/3, web.computers-switcher-4648 14/14, server.test.js 6406 1/1, web.allow-card, web.plus-tab, web.allagents-4812, web.otheraccounts-6178, browser-checks-reason-grep, tools.browser-checks-wired 0 failing; render-computers-4648.js 116/116 Chromium + WebKit light + dark; both browser-check gates 0. The full suite runs in PR CI)
subdir_audit: passed
timestamp: 2026-10-17T23:16:08Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (alternating sonnet and opus)
**Converged:** Yes
**Total findings:** recorded per iteration in the commit messages and the plan's review log
**Fixed:** every BLOCKER and WARNING, or stated as a limit with its reason in the plan | **Deferred:** NITs only | **Asked (awaiting user):** 0

Card #6406 step 2, the app half (Josh 11:31/11:32/12:04: reach the other computer in the Kosmos app with no sign-in).
In the app, a click on another of the person's computers asks THIS computer for a ticket and opens the other computer
with it as #kpt=. The tunnel half is kosmos-relay openticket-6406. Before that ships, the route answers 400 and the
plain address opens, as today.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] server.js — the screen-only comment overstated what it guards --> FIXED (wording; local-process limit stated)
- [WARNING] server.js — the relay header premise was unpinned --> FIXED (pinned by a test in the relay branch)

#### Iteration 2
**Reviewer model:** opus
- [WARNING] web/index.html — unchosen-mode Windows sends the ticket to the person's browser --> STATED (the person at this computer; single use, two minutes)
- [WARNING] web/index.html — no feedback while the ticket is made --> FIXED (aria-busy, progress cursor)
- [NIT] x-forwarded-for-only case untested; AbortController fallback --> FIXED

#### Iterations 3-5
- [WARNING] iteration 3 — the 8 s fallback untested --> FIXED (fake timers; mutant red)
- [WARNING] iteration 4 — a script navigation sent this board's address as Referer --> FIXED (computersGo: a throwaway noreferrer link)
- [WARNING] iteration 4 — "on this computer" only negative; a person's own reverse proxy passed --> FIXED (madeOnThisComputer: loopback Host AND Origin, nothing forwarded)
- [WARNING] iteration 5 — headers alone can be forged from the network --> FIXED (isLoopbackPeer too)

#### Iterations 6-9
- [WARNING] iteration 6 — the socket arm and the noreferrer path untested --> FIXED (ticketCallerHere arms; the click harness takes the page path)
- [WARNING] iteration 7 — the route not tied to the rule; a tunnel failure's words reached the page --> FIXED
- [WARNING] iteration 8 — Kosmos+ refused only by the forwarding headers --> FIXED (boardCookieHere: the board cookie, which Kosmos+ strips); the board page strips #kpt= on load (browser-checked, mutant red after a non-discriminating first arm was corrected)
- [WARNING] iteration 9 — no bypass found; strip only the kpt key; own timeout --> FIXED

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 5 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 4 | WARNING | web/index.html computersOpenClick | BRANCH | Referer leak | FIXED | computersGo |
| 2 | 4 | WARNING | server.js open-ticket | BRANCH | own reverse proxy passed | FIXED | madeOnThisComputer |
| 3 | 5 | WARNING | server.js open-ticket | BRANCH | network socket with forged headers | FIXED | isLoopbackPeer |
| 4 | 8 | WARNING | server.js open-ticket | BRANCH | one signal against Kosmos+ | FIXED | boardCookieHere |
| 5 | 2 | WARNING | web/index.html | BRANCH | unchosen Windows mode | STATED | plan |

### Validation
- See the frontmatter. Mutants red during the loop: no relay guard, no address check, no ticket shape, modified clicks taken, listener removed, no 8 s fallback, no x-forwarded-for half, no Origin half, no socket half, script navigation instead of the link, no load-time strip.
- Screenshot: none (no visual change beyond a busy cursor on a link while its ticket is made).

### NITs (non-blocking, across all iterations)
- see iteration 10 (the strip's place in the page script, a test arm's comment, plan formatting)

### Strengths (across all iterations)
- three independent signals for "this computer's own screen": loopback socket, loopback headers with nothing forwarded, the board cookie (iterations 5-10)
- every failure opens the plain address exactly once; nothing is worse than today (iterations 2-10)
