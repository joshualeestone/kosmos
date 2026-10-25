# roomsearch-7096: search in the native iPhone room (#7096, the room's half of #7074 gap 4, plan #6838)

Built stacked on chatsearch-7089 (#7089, merged as PR #7102): it reuses the chat's search row design, the
no-match sentence and the guards.

## Finished looks like
On main, the iPhone room has the magnifier and search row Mona Lisa approved for the chat (#7089), filtering
the loaded room as the board's `#pj-room-search` does (pjRoomFilterRows), with the board's no-match
sentence, no older posts loaded and no following while it filters, and LogicTests covering the filter; a
broken copy of BoardRoom run against them goes red (run by hand with run-room.sh <dir>, recorded on the card).

## The board, measured on main (web/index.html)
- pjRoomFilterRows(rows, p, q): needle trim + lowercase. who: valve '' ; operator 'you' ; else
  pjNameOf(p, from) || from || ''. text: valve because || fallback; refused (doing + ' ') + because;
  else text. Keep when who or text includes the needle.
- The room filters before its refusal fold; no-match sentence pjNoMatchSentence (shared with the chat);
  the room announces it on the way into no match (PJ_SEARCH_WAS_EMPTY); PJ_ROOM_QUERY clears on switching
  project.

## Build
1. BoardRoom: `static func roomFilter(_ rows:, name:, query:)` with the rules above, on the rows before
   roomItems folds refusals. LogicTests in ios/LogicTests/room.
2. RoomView: the magnifier and search row as ChatView's (#7089); filtered rows into roomItems; no-match
   state; guards while searching: older posts (loadEarlier equivalent), BOTH scroll-to-bottom paths (the
   rows.last?.id one and the #7080 workingLine onChange, per Mona Lisa on the card). (The room draws every
   reply's header already, so there is no adjacency to switch off.)
3. Shots light and dark, ~/work/design-shots/kosmos-7096.

## Decided, not missed
- A refusal matches by its writer's shown name and by what it tried and why, not by the sentence the
  phone draws for it ("... tried to ... and Kosmos stopped it: ..."), as the board's does. A valve band's
  text is already its reason on the phone, so it matches as the board's does.
- A note has no writer (the board's pjNameOf of no sender is ''), so it matches by its text only.
- An outside message matches by its sender id (the board's pjNameOf finds no member for it).
- A post written while words filter gets the chat's line, "Once it arrives, your message shows only if it
  matches the search.", under the room (below the post's own line, which wins when a post did not go);
  cleared when the words change, on leaving and on a reset.
- On a read that could not read all of the room (RoomStore.roomPartial, from the read's ok false), a
  search matching nothing shows the board's partial-read line instead of the no-match sentence, as the
  board does on body.ok === false: what matches may be in the part it missed.
- The magnifier takes the room's own bar style (as its info button), not the chat's grey glyph.
- While filtering, runs group over the kept rows (two posts by one writer with others between them can
  read as one run). Cosmetic; the board's fold accepts the same.
- With the row open and the keyboard up, a new post follows only a reader whose end marker is still on
  screen: that is the room's own rule today with its composer (it has no keepNewestInView, unlike the
  chat). Not changed here.
- The partial-read line shows only where a search matches nothing; the board draws its band in every case,
  and a current Mac answers the phone's read with a 503 (roomFailed), so it is rarely reached. A page already
  loading when the row opens keeps its anchor when it lands, as the chat's does.
- A search covers the posts loaded on the phone (no older page loads while the row is open), so "Nothing here
  matches" is about those, as in the chat (#7089). The card scopes unloaded history out.
- The partial-read flag describes the rows on screen: a failed read leaves it as the last read that landed set
  it (the board's announcer reads the last body that landed too).
- An outside message matches a name for its sender if one is known (the board's pjNameOf), though the
  phone draws an outside sender by its id (#3851); same as the board.
- The person's pending post bubbles stay on screen while words filter, as in the chat (#7089: a send's only
  feedback is its bubble). The board leaves its pending row out while filtering ("not a result of one").
  The sent-while-searching line says the post shows only if it matches once it arrives.
- The partial flag's rule is Board.partialRooms, which is tested. Its wiring is not: RoomStore calls it on each
  landed read (a failed read returns before it) and reset() empties the set; there is no RoomStore seam in the
  logic tests, so that wiring is read, not tested.
- On a partial read with no match, the phone shows the board's band sentence in place of the rows, as the board
  does, and speaks it: the board's announcer stays silent on ok false, but on the phone the field holds
  VoiceOver's focus and nothing else would say why the room is empty. Rarely reached (a current Mac answers
  the phone's read with a 503, roomFailed).
- Tapping the room's composer with the search row open and empty puts the row away: the design's "leaving it
  empty hides it" (#7089), as in the chat. A row holding words stays.
- A reply's header pressed while the search hides the post it answers does not move the room: the line under the
  room says "That message is hidden by your search." (spoken), as the board's PJ_HIDDEN_BY_SEARCH, until the words
  change or the search goes. Only for a post the room holds; one not loaded keeps the jump's own behaviour. Added
  on the rebase onto #7101 (Mona Lisa's jump), as agreed with her: whichever merged second added this guard.
- The lines under the room follow the board's one line, newest write wins: a jump to a hidden post shows over the
  last post's line, a new post clears the hidden line, and the hidden line clears the sent-while-searching one.
  A post's own line arriving later clears the hidden line too. The jump's rule is Board.roomJumpHidden, tested both
  ways; its call in RoomView (shownRows, rows) is read, not tested, as the partial flag's wiring is.
