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
- BoardClient.swift: `loadPreviewImage`, the thumbnail loader's rules (through the phone's own session, once per run,
  a passing failure asked again, a 404 or an undrawable picture not), decoded once to a CGImage at most 900 px (review
  round 1: not a PNG decoded again on every draw), the newest 40 kept; reset with the chat.
- ChatView.swift: `LinkPreviewCard` under the bubble, laid out as the board's card (#761, Josh: the words first, then a
  much larger picture at the card's width); tapping opens the address. Inside ChatBubble, whose one VoiceOver element
  now says "Link: title, site" and, among its link actions, "Open <title>" unless one of the message's own links
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
- Weakest premise: that the picture fits a 0.52 aspect at the bubble's width (capped 220 pt); a tall picture is cropped,
  as the board's own card crops with object-fit.

## Verified
- ios/LogicTests (run.sh): 1898/1898, with the loader cases mirroring the thumbnail loader's (not a picture, 900 px,
  the unfurl route, 5xx again, 404 not, the sign-in page again, once only, no picture no request, the cap of 40 and
  its refetch, a sign-out clears them; the test Mac now answers the unfurl route) and the parsing cases (a full preview read; none on a plain row; non-http(s)
  refused; no title/words/picture is no card; title and site fallbacks; a picture from anywhere but the unfurl route
  dropped, another Mac route dropped, .. dropped; blank title; the spoken line).
- xcodebuild (Debug, iphonesimulator): BUILD SUCCEEDED.
- Shots, light and dark, on a simulator of my own (created and deleted): Files/7864-chat-preview-{light,dark}.png.
