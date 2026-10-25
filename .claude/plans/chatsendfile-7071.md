# chatsendfile-7071: send a photo or a file from the native iPhone chat

Card: kosmos#7071, a gap in the native iPhone plan (#6838). The board's chat adds files with the + beside its composer;
the native chat (slices 3a #7008, 3b #7016) sends words only.

## Finished looks like
On main, the native chat with an agent has a + beside the composer offering Photo Library and Files. Each pick uploads
at once (PUT /api/agent/<agent>/attachment, as the board's attachUpload) and waits as a chip with a remove button
above the composer. Send carries the words and every waiting file as one message (POST .../thread with
`attachments: [ids]`); with no words, the files' names are the words (the board's own attachment-only send). The
pending bubble shows the files it carries, and a retry sends them again. The board's sentences for too big (100 MB),
too many (10), too slow (408, or a cut large upload) and not reached are said on the composer line. Checked by
ios/LogicTests (requests, answers, limits, the client against the fake Mac) with a broken-copy control, and the iOS
typecheck. The real-iPhone check joins #6838's device list.

## Change
- BoardLogic.swift: `Attached` (id, name), `uploadRequest`, `uploadResult`, `uploadRefusal` (size and count before
  any bytes), `sendWords` (names when no words), `sendRequest` takes attachment ids; `PendingSend.files`.
- BoardClient.swift: `Environment.upload` (the bytes from a file on disk, never held in memory); per-agent `attached`,
  `uploading`, `attachLine`; `attach`, `unattach`; `post` carries and clears the chips (they ride the pending item, so
  a retry resends them); `sendAgain` resends a row's files; all dropped by forgetChats; epoch guard after awaits.
- BoardClient+App.swift: `upload` through the same session (URLSession.upload(fromFile:)).
- ChatView.swift: the + menu (PhotosPicker, images, compatible encoding; fileImporter), chips, can-send with files
  only, the composer line for upload sentences, pending bubble lists its files.
- LogicTests/main.swift: a section for all of the above.

## Decided
- Chips move into the pending bubble at Send (the board keeps them on the composer until answered). A failed send
  keeps them on the bubble, whose retry resends them, so nothing is lost and the composer is free for the next one.
- Deleting a failed bubble deletes its files with it (they are not put back on the composer): Retry resends them,
  and the board's own files stay on the Mac either way. Rejected: putting them back, which would revive files the
  person had just chosen to drop.
- A removed chip's file stays on the Mac, as with the board's x (nothing there removes a stored attachment).
- Photo Library is images only, re-encoded as JPEG by Apple's picker (`.compatible`): a HEIC the Mac cannot preview
  would show as a plain file. Videos and anything else go through Files.
- No camera in this card (needs the camera permission string and a capture screen).
- A project room's composer is not touched (Mona Lisa owns RoomView, #7062).

## Weakest premise
That the Mac accepts the upload through Kosmos+ from the app's own session exactly as from the board's page. The
route is the same and the session is the one every other native call uses, but no automation here reaches a real Mac
through Kosmos+; it is on the device check.

## Device checks (join #6838's list)
1. Photo Library and Files both open from the + menu (iOS 16 and current).
2. A photo and a PDF send to an agent through Kosmos+, with and without words; the agent sees the files.
3. A file held only in iCloud Drive (evicted) is fetched and sent; one over 100 MB is refused without being copied.
4. VoiceOver on a sent files row says You, the time, the count; on an agent's files row that has words, the words
   are heard (they are read through the bubble's label); the + says why it is off at ten files.
5. Switching apps during a large upload: whether it finishes or says it could not reach Kosmos.

## Deferred (with reasons)
- No cancel for a file still being fetched from the cloud: the wait is Files', shown as Adding a file, and a cancel
  needs its own control; the device check measures how long it really is.
- No background time for an upload (beginBackgroundTask): leaving the app mid-upload may fail it, which the line says
  plainly and a second pick fixes; device check 5 measures it.
- A failed pending bubble's file chip is under 44 pt tall; the not-sent line beside it is the full-size way to retry,
  and VoiceOver's action covers it.
- The person's files bubble uses the agent files bubble's width (at least 85%), so the file cards keep room for their
  names; the person's text bubbles keep 78%.
