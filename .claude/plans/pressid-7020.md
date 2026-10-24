# #7020: a permission press names the request it was drawn for

Stacked on Mona Lisa's #7017 part 2 (notifallow-7017, rebased onto main here), which adds
`chat.permissionRequestId(card)` and serves it on the thread GET's question row as `permission.request`.

## Finished looks like
- A press POST that carries `request` is refused (409, types nothing) when the permission prompt on screen now has a
  different fingerprint, or when no permission prompt is on screen. The sentence is the existing "its screen moved
  between drawing that button and sending it".
- A server test shows two permission prompts with the same question line and the same Yes/No options: a press drawn for
  the first, sent while the second is up, is refused and nothing is typed; the same press against the first is typed.
- A malformed `request` (not 64 lowercase hex) is refused 400.
- The board page and the iPhone chat both send `request` when the question row carries a permission card, and the
  request is part of the question's identity on both (a new request with the same words is a new question: buttons
  re-enable, an armed lasting choice or an answered lock does not carry over).
- `Board.pressRequest` gains `request: String? = nil`, so Mona Lisa's notification call site compiles unchanged and
  she passes `press.request` in a one-line follow-up (agreed 00:13 CDT).

## Approach
- server.js press handler (POST /api/agent/:name/thread): inside the existing button-press block, after the `asked`
  checks so their more specific sentences win, read `chat.permissionCard(seen.text)` and compare
  `chat.permissionRequestId` with `body.request`. The thread GET reads the same `chat.viewport`, so an unchanged
  pane gives the same fingerprint.
- web/index.html: `dmChoicesFrom` keeps the live question row's `permission.request` on DM_CHOICES and folds it into
  the `gen` test; `dmChoicePress` sends it.
- iOS: `Board.Choices` gains `request`, read in `parseChoices` from the thread's last unreported question row, and it
  joins `key`. `sendPress` passes it to `pressRequest`.

## Rejected
- Comparing `detail` alone (the card's first idea): the fingerprint covers kind, title, says, target, detail and reason,
  and is already what the phone's notification carries. One id, not two.
- Making `request` required on every press: an older board page or phone would then be refused on every button.
  Optional on the wire like `asked` was; every client in this repo sends it where a card is shown.

## Weakest premise
That the card's fields read the same on two captures of one unchanged prompt. A pane redrawn at another width can wrap
`detail` differently and refuse an honest press, which is the safe direction (Mona Lisa's premise too).
