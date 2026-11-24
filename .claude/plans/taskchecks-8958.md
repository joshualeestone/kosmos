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
- The info button is dropped, not relabelled: with this slice the page has everything the board's task page has, except "Show me where
  the task conversations live", which the board itself hides when it is opened remotely (data-remote-hide).
- With it go TaskPageView.openPage, BoardClient.taskURL and Tasks.taskPageURL, which nothing else used.
- Weakest premise: a task this phone cannot show in full (a repeat rule of a new kind) now has no link, only the words saying to open it
  on the computer's board.
