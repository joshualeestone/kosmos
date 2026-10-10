---
pre_challenge: true
method: challenge-loop
branch: joinwords-4649
diff_hash: 165d2112cfd60f533eeaf859118a89b85b8ce705aa5d2b23be8a8dc88ff6ddda
validation: NOT a clean local pass, stated plainly. The full validation failed only two OpenAI sign-in tests at their 4 s limit (openaiaccounts chatgpt-reauth and chatgpt-driver), outside this diff, the same two seen in earlier runs today and passing alone (the #5727 class). Related tests 68/68 pass. Browser checks through tools/browser-checks.sh PASS: render-federation-invite-4649, render-pjmode-style-3495, render-unread-edge-3743, render-fed-plus-gate, render-agentdm-3414. render-owncode-4649 PASS in chromium and webkit at 1280 and 390, and FAILS with the old message restored (control). The surface gate (sourced) returns rc 0. The merge is gated on all-green GitHub CI.
subdir_audit: passed
timestamp: 2026-10-10T01:10:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind review, then a re-check with the tightened browser check and its control)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
**Fixed:** the WARNING and one NIT. Two NITs were left, with reasons. | **Asked (awaiting user):** 0

The change (#4649, from a friction walk of the pilot's join steps on prod 0.7.35):
- The own-computer code's instruction named "Join a project", which did not exist; the path was + Add Project, then "Join an external project".
- Now the tab is "Join a project", the field "Enter your code to join a project:", and the instruction names + Add Project and Join a project in order. The invite's step names the same tab.
- Josh's verbatim invite sentence is unchanged.

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
- Checked: no visible text, doc, CLI line or agent-facing text in the tree still names the old tab or label. The remaining "external project" phrases (server 403 texts, fedseats room notes, Josh's sentence) name no control.
- Checked: "+ Add Project" and "Join a project" are exactly the page's visible labels.
- Checked: no test or browser check asserts the old strings, and Josh's sentence is intact in the page, the check and the test.
- [WARNING] render-owncode-4649 matched /Join a project/ anywhere in the message, so it passed on the old, wrong sentence and left this exact bug unguarded --> FIXED. It now asserts the whole instruction, and that + Add Project and Join a project are the page's own labels. Control: the old message restored makes it FAIL in chromium at 1280 and 390.
- [NIT] the screen-reader legend said "join an external one" --> FIXED ("join one").
- [NIT] the 420 px pjmode check no longer exercises a wrap, since the shorter label fits --> LEFT (it still guards overflow; the comment says so).
- [NIT] two comments still use the old name --> LEFT. One quotes Josh (editing a quotation falsifies it); the other is #3312 history.

#### Iteration 2
- Re-ran render-owncode-4649 on the final code: PASS in all four engine and width arms.
- The working tree was verified clean after the control (restored by hand when a transient git index.lock blocked the checkout).
