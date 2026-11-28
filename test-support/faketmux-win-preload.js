'use strict';
/* kosmos#8378 group 5: loaded with --require into a board a test starts as a child process, on Windows only (see
   test-support/faketmux-win.js childArgs), so that board reads fake tmux's panes and screen the way an in-process test's
   board does. It runs before server.js, with the child's own environment, so it reads that board's fixture files. */
require('./faketmux-win').serveOnWindows();
