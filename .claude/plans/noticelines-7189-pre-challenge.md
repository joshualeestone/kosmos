---
pre_challenge: true
method: challenge-loop
branch: noticelines-7189
diff_hash: 7c2a61dc665765545988958b82448e3b433430b3968d13ebd6d8b98bbb574c4c
validation: passed (focused node set of 74 files chosen by who reads server.js notes, the room text view, msg-valve, the notice CLI usage, plus fixture-discipline, cli.sandbox-data-4796, engine.reachable, no-brand-refs and no-name-refs: 1311/1311 before and after rebasing onto main; controls: the new tests fail on origin/main's server.js and web/index.html, and dropping the text-view flatten fails the forged-row test, its no-own-row assertion measured live on its own)
subdir_audit: passed (no CLAUDE.md in the diff)
timestamp: 2026-10-26T13:02:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind reviewers, opus then sonnet)
**Converged:** Yes (iteration 2: no new BLOCKER or WARNING)
**Fixed:** 2 | **Deferred:** 1 | **Accepted:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
[WARNING] the forged-row test's "no own row" assertion matched the old double space, which the store now tidies, so it could not fail. Fixed (matches any whitespace; measured live).
[NIT] the text view's flatten missed U+0085 (`\s` does not match it). Fixed for notes and posts.
[NIT] no test sent a lone CR, VT or FF. Fixed (pinned in the multi-line test).
Not an issue: the test board's update-check boot line (first look is on an unref'd 60 s timer).
Noted for design: the phone centres Kosmos lines.

#### Iteration 2
No new issues found. Accepted: the Mac CLI maps a lone CR to a space where the server makes a break (CRLF identical). Deferred (predates the card): a raw VT or FF piped through the Mac CLI is refused as invalid JSON.

### After the loop
- CI's coarse browser-check gate (#1720) was red on the first push: a web/ change with no browser-check assertion. Added one to docs/browser-checks/render-projects.js (a seeded multi-line note must draw two <br> and occupy at least three visual lines, measured from the rendered text), a design-shots screen (room-notice-7189) in mobile-shots.js, and a per-check surface trailer for render-no-left-bars-3692.js (the band gains only <br>; its border and left edge are unchanged). Both gates rc 0 locally. The tests that read mobile-shots.js: 110/110.
- Design review (Mona Lisa): band approved; on a multi-line notice the time now stands on its own line, right-aligned (`.msg-valve-ml .msg-t`), asserted in the web test (class) and in render-projects.js (the time's top at or below the words' last line, measured from the rendered text). Surface trailer for render-agentdm-3414.js (the new .msg-t rule is scoped to .msg-valve-ml). The shot screen now ends at the room's newest row. Her phone question (the composer over the last row) holds at the room's true end, so it is filed as #7196 with the ordinary-message control she proposed.
