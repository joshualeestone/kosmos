# preview-4930: click a file a message carries to see it full page (#4930)

Josh, #admin 2026-10-01 20:17: "if I clicked on a image (or even possibly a document) it zoomed up and rendered it
full page preview with a very dark background modal. And then gave me a button to close ... in the top right with a
X or an open in finder button on the bottom left".

## Done when
In a served build, clicking a screenshot an agent posted opens it full page on a dark backdrop, X closes it, and
Open in Finder selects that file in Finder.

## Measured first (the card's weakest premise: one rendering path?)
Every place the page shows a person's file was printed, not counted (a search agent, 2026-10-01 20:22):
- The only images are message attachment cards, all drawn by ONE function, pjAttachmentCard, from four callers: the
  DM (agent rows and the person's own), the project room, and the project's agent-thread panel. So one hook covers
  every image a message carries.
- The Files lists (agent Files, the project Files card, the Documents screen) show names and icons, never images,
  and no route serves their bytes; their rows open the file on the Mac.
- No reveal route could select ONE file: every reveal opened a folder.

## Call
1. pjAttachmentCard puts the attachment id on its card (data-att) and remembers what the card showed (PV_ATTS).
2. One page-level click handler: a plain click on a card opens the preview; a modifier or middle click keeps the
   download the card has always been.
3. The preview (#pv-preview): a 90% black layer over the whole window; an image at its own size, fitted (contain,
   never cropped), growing from the card it was clicked on unless the person asked for less motion; a PDF as its
   first page (the existing /preview route draws it) with "The first page"; a text file as its opening (the card's
   own snippet, as text) with "The start of the file"; anything else its icon, name and size. X top right; Escape and
   a click on the dark close it; focus goes back to the card; Tab stays between the X and the action.
4. Bottom left: "Open in Finder" ("Show in File Explorer" on Windows) asks POST /api/attachment/<id>/reveal, which
   finds the file by id alone and selects it (projects.revealFile: `open -R`; win32explorer.revealFile: `/select,`).
   Over Kosmos+ (kplusRemote) it is "Download" instead, a link to the attachment.
5. While the preview is up the page drops its scrollbar strip (html.pv-open): Chromium, the Windows app's engine,
   never paints a fixed layer over a `scrollbar-gutter: stable` strip, so the dark stopped 15 px short of the edge.

## Review 1
- The update window ("Kosmos has been updated") counts the preview as a window over it (wnCovered), and the preview's
  keys stand aside for first run, the update overlay and the restart screen: one Escape closes only the top one (P8).
- Any click on the dark closes it, the bottom bar's too; focus finds the card again if a poll redrew its row; a click
  another handler already cancelled does not open it; the action is at least 40 px tall (P7); focus rings on the dark.
- The reveal route answers like its siblings (409, { ok: false, because }); File Explorer's refusal speaks of showing,
  not opening.
- P9: cards drawn by the real message rows (pjMsg, dmRow) open it, not only cards drawn alone.

## Review 2
- A click on the dark closes it only when the press began on the dark too (selecting a text file's words and letting
  go past them keeps it open; P6). It stands aside for a native dialog. The zoom cursor only on cards with a picture.
- Decided, not missed: while the update overlay (.upd-back) is up, the preview and the update window both stand aside
  to it; it is the window on top and owns the keys. That is the order, not two windows waiting on each other.

## Rejected / not in this PR
- The Files lists: they show no images and have no route that serves a file's bytes; a preview there needs one.
- Arrows and swipe to step through a conversation's images (the card marks it optional).
- A full PDF or a full text file: there is no inline route for either today (the attachment route always downloads,
  by design: "an HTML one never renders on the board's origin"). The first page and the opening are what the card
  already had; the action reaches the whole file.
- The link-preview picture (an unfurled web page's image): it opens the web page, which is what a person expects.

## Weakest premise
That a plain click on a card is never meant as "download". It always was a download until now; a person who wants
the file still has the action (Open in Finder selects it, Download over Kosmos+) and a modifier click.

## Verified
- docs/browser-checks/render-file-preview-4930.js, Chromium and WebKit, desktop and phone: all good. Controls: without
  the modifier check P5 goes red; without the scroll lock Chromium P1 is 15 px short.
- engine/projects.revealfile-4930.test.js (Mac `open -R`, Windows `/select`, refused paths, error rule);
  server.attachment-reveal-4930.test.js (the stored file by id; opening the folder instead goes red);
  web.modal-way-out-1316 (the preview joins the Escape table); web.api-routes-3957 (the new route, which goes red
  when the route is removed).
