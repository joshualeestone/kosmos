---
pre_challenge: true
method: challenge-loop
branch: computer-3758
diff_hash: 28191cbd2b1004466f81a68b9555b63a0857338b37104df5467917afede4f470
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T17:15:36Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 had nothing at WARNING or above)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (not taken)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
What the reviewer verified, each by reading:
- The nav button (data-go="mac"), the section's aria-label, the setup wizard's screen-reader line, the agents tile's
  aria-label and the guide's close ask all read "Computer" / "Close for now" / "Close forever", in Josh's words, with
  no trailing period on the line (as he wrote it and as B7b asserts).
- B7b's textContent normalisation of the non-breaking spaces matches the asserted string exactly, so the nbsp that
  holds "Settings > Computer" together does not break the check; its nav-name arm reads the renamed button.
- A case-insensitive sweep of web/index.html, engine/*.js, server.js and the tests finds no user-facing place that
  names the Settings section "This computer"; the remaining hits are prose about the machine (#1004's product voice).
- The Windows copy table has no section-name string. The guide's knowledge (roles.js, setup-assistant.js,
  hostedguide.js) carries no section-name copy.
- The inline script around the ask's string concatenation is intact (a comment between +-joined strings is valid).
NIT not taken: web.settings-nav.test.js and engine.setup-assistant-3034.test.js still say "This computer" in test
titles and comments; they assert by ids and booleans, not copy, and are not user-facing.

## Validation
6j on HEAD: full suite clean (hash 28191cbd2b10), subdir audit clean. render-assistant-bubble-3034: 75 pass, 0 fail,
B7b and B8 included; render-assistant-hosted-3660 passes. web.settings-nav, server.setup-guide-page-3034, browser-checks-selectors and install.this-computer tests pass.
