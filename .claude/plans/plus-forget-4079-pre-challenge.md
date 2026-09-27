---
pre_challenge: true
method: challenge-loop
branch: plus-forget-4079
diff_hash: 6e36ae1ee7c15871d8c19761fb493d589458840fd5a016aac39e17280abc3861
subdir_audit: passed
timestamp: 2026-09-27T03:27:58Z
converged: true
---

## Challenge loop: #4079 Kosmos Plus, Remove this computer

#### Iteration 1 (blind, opus)
- [LOW-MED] the confirm opened with focus on the destructive button, so a held or repeated key could carry
  straight through it --> FIXED: focus goes to Cancel; the browser check asserts it.
- [LOW] on failure focus fell to the page body --> FIXED: focus returns to the Remove this computer button.
- [LOW] a 500 read "still connected: we could not forget this computer: ...", with two colons, and "still
  connected" could be untrue after a late engine failure --> FIXED: "Removing it did not finish: <why>.", with
  the prefix and trailing stop trimmed.
- [LOW] the result line could go stale after the computer is enrolled again another way --> FIXED: cleared
  whenever the pane reads connected.
- [LOW] two comments still said Turn off --> FIXED.
- Checked clean: a null body on a 200 takes the failure path; double-click is prevented (buttons disabled before
  the await, and the engine dedups); after forget, paintPlus lands in the not-connected state; the Pause rename's
  only reader compares against 'Turn on'; phone-notify's separate 'Turn off' is correctly unchanged; no em dashes.

#### Iteration 2 (blind, sonnet)
No issues found. NO NEW FINDINGS. (It also flagged that the Remove relabel was then mid-edit; it was completed and
committed, comments included, before this proof.)

## Evidence
- render-plus-panel-3829.js: all PASS, including told / untold / failed, the confirm surviving the 5-second repaint,
  Cancel sending nothing, focus on Cancel, and Pause. Control on main's page: FAIL (no Remove this computer; Turn off).
- Plus unit tests (plus-tab, plus-stale, lost-phone, phone-notify-718, plus-route): 36/36 at the final commit.
- #1720 gate passes; #2518 passes with trailers for render-unread-edge-3743 and render-agentdm-3414 (the token
  'msg' matched only the new ids and a local variable).
