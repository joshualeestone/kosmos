# roomprev-7864: the iPhone room draws the link preview card too (kosmos#7864 slice 2)

Slice 1 (#7870, merged 637cf2fd5c) drew the card in an agent's chat. Rooms have their own row model and renderer.

## The change
- BoardRoom.swift: `RoomRow.preview`, read with slice 1's `parseLinkPreview` on a room POST only. An outside row never
  carries one: the board never fetches for words from outside this Kosmos (#3311), and the phone does not read one.
- RoomView.swift RoomBubble: slice 1's `LinkPreviewCard` under the bubble at the room bubble's width (0.78 of the screen).
  The post is one VoiceOver element (`.combine`), so the card's words are read with it, and its address is an action,
  "Open link to <host>" (the address's own host, as in a chat), beside the file actions.
- RoomView.swift: the picture through slice 1's `client.loadPreviewImage`, its task id carrying kept/missing and the drop
  generation (the chat's previewTaskKey rule); released when the room leaves the screen; dropped on a memory warning.
- Debug only: KOSMOS_SAMPLE_PREVIEW=1 gives the sample room's post a link and its preview, and the sample picture serves
  it, for design shots.
- No new request: server.ios-routes-6838.test.js passes unchanged (5/5).

## Decided
- The room's onDisappear also runs when a member's chat is opened from the room: the release can drop a picture that
  chat already kept, whose card then reads missing and fetches it again. Self-healing; not fenced.
- No dedupe of the action against a link in the post's text: the room bubble has no per-link actions of its own (its
  links are tapped in the text), so the card's action is the only spoken way to open the address.

## Verified
- ios/LogicTests/run-room.sh: 807/807, with a post's preview read, none on a plain post, and none read on an outside row.
- xcodebuild Debug iphonesimulator: BUILD SUCCEEDED.
- Shots, light and dark, on a simulator of my own (created and deleted): Files/7864-room-preview-{light,dark}.png.
