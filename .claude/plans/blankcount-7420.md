# blankcount-7420 (kosmos#7420)

Finished means: an agent on this Mac can read, per iPhone build, how many chat showings there were, how many went blank, how many rebuilds they took and how many were left blank at close, without asking the person.

Why: asked 11-05 whether blanks got more frequent, nobody could say. A blank is recorded only when someone shares a capture.

Call: a tally per build on the board (engine/chatopens.js), not more shift-report fields. Shift reports go only when a shift happened and keep the last 50, so they cannot give a rate.

Rejected: counting "blank, not yet acting" lines (those can be an instant); a screen for it (agents read it, Josh said he will not look things up).

A showing: from the chat appearing or coming back to the front until it closes or goes to the background. So one long chat can count twice. Rate is per showing, not per person.

Blank here means a rebuild happened or the list had no rows for 3 s when it closed. So the number is a floor: see engine/chatopens.js for what it misses. Past-the-end put-backs are not counted on purpose: the simulator does one on every box shrink with rows drawn, so they would swamp it.

Not widened: GET stays behind the board's token like /api/phone/chat-shifts rather than joining AGENT_TOKEN_ROUTES; the file is readable on this Mac, and nothing here justifies more reach.

Known under-counts: a chat torn down under its info page, a background entered from the info page, and a killed app send nothing. A count that loses a few showings is fine for a rate; a false blank is not.

Weakest premise: rows-gone timing at close, and the whole path from phone to board. Tested in logic and by source checks only; nothing has run it end to end on a phone.

Needs a board release to receive; an older board answers 404 and the phone ignores it. Needs a TestFlight to send.
