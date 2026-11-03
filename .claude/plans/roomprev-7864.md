# roomprev-7864: the iPhone room draws the link preview card too (kosmos#7864 slice 2)

Slice 1 (#7870, merged 637cf2fd5c) drew the card in an agent's chat. Rooms have their own row model and renderer.

## The change
- BoardRoom.swift: `RoomRow.preview`, read with slice 1's `parseLinkPreview` on a room POST only. An outside row never
  carries one: the board never fetches for words from outside this Kosmos (#3311), and the phone does not read one.
- RoomView.swift RoomBubble: slice 1's `LinkPreviewCard` under the bubble at the room bubble's width (0.78 of the screen).
  The post is one VoiceOver element (`.combine`); the card is read in it as plain words, the chat's spoken line
  (`linkPreviewSpoken`: title, real host, words), never as a button, as this file already does for file cards (review
  round 1); its address is the post's one "Open link to <host>" action.
- RoomView.swift: the picture through slice 1's `client.loadPreviewImage`, its task id the shared
  `client.previewTaskKey`; dropped on a memory warning. NOT released when the room leaves the screen (review round 2):
  the room stays alive behind another tab, so a release would also drop the pictures a chat on that tab is showing (they
  blinked and refetched on every tab switch). The shared cap of 12 and the memory-warning drop bound them.
- Debug only: KOSMOS_SAMPLE_PREVIEW=1 gives the sample room's post a link and its preview, and the sample picture serves
  it, for design shots.
- No new request: server.ios-routes-6838.test.js passes unchanged (5/5).

## Decided
- Review round 3 (a BLOCKER, from the code and Apple's docs, not a device): `.ignore` on the card's Button itself keeps
  its button trait and action, so a VoiceOver double-tap on a post (the picture fills its centre) could open the site.
  The card is now wrapped in a container before `.ignore` (the file cards' shape), and a post with a card gets a
  do-nothing default action (the chat's #7014 rule); other posts keep their default exactly. NOT verified with
  VoiceOver or Accessibility Inspector on a device: stated.
- Accepted, as in the chat: the card is the bubble's maximum width (a short post's bubble is narrower) and sized from
  the screen, not the window (iPad split view); two memory-warning observers when a room and a chat are both alive
  (harmless double drop).
- Stated, as for the chat: a chat closing releases the shared pictures, so a room shown after it refetches its own
  (self-healing); a load already on its way when the chat releases can still land; more than 12 cards with pictures
  alive at once would evict and refetch in turn (a phone screen shows a few; an iPad or a long archive might not).
- The picture task's id is one `BoardClient.previewTaskKey`, shared by chat and room, with a logic test.
- No dedupe of the action against a link in the post's text: the room bubble has no per-link actions of its own (its
  links are tapped in the text), so the card's action is the only spoken way to open the address.

## Verified
- ios/LogicTests/run-room.sh: with a post's preview read, none on a plain post, none on an outside row, and a later
  poll's preview replacing the row shown (mergeRoom).
- xcodebuild Debug iphonesimulator: BUILD SUCCEEDED.
- Shots, light and dark, on a simulator of my own (created and deleted): Files/7864-room-preview-{light,dark}.png.
