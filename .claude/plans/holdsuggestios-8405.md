# holdsuggestios-8405: the iPhone shows the suggested answer beside a for-you hold's question

Card: kosmos#8405 (follow-up to Angel's #8395, which adds onHoldSuggest). Built on holdsuggest-8395 (20a6e5c784); rebase onto main when #8395 merges. Angel confirmed the field is settled (Fleet Builders m3909).

## Finished looks like
On the iPhone, a task an agent held for the person reads "On hold until you answer: <question>. Suggested: <answer>. Open it and take it off hold once you have.", word for word as the board's row (tskHoldSuggestWords between the question and the clear hint). There is no suggestion on any other hold, and none when it is blank.

## Shape (decided)
- Board.TaskRow.holdSuggest is read from onHoldSuggest: trimmed, and nil when blank or not text.
- Tasks.forYouLine adds holdSuggestWords: " Suggested: " + text, plus a full stop unless it ends in . ! or ?. It applies only when holdForYou (onHold and onHoldForPerson), the same gate as the board.
- The task page is unchanged: the iPhone task page shows no question today (its holdLine is the board's tk-hold-hint), so there is nothing for a suggestion to follow there.
- Weakest premise: the task row is the only iPhone place showing the question (grep of ios/ for onHoldBecause and forYouLine).

## Tests
ios/LogicTests/tasks/main.swift:
- a suggestion after the question, with its full stop;
- one ending in ? gets no extra full stop;
- control: a plain hold shows none;
- premise: the board's tskHoldSuggestWords and row text;
- the read trims, and drops blank and non-text values.
Every iPhone logic suite passes (run.sh 2135/2135, tasks 156/156, room 871/871 and the rest).
