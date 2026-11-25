# taskchecks-8958: Done when, the wake line, and the last way out to the board (kosmos#8958 slice B9)

Stacked on taskholdform-8958 (B8).

## What the board does (web/index.html paintTaskPage, tkCheckResults, tskWakeSentence, tkClosedHowWords, tkStateWord)
- Done when: each check, with "<name> says met: ...", "... says not met: ...", or "Not reported yet"; one not met can name the task its
  part moved to (a link). Under it, the checks of other tasks that moved here. Reading only: agents write them (kosmos task).
- The wake line (kosmos task wake, #8669), under the repeat line, on an open task.
- State: "Closed, not run" (#8301), and how it was closed ("with a change", "on a note", "without being marked built", #8552) unless
  the last check found its commit missing (#8555). The phone said Done for all of these. Found while reading for this slice.

## Call
- Same words, pinned to web/index.html. The "Moved to" link is its own line under what is said (a 44 point target), where the board
  runs it into the sentence.
- The info button is dropped, not relabelled. Review round 1 found more it still gave, closed here: the Activity's words (the wake
  events, and parts of done-when-set, check-reported, hold-set and hold-stale), now checked against the board's own tkActPhrase on
  every event it knows; the links in the state line and on a replaced row (their own lines, "Open task N"); and the runs a folded row
  holds. The checks are under the hold section, so Mark as done stays near the top.
- Left on the board's page alone, and why that needs no way out: "Show me where the task conversations live" (the board hides it when
  opened remotely); block Markdown in a detail (headings and lists show as written, as in the phone's other texts); the link back to
  the project (the Projects tab); faces beside the parts; the hint about holds on a task that is not held.
- With it go TaskPageView.openPage, BoardClient.taskURL and Tasks.taskPageURL, which nothing else used.
- Weakest premise: a task this phone cannot show in full (a repeat rule of a new kind) now has no link, only the words saying to open it
  on the computer's board.
