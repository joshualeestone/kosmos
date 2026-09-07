# Plan: correct the proven-false a11y attribution belief (#2125)

**Branch:** axbelief-attribution-2125
**Scope:** comment/doc-only. No functional change.

## Problem
The #2125 Accessibility seam was built on a belief the code states as fact in several comments: that spawning the `AXIsProcessTrusted` read UNDER tmux makes macOS attribute it to tmux (the responsible process that owns the folder-TCC grant). Josh's 0.6.42 fresh-account re-test disproved it: the tmux gate read "ACTIVATED" on arrival while tmux was ungranted and absent from the Accessibility list. Accessibility is keyed on the CALLING BINARY, so the read reports the kosmos-app's trust, not tmux's (a false-GREEN, the opposite of the false-BLOCK the comments anticipated). The same principle explains #2189 ("no Tmux to enable": the prompt registers the app, not tmux).

## Change
Correct every Accessibility-attribution comment in `engine/a11ystatus.js` and `native-app/main.swift` to say the calling binary (kosmos-app), not tmux/responsible-process, applied uniformly to the axCHECK read and the axPROMPT list-registration. Deliberately preserve the folder-TCC comments (responsible-process = tmux) unchanged, since that is a genuinely different macOS TCC domain, and draw the contrast explicitly. Ships now per Splinter regardless of the #2125 keep/drop fork (Josh has since decided KEEP; the real fix is the follow-on build that routes the AX check + grant through one identity).

## Why comment-only ships alone
The belief correction is safe under either fork and stops the next build re-assuming the false tmux attribution. The functional KEEP build (tmux actually requests AX, appears in the Accessibility list, correct-identity check, right pane) is a separate, larger, fresh-install-gated change tracked under #2125.

## Verification
- Full validation suite green (fmt/lint/tests); `node --test engine/a11ystatus.test.js` 7/7; `swiftc -typecheck` on main.swift passes.
- No em dashes in either file (all five spellings swept).
- /challenge-loop: 4 iterations, converged (proof in axbelief-attribution-2125-pre-challenge.md).

## Note
Plan file added after the challenge-loop converged; the reviewed CODE is byte-identical (this is a docs-only addition), so the converged review still holds. The proof's diff_hash was recomputed to include this plan file per the pre-challenge-gate contract.
