# wnphone-7839: no desktop update window inside the phone app

Card: kosmos#7839 (Josh 11-03 04:16, iPhone build 29). Owner: Baron Draxum (What's New).

## What
whatsNewCheck returns at once, reading and recording nothing, when wnOnPhone():
- html.kapptabs: the iPhone app marks every page it loads at document start (ios ShellLogic AppTabs.markScript, its
  one WKWebView in ContentView), the board sheet Josh opened included; or
- html.kremote at phone width (PNAV_PHONE_MQ): the Android app, which opens the board without marking it, and a phone's
  browser.
Nothing is recorded on a phone, so the computer's own window still shows the update.

## Checked, not changed
- The update dialog (.upd-back) opens only after a person presses Update.
- The update toast already speaks for a Kosmos+ view ("on your Kosmos computer", no restart offered).
- The sign-in expiry banner Josh also saw is a separate question (the card says it may be wanted on the phone).

## Tests
web.whatsnew-phone-7839.test.js (the real whatsNewCheck: marked, phone-width remote, desktop remote CONTROL, and the
app's mark script still present); docs/browser-checks/render-whatsnew-phone-7839.js loads the page with the app's own
mark script at document start, Chromium and WebKit, with an unmarked CONTROL.

## Weakest premise
That a desktop-width Kosmos+ session (a laptop browser) should still show the window. It is about the host computer's
app, so it may be noise there too; left as it was, since only the phone was asked about.
