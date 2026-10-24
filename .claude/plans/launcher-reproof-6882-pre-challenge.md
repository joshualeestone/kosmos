---
pre_challenge: true
method: challenge-loop
branch: launcher-reproof-6882
diff_hash: 9ad57503aae2b0a7d8e45095ff362dfad121122337f3f00d27962d86c18e02aa
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T17:15:59Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 fresh blind reviews (a separate review agent each round, given only the branch, the card and the context)
**Converged:** Yes (round 10: NOTHING ACTIONABLE)
**Fixed:** every actionable finding of rounds 1 to 9 (ledger in .claude/plans/launcher-reproof-6882.md), except two documented as accepted costs and one pre-existing gap deferred (another loopback port carries the cookie)

Between rounds 3 and 4 the live rig on this box disproved the design's weakest premise (WebView2 holds a navigation's
request while NavigationStarting runs): it does not. The reloads the window starts were reworked to prove before they
start, and the NavigationStarting check is documented as a guard on what is shown.

Validation: tools.win-launcher-reproof-6882.test.js and the touched launcher suites green with the preload; every new
arm run red with its fix reverted (58 reverts); tools/windows-tests.js on branch and clean origin/main, same 5
non-passing entries (all box-local, pre-existing). Kosmos.exe rebuilt and signed; verify-launcher.ps1 OK.

## Final ledger

### Round 1
- [WARNING] a synchronous 3 s check refusing on no answer would lock a busy board's person out (FIXED: quick check, then a full check off the window's thread)
- [WARNING] a page-asked sign-in (#6512) shown NotConfirmed on one slow answer or a held token (FIXED: page-asked is patient)
- [WARNING] late answers acted on the next visit (FIXED: boardVisit)
- [NIT] a double-click during a sign-in was dropped (FIXED: startOverWanted)
- [NIT] a squatter stalling only the proof evaded the watch (FIXED: 3 no-answers in a row)

### Round 2
- [WARNING] a deferred navigation dropped across visits (FIXED)
- [WARNING] a board restart treated as final for a navigation (FIXED: CheckBoardPatiently waits up to the opener's 20 s)
- [NIT] a token held by antivirus refused at once (FIXED: waited out)
- [NIT] a re-issued Navigate is not a reload (STATED)
- [NIT] a double-click's fresh sign-in thrown away (FIXED)

### Round 3
- [NIT] a page-asked sign-in after a failed check dropped (FIXED)
- [NIT] a deferred reload of an address with a fragment loaded nothing (FIXED: Reload)
- [NIT] a window taken off its board never came back (FIXED: RecoverBoard, capped)

### Live rig, between rounds 3 and 4
- [BLOCKER] WebView2 sends the request before NavigationStarting is answered, so the check guarded display only (FIXED: crash reload and reload keys prove first; comments say what the check guards)

### Round 4
- [WARNING] Back to a board page under NotConfirmedPage showed an unwatched board (FIXED)
- [NIT] AltGr+R taken as a reload (FIXED)

### Round 5
- [WARNING] a held ?boot= load replayed with a spent code (FIXED: sign-in loads approved; measured live)
- [NIT] a failed load stuck on the error page after a quick restart (FIXED: one retry)
- [NIT] right-click Reload/Back/Forward claim (FIXED: comment; STATED as accepted)

### Round 6
- [NIT] failed-load retry once per window life (FIXED), stale comments (FIXED), watch over a Kosmos Plus page (FIXED)
- [NIT] another loopback port carries the live cookie (DEFERRED: pre-existing)

### Round 7
- [NIT] three comments claimed the check stops the request (FIXED)

### Round 8
- [WARNING] an unreadable board.token read as no token in the window's fallbacks (FIXED)
- [NIT] a waiting navigation pulled the window off a Kosmos Plus page (FIXED)
- [NIT] a late sign-in loaded on an older proof (FIXED: proved again)
- [NIT] a download-ending navigation would be retried (FIXED: only unreachable statuses)

### Round 9
- [NIT] fragment compare for a replayed reload (FIXED), a replayed sign-in not approved as one (FIXED)

### Round 10
- NOTHING ACTIONABLE
