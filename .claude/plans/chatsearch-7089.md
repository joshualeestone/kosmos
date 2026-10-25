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
2. ChatView: a magnifier in the bar opens the search row (see Decided); the filtered rows go into Board.chatItems; empty filtered list with a
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
- The field: Mona Lisa's design (#7089 comment 6394220427). A magnifier beside the (i) opens a field
  under the bar with the keyboard up; it stays on screen while it holds words; its x or Cancel empties
  it and puts it away, as does leaving it empty. VoiceOver label "Search this conversation" (the
  board's). Built as a plain TextField row, not .searchable: on iOS 16 .searchable cannot be shown and
  hidden from code (isPresented is iOS 17). History: first .searchable .automatic (a filtering search
  could sit out of sight), then .always (about 50 pt on every visit); both rejected for this.
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
  names every non-person row by this agent (ReplyHead), so the filter matches who the phone shows. Words match the row's
  text as the Mac sent it, as the board's do, even where the phone draws a row differently (a
  permission card, an unsent-draft row, a files row).
  Weakest premise: a chat row from ANOTHER agent; if those reach the phone it needs their names.
- The no-match sentence is also announced to VoiceOver (the field keeps focus), as the board's room
  search announces it.
- While searching, the person's own send still scrolls to the end, where its bubble is drawn. The board does
  not move at all (jumpToOwnSend), but it also hides its pending row while filtering; the phone keeps
  the bubble as the send's only feedback, so it brings that bubble into view. The new-messages capsule
  is off while searching. Opening the row pushes the thread down, so a reader at the newest message
  is kept there (scrolled back after the row opens, kept by the keyboard).
- Search mode is the row open OR words in it. In it no earlier pages load (and a page already on its
  way does not move the reader when it lands), so editing the words, even back to none, never loads
  one under the reader. Following and the capsule pause only while words filter (convPause). Putting the row away scrolls to the newest message only if this open filtered the
  thread (the reader's place is gone then); an open that never filtered leaves the reader where they
  are, so closing it from a scroll that dismissed the keyboard does not pull them anywhere.
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
- The search field's prompt is "Search" (the board's placeholder); the field and the magnifier carry
  the board's aria-label, "Search this conversation", for VoiceOver.
- The magnifier is there on the loading, refused and Mac-not-answering screens too; typing there does
  nothing until a conversation loads. Every host pushes ChatView inside a NavigationView (AgentsView,
  RoomView, TasksView, TodayView), so the bar's buttons render in each.
- The clear-search settle and its fallback are view behaviour LogicTests cannot drive; they join the
  device checks on #7089 (clear a search on a long chat with earlier pages loaded: it lands at the
  newest message and does not load a page; the same after leaving a chat mid-search and coming back;
  the magnifier and (i) both fit at the largest text size (if not, Mona Lisa's fallback: Search in a menu);
  the search row at the largest text size (Cancel does not wrap, the field keeps room); opening the row
  at the newest message keeps it in view; VoiceOver hears the no-match
  sentence).
- No rows yet, a send in flight and a search on: the phone shows the bubble and no sentence; the board
  (pending hidden while filtering) would show its empty line. Kept: the conversation is not empty of
  what the person can see.
