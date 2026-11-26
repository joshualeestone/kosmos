# keepdrafts-9132: chat and room drafts are kept across a reload, so a kept draft no longer holds the Mac window's restart

Card: kosmos#9132 (split from #9093 part 2 by Ice Cream Kitty, 11-26). Night-shift rotation; claimed by Mona Lisa 04:5x.

## Done when

Words half-typed into an agent's message box, its Terminal box, a project's message box or a project room's box are
still there after the page reloads (they come back when that chat or room is opened), and those kept words no longer
make updateNothingToLose() refuse the Mac window's self-restart onto an update. Words that could NOT be kept (storage
refused) still hold it, as today. Shown in a real page by a browser check with a control arm.

## Measured on origin/main first (the card is live)

None of the four maps (TALK_DRAFTS, TERM_DRAFTS, PJ_DRAFTS, PJ_ROOM_DRAFTS) is written to localStorage or
sessionStorage; updateNothingToLose returns false while any holds words, and also while any typed box holds words
(UPDATE_TYPED: every textarea the person typed in, the chat boxes included).

## The change (web/index.html)

- keptDrafts(kind): the same plain map, wrapped (Proxy) so every set or delete also writes that one entry to
  localStorage, "kosmos.draft.<kind>.<agent or project>" = {v, t}; filled from storage on load; entries older than 14
  days or unreadable are dropped. Per entry, not one blob, so two windows of one board never overwrite each other.
  A failed write marks that key unsaved until it writes again; a failed load marks the map unsaved.
  draftsKept(m): true only for a map made by keptDrafts with nothing unsaved (a test's plain map is never kept).
- The four maps are now keptDrafts('talk' | 'term' | 'pj' | 'room'). Every write site is unchanged: the wrapper sees
  them all. The restore sites (paintTalk for the agent boxes, the project open for pj-say and pj-post) are unchanged:
  they already fill an empty box from the map, which is now filled from storage.
- updateNothingToLose: a map's words hold the restart only if the map is not kept; a typed box holds it unless it is
  one of the four boxes (d-say, d-term-say, pj-say, pj-post) and its words are exactly the kept draft for the open
  agent or project (they park on every keystroke, so they match).

## Decided

- localStorage, not sessionStorage: the card rejects relying on sessionStorage across a native restart (unmeasured).
- The wrapper rather than editing every write site: dozens of sites (typing, send, failed send, switches), and
  server.test.js pins several of them by text.
- Not done here: logging why a restart was held (the card's measurement of its weakest premise). The fix stands on
  its own (a reload losing half-typed words is a defect either way); the reason log is the Mac app's (native-app) and
  can follow.

## Weakest premise

That localStorage under the board's origin survives the Mac window's restart. Reasoned, not measured on the app:
native-app/main.swift makeWebView builds a plain WKWebViewConfiguration, so the web view uses WebKit's DEFAULT,
persistent data store (kept on disk across launches), and the page already relies on localStorage persisting there
(loginAdvDismiss's hidden notices). The browser check shows it across a page reload only. If it did not survive, a
restart would lose kept words; measuring it on the app (type, let it restart, reopen) is the check that settles it.

## Verified

- web.keepdrafts-9132.test.js (6, the page's own helper lifted): kept across a reload, stale entries dropped, kept
  drafts do not hold the restart and plain ones do (control), a refused write holds it, the open box matching its
  kept draft does not hold it and other words do. Main's page: 6 of 6 fail. Mutations (box excuse removed, kept-map
  excuse removed) each fail the test that names them.
- docs/browser-checks/render-keepdrafts-9132.js (real Chromium, real typing): stored as typed, updateNothingToLose
  true, back after a reload; control arm (storage refusing writes): held, and empty after a reload. Against main's
  page the three kept-draft assertions fail.
- The four tests that lift updateNothingToLose pass (61); the wiring and tree guards pass.
- bc-pr-select: 80 checks selected (the four boxes and the open agent/project are genuinely touched).
