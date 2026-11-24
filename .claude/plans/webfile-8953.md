# webfile-8953: a web-page file opens on the iPhone itself, never on the board (kosmos#8953, a slice of #8952)

## Problem
A web page or markup file an agent or a room made (.html, .htm, .xhtml, .shtml, .svg, .xml, .webarchive, .mht) opened
the whole computer board on the chat or project page, not the file. Board.isWebDocument sent it there on purpose
(#7016 part 2 review 2): Quick Look draws such a file as a web page that can load from elsewhere, and fetchFile refused
any text/html answer because the computer's sign-in gate can answer with its own page.

## Decision (written on the card)
- Fetch: a web-page file is fetched like any other, and taken only when the answer carries Content-Disposition:
  attachment, which every board file route sends (server.js attachment and project file routes) and a sign-in page never
  does. Any other file is still refused when the answer is a page (Board.fileAnswerAccepted).
- Show: WebFileView, in place of Quick Look for these files only, through one modifier (.filePreview) used by the chat,
  the room and the Files screens. Done and Share on every kind.
  - A page (.html .htm .xhtml .shtml) and a web archive's own page: drawn by LockedWebView. JavaScript off, a data store
    that is not kept, a content rule that blocks every load, only the first navigation allowed.
  - An SVG: drawn only as a picture (base64 in an <img>), which can neither load nor link.
  - XML: shown as text (the first megabyte). MHTML and a compressed SVG: no reader; the sheet says so and offers Share.
- No touch reaches the page's content: every view inside the web view's scroll view takes no touches; the scroll view
  still scrolls and zooms. Measured necessary: tapping a link had WebKit open a TCP connection to the link's host before
  the navigation was refused (no request sent, one connection), and a CSS rule making links inert (even first, in its own
  cascade layer) was overridden by the page's own !important rule.
- The captions and VoiceOver hints that said "Opens on your computer's board" go; the cards say what the file is.
- The dead openOnBoard plumbing through FilesView / FilesSection / FilesOpener is removed.

## Rejected
- Quick Look for these files: the reason for the old rule.
- Safari: leaves the app, and the file would need an address the phone can open.
- Making links inert with CSS: a page can override it (measured in WebFileUITests).
- limitsNavigationsToAppBoundDomains: measured, did not stop the link-tap connection.

## Weakest premise
That nothing else in WebKit opens a connection for a page drawn from bytes with touches off: preconnect for prefetch
hints, DNS prefetch, or something a future WebKit adds. WebFileUITests is the guard: its listener counts connections,
the sample page names it in every way a page can load (stylesheet, @import, font, script, image, srcset, frame,
refresh, links incl. two that try to re-enable themselves), and a count above the control's baseline fails.
Observed once and not explained: one of three runs of WebFileUITests hung waiting for the app to idle after the third
link tap (the first run after a rebuild); the next two passed.

## Tests
- ios/LogicTests/main.swift: webFileKind per extension and type; fileAnswerAccepted both ways (download taken, sign-in
  page refused, other files unchanged); inertPage per kind; fetchFile against the fake Mac: a page without the download
  header is no file, with it is saved under its own name; a page under another type is fetched and judged by its name.
- ios/KosmosUITests/WebFileUITests.swift (added to ios/tools/ui-sample.sh, so CI runs it): the page and the SVG open on
  the phone with no navy Close bar, and the probe listener's count stays at the control's baseline through load, refresh,
  three link taps and an SVG tap. Controls: the listener counts the test's own request; without the touch block the same
  test failed on a link tap (measured twice: the plain link, then the loud link once CSS was tried).
