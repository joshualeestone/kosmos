# limitwin-5805: a Windows agent out of usage reads rate_limited, with its reset, and its messages are held (#5805)

Splinter 10-19 08:14: the board half, after a Windows box went silent for 17 hours on one shared account's weekly
limit while every message was counted delivered and nothing on the board said why. The Mac half shipped in 0.7.43
(engine/limitqueue.js, "Looks like a usage limit until", the limit holds); none of it reached Windows.

## Why Windows never showed it (traced, file:line on origin/main 513adb090)
A Windows card's state comes from the agent's stream-json events (engine/win32streamstate.js), and only the event's
`type` was kept: busy or idle. `rate_limit_event` was pinned as saying nothing. So the win32 branch of status.classify
never returned rate_limited, claudeLimitUntilIso returned null, and every hold (chat.limitHeldVerdict, needing a
rate_limited card) passed: messages went through win32channel.say and were counted PLACED.

## The event's shape (read from the installed Claude Code 2.1.303's own schema, not guessed)
`{type:"rate_limit_event", rate_limit_info:{status: allowed|allowed_warning|rejected, resetsAt: int (epoch seconds),
rateLimitType: five_hour|seven_day|seven_day_opus|seven_day_sonnet|seven_day_overage_included|overage, ...}}`.

## Change
- engine/win32streamstate.js: the publisher keeps a `limit {until, kind[, line]}` from a `rate_limit_event` that Claude
  Code itself counts as a limit (review 2, read from its binary: status rejected, a reset time, and neither
  isUsingOverage nor overageInUse; an overageStatus of allowed or allowed_warning is room too). An allowed or warning
  event clears it, and so does a turn that reached the model (an assistant message since the last write or init) and
  ended without an error; a local command's result does not (it made no API request, so it says nothing about the
  account). A refused turn's error arrives as an assistant message and its result carries is_error true (Claude Code
  2.1.303: is_error follows the last assistant's isApiErrorMessage), so is_error is what keeps that turn's own result
  from clearing the limit (review 3); a repeat of the same refusal keeps the sentence already read. The first error sentence after the refusal rides along as its evidence (one line, capped at 300). A
  transition is the state token AND the limit, so a refusal while idle is written. `stateFor` returns
  `limit <until> <kind|->[ <line>]` while the reset is ahead; past it, the plain state comes back. resetsAt above
  1e12 is taken as milliseconds.
- engine/status.js: the win32 branch maps that token to rate_limited / scraped (the Mac's reading, so the card says
  "Looks like a usage limit until <time>" and the existing holds apply); claudeLimitUntilIso uses the stream's reset.
- engine/status.js reconcileReport (review 5): a Windows agent has Kosmos's hooks, and a fresh report outranks a screen
  reading (#966). The stream's limit is the account's own refusal, not a screen, so a fresh AUTOMATIC report (working
  when a message is typed in, idle when the refused turn ends) cannot outrank it, exactly as #3723 lets Codex's and
  Gemini's limit messages stand. Only the AGENT's own report can outrank it (review 7: an operator clear says
  nothing about the account either), and only one newer than the LATEST refusal (reviews 6-7: a capped session cannot
  write a new report, and a refusal after it proves the account is capped now). The token carries that time
  (`limit <until> <since|-> <kind|->[ <line>]`).
- engine/win32capture.js (review 7, after rebasing onto main): #6131 made the capture accept only busy and idle and
  treat anything else as a failed look, which would have dropped the limit token silently on a clean-looking merge.
  It now also accepts the token (win32streamstate.isLimitToken), but only the two plain tokens are CARRIED across a
  restart, since a carried limit would skip stateFor's reset expiry (the carry file may record one; it is not read
  back). A held limit reading is logged as "out of usage", not "idle" (review 8; arm and mutant). Without this, a box whose refused turns fire
  Stop would read idle and hold nothing: the 17-hour failure again.
