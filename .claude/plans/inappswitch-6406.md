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
decidePolicyFor / connectLinkDecision; Windows OnNavigationStarting / ConnectLinkDecision); only target=_blank sent it
to the browser (Mac createWebViewWith opens the system browser on a run/both computer).

## Known limit until step 2
The other computer's gate still asks to sign in once in that window (its session then lasts a year).

## Steps
1. web/index.html: computersInApp() (kosmosBadge bridge or WebView2); the row link drops target=_blank in the app.
2. web.computers-switcher-4648.test.js: Mac and Windows bridges open in the window; CONTROL: a browser keeps _blank.
   Mutant (always _blank): red.
