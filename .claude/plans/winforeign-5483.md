# #5483: the Windows launcher refuses an unclicked foreign navigation, as the Mac does since #5169

## What changes
- `tools/windows/KosmosLauncher.cs` `ConnectLinkDecision(address, clicked, fromKosmosPlusPage)`: an https address
  that is not Kosmos Plus returns `(clicked || fromKosmosPlusPage) ? Browser : Block` (was `Browser` either way),
  exactly the Mac's rule. `fromKosmosPlusPage` is `IsKosmosPlusSiteAddress(page)` (the Mac's isKosmosPlusSiteURL:
  the coordinator or its apex, NOT a computer's board), where `page` is the page the window last COMMITTED
  (`committedPage`, the Mac's committedPageURL): set at WebView2 ContentLoading (a new document committed, before its
  scripts run, the Mac's didCommit) to the address its in-window navigation was allowed for, matched by NavigationId;
  null on an error page, an unknown document, a mode switch, a crashed page, a fresh first load (iteration 4 moved it
  from NavigationCompleted, which lagged the page's own scripts in both directions). And
  "clicked" is `IsUserInitiated && !IsRedirected`: WebView2 counts its own `Navigate` as user-initiated, but a redirect
  is never a click (WebKit calls it `.other`). Iteration 3 found both: reading `get_Source` mid-navigation and taking
  `IsUserInitiated` alone could each let a first-load redirect through, unlike the Mac. The SITE hands off to checkout by
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
- A FIRST load redirected off-site (a captive portal) is now refused, as on the Mac. WebView2 reports that as a
  cancel, which the launcher did not count as a failure, so the window would have sat blank with no way back
  (review iteration 2). Now a first load the connect rules refused counts as failed: the "could not reach Kosmos
  Plus" box shows and Reopen loads it again. Before this change the redirect opened in the browser instead.

- The refused-first-load flag is set and consumed only for the first load's OWN navigation (its NavigationId, which
  WebView2 keeps across that navigation's redirects), so another navigation refused or completed while it is pending
  is never taken for it (iteration 3).

- The first load is captured as the navigation to the sign-in address itself (not a redirect), not as whichever
  navigation starts first after LoadConnect (iteration 4).
- WebView2's IsUserInitiated follows Chromium user activation, so a script navigation or form submit inside a click
  handler counts as a click, where WebKit says .other. Such a navigation opens in the person's BROWSER on Windows (as
  it always did) and is refused on the Mac. Decided: WebView2 exposes no link-activated signal, and the Windows
  outcome never replaces the window; noted, not built.
- Nothing on the Mac exercises the committedPage state machine (ContentLoading, NavigationStarting, the clears): the
  pins check its text. A real Windows run is the only full check (#570's box).

## Weakest premise
WebView2 raises NavigationStarting again for a server redirect with the SAME NavigationId and IsRedirected true (its
documented behavior; the header carries no prose). The slots are read from WebView2.h 1.0.4191.47 itself (NuGet
package, build/native/include): NavigationStarting args slot 7 and NavigationCompleted args slot 3 are
`get_NavigationId(UINT64*)`. The probe pins the decision function; only a real Windows run exercises the COM path.
