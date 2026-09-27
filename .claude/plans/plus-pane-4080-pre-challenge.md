---
pre_challenge: true
method: challenge-loop
branch: plus-pane-4080
diff_hash: 3f304c57ab5d87c85f249ca0db6fa9cd35f16842e29a56b1e840485c9042fffb
subdir_audit: passed
timestamp: 2026-09-27T05:11:06Z
converged: true
---

## Challenge loop: #4080 the Kosmos Plus pane to Josh's design

#### Iteration 1 (blind, opus)
- [HIGH] web.second-factor-copy-1415 pinned the removed #plus-second --> FIXED: the guard reads the dialog's sentence.
- [HIGH] web.modal-way-out-1316: 18 modals over a ceiling of 17, plus-lost-modal not in ESCAPES_VIA --> FIXED.
- [HIGH] web.consolidated-980: the dialog made body's 39th child (the grid reserves 38) --> FIXED: moved into #s-sec-plus.
- [HIGH] the #2518 surface gate (plus-stars, unread-edge, agentdm) --> the checks were run on the branch; trailers added.
- [MEDIUM] the sign-in wizard's recovery line named "I lost my phone" --> FIXED ("Lost your phone?").
- [MEDIUM] the dialog lacked the plus-gate Tab trap and a document-level Escape --> FIXED; browser-checked (Tab wraps; Escape from <body>).
- [MEDIUM] closing and reopening mid-request lost the reset's answer --> FIXED (PLUS_SECOND_BUSY).
- [LOW-MED] two plus-stale tests asserted on an id nothing paints --> FIXED (the enrolled-only row).
- [LOW] stale comments, dead #plus-switch rules, an if(false) block --> FIXED.

#### Iteration 2 (blind, sonnet)
- [MEDIUM] a reset answered while the dialog was closed was cleared on the next open --> FIXED (PLUS_SECOND_UNSEEN); browser arm, red without it.
- [LOW] a stale test comment --> FIXED.
- (Harness: render-plus-gate-1615's #3151 arm counted the dialog's title as a section heading --> the arm skips .rm-back titles.)

#### Iteration 3 (blind, opus)
- [HIGH] the dialog was NOT an overlay: #s-sec-plus > *:not(#plus-stars) made it position:relative --> FIXED with #s-sec-plus > #plus-lost-modal; overlay arm (control: a 544x264 block without the rule).
- [LOW] the 5-second repaint re-enabled an in-flight reset --> FIXED.
- [LOW] a stray "?." in the recovery copy --> FIXED (quoted).

#### Iteration 4 (blind, sonnet)
No issues found. NO NEW FINDINGS.

## Evidence
- render-plus-panel-3829: ALL PASS, incl. switch, box, no address, logo, bottom row, dialog focus, Tab wrap, Escape from body, overlay, closed-then-answered reset, switch PUT, and #4079's Remove arms. Control on main's page: the #4080 arms FAIL.
- Harness on the branch: render-plus-panel-3829, render-plus-signin-3478, render-plus-gate-1615, render-plus-stars-3778, render-unread-edge-3743, render-agentdm-3414, render-fed-plus-gate: all PASS.
- web.*.test.js on the final files: 1912/1912. Full suite: 0 test failures (its exit 1 was the surface gate, since cleared with a trailer after render-fed-plus-gate passed). #1720 and #2518 gates pass.
