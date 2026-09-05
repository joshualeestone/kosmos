---
method: challenge-loop
branch: emoji-picker-2254
diff_hash: 3a56a03f9254b0e1a094dbb97a9f4606ab1fea93356626f2af6dfbed20be070b
subdir_audit: passed
---

# Challenge-loop ledger — #2254 (composer emoji picker)

Two rounds of fresh, blind review, each of which RAN the pw-runtime browser-check and empirically
perturbed the product. No blockers in either round; escalating quality, ending in only deferred-v1
polish. Every fix is browser-verified (10/10) and perturbation-guarded.

#### Iteration 1

[WARNING] The emoji buttons inserted on `mousedown` ONLY, so a keyboard user (focus a button,
Enter/Space -> `click`) could open the panel but not pick anything - the aria markup advertised access
the handler did not deliver. Fixed: switched the panel insert listener to `click`, which fires for both
mouse and keyboard, with no double-insert (only `click` inserts once per activation); pjEmojiInsert's
input.focus() returns focus to the composer and the caret's selectionStart is preserved. Added a
keyboard arm to the check. Perturbation-verified: reverting click->mousedown reds the keyboard arm
while the mouse arm still passes.

[NIT] role="dialog" over-promised a modal with focus management -> role="group" (a labeled group of
buttons). [NIT] corrected an inaccurate listener comment.

#### Iteration 2

[STRENGTH] Independently confirmed keyboard + mouse work with a single insert path and NO double-insert
(reverting click->mousedown reds ONLY the keyboard arm; the mouse arm inserted exactly once). Confirmed
no regression by construction (0 deletions; the diff only appends). XSS/leak/array all clean.

[WARNING] `aria-haspopup="true"` on the trigger maps to "menu" but the panel is role="group" - fixed
by removing it. [WARNING] Escape from inside the panel dropped focus to <body> - fixed: pjEmojiClose
restores focus to the trigger when a panel button held it (guarded on activeElement so an outside click
does not have focus yanked). New browser-check arm asserts the restore (10/10).

[NIT] tab order (emoji buttons after Post) and [NIT] redundant per-button aria-label: deferred as
v1-acceptable, documented in the plan and the PR - reachable/harmless, both follow-up polish.

### Final Ledger

Converged: no blockers across two rounds; round 1's substantive keyboard WARNING is fixed and guarded
by a perturbation-verified check arm; round 2's findings were non-blocking a11y polish, the fixable
ones fixed (aria-haspopup, focus-restore) and the rest deferred with reasons. Browser-verified 10/10
via pw-runtime. Additive only (0 deletions to existing lines), so no regression to the @ picker,
attach, draft-save, auto-grow, or Enter-to-send. Scope is the project composer (v1); the agent-detail
composer is a documented follow-up.
