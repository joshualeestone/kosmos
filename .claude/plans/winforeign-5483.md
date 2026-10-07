# #5483: the Windows launcher refuses an unclicked foreign navigation, as the Mac does since #5169

## What changes
- `tools/windows/KosmosLauncher.cs` `ConnectLinkDecision`: an https address that is not Kosmos Plus returns
  `clicked ? Browser : Block` (was `Browser` either way). So on a connect computer a REDIRECT or a SCRIPT navigation to
  another site is refused, nothing opens; a CLICKED foreign link still opens in the person's browser. This is the
  Mac's #5169 rule.
- `OnNavigationStarting` already cancels every non-InApp navigation and opens only a `Browser` one, so `Block` means
  "cancelled, nothing opened". `OnNewWindowRequested` decides as a click (`clicked = true`), unchanged, as on the Mac.
- The context-menu path (`decidedByConnectRules && ConnectLinkDecision(address, true)`) asks as a click: unchanged.

## Not a security fix
Windows already cancelled the in-window navigation, so a foreign page never replaced the board (#5169's Mac bug).
This restores parity: the person sees the same behavior on both, and an unclicked redirect no longer pops their
browser open to a site they did not choose.

## The parity test (tools.windows-computer-mode-4381.test.js)
- The 10 Windows probe rows that sent an unclicked foreign nav to the browser now expect `Block` and use the Mac's
  exact words; the Mac's clicked-foreign row is added (53 -> 54 rows). The Windows-only non-ASCII host row also
  becomes `Block` ("refused unclicked").
- `MAC_ONLY_WHYS` is now EMPTY: every Mac row runs on Windows again, including the clicked-link row (Sonya: it never
  truly diverged; it only lacked a Windows row).
- Liu Kang's review of #5482, folded in: `MAC_ONLY_WHYS` is a Map of why -> { card, wrongIf }; every entry must carry
  its card and the one condition that would make the exception wrong; while it is non-empty the test emits a
  diagnostic naming how many rules it excused and which, so a green run reads "matches, except these N", never as
  full parity.

## Validation
The probe compiles the launcher and runs only on Windows: the `windows` CI job (`tools/windows-tests.js` includes
every `tools.windows-*` test). On the Mac: the file's non-probe tests and the launcher-source pins
(win-open-board-2007, win-launcher-native) pass, 40 of 40 with 19 Windows-only skips.

## Stacked
On #5482 (runboth-nav-5169, open), which adds MAC_ONLY_WHYS. After it merges: rebase onto main, then the PR.

## Weakest premise
The empty Map's reporting branch never runs today, so nothing exercises the diagnostic until an exception is added.
