# departed-4540: after `kosmos task message`, say who was told and who was not

Card: joshualeestone/kosmos#4540 (claimed:angel), rescoped on the card after measuring: the other task
notifications do not reach departed assignees with a reply to make; what is false is the CLIs' sentence.
Built on #4491 slice 3 (#4551, squash 70a2529da, on main), whose departed-assignee filter this reports on.

## Finished looks like
After `kosmos task message` (Mac and Windows), the command prints "Message recorded on task N of P." followed by
the board's own sentence saying who was told, who may have been told, and who was not and why (an Off swarm, an
assignee no longer on the project, a delivery that failed), or that nobody is assigned. It never claims an
assignee was notified when the board says it was not. Against an older board that sends no summary, it prints
only the first sentence.

## Decisions
- The board builds the sentence (`summary`), from the same `delivered` list it already returns, because the Mac
  CLI is bash 3.2 with no JSON parser (a clean Mac has no python3 or jq). The CLI extracts one plain string with
  sed, exactly as it already extracts `error`. The summary is built without double quotes or backslashes so that
  extraction cannot be cut short or mis-read.
- Wording per state: placed -> "Told X."; unconfirmed -> "X may have been told (Kosmos could not confirm it)."
  (never "told" for unconfirmed); could_not -> "Not told: <the board's reason>."; no assignees -> "Nobody is
  assigned to it, so no agent was told." The sender is already left off `delivered`, so it is never listed.
- Rejected: parsing `delivered` in bash (fragile over agent names and reasons), and keeping a vaguer fixed
  sentence ("assignees may have been notified"), which is true but tells the person nothing.

## Weakest premise
That a person reads this line. The CLI is mostly run by agents; the sentence still matters because an agent acts
on it (it may otherwise wait for a reply from an assignee that was never told).

## Tests
- Server: `summary` for told, unconfirmed, a departed assignee, an Off swarm, and no assignees; it contains no
  double quote or backslash even when a reason does.
- Mac CLI (stub board): prints the summary; with no summary field, prints only "Message recorded ..." and never
  "were notified".
- Windows CLI: the same two cases through its own test harness.
