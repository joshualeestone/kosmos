# #5483: the Windows launcher refuses an unclicked foreign navigation, as the Mac does since #5169

## What changes
- `tools/windows/KosmosLauncher.cs` `ConnectLinkDecision(address, clicked, fromKosmosPlusPage)`: an https address
  that is not Kosmos Plus returns `(clicked || fromKosmosPlusPage) ? Browser : Block` (was `Browser` either way),
  exactly the Mac's rule. `fromKosmosPlusPage` is `IsKosmosPlusSiteAddress(page)` (the Mac's isKosmosPlusSiteURL:
  the coordinator or its apex, NOT a computer's board), where `page` is `ICoreWebView2.get_Source` read during
  NavigationStarting (the page the nav leaves; slot 2, previously declared unused). The SITE hands off to checkout by
  script (signin.html -> checkout.stripe.com): without the exception Buy and Billing silently do nothing (found in
  review iteration 1; the Mac's "#5169 MERGE GATE" row). So on a connect computer a REDIRECT or a SCRIPT navigation to
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
- The parity check now also reads the Mac's `navCase` and `siteIs` rows (it read only `mode` and `link`, so the
  checkout exception was invisible to it): 46 Mac rows. Windows gains Nav and Site rows for them (63 probe rows).
- `MAC_ONLY_WHYS` holds only the Mac's two run/both `board:` navCase rows, for #5492 (Windows applies these rules
  on connect computers only; a run computer's board may navigate to sign-in pages by script, so that is its own
  card). The clicked-link row is no longer an exception (Sonya: it only lacked a Windows row).
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

## Decided
- A FIRST load redirected off-site (a captive portal) is now refused, as on the Mac: the window shows nothing (a
  cancel is not a failure, so no box); F5 retries. Parity chosen over a Windows-only message.

## Weakest premise
`get_Source` during NavigationStarting returns the page being left (WebView2 documents Source as the current top-level
document; it changes at SourceChanged, after commit). Only the Windows CI probe and a real Windows run can confirm the
whole chain; the probe pins the decision, not the COM read.
