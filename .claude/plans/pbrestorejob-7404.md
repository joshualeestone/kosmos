# Personal backup: the restore routes, off the board's event loop (#7404)

The routes a restore screen calls, with the restore itself in a child process the board forks. No screen here.

- `engine/personalrestore-child.js`: forked with an IPC channel; takes one ask (list, or restore one key), answers once,
  exits. It signs nothing: its Kosmos+ requests go to the board as `{ mac }` and come back as `{ macAnswer }`. It exits
  when the channel closes, so no restore outlives its board.
- `engine/personalrestorejob.js`: the board side. `list()` (shared while one runs, 5 minute bound), `start(key)` (one
  restore at a time on this board; answers at once), `status()`. Signs only the three routes a restore makes
  (member-key/mine, mine/manifests, mine/read), through remote.macRequest so the busy() guard around register and
  Forget holds; any other is answered as refused and never sent. Both answers leave by named fields only.
- `server.js`: POST /api/personal-backup/backups, POST /api/personal-backup/files, GET /api/personal-backup/files. Same
  gates as the other personal backup steps: 404 with the switch off, the person's only, and both POSTs need a step-up
  from a remote session.

Rejected: a worker thread (shares the board's process, so a crash or kill in the restore takes the board), and letting
the child call the tunnel itself (signs outside busy()).

Not here: the screen (design review); carrying on a stopped restore; a real restore through the child end to end (the
tests fork the real child but personal backup is off in their sandbox, so the signing path is covered by a stand-in
child and by the child's own half in-process).

Tests: engine/personalrestorejob-7404.test.js, server.personalbackup-7404.test.js; guards engine.reachable,
tools/test-connector-verbs.sh updated.
