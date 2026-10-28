# launchertext-7492: kosmos#7492, the Windows launcher box text

**Card:** kosmos#7492. Ships with or after #2988 (the board watchdog, PR #7495, merged 2026-10-28).

## What finished looks like (from the person's side)

When the Windows hand-off falls back to serving the board in a window, the box no longer says "Click OK to stop
Kosmos", which the watchdog made untrue. It says: "Click OK to close it and stop Kosmos here. If 'Start Kosmos when I
sign in to Windows' is on in Settings, Kosmos then tries to start again in the background by itself."

## Pieces

1. `tools/windows/KosmosLauncher.cs`: the `RunningHereMessage` text.
2. `tools.win-launcher-native.test.js`: the pinned text, and a new assertion that the quoted switch name equals
   web/index.html's `startAtSignInLabel` (red-capable: rewording the label fails it).
3. `tools/windows/Kosmos.exe`: rebuilt and re-signed on the Windows box by Homer (verify-launcher OK, signature
   Valid, the Windows-only launcher tests 29/29, signin-6512 10/10), commit b66d91b79b, for the first wording; rebuilt again for the
   round-1 wording (no time in the sentence).

## Decisions

- Conditional wording, not the card's sample sentence. The box shows on every serve-here, including when the person
  switched the logon task off; then the watchdog starts nothing, so "starts again on its own" would be false there.
  "Tries to" because the restart is the same task board that just failed to answer in time.
- Single quotes around the switch name: the test's `sourceConstant` cannot read escaped double quotes, and curly
  quotes risk csc's codepage.
- No rebase before merging: main's newer commits touch nothing under tools/windows, CI tests the PR against main, and
  a rebase-merge keeps the signed exe's bytes. Any rebase would need Homer to re-run verify-launcher.
- No time in the sentence (review round 1): the watchdog backs off to one start per 15 minutes after repeated
  failures, which is likely for exactly the person who sees this box, so "within about a minute" would be false then.
- The claim holds on main, where #2988's watchdog is merged (#7495); this branch's base predates it, so it must merge
  after #7495 (it is merged) and as a rebase-merge, never ahead of it.

## Weakest premise

That the sign-in switch is the watchdog's only off switch. If #7493 splits them, this sentence must change with it.
