# chatsearch-7089: search in the native iPhone chat (#7089, gap 4 of #7074, plan #6838)

## Finished looks like
On main, the iPhone chat has a search field that filters the loaded conversation as the board's
`#d-talk-search` does (talkFilterRows), shows the board's no-match sentence, clears when the chat
changes, does not load older pages or follow new messages while a search is on, and LogicTests
cover the filter and the sentence; a broken copy of BoardLogic run against them goes red (run by
hand with run.sh <dir> and recorded on the card, not a standing test).

## The board, measured on main 4833d3f9b0 (web/index.html)
- talkFilterRows(rows, name, q): needle = trim + lowercase; keep a row when dmWho(m.from, name) or
  m.text contains it. dmWho: this agent's own rows say the agent's name; a person's row has no
  `from`, so tskAgentName(undefined) gives '' and it matches by text only.
- pjNoMatchSentence(q): `Nothing here matches "<trimmed q>". Clearing the search brings the conversation back.`
- earlierNearTop returns early while a search is on ("a search shortens the thread; that is not a
  reader at the top"); convPause while filtering (#5624): no follow to the bottom.
- TALK_QUERY = '' when another agent opens (44149).

## Build (stacked on #7087's ChatView, so after it merges: rebase onto main first)
1. BoardLogic: `static func chatFilter(_ rows: [ChatRow], agentName: String, query: String) -> [ChatRow]`
   and `static func chatNoMatch(_ query: String) -> String`, the board's rules exactly.
2. ChatView: `.searchable(text:, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")`
   on the chat (iOS 16 target); the filtered rows go into Board.chatItems; empty filtered list with a
   non-empty query shows the sentence; loadEarlier() returns while searching; follow() does nothing
   while searching (no scroll, no capsule; clearing scrolls to the newest); query resets on agent change / disappear.
3. LogicTests: the board's cases (agent name match, person row by text only, case and trim, empty
   query returns all, sentence text), plus a broken-copy control.
4. Simulator shots light and dark (KOSMOS sample env), design folder ~/work/design-shots/kosmos-7089.

## Decided, not missed
- Kosmos rows (who == .kosmos) match by text only. Weakest premise: the board's dmWho on a kosmos
  row may give a non-empty from; changing it is one line if the reader finds it does.
- Pending (sent, not yet a row) bubbles stay visible while searching. The board leaves its pending
  row out while filtering and instead adds "Clear the search to see it." to its not-sent line; the
  phone has no such line, a failed send's only feedback is its own bubble, so hiding it would hide
  the failure. Rejected: following the board here. The board's "That message is hidden by your
  search." comes from jumping to a reply's original, which the phone does not have (#7083: header
  not a jump), so it does not arise.
- While searching every reply draws its header (dmReplyAdjacency: not while filtering), pending too.
- Clearing the search scrolls to the newest message: the board resumes following then (convFollow
  when not filtering). Weakest premise: a reader who scrolled up before searching loses that place.
- The field is SwiftUI .searchable in the navigation bar drawer, displayMode .always. First built
  with .automatic (hidden until pulled down); the first screenshot showed a filtered thread with the
  field out of sight, nothing saying why the chat was short. Rejected .automatic for that. Cost: one
  row (about 44 pt) always taken; a design question for Mona Lisa (shots in
  ~/work/design-shots/kosmos-7089/).
- The query clears when the chat goes off screen, so coming back always shows everything.
- Day lines are recomputed over the filtered rows (chatItems runs on what is shown), as the board
  repaints the filtered rows.
- Not here: room search (pjRoomFilterRows, valve-band rule), searching unloaded history.
- A message sent while searching: the board leaves it out of sight once recorded (no pending row while
  filtering, and the row is filtered). The phone says so under the composer: "Once it arrives, your
  message shows only if it matches the search." (cleared when the search changes). It is set only once the send went out and
  ranks below every other composer line, so a refused press or file is never hidden behind it. Rejected: always
  keeping the person's newest row, which would make the filter show rows that do not match.
- Rows the phone marks .agent (any `from`, and question rows) all match this agent's name. The board
  names another agent's row by that agent's card and a from-less question by ''. The phone already
  names every non-person row by this agent (ReplyHead), so the filter matches what the phone shows.
  Weakest premise: a chat row from ANOTHER agent; if those reach the phone it needs their names.
- The no-match sentence is also announced to VoiceOver (the field keeps focus), as the board's room
  search announces it.
- While searching, the person's own send does not scroll the thread (the board's jumpToOwnSend). The
  keyboard's scroll-to-newest and the new-messages capsule are off while searching too.
- No match with a pending bubble showing: the sentence is about the conversation's rows and stays the
  board's; the bubble is the send in flight (see above). Raised to Mona Lisa with the shots.
- Matching uses Swift's String.contains, which treats composed and decomposed accents as equal; the
  board's includes compares code units. The phone can match slightly more; kept (it is the kinder
  answer for a person typing).
- While searching, the earlier-messages failure line and its Try again are not drawn (no pages load
  while searching); they come back when the search clears.
- Clearing the search re-arms the first-scroll settle (settledAtEnd = false) so a read landing during
  the scroll to the newest cannot load a page and pin the reader at the top. Settled by the end marker
  or the top leaving, as on opening; a one-second fallback covers a chat too short to move either.
  Weakest premise: the fallback is a time, which the opening path deliberately avoids; it only
  releases what the markers did not, and loadEarlier still checks topVisible.
- The search field's prompt is "Search" (the board's placeholder); its aria-label "Search this
  conversation" is not carried: .searchable takes one prompt. Rejected a longer prompt that truncates.
- The field also shows over the loading, refused and Mac-not-answering screens: .searchable is on the
  chat's one view, and making it conditional would change that view's identity and reset its state.
  Typing there does nothing until a conversation loads. Every host pushes ChatView on a navigation
  stack (AgentsView, RoomView, TasksView, TodayView), so the drawer renders in each.
- The clear-search settle and its fallback are view behaviour LogicTests cannot drive; they join the
  device checks on #7089 (clear a search on a long chat with earlier pages loaded: it lands at the
  newest message and does not load a page).
