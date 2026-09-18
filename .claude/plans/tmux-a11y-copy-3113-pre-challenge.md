---
pre_challenge: true
method: challenge-loop
branch: tmux-a11y-copy-3113
diff_hash: 532c2c4c107ac40c4373fc64f361354c6377566dafc0bb97b36e097eb5bbf650
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T22:23:40Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

kosmos#3113 native half: reword the single shared `NSAppleEventsUsageDescription`
(install/setup.sh:3102) to be honest for BOTH the Open-Terminal feature AND the tmux-a11y
register (spawnTmuxAutomationPrompt's osascript-under-tmux). Josh's 0.6.78 fresh-box saw the
old Open-Terminal-only copy as a confusing "control System Events / Open Terminal" prompt when
he clicked the Accessibility Turn On.

**Iterations:** 2 (validation + 1 blind reviewer pass)
**Converged:** Yes (zero BLOCKER/WARNING/CONVENTION after addressing iter-1's wording WARNINGs)
**Fixed:** 2 wording WARNINGs | **Deferred:** 0 | **Asked:** 0

### Validation
- `tools/test-plist-heredoc-clean.sh`: 0 failures (no backticks / no `$` in the heredoc comment).
- XML valid: the blind reviewer extracted the app-bundle heredoc and ran `plutil -lint` + `xmllint
  --noout` = both OK; no unescaped `&`/`<`/`>` in the `<string>`; the XML comment has no interior
  `--` double-hyphen.
- Convention: no em dash on any added line (checked all 5 spellings; the em dashes at setup.sh:1289
  and :2168 are PRE-EXISTING, outside this 1-line diff).
- `test-install.sh` #2810 guard: the string stays NON-EMPTY.

### Per-Iteration Breakdown

#### Iteration 1 (validation)
Plist-heredoc-clean + the XML/em-dash checks passed on the tree.

#### Iteration 2 (blind review)
**Reviewer model:** sonnet
**Findings:** 0 BLOCKER/CONVENTION; 2 WARNINGs (wording clarity), both ADDRESSED.
The reviewer traced the mechanism through engine/promptrequest.js + native-app/main.swift
(spawnTmuxAutomationPrompt:1360) and confirmed the copy is factually consistent with the code
(osascript under tmux -> System Events -> tmux's own Accessibility row), that only ONE
NSAppleEventsUsageDescription exists (the "shared string" framing is correct), and that the change
is scoped to exactly one file/one hunk.
- WARNING (wording): "during setup" ambiguously scoped the whole sentence (including the persistent
  Open-Terminal feature) to setup-time. FIXED: dropped "during setup".
- WARNING (wording): "terminal tool (tmux)" next to "Terminal window" risked the exact tmux-vs-Terminal
  conflation the card fixes. FIXED: reworded to "tmux (the tool that runs your agents)".
- NIT (length ~doubled): cosmetic; plutil/xmllint accept it; no documented macOS truncation limit.
- The reviewer noted the honesty depends on the open fresh-box premise (does the probe raise
  Accessibility vs Automation) - the copy describes purpose/outcome, not the OS dialog category, so it
  is honest either way; that premise is a NON-BLOCKING fresh-box residual (Josh's next run confirms).

### Convergence
The wording WARNINGs are the only findings; both addressed in the final commit. No BLOCKER/CONVENTION.
Per the challenge-loop rule this converges. Josh is the final wording authority (Splinter is offering
him the copy); the honest default ships if he does not reword.
