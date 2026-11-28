'use strict';
/* kosmos#8378 group 5: loaded with --require into a board a test starts as a child process, on Windows only (see
   test-support/faketmux-win.js childArgs), so that board reads fake tmux's panes and screen the way an in-process test's
   board does. It runs before server.js, with the child's own environment, so it reads that board's fixture files.

   A board starting on Windows wires its own roster and live state (server.js: status.setPaneSource(win32roster.make())
   and status.setPaneCapture(win32capture.make(...)), from `claude agents --json`), which would replace these seams. So
   in this child those two factories hand back fake tmux's reads instead: the board's own wiring runs unchanged, and what
   it installs is the fixture. Measured on GitHub's Windows runner (run 46120636257): without this the eight board-start
   files still saw no existing agent. */
const win = require('./faketmux-win');
win.serveOnWindows();
const { source, capture } = win.current();
if (source) {
  require('../engine/win32roster').make = () => source;
  require('../engine/win32capture').make = () => capture;
}
