# gemini-checks-fix: the two Gemini browser checks the nightly run found red

Card: Splinter's HEADS-UP 2026-09-26 08:05 (nightly #3813, run 36239853904 on main 52261a82); must be green before the 0.6.97 cut, which exists for Josh's Gemini choice.

## What finished looks like
Both `render-accounts-openai` and `render-provider-combobox-1040` pass on a Mac with or without the gemini tool installed, and each still fails on the defect it guards.

## Findings (measured)
- render-provider-combobox-1040: #2234 (594d51a1a) added a help link under the Add-a-provider picker, so the dialog is taller and Gemini's option now sits inside it (option middle 514, dialog bottom 523 at 900x700). The check's geometry precondition (Gemini past the dialog edge) failed on every machine; the product was fine.
- render-accounts-openai: since #3910 the "Use an API key" press re-reads the gemini tool, and where it is missing the page correctly shows the download step. The check assumed the key step, so it passed on Agent1s (gemini installed) and failed on the nightly Mac (not installed).

## Decided
- combobox: keep mouse-picking Gemini and Grok and asserting the dialog stays open for each; the non-vacuous condition becomes "at least one picked option sits past the edge" (today Grok). Negative control measured: Gemini alone fails the new assertion. Rejected: shrinking the viewport to push Gemini out again, which ties the check to one layout and breaks again on the next height change.
- accounts-openai: pin the page's `/api/runners` answer to present for gemini/grok in the #3566 section (from the board's real answer), since the download path has its own check (render-keyed-install-3713). Control arm KOSMOS_BC_RUNNERS_ABSENT=1 reproduces the nightly failure exactly. Rejected: branching the check on the machine (it would silently test less on the nightly Mac).
- Weakest premise (checked in review round 1): the download path from the "Use an API key" press is covered by render-settings-agy-3874 ("Use an API key with the Gemini CLI missing goes to its download"), not by render-keyed-install-3713 as first written; 3713 covers the direct pick.

## Not in scope
The other four nightly reds (live-connect, render-boot-no-flash, render-plus-bar-3837, render-talk) are not Gemini and not mine; Baron is re-running the full set on Mortals.

## Review round 1
- The runner pin passes a failing board answer through (non-OK status, non-JSON, or a fetch that throws is a named FAIL), so it cannot turn a broken /api/runners into a healthy one; the route is unrouted with the apikey route.
- Comments cite render-settings-agy-3874 for the download path; README row and file header describe the pin and its control arm.
- The combobox check prints each pick's geometry as a NOTE line, so the remaining margin is visible every run.

## Review rounds 2 and 3
- One commit in the repo's `<branch> -- <message>` format; the control arm renamed KOSMOS_BC_RUNNERS_ABSENT (it reports gemini AND grok missing); the combobox README row brought current.
- Kept, deliberately: this check no longer exercises the real gemini/grok binary detection (render-settings-agy-3874 and render-keyed-install-3713 assert the missing-tool path; the real detection is engine-level).
- No "which option sits past the edge today" in comments or the README (it goes stale on the next dialog change, as "Gemini and Grok" did); the NOTE geometry line and the pick label say it per run. Measured at this commit: Grok's option middle 548 vs dialog bottom 523 (25px past), Gemini's 514 (inside).
- The surface trailers are dropped: this branch changes no web/ file, so they did nothing and read as a deliberate surface deferral.

## Review rounds 4 and 5
- route.abort() guarded as the sibling check does; comment rewrapped.
- A board error status is now a named FAIL too (all three failure kinds are named, as the comment and README say); a null body cannot throw in the handler; a NOTE says when the control arm is on; the README row names where the download path is covered.
- The per-pick assertion name stays stable (the geometry is on the NOTE line, not in the name).
- Declined: `unrouteAll({ behavior: 'ignoreErrors' })` for a runners read in flight at close; nothing reads runners after the last assertion, and `unroute`'s second argument is a handler, not options.

## Review round 6
- BLOCKER fixed: `route.fetch()` returns an APIResponse whose `ok` and `status` are METHODS on the pinned Playwright, so round 5's `!real.ok` was always false and the board-error branch was dead. Now `ok()` / `status()`. Lesson: the branch was added without anything exercising it; a second control arm (KOSMOS_BC_RUNNERS_BOARD_ERROR=1, the read sent to an address the board does not serve) now runs it, measured: `FAIL #3566 the board answers the runner read  status 404`.
- Declined: returning early after a failed reveal to skip the 30s wait on #acct-apikey-go. That structure is on main unchanged, the check still goes red, and restructuring the section widens a fix 0.6.97 is waiting on.

## Review round 7
- A 200 answer without a runners map holding gemini and grok entries is a named FAIL and passed through, not pinned (a changed /api/runners shape would fail the page on every machine, so the check must not invent one).
- History trimmed from code comments (the nightly run, "dead code once"); it lives here and in the commit.
- Considered and deferred to a follow-up card: stub gemini/grok binaries through AGENT_WORKFORCE_GEMINI_BIN / AGENT_WORKFORCE_GROK_BIN in the harness's render-accounts-openai boot (tools/browser-checks.sh, as it already does for codex and claude), which would exercise the real server-side detection and retire the route pin. Not taken here: it changes the shared harness script while the 0.6.97 cut waits on this branch.
