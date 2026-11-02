# What's New notes for 0.7.77 to 0.7.83 (#7411, from #7784 item 5)

Josh's 0.7.83 model-family report: `kosmos whats-new` says 0.7.83 added no notes, and four CLI commands since 0.7.76
have none. The pool had nothing newer than 0.7.76.

Adds five pending items to release/whats-new-pool.json:
- "Say why a task is on hold" (0.7.82, #7749), for people, rank 14.8: it takes a slot in the next window.
- Four agent CLI notes, ranks 50 to 53 so they reach `kosmos whats-new` without taking a slot in the next windows
  (eleven items are pending above them, this branch's hold note included): `task built --commit` (0.7.73, #7508),
  `task close --with-built` (0.7.74, #7514), `task hold --because` (0.7.82, #7749), `agent list` (0.7.83, #7748:
  the list itself is 0.7.82, but an agent saw whether each agent runs only from 0.7.83, rosterstate-7748).
  Nothing keeps them out of the window for good: after about two prod promotes they would rise into it. Whoever builds
  that window retires them by hand first (status shown, as a Windows-only item is), or the pool gains a notes-only mark. Each is in both CLIs (install/kosmos and
  tools/windows/kosmos-cli.js), so none is tagged for a platform.

`since` is the first version commit after each change merged. No restart marks: none changes an agent's instructions,
hooks or launch.

Not here: web/whats-new.json, which the 0.7.84 cut builds (`tools/whats-new-pool.js build 0.7.84`); 0.7.83 itself keeps
its empty notes, since its bytes are cut.
