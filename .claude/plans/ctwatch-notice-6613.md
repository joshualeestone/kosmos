# ctwatch-notice-6613: raise a certificate check finding outside Settings, and acknowledge a lost report (kosmos#6613)

Stacked on ctwatch-board-6602 (kosmos#6602, the Plus pane line and switch). Detail of the underlying item is private.

## What this branch does
- `engine/cert-watch.js`: `certWatch` gains `key` (a 16-hex digest of the finding set: each finding's own hash, or
  its log id, for this address and earlier ones, plus the overflow counts) and `lostAt` (the lost marker's value).
  `ackLostIn(dir, at)` records in the board's own `ct-watch-lost-ack` file that a person saw the lost report for
  marker `at`; it refuses any other marker. The tunnel's report is never edited.
- `engine/remote.js` / `server.js`: `POST /api/remote/cert-watch/ack-lost {at}`, person-only (`isViaScreen`) and
  enrolled-only, like the switch.
- `web/index.html`: a notice card in the floating stack (`#cwnote-slot`, first slot, the `.utoast` look and its
  attention red, as #5018's notices) on every view but Kosmos+, while there is a finding: Review opens Kosmos+, close puts that finding set away (its key, in `localStorage`, as
  #6315's request notice keeps its own); a new finding is a new key and shows it again. On the Plus pane, Got it
  beside the lost-report sentence.

## Decisions
- In the floating stack, not beside `#askcard`: the page flow's `#askcard[hidden] + #conn` rules (the warning line,
  the empty-board phone layout, the talk view) need `#conn` straight after `#askcard`, and the stack takes no room.
  Closing sends keyboard focus where #5018's notices send it (the K mark, the remote bar's menu, the heading).
- The slot is in the stack's `:empty { display: none }` rule like every other slot (an empty flex item spends one
  gap); a static test checks every slot in `#topnotes` has one.
- Review puts the finding away, as #6315 ruled for the request notice ("Its close button or Review puts that set
  away"), but only once the pane's line says the finding (a pane that did not paint keeps the notice), and focus goes
  to that line. Rejected: dismissing only on close (Review is the person reading it).
- With the check switched off, the card still raises a finding (a switch never hides one) and says the check is off.
- The notice's words carry `role="status"` and are filled after the card is inserted, the login notice's pattern
  (#3532); consistent with the stack, not separately measured with a screen reader. Owner of that measurement: April,
  with VoiceOver at this card's design review, recorded on kosmos#6613 before it closes.
- Follows Josh's #6315 ruling for the request notice ("Definitely have to have a way to dismiss it"): close puts
  away what was shown, a new one comes back. The Plus pane line is never put away, so a finding stays findable.
- The key is a digest, not the report's strings, so nothing from the third party reaches the page.
- Got it is a board-side record keyed on the marker value, so a later loss (a new marker) is said again. Rejected:
  editing the tunnel's report (it is the tunnel's file, written atomically on its own schedule).
- Weakest premise: the notice is per browser (localStorage); another browser shows it again. Accepted: it errs
  toward telling, and the request notice works the same way.
- After Got it, focus goes to the line when it still says something (a finding), else to the check's switch, and
  the pane says "Noted." (an empty status line is no place to land).
- Not in this branch (still kosmos#6613's remaining notes): the Kosmos+-off path an agent can use to stop the check,
  and `isViaScreen` being a speed bump. Both need a decision about `PUT /api/remote` itself, outside this card.

## Proof
- Browser check `render-plus-panel-3829.js`, its certificate scenario: the notice's slot is first in the stack, a
  finding is raised away from Kosmos+ as the fixed warning, Review opens Kosmos+ and puts it away; a clear check
  raises nothing (the control). Its lost scenario: Got it shows with the lost sentence, posts the marker it was
  shown, then goes, the pane says Noted., and focus is on the switch.
- `node --test engine/cert-watch.test.js` (13), `web.cert-notice-6613.test.js` (13), `web.plus-cert-watch-6602.test.js`
  (9), the `server.test.js` route test (by name). Mutant: the dismissed-key check removed, 2 notice tests red.
