# #3660: the setup assistant bubble on Kosmos's own model (the bubble side)

Josh, 2026-09-24 18:05/18:07: the assistant runs on Kosmos's own model until the person connects theirs ("let's do
it"). The server side is merged and deployed (ICK, kosmos-relay#115), and the Mac route is merged (#3674). The connector
with `assistant-chat` rides the 0.6.94 cut.

## Finished looks like
On an installed Kosmos with no guide agent yet, the bubble shows. It has the bundled picture of Josh, says it runs
on Kosmos's own AI until they connect theirs, and answers through POST /api/setup-guide/hosted. It carries the
conversation (session-long), says the allowance when low, and keeps the words in the box on a refusal. Once a guide
is made, the bubble moves to it. A connector that predates the verb (501) says so once and steps aside. A source
checkout and every browser-check sandbox show no bubble, as before.

## Decided
- Where it shows: GET /api/setup-guide says `hosted` only when a connector exists at a real path
  (remote.hostedAvailable), meaning the bundled copy or an explicit override. Rejected: always showing it without a
  guide. That would put the bubble on every browser check's page, and would send a developer's chat to the
  production coordinator.
- The conversation lives in sessionStorage for the tab. There is no agent thread to hold it, and it is not worth
  a board store: it is left behind when a guide takes over, since that is a different assistant.
- The screen goes with each question (the route keeps only the Screen line). The guide's /api/setup-guide/page
  report is skipped with no guide; its 404 would reset the bubble.
- The note says where it runs, because the words leave the Mac: "An AI in Josh's voice, on Kosmos's own AI until
  you connect yours. Josh isn't typing live."
- The allowance is shown only at 5 or fewer, so it is not a meter on every answer.
- The picture is served from the /icons allowlist as image/jpeg.

