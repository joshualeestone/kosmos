# inappswitch-6406 (step 1): switching computers in the app stays in the app window

Card: joshualeestone/kosmos#6406. Josh 12:04 ruling: the other computer opens INSIDE the app window, no sign-in, no
browser tab. Design on the card (agreed by Splinter 12:17): step 1 here (in the window); step 2 (no sign-in) is a
pairing-key ticket the other computer's gate checks, built after #6404 lets a pair finish its code check.

## Finished looks like (step 1)
In the Kosmos app (Mac or Windows), clicking another online computer in Your computers opens it in the same app
window, not a browser tab. In a browser it still opens a new tab. The link never sends this board's address
(noreferrer). Getting back is the same switcher on the other computer's board.

## Why this is enough for the window
The native apps already keep a same-window navigation to https://<name>.kosmosplus.com inside the app (Mac
decidePolicyFor / connectLinkDecision; Windows OnNavigationStarting / ConnectLinkDecision, once the computer's mode is
chosen; an unchosen mode on Windows still sends it to the browser, as before: #6411); only target=_blank sent it to the
browser (Mac createWebViewWith opens the system browser on a run/both computer). Every "open another computer" link
the board renders follows the same rule: the switcher, its phone-menu copy, and the Agents view's Open links (#4812).

## Call (review 2)
Every "open another computer" link stays in the window, agent cards included (the ruling is about switching computers,
and an agent on another computer is that computer). A same-window switch replaces this board, so unsent text in a
composer goes, as on a reload today (the page has no beforeunload). Rejected: keeping agent cards on a new tab (the
Agents view has no composer open, so the loss there is unlikely, and a browser tab breaks the ruling). Weakest premise:
that nobody switches mid-message; if that bites, a "you have an unsent message" check belongs with #6411.
One helper, computersLinkTarget, decides the target for all four sites (a source test pins that).

## Known limits (native app, follow-up card)
- Until step 2, the other computer's gate asks to sign in once in that window (its session then lasts a year).
- Getting back is the other computer's switcher, which goes to this computer's Kosmos+ address (a sign-in once there),
  not the local board the window started on; if this computer's own connection is down it is listed as not connected
  and there is no link back short of quitting the app. A native "back to this computer" belongs in the app.
- On a Mac showing another computer, Cmd-, still clicks that page's Settings (openSettings refuses only on a connect
  computer). The guard belongs in the app (#6411).

## Steps
1. web/index.html: computersInApp() (kosmosBadge bridge or WebView2) and computersLinkTarget(a), which every link to
   another computer calls: the switcher row (computersRender), the Agents view's agent cards (oaCard) and its two
   Open <computer> links (oaGroup, aoGroup); the phone menu (pnavFill) copies the row's own target.
2. web.computers-switcher-4648.test.js: Mac and Windows bridges open in the window, a browser keeps _blank (CONTROL);
   a source scan: every href that names a computer's address is followed by the helper within six lines, with no
   new-window target set there by itself (target = or setAttribute).
3. web.allagents-4812.test.js: the agent card and Open <computer> in the app and in a browser (CONTROL).
4. render-computers-4648.js arm 3 (Chromium + WebKit): the switcher row and the phone menu's copy in the real page.
5. Mutants red: always _blank on the row; pnav always _blank; a stray _blank on the agent card (two tests).
