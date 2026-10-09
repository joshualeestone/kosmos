---
pre_challenge: true
method: challenge-loop
branch: winrunnav-5492
diff_hash: 1208face88b9b08a03c953474b01f59e4da86886efa5f84988839887fe4aba77
validation: passed (validation_log PASSED for stack=typescript hash=1208face88b9, full tools/run-tests.sh on main after #5610; tools.windows-computer-mode-4381.test.js 11 pass, Windows-only probe rows skip off Windows)
subdir_audit: passed
timestamp: 2026-10-09T04:21:54Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews, both opus (the second after rebasing onto main once #5483 merged as #5610). The full record is in .claude/plans/winrunnav-5492.md.

### Iteration 1 (opus)
- No issues found above NIT (CONVERGED). Confirmed:
  - connect behaviour is unchanged;
  - the Starting page, the first load and the `?boot=` 302 stay in the window;
  - no state leaks across mode switches;
  - Unset and Unreadable keep the older rule.
- [NIT] run and both let any about: or data: URL through: unchanged from before this card. Recorded.
- [NIT] IsBoardAddress also accepts localhost and [::1]: still this computer's loopback board. Recorded as a WINDOWS row.
- [NIT] two comments in other test files describe the older rule as if it covered every mode: FIXED at the rebase.
- [NIT] no probe row for a clicked board link: FIXED at the rebase (an InApp row).

### Iteration 2 (opus)
- [WARNING] with the release switch off, LaunchComputerMode() is Run on every Windows computer, so these rules reach every Windows user at the next release, while the switch comment said nothing below changes a Windows computer.
  - DECIDED: ship ungated, as the card asks for Mac parity (the Mac applies #5169 with its switch off).
  - The switch comment and the plan now say so, and name the unmeasured WebView2 wiring as the weakest premise, with a real-Windows check before the release.
- [NIT] the localhost row claimed open-board.js names localhost: FIXED wording.
- [NIT] the plan claimed new-window parity: FIXED. The Mac sends a new-window own-board link to the browser; Windows keeps it in the window (#2007, unchanged).
- [NIT] WebView2's "user-initiated" is wider than the Mac's "clicked": recorded in the plan. No board handler does that today.
- [NIT] the event handlers are pinned only by source text: recorded. Windows CI runs the decision rows.
- Confirmed: run and both route through #5483's ConnectLinkDecision, with no second copy that could drift, and the decisions match the Mac's #5169 code.

**Mutations (from the build):** removing the Starting-page line, passing the port on connect too, or dropping `runsBoard &&` each turns the #5492 test red.

**Weakest premise:** the real WebView2 wiring has not run on a real Windows computer. Before the release that carries this:
1. open a board on the Windows box (or Josh's PC laptop);
2. click an outside link: the browser should open;
3. confirm a provider sign-in still completes.
