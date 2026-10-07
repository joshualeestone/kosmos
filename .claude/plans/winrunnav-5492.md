# winrunnav-5492: Windows run/both computers follow the #5169 link rules (Mac parity, second half)

Card: kosmos#5492. Stacked on winforeign-5483 (Baron, kosmos#5483), itself stacked on runboth-nav-5169 (PR #5482). The PR opens once both are on main and this is rebased.

Finished means: on a Windows run or both computer, a main-frame navigation is decided by ConnectLinkDecision with the board's port, as the Mac's #5169 does; the computer's own board and the window's Starting page stay; an unclicked foreign navigation is refused, a clicked one opens in the browser; MAC_ONLY_WHYS is empty, so the parity test reads as full parity.

## Step 1 of the card: script navigations the board starts to a non-board address (audited on origin/main)
- web/index.html: one `location.replace('/#signed-out')`, same origin. No `window.open`, no form posts to other sites, no meta refresh.
- Programmatic `a.click()` downloads are same-origin (/api/... file downloads).
- server.js: the only 302 is the board-auth bootstrap, to the board's own clean URL.
- Provider sign-ins (OpenAI subscription, Claude) are links the person clicks (openA.href = authUrl), so they are user-initiated and still open in the browser.
So refusing unclicked foreign navigations on run/both breaks no flow the board has today.

## Change
- KosmosLauncher.ConnectLinkDecision gains `int boardPort = 0`: when given, IsBoardAddress(address, boardPort) is InApp before any scheme rule. Connect passes none (its board is stopped), so connect is unchanged.
- OnNavigationStarting: Run and Both take the connect branch with `runsBoard ? port : 0`; the about:/data: Starting page is let through first (ConnectLinkDecision refuses data:). The first-load bookkeeping stays connect's (`!runsBoard &&`). Unset and Unreadable keep the older rule.
- OnContentLoading and OnNavigationCompleted run for Run and Both too, so a Kosmos Plus page opened in their window can hand off to checkout (committedPage), and the in-window record is forgotten.
- Parity test: the Mac's two `board:` navCase rows are ported as probe rows (plus WINDOWS: localhost is the same board), 63 -> 66 rows; MAC_ONLY_WHYS is empty. Source-text assertions updated; a #5492 test pins the run/both wiring.

## Behaviour changes on a Windows run/both computer, stated
- An unclicked redirect or script nav to another site is refused instead of opening the browser.
- A clicked mail, phone or text link opens the person's app for it (the Mac's rule) instead of the "Kosmos only opens web links" box.
- A Kosmos Plus link opens in the window instead of the browser (the Mac's rule).
- New-window links (target=_blank) are unchanged, as on the Mac (createWebViewWith is connect-only there too).

## Checked
- Node: tools.windows-computer-mode-4381.test.js passes on the Mac (Windows-only probe tests skip); the #5492 test proven red by three mutations (Starting page line removed, port passed on connect too, board check removed).
- The pure decision rows (41 Link/Nav/Board/Site rows) compiled and run on this Mac with dotnet, from the functions extracted out of KosmosLauncher.cs: 41 pass. Control with the board check removed: exactly the two board-InApp rows fail.
- NOT checked here: the whole launcher compile and the WebView2 wiring; Windows CI's `windows` job runs the real probe.

Weakest premise: the board's script-navigation audit is of today's code; a future board flow that sends the window to another site by script (say, a provider sign-in by redirect) would silently do nothing on run/both. That holds on the Mac already since #5169.