- engine/status.js (review 9): main's #5949 rule reconciles a REMEMBERED reading (a failed look) as unknown first, so a
  hook's automatic idle decided the card and the held backlog was released into a capped session. A remembered Windows
  usage limit (the account's refusal, not a remembered screen) is used directly instead; reconcileReport still lets the
  agent's own newer report outrank it. Arm: a limit plus the Stop hook's idle, then a failed look, stays limited and
  held (mutant fails it).
- engine/win32streamstate.js (review 9): a refused request's own error message (is_api_error_message in Claude Code's
  schema) does not count as reaching the model, and a result with api_error does not clear; so the limit no longer
  depends on a refused turn's result carrying is_error true (arm and mutant).
- engine/chat.js: limitHeldVerdict uses a Windows card's limitUntil first (reachedByChannel is true only for Windows
  panes), so the hold and the card agree on the reset (review 1). No Mac card changes.
- No new control and no new wording on the page.

## Test
engine/win32limit-5805.test.js, 27 arms, on the Windows runner's list (selectFiles picks it): the real publisher, a
real state file, the real capture and status.snapshot(), the real holds. A refusal plus a failed turn reads
rate_limited with the stream's reset and the turn's sentence, and both holds hold with the card's reset; an allowed
event, a warning event, or a successful real turn clears it; a local command's result does not, also after an
earlier real turn; each of the four extra-usage flags alone is room; a refusal with no reset is no claim; a past reset
reads idle; a reset in ms reads right; CONTROL allowed and warning events alone read idle; a REAL refused turn (its
error as an assistant message, then is_error true), twice, stays limited and keeps Claude's sentence (review 3). Mutants (reverted fix;
no overage check; no overageInUse; clear on any result; no warning clear; overwrite the line; the sentence's date
first; no is_error guard; no keep-the-sentence rule) each fail their arm. With no sentence from Claude the card
quotes nothing (review 4: the account-problem box shows evidence as `Claude says: "..."`), and a write with no init
starts a new turn for the flag. The real hook sequences (review 5): against an automatic working report, an automatic
idle report and StopFailure's blocked report the card stays rate_limited and held; CONTROL the agent's own fresh
report still outranks it. A refusal with no reset neither sets a limit nor clears a live one. Mutants: no exemption
(the working and idle arms fail); no no-reset guard (that arm fails). The 24 test files touching reconcile, rate
limits or limitUntil: 667/667. Review 6: the agent's own report from before the refusal does not outrank it; one
from after does (CONTROL); mutant without that rule fails its arm. Review 7: an operator clear does not outrank it,
and the same refusal again after an agent report wins (mutants: auto-only exemption; first-seen time) each fail their
arm. Rebased onto main 858c20a7c (the capture's #6131 filter): 24/24; 27 neighbour files incl. every win32capture
test: 735/735; the four full-suite guards pass. win32streamstate.test.js and the Mac limit neighbours pass.

## Not done (the device half, parked as the card says)
- The page's existing wording says "<name>'s screen said: <sentence>" for a Windows card too, where the sentence comes
  from its stream (review 5 NIT); left for a wording pass, since changing page copy needs its own browser check.
- engine/assigner.js's limitedCard reads a reset only from the card's sentence, not limitUntil, so a Windows card
  whose sentence has no date is not treated as limited by the failover (the chat hold is). That errs on the safe side
  (no work is moved off it) and is left for a follow-up (review 4).
- The limit lives in the supervisor's memory: a restart while the account is still capped reads idle until its first
  refused request, and each agent on a shared account reads limited only once its own session is refused. Not a
  regression; one message is typed and refused before the card says so.
A real capped account on the Windows box. The fixture follows Claude Code's schema; a real capture is still the test
of the exact `result` sentence.

## Weakest premise (and one more, review 2)
- Two independent guards now keep a refused turn from clearing its own limit: its error message does not count as
  reaching the model (is_api_error_message), and its result carries is_error (review 9). Both are read from the
  installed binary's schema, not from a captured capped stream.

That a capped Windows session emits a rejected rate_limit_event at all in headless stream-json mode (the schema says
the event carries status rejected for a refused request, and the box measured rate_limit_event arriving mid-turn, but
a real capped stream has not been captured). If it does not, the card still reads idle, as today: no regression.
