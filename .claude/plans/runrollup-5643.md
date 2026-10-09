# runrollup-5643: roll up a recurring task's unchanged runs (#5643, slice 1)

From a user's feedback (2026-10-09, triaged by Splinter). A long monitoring task's "On a schedule" runs (#5456,
#4787) mostly find nothing new, and each one adds a full row to the task's history, so the few that matter get buried.

## Finished looks like (slice 1)
- A run can be recorded as UNCHANGED, and the task keeps the last change apart from the last run.
- The task page's repeat line is the status card: what is missed (red, first), the last run, how many runs in a row
  found nothing new since the last change (and what that change was), and the next run.
- In the task's history, a streak of 2 or more consecutive unchanged runs is ONE row ("12 runs found nothing new", or
  "repeated the same note" for runs the board only inferred), and pressing it shows each one. Changes, late runs and
  missed runs keep their own rows.
- Both CLIs: `kosmos task ran <project> <n> --unchanged ["what it checked"]`.

## Decisions (Angel; the card asks the builder to make these)
- **How an agent marks a run unchanged: two ways.**
  - The explicit `--unchanged` flag, which an agent uses when it knows nothing changed.
  - Automatic: a run whose note is the same text as the run before it (whitespace aside) is unchanged. That is how an
    agent that has not been taught the flag ("all clear", "no new items") gets the rollup today. Never a note with a
    digit in it (review 1): "found 2 new errors" can repeat word for word over two different pairs of errors, so a
    repeated count or reading is unchanged only when the agent says so.
  - **The page says which is which** (review 2). A run the agent marked "found nothing new"; one the board inferred from
    a repeated note "repeated the same note" (in the history, the status line and both CLIs), since the same words can
    still cover new things ("found two new errors"). An inference never reads as a fact. Any numeral (Unicode \p{N})
    keeps a note out of the automatic match.
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
That repeating agents write the same note, with no number in it, when nothing changed. One that varies its wording each time ("checked at
10:05, nothing new") gets no automatic rollup until slice 2 teaches the flag.

## Review log
- **Round 1 (opus):** 0 blockers, 3 warnings, all fixed.
  - W1: clearing the repeat left the streak; it is now dropped on a clear and, like `lastRunLate`, on a rule change.
  - W2: a repeated note with a digit can hide a finding; such notes are never automatic.
  - W3: the status line said the same note twice; now once.
  - Conventions fixed: both CLIs read "found nothing new" from the board's answer, so an automatic one says so; the rule-change reset (above).
  - NITs fixed:
    - a redraw keeps an opened rollup open (keyed by place and time, browser-checked);
    - the disclosure mark has empty alt text;
    - a comment on the count versus the history;
    - the route test's name.
- **Round 2 (sonnet):** 0 blockers.
  - W fixed: the digit guard was a partial patch. Now the board records which unchanged runs it inferred, and the page and both CLIs say those as "repeated the same note", never "found nothing new"; \p{N} instead of \d.
  - CONVENTION fixed: a plain `content` line before the alt-text form, for older browsers.
  - NIT decided: after a rule change, `lastRunNote` still carries, so the first run with the same note can read "repeated the note before it" with no change named. That is true, and harmless.
- **Round 3 (opus):** 0 blockers.
  - W fixed: a run with no note and no flag ended the streak AND was called "the last change". It still ends the streak, but names no change.
  - C fixed: both CLIs drop "groups it with the runs like it", which a first inferred run or a late run makes untrue.
  - NITs fixed:
    - closing a task drops the streak (dropRunStreak, one helper for the four places);
    - the route, recordRun and history comments;
    - a test isolating unflagged identical runs;
    - a test that duplicate is said before unchanged in both CLIs;
    - one redundant CSS line.
- **Round 4 (sonnet):** 0 blockers.
  - W fixed: two dropRunStreak call sites had no test that could fail (the clear itself, and a task closed by its last part). Both are now tested directly.
  - NITs fixed: the comment reflowed, and the plan's wording matched to what ships.
- **Round 5 (opus):** nothing above NIT, CONVERGED. NITs taken: the CSS comment, a rule line under an open rollup's summary, and a test header.
