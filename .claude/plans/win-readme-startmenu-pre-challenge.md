---
pre_challenge: true
method: challenge-loop
branch: win-readme-startmenu
diff_hash: 3af9dfe67cb492c8eb3370304ed81be1436b4d1000ab47fe2c950329a020385b
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T11:52:17Z
iterations: 2
converged: true
---

# Pre-challenge: win-readme-startmenu

#### Iteration 1 (fresh blind subagent)

- [WARNING] tools/build-kosmos-windows.sh not-signed-in paragraph: a first run stopped before it
  installed (the person pressed "Don't run") has no Start menu entry, so "open Kosmos from the
  Start menu again" pointed nowhere. FIXED: the paragraph names the extracted Kosmos.exe as the
  fallback when Kosmos is not in the Start menu yet; tests pin that line.
- [NIT] tools/windows/README.md: "its shortcut runs the installed Kosmos.exe" is inexact when a
  copy runs in place. FIXED: "the Kosmos.exe that last refreshed it (the installed one, once
  Kosmos has installed itself)".
- [STRENGTH] Claim verified in KosmosLauncher.cs: RefreshStartMenuShortcut SetPath(exe); window
  mutex and .Show message named by BoardWindowName(port), so a Start menu launch reaches SignInAgain.
- [STRENGTH] No other test or doc pins the old read-me words (others use only the file name).

#### Iteration 2 (fresh blind subagent)

- No issues found (reviewer: NO ACTIONABLE FINDINGS). Read-me reads consistently as one piece,
  line lengths 61 to 70 columns, \047 kept, regexes match new text and fail on old text.
- [NIT] "Always open Kosmos from the Start menu." right after the fallback line; reviewer judged it
  fine in context (contrasts with bookmarks). Not changed.

### Final Ledger

- Converged after 2 iterations. 1 warning and 1 nit fixed, 1 nit declined with reason.
- Validation: tools.build-windows-570 + tools.win-launcher-native 44/44 pass; 20 related Windows
  test files 530 pass, 0 fail, 2 skipped. Negative control: the origin/main build script fails 2
  tests under the new pins. Zip built from the worktree; READ ME printed from it, CRLF, no em dashes.
