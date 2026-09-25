# #3034: the setup assistant bubble (the Mac UI)

Josh, 2026-09-24 (#chaoskosmos-design): 16:05 "bottom-right app-wide", "context aware for what page you
were on", his avatar labelled as AI; 18:02 on the mock "I love it", plus: the first x offers close-for-now
or close forever, and a Settings switch they are told about to bring it back. Design: chaoskosmos-site
design/setup-assistant.html (91e604b), sections 1-4 and 6. Renet's half is on main (#3666): the setup
role, POST /api/setup-guide/page, /api/settings setupAssistant { on, asked }. Ice Cream Kitty's #3660
(guide-on-connect) creates the guide; until it merges no install has one.

## Finished looks like
On a board whose setup guide exists (and is not removed) and whose Setup assistant setting is on:
- A bubble with the guide's picture sits bottom-right on every screen except first run.
- While the person has never written to the guide, a one-line nudge "Want help setting up Kosmos?" sits
  beside it; its x hides it for the session. It never shows once they have sent a message.
- Clicking the bubble opens a small panel in place (300px, page usable beside it): header "Josh" with a
  JOSH'S AI tag, a minus and an x; the direct-message thread with the guide; a note "An AI that knows
  Kosmos, in Josh's voice. Josh isn't typing live."; an input that sends to the guide. It tells the guide
  which screen the person is on when it opens and when the screen changes (POST /api/setup-guide/page).
- Minus folds it back to the bubble; a gold dot on the bubble means the guide replied while folded.
- The first x (setting asked false) asks inside the panel: "Close the assistant?" / Close for now /
  Don't show this again / "You can turn it back on in Settings, under This computer." Either choice sets
  asked; Don't show this again also sets on false and the bubble goes. Later x just closes.
- Settings > This computer: the Tips box is titled Help and gains a Setup assistant switch under Show tips,
  shown only when a guide exists. Switching it on brings the bubble back at once.
No guide, or the setting off: nothing shows and nothing is fetched beyond the one guide read.

## Pieces
1. server.js: GET /api/setup-guide -> { ok: true, name } or 404 { error } (no guide, folder marker gone,
   or removed), the same gates as POST /api/setup-guide/page. Test in a server test file.
2. web/index.html: the bubble layer (built at runtime like the tips layer; web.consolidated-980 counts
   static body children), CSS in the app's tokens, light and dark. The guide is found by name in LAST
   for its sessionName and avatarVer.
3. The panel reuses the direct-message route: GET/POST /api/agent/:session/thread; polled every 5s only
   while open (and once a minute while folded, for the gold dot). The send mirrors sendTalk's verdict
   handling (placed / unconfirmed / could_not) without touching the agent page's globals.
4. Settings row: /api/settings setupAssistant.

## Decided
- Nudge dismissal is per session, and the nudge stops for good once the person has written to the guide:
  the setting has only on/asked, and engine/setup-assistant.js is being rewritten on #3660, so no new key.
- The chat's suggested taps in the mock are not built: SETUP_HANDS_OFF keeps the guide hands-off until the
  bubble can act (Splinter, on the card). The panel is a plain conversation.
- Hidden during first run (its own full-screen flow) and when no guide exists.

## Weakest premise
That the guide's session name can be found in /api/status by the name the seed recorded. If #3660 names
sessions differently, the bubble shows for nobody (safe, visible in its check).

## Verification
A browser check with a fixture guide: bubble shows only with a guide and the setting on; nudge only
before any message; open/fold/close; first-x question once with both choices; Settings switch brings it
back; page context posted on open and on screen change; hidden in first run; light and dark; each
"shows only when" arm with a control.
