# phonepass-5510: the phone board as the Android app shows it (slice 1)

Card: kosmos#5510 (Splinter 17:14 CDT 10-07; Josh's week: "mobile app hard", testing on a real Android phone).

Finished means: at 360 and 412 CSS px, light and dark, the board over Kosmos+ (what the Android app opens) has no cut project name, no cut composer hint, and a toolbar whose controls sit evenly; the screenshot tool can shoot that layout; a browser check holds each fix and is red without it.

## The finding that changed the pass
The Android app opens <computer>.kosmosplus.com, so kplusRemote() is true and the board takes its remote phone layout (html.kremote): Kosmos+ bar and its own menu (#pnav), agents as a list of cards (no grid, no count tiles). mobile-shots.js never turned that on, so every "phone" shot so far, the first sweep of this card included, showed the board as it looks AT the computer.

## Changes
- docs/browser-checks/mobile-shots.js: `--remote` (a made-up *.kosmosplus.test host served from the throwaway board through the browser's router, so nothing leaves the machine); an `android360` size (360x800 at 3x); openTab, nav-menu and ask-waiting work in the remote layout (#pnav instead of #burger; the visible card when the grid is hidden); nav-menu waits for the menu's own fade-in (a mid-fade shot showed grey words).
- web/index.html, phone widths only:
  - toolbar (html.kremote): the sort menu fills the row between + and the view buttons; it sat 3px from + at 360 and 55px at 412.
  - project name: two lines before the ellipsis (max-width 40rem); one line held 14 characters at 360.
  - room composer: no emoji button on a phone touchscreen ((max-width: 40rem) and (hover: none)); the hint shortens to "Write something…" on a phone (matchMedia, back to the @name tip when the window widens).
- docs/browser-checks/render-phone-pass-5510.js (+ gated.txt, README row, SITE_COUNTS): T, N, E, P at 360 and 412 as a touch phone over Kosmos+, with desktop controls.

## Decided, not missed
- Tap targets: the tool reports 12 small controls in the project room, but it measures the drawn box. #4663 already gave each an invisible tap area of at least 36px (the room's --room-tap, asserted by render-room-msgbox-2806), and Answer has one too (inset -8px -6px, 40px). 36 is a recorded decision; not raised to 44 here. The composer's heights are #4108.
- Removing the emoji button on phones: a phone keyboard carries emoji; the button cost 34px of a 296px row and was why the hint was cut. Desktop keeps it (the three emoji checks run at desktop widths).
- The one-line name (pinned by web.pjone-no-disclosure-2838) was a consequence of removing the disclosure arrow, not a Josh ruling (#2838 is arrow -> cog). Desktop keeps one line; the pin is on the base rule, which still holds, and its comment now says so.

## Checked
- render-phone-pass-5510.js: all pass in Chromium and WebKit; against origin/main's page 9 FAIL (T 3px/55px, N cut, E shown, P long hint, resize) while the three desktop controls pass.
- Wiring tests: reason-grep 7/7, wired 11/11, indexed 1/1. mobile-shots tests (desktop 12, leak 8), pr-select 31, control-arms 10, receipt 17, pjone 5: all pass.
- Shots before/after at 360 and 412, light and dark, with --remote.

Weakest premise: Chromium with isMobile is not an Android phone; the real check is Josh's phone after the release.

## Review 1 (opus): 2 WARNING, 5 NIT
- [WARNING] fixed: under --remote, a screen's own page.route stubs called route.fetch()/continue() bare, which went to the made-up host (page routes run before the context proxy): login-notice, reboot-with-login, the consolidated screens, task-receipt, settings-undo broke. Now every stub fetches through fetchBoard() and passes on with fallback() (same as continue() without --remote); page.request (not routed at all) uses boardUrl(). Measured: those screens, plus settings-recommender, shoot clean with and without --remote.
- [WARNING] fixed: the proxy passed the page's Origin through, and the board refuses a write from another site. fetchBoard sets Origin (and Referer) to the board's. Measured: a PUT from inside the page at the made-up host returns 200 (the reviewer measured the refusal before).
- [NIT] fixed: the (hover: none) half of the emoji rule was untested; a mouse at 360 now asserts the button stays (proven red by dropping (hover: none)).
- [NIT] fixed: the new placeholder block sat between an existing comment and its subject; moved above it.
- [NIT] fixed: the query is named once (ROOM_HINT_MQ), with why it is not PNAV_PHONE_MQ.
- [NIT] fixed: addListener fallback for engines without MediaQueryList.addEventListener.
- [NIT] decided: the sort menu stretches wide on a phone turned sideways (the kremote block covers landscape); the gaps stay even, so it reads as one row. Left.
Found while testing, out of this card's six screens: Settings at 360 overflows horizontally (with and without --remote). Noted on the card.
