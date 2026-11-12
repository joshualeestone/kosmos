# holdsuggestios-8405: the iPhone shows the suggested answer beside a for-you hold's question

Card: kosmos#8405 (follow-up to Angel's #8395, which adds onHoldSuggest). Built on holdsuggest-8395 (20a6e5c784); rebase onto main when #8395 merges. Angel confirmed the field is settled (Fleet Builders m3909).

## Finished looks like
On the iPhone, a task an agent held for the person reads "On hold until you answer: <question>. Suggested: <answer>. Open it and take it off hold once you have.", as the board's row says the question and the suggestion (tskHoldSuggestWords right after the question). Not word for word with the whole row: the board then adds tskHoldToldWords ("It asked you 3 minutes ago."), which the iPhone has never shown (no HoldTold under ios/). That gap predates this change and is out of scope here. There is no suggestion on any other hold, and none when it is blank.

## Shape (decided)
- Board.TaskRow.holdSuggest is read from onHoldSuggest: trimmed, and nil when blank or not text.
- Tasks.forYouLine adds holdSuggestWords: " Suggested: " + text, plus a full stop unless it ends in . ! or ?. It applies only when holdForYou (onHold and onHoldForPerson), the same gate as the board.
- The task page is unchanged: the iPhone task page shows no question today (its holdLine is the board's tk-hold-hint), so there is nothing for a suggestion to follow there. Known gap, older than this change: the board's task page shows both the question and the suggestion (tkPaintHoldUntil), and the iPhone's shows neither. Raised on #8405 for routing.
- Weakest premise: the task row is the only iPhone place showing the question (grep of ios/ for onHoldBecause and forYouLine).

## Tests
ios/LogicTests/tasks/main.swift:
- a suggestion after the question, with its full stop;
- one ending in ? gets no extra full stop;
- control: a decision row that is not a hold for you shows none, whether set directly or parsed from onHold without onHoldForPerson;
- . and ! endings get no extra full stop, as ? does;
- premise: the board's tskHoldSuggestWords and row text;
- the read trims, and drops blank and non-text values.
Every iPhone logic suite passes (run.sh 2135/2135, tasks 160/160, room 871/871 and the rest).

## Review ledger
- R1 opus: 0 B, 2 W (the plan's "word for word" was false: the board then adds tskHoldToldWords; the task page gap unnamed), NITs (a control that could not go red, untested . and ! endings, trim notes). Fixed; both older gaps raised on #8405.
- R2 sonnet: 0 B/W/C, NITs only. Converged. Every iPhone suite passes (the reviewer ran all thirteen).

## Status
- [x] built and reviewed
- [ ] rebase onto main once #8395 merges; full validation; proof; PR; mog
