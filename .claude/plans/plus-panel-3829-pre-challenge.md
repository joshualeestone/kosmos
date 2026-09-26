---
pre_challenge: true
method: challenge-loop
branch: plus-panel-3829
diff_hash: 3080667e6d5cf445dff4a138ca24cecb97f617bb2c2ffea9c47258f91f134d5f
subdir_audit: passed
timestamp: 2026-09-25T23:23:09Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review pass (opus: code and design, against Mona Lisa's review list and the before/after shots).
**Converged:** Yes. 1 blocker and 5 warnings, all fixed; nits mostly taken.

## Iteration 1 (opus)
- [BLOCKER] The new check's screenshot ran even with no shots folder, which is how CI runs it. Fixed: the screenshot is braced under if (SHOTS).
- [WARNING] "Not now" was only half removed. A leftover session flag could hide a request with no way back. Taken: removed entirely, and an old flag is cleared on load. The tab dot now marks any waiting request.
- [WARNING] A stale request cannot be put away. Decision (the card allowed "faded or expired"; the engine has no expiry): it fades. Denying an OLD request no longer accuses anyone, while a fresh Deny keeps the password sentence.
- [WARNING] "Connecting" was shown forever when the switch was on but nothing was running. Taken: a "Not connected" pill, with the engine's reason as the line.
- [WARNING] Two cards read "Allow, Deny, Allow, Deny" to a screen reader. Taken: aria-labels name the device and the code.
- [WARNING] The stale fade dropped text contrast. Taken: only the border and the icon fade.
- [NIT] An aria-label on a div. Taken: a visually hidden span.
- [NIT] Stale comments. Taken.
- [NIT] The Open link now requires a hostname.
- [NIT] The "shown once" test was strengthened.
- [NIT] Turn off sits beside the line rather than below it. Not taken: it is quiet and one line, and Mona can call it.
- [NIT] The card is framed twice. Not taken: the outer edge carries #718's contrast rule.

## Measured
- The full suite had 0 unit failures. The surface gate named render-plus-stars-3778 and render-plus-gate-1615; both pass on this branch (trailers). Running every check that names this surface found render-plus-signin-3478 reading the old status line: fixed and green. render-openai-step needs a live board (not hermetic, and not this surface).
- render-plus-panel-3829 covers the off, not-running, connected, one-request and two-request states. Perturbed red:
  - the old phone wording, and the bare "device";
  - the password line on an old Deny.
- Shots: ~/.cache/claude-handoffs/shots-3829/before (main) and after.

## Weakest premise
- Requests stay in the app-wide card rather than moving into the Plus panel as Mona's sketch drew them. The card is what catches a request in any view. Mona can overturn it; moving it is one render target.
