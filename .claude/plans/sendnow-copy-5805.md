# sendnow-copy-5805: no bare status number under Send now anyway

Follow-up to #5830 (#5805 slice 2b), from Mona Lisa's copy note on that PR (it merged 3 minutes after the note).

## Done when
- A refused Send now anyway whose answer carries no reason says "Kosmos could not send it. Try again." under the box, never "Not sent (the board answered 503)".
- web.limitdm-5805.test.js asserts that text and that no digit reaches the screen, and fails on the old wording (measured: fail 1, actual "Not sent (the board answered 503). Try again.").

## Call
- Wording: "Kosmos could not send it. Try again." parallels the line just above it ("Kosmos could not reach the board to send it. Try again."). Rejected: "Not sent. Try again." (it reads like the "Not sent: <reason>." line with its reason missing).
- A refusal WITH a reason keeps "Not sent: <reason>." unchanged.
- Weakest premise: the status number had debugging value for someone reading a screenshot. Nothing on main shows one on screen today, and the server logs the refusal.

## Browser check
Error-path copy only, on a function the unit test lifts from the page and runs. Trailer used, no new render check.