## Review iteration 1 (fixed)
- BLOCKER: hosted must also mean no model of their own (#3660 rule 7). Every install from before the guide has no
  guide but has a model. It is now setupAssistant.hostedOffered: a connector AND listedModels() empty. It is used by
  the GET and by the POST, which refuses 409 own_model. H13 and unit arms cover it; the check has its own
  AGENT_WORKFORCE_HOME so it never reads this Mac's accounts.
- The 501 hands focus back to the page, and it is remembered for the session (sessionStorage). H9 and H9b cover it.
- On the move to a guide, the hosted allowance or refusal line is cleared (H8).
- NITs taken: a Thinking line while it answers (H3); only { screen } is sent (H3); 7 turns; no blink when a guide
  goes (confirmGuide reads hosted); the copy is "running on Kosmos until you connect your own AI"; turns alternate
  after a refusal (H5b); H6 waits, then asserts; H12 has a positive control.
- NIT left: the page hard-codes the .jpg. The engine allows other extensions, but the shipped file is the .jpg, and
  engine.setup-assistant-3034 pins that one ships.

## Weakest premise
That the connector ships with the page. It does: it is in the same bundle (app/bin), and the 0.6.94 cut carries the
rebuilt one. A board on an old connector sees the 501 path once per session.

## Verification
- render-assistant-hosted-3660 (H1 to H12), with a fake connector and the route answered in the check. H12 asserts
  the fake never ran.
- render-assistant-bubble-3034 still passes (54), including B1's "no bubble without a guide" in a checkout sandbox.
- server.setup-guide-page-3034: `hosted` is false on a checkout board. hostedAvailable is covered in four arms
  (real file, missing, a bare name, a directory), and the picture route is checked (a JPEG, plus a 404 control).

## Review iteration 2 (fixed)
- WARNING: not-guide (an agent took the guide's name) left `hosted` stale, and the bubble vanished. The 409 now carries
  `hosted`, and the page reads it for none and not-guide alike. H14 covers it (H11 allows that one 409, which dates
  from #3034).
- NITs taken: an own_model refusal says so and steps aside, with focus returned. "Thinking" is announced in the live
  region. The refusal's copy is "you've connected your own AI, so the setup assistant is moving over to it".
- NIT kept as a choice: listedModels() on each no-guide poll. It is local config reads, the poll backs off to a
  minute, and accounts already pays the same on the 5s tick.

## Review iteration 3 (fixed)
- WARNING: a guide made mid-answer got the hosted answer painted over its chat. Now the answer is kept in the hosted
  conversation and nothing is written once the mode changed (H17).
- WARNING: the 6s step-aside timers could close a guide's chat or a reopened one. They now only do so for the
  same hosted chat (openGen), never with a guide.
- WARNING: a mode switch hid the panel with focus inside. asbPaint's hide hands focus to the page, and a guide is
  adopted only once the board lists its row.
- NITs taken: the gold dot for an answer while folded (H16); asp-msg cleared whenever a guide is named; a 409 splits
  into own_model and no_connector with true sentences; /bin/kosmos-tunnel is gitignored so a checkout never offers it.

## Review iteration 4 (fixed)
- BLOCKER: the step-aside timer flipped hosted/hostedOff before its reopen check, so a chat folded and reopened in the
  six seconds was still hidden, with focus taken. The reopen check (openGen) now gates the flip as well. H9c covers
  it; control: with the old order, H9c fails.
- NIT: the duplicate asp-msg clear on guide adoption was removed. The double asbFocusPage on "Don't show this again"
  was left alone: it is the same target, and it predates this branch.

## Review iteration 5 (fixed)
- WARNING: a refusal while folded went unseen and the bubble left anyway. Now the dot lights and the six seconds
  start when it is opened (asbStepAside). H18 covers it.
- WARNING: the note did not say the words leave the Mac. It is now "An AI in Josh's voice. Until you connect your own
  AI, your questions go to ours, online. Josh isn't typing live." (H2).
- WARNING: H8's "allowance gone" could not fail. It now has a precondition with the line showing, and no reload.
- NITs taken:
  - the deferred adoption backs off to a minute;
  - own_model looks for the guide at once;
  - an unreadable model list is 503 'unchecked', not "your own AI" (hostedWhy, with unit arms);
  - each turn is trimmed to 2,000 characters;
  - the live region is cleared on a refusal.

## Review iteration 6 (fixed)
- BLOCKER: a folded hosted refusal still waiting (asideOnOpen, and its dot) survived the move to a guide. Opening
  the guide's chat then locked Send for six seconds. It is now cleared on adoption and in asbForgetGuide, and asbOpen
  never steps aside for a guide's chat. H19 covers that exact order.

## Review iteration 7 (redesigned, not patched)
The last rounds' findings mostly came from one design: timers that flipped state later while other code flipped
the same state sooner. Replaced:
- A 501 or 409 flips the hosted state at once.
- Only what is SHOWN is held, by asbStepping(): the open chat stays readable with Send off until asideUntil (six
  seconds), and a refusal while folded (asideOnOpen) keeps the bubble and its dot until it is opened and read.
- No timer changes state, openGen and asbStepAside are gone, and a guide takes the corner at once.
- Guide adoption waits for the row while hosted or stepping.
- WARNING (the own_model sentence was cut short by the board flipping): fixed by design. H20 flips the board for real.
- WARNING (Send locked on an adopted guide's chat): gone, since no lock outlives hosted and a guide never steps.
- WARNING (unchecked was unreachable): listedModels now reports `failed` when a provider list throws, and hostedWhy
  answers unchecked. There is a unit arm through the real listing.
- WARNING (stale after first run): the end of first run resets the find backoff.
- NITs taken: H19 reads before the click; switching on after the guide went shows the hosted bubble, not "not on this
  computer"; deferEvery resets.
- NITs left: the hosted answer after a mid-answer adoption is kept, not shown (H17's intended behaviour); hostedOff
  survives an in-window update (the connector ships with the page, so an update brings a new window); a11y of a
  folded answer is as for guide replies.

## Review iteration 8 (fixed)
- BLOCKER: opening a folded refusal ran asbPoll's guide confirm, which "forgot" a guide that never was, so the chat
  closed within milliseconds. asbPoll now reads a thread only with a guide. H18 asserts the chat is still open with
  the sentence and focus three seconds after opening (the old arm only checked "at some point" and "eventually").
- WARNING: folding during the six seconds lost the sentence. It is now kept behind the dot (H18b).

## Review iteration 9 (fixed, and the timer removed)
- WARNING W2: a six-second timer was the only way out, closing it restarted it, and it closed the chat under "Close
  the assistant?". The timer is gone. An open chat keeps the sentence until the person closes it, and closing it by
  any route (fold, x, Escape) is reading it. The x never asks while it steps aside. H9 (still open at 8s, x closes)
  and H18 (still open at 7s, Escape ends it) cover it.
- WARNING W1: the board withdrawing hosted mid-chat made it vanish silently. GET now carries `hostedWhy`. An open
  chat is told why and goes when closed (H21). 'unchecked' changes nothing. An answer arriving for a chat with no
  guide is still shown.
- WARNING W3: H19's precondition could not fail (`!== null` on a boolean). It is now `=== true`.
- NITs taken:
  - the hosted thread is cleared on adoption;
  - an old refusal is cleared when hosted comes back;
  - a send after the guide went is asked of the hosted assistant when it stands in;
  - the bubble's label says "there is something new to read" while the dot is lit (H18).

## Review iteration 10 (fixed)
- BLOCKER: the board withdrawing hosted while FOLDED still vanished silently (round 9 fixed only the open case). Now,
  for someone who was using it (wroteOnce), it waits behind the dot with the reason (H22). A bubble never asked
  anything simply goes (H22b, the control). Decided: wroteOnce is the line, because a person who never asked has no
  news to keep.
- NITs taken: one sentence per reason (ASB_WHY_OWN / ASB_WHY_NONE, matching the server's words), and while stepping the
  note reads "This chat has ended. Josh isn't typing live." instead of offering the service.
