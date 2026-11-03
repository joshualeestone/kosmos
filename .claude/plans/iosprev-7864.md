# iosprev-7864: the iPhone chat draws the link preview card the board already sends

Card: kosmos#7864 (split from #7861: Josh asked "Check the phone app's chat does the same"). Owner: Ice Cream Kitty.

## Measured before building
The iPhone chat made links (bare ones too, NSDataDetector) but drew no preview card for ANY link: no Swift file read a
row's `preview`, which the board attaches in withPreviews (#357) on the thread route the phone reads.

## Slice 1 (this branch): the agent conversation
- BoardLogic.swift: `LinkPreview` and `parseLinkPreview`, by the board's pjPreviewCard rules: an http(s) address with a
  host; at least a title, words or a picture; the title falls back to the address and the site to the host. The
  picture is kept only as the Mac's own `/api/unfurl/image?url=` path (isBoardPath), never another address, so the
  phone never talks to the site. `ChatRow.preview`; `linkPreviewSpoken` for VoiceOver.
- ChatView.swift card top line: `linkPreviewSiteLine` (site, and the real host when it differs).
- BoardClient.swift: `loadPreviewImage`, the thumbnail loader's rules (through the phone's own session, once per run,
  a passing failure asked again, a 404 or an undrawable picture not), decoded once to a CGImage at most 900 px (review
  round 1: not a PNG decoded again on every draw), decoded off the main actor (round 3), the newest 12 kept and all
  dropped on a memory warning (round 3: 40 could reach ~130 MB); a card on screen whose picture was dropped fetches it
  again (its task's id names whether the picture is kept, round 2); reset with the chat.
- ChatView.swift: `LinkPreviewCard` under the bubble, laid out as the board's card (#761, Josh: the words first, then a
  much larger picture at the card's width); tapping opens the address. Inside ChatBubble, whose one VoiceOver element
  now says "Link: title, host" and, among its link actions, "Open link to <host>" (round 6: the address's own host,
  never the page's site name, which a page can make up and a VoiceOver user has no address to check against) unless one of the message's own links
  already opens that site (review round 1: it was an action on every bubble).
- Debug only: KOSMOS_SAMPLE_PREVIEW=1 adds two sample rows with previews and draws a sample picture, for design shots.

## Slice 2 (next, same card): project rooms
Rooms have their own row model (BoardRoom.swift RoomRow) and renderer (RoomView.swift); same card, same parser.

## Decided
- Not built: a card under a message that also carries files (FilesBubble). The board shows one there; the phone's files
  bubble is its own layout. Noted for slice 2's review.
- Differences from the board, deliberate: a picture whose address holds ".." is dropped (isBoardPath), and a preview
  whose only content was such a picture draws no card (the board would title it with the address). The card does not
  take the long-press sheet; it is a link, and its message's bubble keeps the sheet.
- Review round 4: a memory-warning drop also bumps a generation the loader checks before keeping, so a picture on its
  way across a drop is not kept (tested). Accepted, stated: a list holding more than 12 preview cards at once could
  evict and refetch in turn (the chat's LazyVStack keeps a screen's worth alive, well under 12); a card scrolled away
  mid-fetch relies on env.send answering nil when its task is cancelled, as the thumbnail loader does.
- Review round 8 (the last under the 8-round cap, whole branch, no blocker): VoiceOver hears the page's words too, up to
  160 characters, as a sighted person reads them; a failed picture is retried when its card is next drawn, as now
  documented. The picture's size is capped by the Mac before the phone sees it (engine/unfurl.js IMAGE_MAX, 5 MB, via
  readCapped), so the phone adds no cap of its own.
- Review round 7: the drop generation is published (a drop with nothing cached yet still redraws and reloads the
  cards); the card's top line shows the address's real host beside the page's site name when they differ, as VoiceOver
  already said; VoiceOver keeps a port. Stated, not fenced: a load of a closing chat still on its way can land after the
  release; it is one of the capped 12 and goes at the next close or memory warning. The sample rows use bare addresses,
  which the board previews since #7861 (merged 11-03).
- Review round 6: a chat closing RELEASES its pictures without the drop generation (a quick switch kept discarding the
  next chat's pictures on their way, tested); only a memory warning bumps it. A cancelled load leaves the asked set alone
  across a drop. Before round 6: the pictures are dropped when the chat closes (not when its info page is pushed over it), so they do
  not outlive it; and a card's load task id carries the drop generation, so a picture thrown away for arriving across a
  drop is fetched again. The site fallback keeps a port, as the board's.
- Weakest premise: that the picture fits a 0.52 aspect at the bubble's width (capped 220 pt); a tall picture is cropped,
  as the board's own card crops with object-fit.

## Verified
- ios/LogicTests (run.sh): 1910/1910 (a sign-out while a picture is on its way, and a memory-warning drop with its
  refetch, added in rounds 2 and 3), with the loader cases mirroring the thumbnail loader's (not a picture, 900 px,
  the unfurl route, 5xx again, 404 not, the sign-in page again, once only, no picture no request, the cap (12) and
  its refetch, a sign-out clears them; the test Mac now answers the unfurl route) and the parsing cases (a full preview read; none on a plain row; non-http(s)
  refused; no title/words/picture is no card; title and site fallbacks; a picture from anywhere but the unfurl route
  dropped, another Mac route dropped, .. dropped; blank title; the spoken line).
- xcodebuild (Debug, iphonesimulator): BUILD SUCCEEDED.
- Shots, light and dark, on a simulator of my own (created and deleted): Files/7864-chat-preview-{light,dark}.png.
