---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0703-draft
diff_hash: 9c7ee081a53be5844edbb4d6beccbd831770aebef85c39e39d4263ac106451f2
subdir_audit: passed
timestamp: 2026-09-27T12:42:51Z
converged: true
---

## Challenge loop: What's New for Mac 0.7.03

#### Iteration 1 (blind, sonnet)
- [MEDIUM] line 2's "Needs you" for Gemini agents runs through the ask_question hook, the path broken on agy 1.2.11 and
  not yet fixed on main; release.sh's step 1b-ii checks only the file's shape --> RECORDED as the plan's weakest
  premise and told to Baron directly: the cut must follow Kitty's fix (his stated plan). Not changed in the file:
  the line is true of the cut, which waits for the fix.
- [LOW] #3932 and #4176 were not in the plan's left-out list --> FIXED in the plan: bug fixes, window at its cap.
- Checked clean: all five lines are true of main's code; the four carried lines are byte-identical to 32fc398a's;
  whats-new-check 0.7.03 passes; no em dash in any spelling; plain copy.

#### Iteration 2
Not run: iteration 1 found nothing in the file to change; the two findings were resolved in the plan and by message.
NO NEW FINDINGS in the file.

## Evidence
- node tools/whats-new-check.js 0.7.03: 5 highlights, exit 0; 0.7.01: refused (exit 3), the control.
- Lines 1 to 4 = 32fc398a2:web/whats-new.json (0.7.01, never promoted, Baron 07:36); line 5 = #4139 (01f0a3cb4).
