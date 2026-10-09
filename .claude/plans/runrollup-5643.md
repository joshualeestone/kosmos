# runrollup-5643: roll up a recurring task's unchanged runs (#5643, slice 1)

From a user's feedback (2026-10-09, triaged by Splinter). A long monitoring task's "On a schedule" runs (#5456,
#4787) mostly find nothing new, and each one adds a full row to the task's history, so the few that matter get buried.

## Finished looks like (slice 1)
- A run can be recorded as UNCHANGED, and the task keeps the last change apart from the last run.
- The task page's repeat line is the status card: what is missed (red, first), the last run, how many runs in a row
  found nothing new since the last change (and what that change was), and the next run.
- In the task's history, a run of consecutive unchanged runs is ONE row ("12 runs found no change, the latest 4m
  ago"), and pressing it shows each one. Changes, late runs and missed runs keep their own rows.
- Both CLIs: `kosmos task ran <project> <n> --unchanged ["what it checked"]`.

## Decisions (Angel; the card asks the builder to make these)
- **How an agent marks a run unchanged: two ways.**
  - The explicit `--unchanged` flag, which an agent uses when it knows nothing changed.
  - Automatic: a run whose note is the same text as the run before it (whitespace aside) is unchanged. That is how an
    agent that has not been taught the flag ("all clear", "no new items") gets the rollup today.
  - A run with no note and no flag is not unchanged: nothing says so.
  - Rejected: guessing from words like "no change". A note saying "no change in X, but Y is down" would roll up a
    finding.
- **Keep each unchanged run's text in the expandable history: yes.** A run note is at most 500 characters, and the text
  is what shows a run really checked something. The rollup hides the rows; it does not delete them.
- **Missed runs and their alerts are untouched** (slice 2 of #4787 already says them first and tells the reviewer).
  A late run keeps its own row even when unchanged, since lateness is news.
- **Slice 2 (follow-up): the instruction text.** Telling agents to use `--unchanged` and to post nothing in the room
  for an unchanged run is a change to the working rules, and every rules version is measured with claude -p before it
  merges. Until then, the automatic match covers agents that repeat the same note.

## Weakest premise
That repeating agents write the same note when nothing changed. One that varies its wording each time ("checked at
10:05, nothing new") gets no automatic rollup until slice 2 teaches the flag.

## Review log
