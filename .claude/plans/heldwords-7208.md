# heldwords-7208: plain words for a held message (kosmos#7208)

## Finished looks like
A person's message that Kosmos is holding reads as "nothing is wrong, here is why it waits", says the REAL reason
(out of usage or not running beats a half-typed message box), and is said once: on the message's own row, not
again under the composer.

## Built (as of review round 2)
- dmHeldWords: no "Held:", one order of reasons read off the agent's card as the server reads it before it types:
  signed out ("X is signed out. This delivers once X is signed in again."), out of usage ("X is out of usage until
  <time>. This delivers when X is back.", or "... once X is back and its message box is clear." when the box blocks it
  too), not running, waiting on an answer from you, queued ("Queued behind earlier messages to X."), the message box
  ("Waiting to deliver: X's message box has unsent text in it. Yours goes through as soon as that is cleared."), and
  back ("X is back. This goes through in a minute or so." only when the card is idle and nothing is failing).
- dmHeldAgent finds the agent's card by session (both callers pass it), else by the name the thread shows.
- sendTalk: the line under the box no longer repeats the row.

## Decided (Josh's example copy adapted)
- Josh's example said "Dario is in the middle of typing ... as soon as he's done". Rejected: the text in the box
  may be Josh's own or left from before, so "typing" can be false, and the product never guesses an agent's
  pronoun. Said instead what is true: the box has unsent text.
- Weakest premise: the agent card's `state`/`limitUntil`/`running` is current enough at paint time (it is the
  same 5 s poll the card itself shows). If it lags, the row says the box reason for one poll.
- Would change my mind: Josh preferring his exact example words, which is a one-line swap.

## Evidence
- docs/browser-checks/render-dm-held-5805.js: 15 passed (each reason in its own words, nothing under the box);
  against origin/main's page, 9 red.
- Root unit set 3552/3552. #2518 surface gate exit 0.

## Review
- Round 1 (.claude/plans/heldwords-7208-review1.md): 0 blockers, 3 warnings, 5 nits. All taken:
  - Queued: "Queued behind earlier messages to X." (the queue is shared with other agents and task notices), and a
    queued row leads with the real reason when there is one ("... This delivers after the messages ahead of it, when X
    is back.").
  - Box-kept to an agent out of usage: "This delivers once X is back and its message box is clear." (usage returning
    does not clear the box).
  - A usage hold past its reset with the card running: "X is back. This goes through in a minute or so."
  - Restarting is not "not running"; signed out (hold or card auth_failed) beats the box and a scraped limit; a scraped
    limit borrowed from the card is hedged ("looks to be out of usage").
  - dmHeldAgent: the open chat's card, else the board list by name (the dead m.to arm dropped).
  - Comment updated; web.inputkeep-6774 anchored on code, not on a comment.
  - Evidence: a unit case per finding (web.inputkeep-6774); render-dm-held-5805 15 passed; root unit set 3552/3552.
- Round 2 (.claude/plans/heldwords-7208-review2.md): 0 blockers, 3 warnings, 4 nits. All taken:
  - "Back" is the card's release state as the server types on it (idle, or blocked with an idle screen, not a remembered
    screen), never heldUntil and never while a send is failing ("This goes through when Kosmos can type it." then);
    an agent waiting on an answer says so; a card that does not know leaves the hold's own words.
  - A stopped card outranks a usage hold, so one agent's held rows give one reason.
  - dmHeldAgent by session: the DM rows pass DM_ROWS_OF, the project panel body.agent.sessionName; by name only as a
    fallback, on the card's `name` (cards carry no displayName: the strict fleet fixture throws on reading one).
  - Plan "Built" rewritten; the browser check's control tests every row; the em dash in review1 removed.
  - Evidence: unit cases per finding, incl. a session lookup over real fleet cards (two agents named Gemini, one named
    as another's session); render-dm-held-5805 15 passed.
- Round 3 (.claude/plans/heldwords-7208-review3.md): 1 blocker, 2 warnings, 3 nits. All taken:
  - BLOCKER: dmHeldAgent read CURRENT first, which is the card as it was when the chat was opened (the poll never
    reassigns it). Now the poll's card (LAST) first, CURRENT only when the poll has none. Browser case: a stale idle
    CURRENT with a polled rate_limited card says out of usage; with the old order it goes red.
  - A held send is announced once in the quiet region (#d-reply-say), and while a search hides the row the line under
    the box says "Your message is kept to send later. Clear the search to see it." Browser cases for both.
  - A card that knows decides, as the server does (signinHeldVerdict, limitHeldVerdict): a sign-in or usage hold keeps
    its words only when there is no card or it cannot say (no state, unknown, stale, a lost connection, error,
    restarting, remembered). A stopped card on a sign-in hold says not running; a working one the neutral line.
  - The "waiting on an answer" line is gone: a question on screen may or may not hold the sweep, so the neutral line
    ("X is back. This goes through when Kosmos can type it.") is the true one.
  - The em dash quoted in review2 removed.
- Round 4 (.claude/plans/heldwords-7208-review4.md): 0 blockers, 1 warning, 2 nits. All taken:
  - The search line is said only when the search really hides the kept row (talkFilterRows on its own words), and the
    search input clears it, as it clears #4256's line. Browser cases: a matching search says nothing; clearing the
    search clears it. Both go red on round 3's code.
  - A sign-in hold never takes its time from heldUntil (that is the one-minute relook, not a reset).
  - "unsure" is the board's own states that cannot say (unknown, restarting); connection_lost has its own line ("X lost
    its connection. This delivers when X is connected again."), since both holds are released then.
