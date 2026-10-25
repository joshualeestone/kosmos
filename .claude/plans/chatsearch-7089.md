# chatsearch-7089: search in the native iPhone chat (#7089, gap 4 of #7074, plan #6838)

## Finished looks like
On main, the iPhone chat has a search field that filters the loaded conversation as the board's
`#d-talk-search` does (talkFilterRows), shows the board's no-match sentence, clears when the chat
changes, does not load older pages or follow new messages while a search is on, and LogicTests
cover the filter and the sentence with a broken-copy control that goes red.

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
2. ChatView: `.searchable(text:, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search")`
   on the chat (iOS 16 target); the filtered rows go into Board.chatItems; empty filtered list with a
   non-empty query shows the sentence; loadEarlier() returns while searching; follow() does not scroll
   while searching (sets unseenNew as when scrolled up); query resets on agent change / disappear.
3. LogicTests: the board's cases (agent name match, person row by text only, case and trim, empty
   query returns all, sentence text), plus a broken-copy control.
4. Simulator shots light and dark (KOSMOS sample env), design folder ~/work/design-shots/kosmos-7089.

## Decided, not missed
- Kosmos rows (who == .kosmos) match by text only. Weakest premise: the board's dmWho on a kosmos
  row may give a non-empty from; changing it is one line if the reader finds it does.
- Pending (sent, not yet a row) bubbles stay visible while searching: on the phone they are the
  send's own feedback, not thread rows, so the board's "That message is hidden by your search."
  case does not arise until it lands as a row. Rejected: hiding them (a send would vanish).
- Day lines are recomputed over the filtered rows (chatItems runs on what is shown), as the board
  repaints the filtered rows.
- Not here: room search (pjRoomFilterRows, valve-band rule), searching unloaded history.
