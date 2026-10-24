# roomfiles-7062: room posts show their attached files (a slice 9 gap, #6838)

**Done when:** on the iPhone, a room post that carries files shows one card per file inside its bubble under its
words (the chat's FileCard, unchanged), a tap opens the file in Quick Look the way the chat does (a page or markup
file opens on the board's room instead), a post that is only its file's name shows the card and not the name twice,
the room suite covers it against the real route's answer, and it is merged.

## Decisions
- Reuse ChatFiles.swift's FileCard as it is (approved in the slice 3b review); no edit to ChatFiles.swift or
  BoardClient.swift (Angel's and Ice Cream Kitty's files). RoomView watches the chat's BoardClient so a picture shows
  when it arrives, and opens files through its existing fetchFile and closed.
- The cards sit inside the post's bubble, after its words, as the board draws pjAttachmentCards after the body. The
  words hidden when they are exactly the file names (Board.roomWords = the chat's wordsShown = the board's pjWords).
- A post is one VoiceOver element (slice 9), so each file is also an "Open <name>" action on it.
- The suite reads room-files.json, captured from a sandboxed board's real GET /api/project/<id>/room?n=50 with a
  two-file post and a names-only post (scratchpad capture script, the test fleet's roo as the member).
- Rejected: FilesBubble (an agent-only bubble with its own background) inside a room bubble, which would draw a
  bubble inside a bubble and none for the person's own posts.
- Weakest premise: the cards' look inside a room bubble is unverified by a screenshot. The simulator shot run was
  denied on this machine (#7055 part 2); the card itself is the chat's reviewed one.

## Steps
1. Model, view, suite, builds. DONE (room 129/129, run 1065, actions 97, settings 41, tasks 90; Debug and the
   KOSMOS_STORE_SHOTS Release build SUCCEEDED; control: roomWords returning the raw text goes red).
2. Review loop. Round 1: 0 blockers, 3 warnings, 5 nits. Fixed: the chat's chatEpoch guard and reset on files;
   cards hidden inside the post's combined VoiceOver element so each file is offered once (its action says when it
   failed); the single-attachment test made able to fail (a hand-made row); a source check that the bubble draws
   roomWords; the chat's 6pt card spacing; the unnamed-file difference from pjWords noted. Left as is (inherited
   from the chat, stated): watching the whole client; Quick Look state lost if the room is replaced.
3. Validation, PR.
