# amhang-6226: the account move's per-agent cap timer no longer holds a process open

## Call
Unref the 330 s per-agent cap timer in engine/accountmove.js. The board's server keeps the event loop alive, so the
timer still fires there; alone, it no longer keeps a process up for 330 s after a test that left a restart unanswered.
Rejected: a test-only teardown (it would fix this file and leave the same trap for any other caller of start()).
Weakest premise: that nothing on the board relies on this timer to keep the process alive (a board always has its
HTTP server open, so it cannot).

## Evidence
- Before: the file never exited alone on origin/main (still running at 45 s).
- After: it exits in 2 s, 19/19 plus the new test.
- New test: a move with a never-answering restart, in a child process, must exit within 20 s. Mutant (unref removed):
  red.

## Review
